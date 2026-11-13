# Lista de despliegue de F14 (roles, permisos y aislamiento)

> Escrita en F9 (2026-11-08). Todo lo que hay aquí se ejecutó al menos una vez sobre la base de desarrollo y sobre una base vacía; **nada se ha ejecutado contra producción**. Los pasos marcados 👤 son de la persona que despliega: dependen de datos o de un teléfono que el equipo de desarrollo no tiene.

## 0. Qué hay que saber antes

- **Mergear a `main` despliega** (`.github/workflows/deploy.yml` → `/opt/kobrax/deploy.sh`). No hay un paso intermedio: lo que llega a `main` corre en producción en minutos. Por eso el orden de abajo empieza *antes* del merge.
- `deploy.sh` migra la base **antes** de reiniciar los servicios. Si la migración o una verificación falla, **los servicios no se reinician** y sigue corriendo la versión vieja sobre una base ya migrada. Las migraciones de F14 son aditivas, salvo el retiro de `user_permission_overrides` (ver 2.3).
- El respaldo previo lo deja `deploy.sh` en `/opt/kobrax/backups/` (paso 5 del script). Es el punto de retorno.

## 1. Interruptores reales (los del plan maestro §G tenían nombres que no existen)

| Interruptor | Valor al desplegar | Qué hace | Cuándo cambiarlo |
|---|---|---|---|
| `AUTHZ_VERSION_CHECK` | **on** (por omisión) | El guard compara la versión de autorización del token (`av`/`pv`) con la vigente. Un token viejo recibe `AUTHZ_STALE` una vez y renueva solo. | No apagar, salvo para volver atrás F1. |
| `AUTHZ_DENY_BY_DEFAULT` | **enforce** | Un handler sin contrato de acceso se niega. | No apagar. |
| `SCOPE_RLS_MODE` | **off** | Seguridad de filas por alcance (oficina/responsable) dentro de la cuenta. `off` → `log` → `enforce`. | Ver 4. |
| `PII_MOBILE_MASK` | **off** | El móvil recibe el documento enmascarado. | Ver 5. **Solo cuando la versión mínima de la app sea la de F8.** |
| `FILE_LINK_SECRET` | **definido** (secreto largo) | Firma los enlaces de archivos (F4). | Es obligatorio en producción; sin él los enlaces no se firman. |
| `PLATFORM_ACCESS_ENABLED` | off | Acceso de la persona de plataforma. | Solo al activar soporte. |
| `SUPPORT_WRITE_ENABLED` | off | Escritura en sesiones de soporte. | Solo con consentimiento de la cuenta. |
| `PLATFORM_ENROLLMENT_KEY` | definido solo durante el enrolamiento | Alta de la única persona de plataforma. | Quitarlo después del enrolamiento. |
| `PLATFORM_ADMIN_EMAIL` | solo en el seed | Correo de la persona de plataforma. | — |

No existen `RLS_SCOPE_MODE`, `PII_PROJECTION` ni `FILES_LEGACY_UPLOADS`: eran nombres del plan y no llegaron al código.

## 2. Antes del merge 👤

1. **Respaldo propio y ensayo sobre una copia real.**
   ```
   # en el servidor
   docker exec kobrax-postgres pg_dump -U postgres --clean --if-exists kobrax | gzip > kobrax-copia.sql.gz
   # en una máquina con el repo y Docker (NO en producción)
   bash infra/production/release-rehearsal.sh kobrax-copia.sql.gz
   ```
   Debe terminar con `✓ ENSAYO SIN PROBLEMAS`. Si no, **no se mergea** hasta entender cada ✗. El ensayo restaura en una base aparte, migra, aplica las políticas, corre las verificaciones, compara los permisos de antes y después y avisa de clientes sin oficina de registro. No toca producción.
2. **Qué mirar en el informe del ensayo**
   - `user_permission_overrides` con filas → la migración que la retira **se detiene** (a propósito). Revisar esas filas y decidir antes.
   - «ningún permiso se quitó a nadie»: se aceptan permisos nuevos; **quitar** uno es una diferencia que hay que explicar.
   - «la copia de cada cuenta dice lo mismo que el rol global»: debe dar 0 diferencias, salvo copias divergidas.
   - Clientes sin oficina de registro: no son un error; los ve el administrador y quien los creó. Decidir si se asignan.
3. **Contar `user_permission_overrides` en producción** (el ensayo lo hace sobre la copia; conviene confirmarlo en vivo justo antes):
   `SELECT count(*) FROM user_permission_overrides;` (si la tabla ya no existe, no hay nada que hacer).
4. **Comunicar**: al desplegar, **toda sesión abierta recibe `AUTHZ_STALE` una vez** y se renueva sola (web y móvil). La persona que está escribiendo un formulario no pierde lo que escribió, pero conviene avisar que puede ver una recarga breve.
5. **CI**: `.github/workflows/ci.yml` corre en cada pull request. Antes de mergear tiene que estar en verde, y conviene activar la protección de rama de `main` para exigirlo. *(El flujo nunca se ha ejecutado en GitHub: la primera corrida puede pedir ajustes; ver `execution/VERIFICATIONS.md`, V-064.)*

## 3. El despliegue en sí

`deploy.sh` ejecuta, en orden: traer `main` → instalar → cliente Prisma → compilar → **respaldo** → función base de RLS → **migrar** → políticas RLS (sin los `verify_*`) → **verificaciones (8b)** → reiniciar → comprobar arranque → firewall.

