> ESTADO: BORRADOR (2026-11-08). Pendiente `validar F9` (G4). **D-1…D-7 son propuestas: la usuaria debe aprobarlas antes de construir.** Hay **2 bifurcaciones que tocan lo que corre en GitHub y en producción** (D-2 y D-3); el resto es verificación y documentación. Ninguna línea de producto se toca antes del PASS de G4.

# Plan F9 · Auditoría integral, pruebas y despliegue

> Cierra la épica F14 (`ROLES-PERMISOS-PLAN.md` §E «Fase 9» y §G «Migración y despliegue progresivo»). **No agrega funcionalidad**: comprueba que lo construido en F1–F8 está probado de punta a punta, deja las verificaciones de base de datos ejecutables con un solo comando, y deja por escrito cómo se despliega sin sorpresas.

## 1. Objetivo
Que, al terminar F14, se pueda contestar con evidencia «¿cada hallazgo del diagnóstico quedó cerrado y probado?» y «¿qué hay que hacer, en qué orden y con qué comprobaciones, para llevar esto a producción y poder deshacerlo?». Y que el despliegue automático actual no tenga trampas conocidas.

## 2. Rama
`f14/p9-cierre`, desde `f14/p8-movil` (F8 aún local; F1–F7 están en el PR #27).

## 3. Estado inicial con evidencia (releído 2026-11-08)

| # | Hallazgo | Evidencia | Clase |
|---|---|---|---|
| E1 | **Cada merge a `main` despliega a producción sin ninguna prueba previa.** No hay un workflow de CI (solo `deploy.yml` y `mirror-backup.yml`). | `.github/workflows/` (2 archivos); `deploy.yml:3-9` | VERIFICADO |
| E2 | **`deploy.sh` aplica TODOS los `rls/*.sql` salvo `verify_isolation.sql`.** F14 agregó `verify_files.sql`, `verify_roles.sql` y `verify_scope.sql` en esa carpeta: en el próximo despliegue se ejecutarían como si fueran políticas. Solo leen, pero abortan el despliegue (`ON_ERROR_STOP`) si una comprobación falla, **después** de migrar y **antes** de reiniciar. El script de desarrollo (`apply-rls.ts`) sí los excluye todos (`startsWith('verify')`): los dos criterios discrepan. | `infra/production/deploy.sh` (paso 8, `grep -v verify_isolation`); `packages/database/prisma/apply-rls.ts:13-14` | VERIFICADO |
| E3 | `deploy.sh` ya hace lo correcto con el orden: construye ANTES de migrar, respalda con `pg_dump` ANTES de migrar y reinicia DESPUÉS; aplica `rls-bootstrap.sql` antes de migrar. Los respaldos viven en el mismo disco (retención: 10). | `deploy.sh` pasos 4–9 | VERIFICADO |
| E4 | Hay 16 migraciones nuevas de F14 (`20261105000000_f14_01…` a `20261108010000_f14_f7_…`). Dos pueden **detener** el despliegue por diseño si el dato de producción no coincide: `…retire_permission_overrides` (aborta si la tabla tiene filas) y los rellenos de `f14_04` (dejan clientes sin oficina de registro en un reporte, no abortan). | `packages/database/prisma/migrations/`; `…020000_…/migration.sql:12-20`; `prisma/verify/f14-cliente-registro.sql` | VERIFICADO |
| E5 | Verificaciones SQL existentes: `rls/verify_isolation|scope|files|roles.sql` y `prisma/verify/*.sql` (7). **No hay** una de las versiones de autorización (F1, outbox, `policy_version`), de la plataforma (F5: una sola persona, enums nativos), ni del catálogo de permisos (F7: reservados, dependencias, plantillas cerradas). Tampoco un comando que las corra todas. | `ls packages/database/prisma/{rls,verify}`; `packages/database/package.json:27-28` (solo `db:verify:seed|contraccion`) | VERIFICADO |
| E6 | **No existe** la herramienta que el plan maestro pide para el despliegue: volcar «membresía → permisos efectivos» antes y después y compararlos. Hoy los permisos del token salen de las copias por cuenta (F5) y los de antes salían del rol global: es la comprobación que demuestra que el cambio de fuente no cambió lo que cada persona puede hacer. | `ROLES-PERMISOS-PLAN.md` §G.3; `grep` sin coincidencias | VERIFICADO |
| E7 | Los nombres de los interruptores del plan maestro no coinciden con los reales. Reales: `AUTHZ_VERSION_CHECK` (`on`), `AUTHZ_DENY_BY_DEFAULT` (`enforce`), `SCOPE_RLS_MODE` (`off`), `PII_MOBILE_MASK` (`off`), `PLATFORM_ACCESS_ENABLED` y `SUPPORT_WRITE_ENABLED` (apagados), `FILE_LINK_SECRET`, `PLATFORM_ENROLLMENT_KEY`. No existen `RLS_SCOPE_MODE`, `PII_PROJECTION` ni `FILES_LEGACY_UPLOADS`. | `apps/api/src/config/env.validation.ts:15-25`; `platform-switches.ts`; `ROLES-PERMISOS-PLAN.md` §G.2 | VERIFICADO |
| E8 | Suites hoy: API `npm test` 2085, shared 498, web 1328, móvil 1034; integración 323/323 en `off` y `enforce` (~30 min por modo). Nada de eso corre fuera de la máquina de la usuaria. | VERIFICATIONS V-052…V-056 | VERIFICADO |
| E9 | El plan maestro (§I) trae una matriz de trazabilidad (hallazgo → fase → prueba → ADR). Se escribió antes de construir; no se ha contrastado con lo construido. | `ROLES-PERMISOS-PLAN.md` §I | VERIFICADO |
| E10 | Pendientes ABIERTOS en INCIDENTS: roles propios (H-9) y retiro de `user_accounts.role_id`; prueba de F8 en un teléfono real (V-057). | `execution/INCIDENTS.md`; V-057 | VERIFICADO |
| E11 | **No tengo acceso a producción ni a una copia de ella.** Lo que sí hay: una base de desarrollo con datos de demostración (migrada incrementalmente desde F1) y la base de pruebas que se reconstruye de cero. | — | — |

## 4. Alcance / fuera de alcance

**Dentro**
1. **Auditoría de trazabilidad:** recorrer la matriz §I y cada fila de la tabla de riesgos del diagnóstico, y para cada hallazgo (R-xx, N-xx) registrar la prueba concreta que lo cubre (archivo y caso) o marcarlo **sin prueba**. Informe `docs/epics/F14/F9-AUDITORIA.md`. Los huecos que sean pequeños se cierran con una prueba; los grandes se anotan.
2. **Verificaciones SQL completas y ejecutables:** `verify_authz.sql` (F1), `verify_platform.sql` (F5), `verify_catalog.sql` (F7) y un comando `pnpm db:verify` que corre **todas** (`rls/verify_*.sql` y las de `prisma/verify/` que sean de comprobación) y falla si una falla.
3. **Herramienta de permisos efectivos** (`permissions-snapshot`): vuelca «membresía → permisos» a un archivo y compara dos archivos; además comprueba, por membresía, que los permisos de la copia por cuenta coinciden con los del rol global de origen (la prueba de que F5 no cambió a nadie).
4. **Ensayo de actualización:** script `release-rehearsal` que restaura un respaldo en una base de prueba, aplica `migrate deploy` + `rls` + verificaciones + comparación de permisos, y escribe un informe. Se ensaya aquí con la base de desarrollo y con una base vacía; **lo vuelve a correr la usuaria sobre una copia real de producción** antes de desplegar.
5. **`RELEASE-CHECKLIST.md`:** orden de despliegue, interruptores con sus nombres reales, qué comprobar antes y después, criterios para pasar `SCOPE_RLS_MODE` de `off` a `log` y a `enforce`, cuándo encender `PII_MOBILE_MASK`, **rollback real por fase**, y la comunicación a las personas (el `AUTHZ_STALE` único al desplegar).
6. **Corrección del plan maestro §G** (nombres reales de los interruptores) y cierre de la épica: STATUS, HANDOFF, `roles-permisos-planes.md` y la lista de pendientes.
7. **(D-3, a aprobar)** Arreglo de `infra/production/deploy.sh`: excluir todos los `verify*` del paso 8 (como ya hace `apply-rls.ts`) y agregar un paso explícito de comprobación después de aplicar las políticas.
8. **(D-2, a aprobar)** `.github/workflows/ci.yml`: pruebas en cada pull request.

**Fuera**
- Ejecutar nada en producción ni tocar `/opt/kobrax` del servidor; encender interruptores (`SCOPE_RLS_MODE=enforce`, `PII_MOBILE_MASK`, `PLATFORM_*`).
- Funcionalidad nueva (roles propios, retiro de `role_id`, `fileId`, aviso de vencimiento de la ventana móvil).
- Rehacer la app móvil (la usuaria la va a refactorizar) y la prueba en dispositivo (es suya, V-057).
- Subir al servidor respaldos fuera del disco (ya anotado en `deploy.sh`).
- `docs/epics/F15/` (otra línea de trabajo).

## 5. Dependencias
F1–F8 (todas cerradas; F8 con la excepción de la prueba en dispositivo). No depende de decisiones ADR nuevas.

### Decisiones de la fase (todas PROPUESTA, esperan a la usuaria)
| ID | Decisión | Estado |
|---|---|---|
| D-1 | F9 es **solo verificación y puesta a punto**: informe de trazabilidad, verificaciones SQL, herramienta de permisos, ensayo, checklist y corrección de documentos. Nada de funcionalidad. | PROPUESTA |
| D-2 | ⚠ **CI en GitHub** (`ci.yml` en cada pull request y en los push a `dev`): `tsc` + pruebas unitarias de shared, API, web y móvil. Opción A (recomendada): solo unitarias (rápidas, sin servicios). Opción B: además la integración con Postgres y Redis como servicios (≈30–60 min; **no la puedo validar sin correrla en GitHub**). Opción C: no agregar CI. **Es configuración que corre en tu GitHub** y que el próximo push activa. | PROPUESTA (elegir) |
| D-3 | ⚠ **Arreglo de `deploy.sh`** (producción): excluir `verify*` del paso 8 y correr las verificaciones como un paso propio, después de las políticas y antes de reiniciar. Si una verificación falla, el script lo dice claro y termina con error **antes** de reiniciar, que es el mismo punto donde hoy se detiene una migración fallida (la versión vieja sigue corriendo). Es lo que hoy ocurriría de todos modos con los tres `verify_*` de F14, pero a propósito y con un mensaje que explica qué falló. Es un cambio a lo que ejecuta producción en el próximo merge a `main`; el problema que corrige (E2) existe tal cual si no se toca. | PROPUESTA (elegir) |
| D-4 | `permissions-snapshot` vive en `packages/database/scripts/` (usa Prisma, sin servidor de la API) y su lógica de comparación es una función pura con pruebas. El volcado no incluye datos personales (ids y códigos de permiso). | PROPUESTA |
| D-5 | El ensayo de actualización se hace **aquí** sobre la base de desarrollo y una base vacía, y se deja el script y el procedimiento para que la usuaria lo repita sobre una copia real de producción. En el informe consta que **no se ensayó con datos de producción**. | PROPUESTA |
| D-6 | `PII_MOBILE_MASK=on` y `SCOPE_RLS_MODE=enforce` **no se encienden** en F9; el checklist deja los criterios (versión mínima de la app; una semana en `log` sin discrepancias). | PROPUESTA |
| D-7 | El informe de trazabilidad distingue tres estados por hallazgo: **probado** (con archivo y caso), **cubierto por una verificación SQL** y **sin prueba**. Un hueco que se pueda cerrar con una prueba corta se cierra; el resto queda en INCIDENTS con su dueño. | PROPUESTA |

### Cruce con la alineación móvil en curso (regla D1)
F9 no toca `apps/mobile`. El checklist depende de que la versión mínima de la app sea la de F8 para encender `PII_MOBILE_MASK`.

## 6. Archivos afectados (IDs HUB; los nuevos se crean al cerrar la fase)

| ID HUB | Archivo / símbolo | Cambio |
|---|---|---|
| H14-080 (nuevo) | `packages/database/prisma/rls/verify_authz.sql`, `verify_platform.sql`, `verify_catalog.sql` (nuevos) | Verificaciones de F1, F5 y F7 |
| H14-081 (nuevo) | `packages/database/prisma/run-verify.ts` (nuevo), `packages/database/package.json` (`db:verify`) | Un comando que corre todas |
| H14-082 (nuevo) | `packages/database/scripts/permissions-snapshot.ts` (nuevo) y su prueba | Volcado y comparación de permisos efectivos |
| H14-083 (nuevo) | `infra/production/release-rehearsal.sh` (nuevo) | Ensayo de actualización sobre un respaldo |
| H14-084 (nuevo) | `infra/production/deploy.sh` (paso 8 y paso nuevo) — **D-3** | Excluir `verify*`; comprobación explícita |
| H14-085 (nuevo) | `.github/workflows/ci.yml` (nuevo) — **D-2** | Pruebas en cada pull request |
| H14-086 (nuevo) | `docs/epics/F14/RELEASE-CHECKLIST.md`, `F9-AUDITORIA.md` (nuevos); `ROLES-PERMISOS-PLAN.md` §G | Checklist, informe y nombres reales |
| H14-001…079 (existen) | todo lo de F1–F8 | consultados en la auditoría; ver IMPACT-MAP |

## 7. Invariantes que aplican
B8/B9 (migraciones aditivas; nada nuevo), B12 (toda prueba nueva registrada en su paquete), RULES D1/D2 (no arrastrar `docs/epics/F15/`; usar siempre rutas explícitas en `git add`), «sin PASS de G4 no se modifica código de producto». Específico de esta fase: **ningún cambio a `deploy.sh` ni a los workflows sin la aprobación expresa de la usuaria (D-2, D-3)**.

## 8. Perfiles de tenant y protección del gratuito individual
- **FREE / cobrador independiente:** nada cambia para él. La herramienta de permisos y las verificaciones lo incluyen como un caso (una cuenta, una persona, un rol); el ensayo comprueba que su administrador conserva todos sus permisos y que su cuenta tiene sus seis roles.
- **Empresa:** sin cambios de comportamiento; la auditoría incluye la comprobación de que ningún rol de plantilla pierde ni gana un permiso respecto del rol global de origen.
- **Regresión del gratuito individual (G5):** la suite de integración completa (que incluye el alta, el login, cliente/crédito/pago y el refresco de token) en `off` y `enforce`.

## 9. Riesgos
| Riesgo | Mitigación |
|---|---|
| Un cambio a `deploy.sh` rompe el despliegue de producción. | D-3 requiere aprobación; el cambio es mínimo (un filtro y un paso nuevo), se prueba en un servidor local con la misma carpeta (`bash -n` y una corrida contra la base de desarrollo del paso 8) y no cambia el orden de los pasos 4–9. |
| Un `ci.yml` mal escrito falla siempre o consume minutos de Actions. | D-2 opción A (solo unitarias); se valida localmente con los mismos comandos que correrá; el primer resultado real lo verá la usuaria en GitHub. |
| El ensayo no representa producción (datos distintos). | D-5: queda dicho; el script y el procedimiento están para repetirlo con una copia real. |
| La migración que retira `user_permission_overrides` aborta en producción si la tabla tiene filas. | Es la salida segura por diseño (respaldo hecho, versión vieja sigue corriendo); el checklist pide contar las filas ANTES de desplegar. |
| Una verificación SQL da un falso rojo en producción (por nombres de roles de base de datos distintos). | Las verificaciones leen catálogos del sistema y avisan qué rol esperaban; se ensayan en dos bases; el checklist las corre antes del merge, no solo durante. |
| La matriz de trazabilidad deja ver huecos que no se pueden cerrar en esta fase. | D-7: se anotan en INCIDENTS con dueño; no se declaran cerrados. |

## 10. Pruebas
**Existentes que deben seguir verdes:** todas (API 2085, shared 498, web 1328, móvil 1034, integración 323 en `off` y `enforce`).

**Nuevas:**
- `permissions-snapshot`: la comparación (iguales; añadido; quitado; membresía nueva o desaparecida) y que el volcado no contiene datos personales (prueba unitaria sobre la función pura); y una corrida contra la base de pruebas que da cero diferencias entre el rol global y su copia por cuenta.
- `db:verify`: corre contra la base de desarrollo y contra la reconstruida de cero, ambas en verde; y una prueba con una condición rota a propósito (p. ej. quitar el RLS de una tabla en una base temporal) que debe fallar.
- `deploy.sh` (si D-3): `bash -n`, y la lista de archivos del paso 8 contra la carpeta real (no incluye ningún `verify*`).
- `ci.yml` (si D-2): los comandos del workflow corridos tal cual en local.
- **Trazabilidad:** el informe lista cada hallazgo con su prueba; las pruebas cortas que se agreguen para cerrar huecos se registran en su paquete.

## 11. Rollback
Todo lo nuevo son archivos de verificación y documentos: revertir la rama los quita. `deploy.sh` y `ci.yml` se revierten con un commit (y solo hacen efecto al mergear a `main`/subir la rama). Sin migraciones.

## 12. Tareas ordenadas
**Datos**
1. Escribir `verify_authz.sql`, `verify_platform.sql`, `verify_catalog.sql` y `run-verify.ts`; correrlos en la base de desarrollo y en una base vacía reconstruida (la de pruebas), incluyendo una condición rota a propósito.

**Herramientas**
2. `permissions-snapshot` (volcar / comparar / comprobar contra el rol global) con su prueba; correrlo sobre la base de desarrollo y la de pruebas.
3. `release-rehearsal.sh`; ensayarlo con un respaldo de la base de desarrollo y con una base vacía.

**Infraestructura (si se aprueba)**
4. D-3: arreglo de `deploy.sh`. D-2: `ci.yml`.

**Documentos**
5. Auditoría de trazabilidad (`F9-AUDITORIA.md`) y cierre de los huecos pequeños.
6. `RELEASE-CHECKLIST.md`; corregir §G del plan maestro.
7. Cierre de épica: STATUS, HANDOFF, VERIFICATIONS, INCIDENTS, `roles-permisos-planes.md`, memoria.

## 13. Criterios de cierre
- **G5:** salida pegada en `VERIFICATIONS.md` de `pnpm db:verify` (base de desarrollo y base vacía; y la corrida con una condición rota), `permissions-snapshot` (cero diferencias; comparación con una diferencia inducida), el ensayo `release-rehearsal`, y las suites completas (unitarias de los cuatro paquetes e integración completa en `off` y `enforce`). Declarado: **sin datos de producción**; F8 **sin prueba en dispositivo**.
- **G6:** `/code-review` de lo nuevo (scripts, SQL, workflow, `deploy.sh` si aplica); recorrido del mapa de impacto.
- **G7:** `RELEASE-CHECKLIST.md`, `F9-AUDITORIA.md`, HUB (H14-080…086), STATUS, HANDOFF, INCIDENTS y `roles-permisos-planes.md` al día. **Fin de la épica F14**; subir ramas, mergear y encender interruptores son decisiones de la usuaria.