- El paso **8b** es nuevo: corre `prisma/rls/verify_*.sql`. Un fallo imprime la causa y **detiene el despliegue antes de reiniciar**.
- Antes de F9, el paso 8 aplicaba los `verify_*.sql` como si fueran políticas (solo excluía `verify_isolation`). Ahora los excluye a todos.

### Si una verificación falla

1. Leer la causa en la salida del despliegue (`FALLO: <archivo>` y la línea `ERROR:`).
2. La base ya migró; los servicios siguen en la versión vieja. **No reiniciar a mano** hasta entenderlo.
3. Comparar con el ensayo: si el ensayo con la copia real pasó, lo que cambió es el estado de producción entre la copia y el despliegue.
4. Para volver atrás: ver 7.

## 4. `SCOPE_RLS_MODE`: de `off` a `enforce` 👤

El valor inicial es `off`. **No saltar pasos.**

| Paso | Condición para avanzar | Cómo se mira |
|---|---|---|
| `off` → `log` | Despliegue estable. | Cambiar el valor y reiniciar la API. |
| `log` → `enforce` | Una semana en `log` en la que **toda** línea `would_deny` se pudo explicar (ver abajo). | Log **de Postgres** (no el de la API): líneas `scope_rls would_deny table=… id=… user=… scope=…`. En Docker: `docker logs kobrax-postgres \| grep would_deny`. |
| `enforce` | Además: `db:verify` en verde y la integración con `SCOPE_RLS_MODE=enforce` en verde. | `pnpm --filter @kobrax/database db:verify` + suite de integración. |

⚠ **`log` trae falsos positivos por diseño** (`006_scope_policies.sql`, nota del modo `log`): se evalúa por fila *escaneada*, no por fila devuelta, así que una consulta que ya filtra bien también deja líneas. «Cero líneas» no es un criterio realista; el criterio es: agrupar por `table` y `user`, y para cada grupo poder decir si la persona *vio* esas filas en pantalla (discrepancia real) o solo las escaneó (ruido). Si no se puede decidir, no pasar a `enforce` en esa semana.

Si en `enforce` aparece una persona que ya no ve algo que veía: volver a `log` (no a `off`) y registrar el caso. El rol de base `kobrax_scoped` no se elimina al volver atrás; es inofensivo.


## 5. `PII_MOBILE_MASK` 👤

Encenderlo **solo cuando la versión mínima aceptada de la app móvil (`MIN_APP_VERSION`) sea la de F8**. Con una app anterior, el documento llegaría enmascarado y la app lo guardaría y lo reenviaría: F8 añade a la API un rechazo (`assertDocumentNotMasked`) para que no se sobrescriba un documento real con uno enmascarado, pero la app vieja no entiende el aviso.

Antes de encender: correr `execution/F8-casos-dispositivo.md` en un teléfono real. **Nadie lo ha corrido todavía.**

## 6. Después del despliegue

- `pnpm --filter @kobrax/database db:verify` contra la base de producción (solo lectura; usar `--local` con `DATABASE_URL` o el contenedor).
- `pnpm --filter @kobrax/database db:permissions dump --out despues.json` y compararlo con el de antes:
  `db:permissions diff antes.json despues.json --by-role --allow-any-added`
  (el volcado de antes con `dump --legacy`, si la base todavía no tenía las copias por cuenta).
- Entrar con un usuario de cada rol real: administrador, gerente, supervisor, cobrador (web y móvil). Comprobar: Equipo, Organización, Seguridad → Roles, y que el cobrador solo ve lo suyo.
- Revisar el log de la API la primera hora: buscar `AUTHZ_STALE` repetidos para la misma sesión (señal de un cliente que no renueva).

## 7. Volver atrás, por fase

| Fase | Cómo |
|---|---|
| F1 versiones de autorización | `AUTHZ_VERSION_CHECK=off`; las columnas se quedan (inofensivas). |
| F3 contrato por handler | `AUTHZ_DENY_BY_DEFAULT` fuera de `enforce`; solo para una emergencia. |
| F2 / F2b alcance en la base | `SCOPE_RLS_MODE=off`. Las políticas `scope_*` siguen creadas pero el rol `kobrax_scoped` no se usa. |
| F4 PII y archivos | `PII_MOBILE_MASK=off`. Los archivos quedan en la tabla `files`; no hay vuelta al endpoint viejo. |
| F5 roles por cuenta | Reapuntar `user_accounts.role_id` a las plantillas globales (script inverso); `account_roles` se conserva para no perder lo editado. **No hay script hecho:** hay que escribirlo antes de necesitarlo. |
| F7 editor de roles | Es solo interfaz: ocultar la entrada de menú. |
| F8 móvil | La API mantiene compatibilidad con la app anterior. |

**Volver a la versión anterior del código no deshace migraciones.** La base queda migrada; las migraciones de F14 son aditivas (salvo `user_permission_overrides`, que exige tabla vacía).

## 8. Lo que este documento no garantiza

- Que el ensayo sobre la copia real de producción pase: nunca se ha corrido con datos reales.
- Que `ci.yml` funcione en GitHub.
- Que la app móvil de F8 funcione en un dispositivo.
- Que el log de Postgres de producción tenga habilitado el nivel que muestra `RAISE LOG` (por omisión sí, pero la configuración del servidor no se ha visto).
