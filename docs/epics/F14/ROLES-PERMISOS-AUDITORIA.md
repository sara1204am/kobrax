# F14 · Roles y permisos — auditoría de lo implementado

> **Fecha:** 2026-11-04 · **Rama:** `f14/roles-permisos` (sobre `dev` con F13 ya integrado) · **Tipo:** análisis, no cambia código.
> **Anexo:** [`ROLES-PERMISOS-ENDPOINTS.md`](./ROLES-PERMISOS-ENDPOINTS.md) — los 202 endpoints con el permiso que exigen.

## 0. Resumen ejecutivo

- Hay **7 roles** y **39 permisos**. Los roles y sus permisos son **globales** (una sola tabla `roles` / `role_permissions` para todos los tenants) y hoy **sólo se cambian por código + migración**: no existe ningún endpoint ni pantalla para modificarlos. `role:write` está definido, concedido y **no lo exige nadie**.
- La regla de la usuaria —**sólo `SUPER_ADMIN` y `ACCOUNT_ADMIN` modifican permisos**— hoy se cumple por defecto (nadie más puede), pero **no se puede implementar tal cual** sin antes separar los permisos por tenant: como los roles son globales, que un administrador editara un rol cambiaría **a todos los tenants** (ver §8).
- Lo que sí está bien: la matriz de permisos en código coincide con lo que la API aplica (verificada con los metadatos de los 202 endpoints y con llamadas reales de tres roles); todos los controladores con `@Roles` tienen `RolesGuard`; el alcance por oficina (F13) cubre Mora, Cartera, Clientes, Pagos, Exportes, Agenda, Rutas, Analítica, Asignaciones e Importaciones.
- Lo que hay que corregir, por prioridad (detalle en §7): **(1)** la sesión no se revoca al desactivar a alguien o cambiarle el rol; **(2)** la lista de personas no se acota por oficina; **(3)** el supervisor no puede crear clientes ni créditos; **(4)** el permiso de PII de clientes no se aplica; **(5)** hay permisos que se comprueban sólo dentro de los servicios y otros que no hacen nada.

## 1. Cómo se hizo (y qué tan confiable es)

| Fuente | Qué se obtuvo |
|---|---|
| `packages/shared/src/constants/permissions.ts` y `enums/permission.enum.ts` | Los 39 permisos y la lista de cada rol (`ROLE_PERMISSIONS`). |
| Metadatos de Nest (se cargaron los 25 controladores y se leyó `@Roles` y `@UseGuards` de cada método) | Los **202 endpoints** y el permiso exacto que exige cada uno. No es una lectura de texto: es lo que el `RolesGuard` aplica. |
| Búsqueda de `can(...)` en los servicios | Los permisos que se comprueban **dentro** de la lógica y no en el guard. |
| `lib/nav.ts`, `cuenta-tabs.ts` y el uso de `can()` en la web; `apps/mobile` | Qué se muestra a cada rol. |
| 22 llamadas reales a la API (cobrador, supervisor y gerente, cuenta DEMO) | Que la matriz se cumple de verdad. Ver §6.1. |

**Límite:** no hay usuarios `AUDITOR`, `VIEWER` ni `SUPER_ADMIN` en la base de desarrollo, y el administrador exige MFA, así que para esos roles la matriz está verificada por código y por pruebas unitarias, no en vivo.

## 2. Modelo

### 2.1 Los siete roles

| Rol | Nombre en pantalla | Nivel | Qué es | ¿Se puede asignar? |
|---|---|---:|---|---|
| `SUPER_ADMIN` | Super administrador | 100 | Plataforma (sin construir). Hoy tiene exactamente los mismos permisos que el administrador. | No |
| `ACCOUNT_ADMIN` | Administrador | 90 | Dueño/administrador del tenant. **Quien se registra queda con este rol** (también el cobrador independiente). | Sí |
| `MANAGER` | Gerente | 70 | Gerente regional: ve y gestiona su oficina y todo lo que cuelga de ella. Asignado a la raíz, ve toda la cuenta. | Sí |
| `SUPERVISOR` | Supervisor | 50 | Supervisa su oficina; reparte y gestiona cobranza. | Sí |
| `COLLECTOR` | Cobrador | 30 | Trabaja en campo; ve solo lo suyo. | Sí |
| `AUDITOR` | Auditor | 20 | Lectura de toda la cuenta, con PII, exportes y auditoría. | **No** |
| `VIEWER` | Consulta | 10 | Lectura de toda la cuenta. | **No** |

Sólo cuatro roles se ofrecen al invitar o cambiar un rol (`MOBILE_ROLES`: administrador, gerente, supervisor, cobrador). `AUDITOR` y `VIEWER` existen en la base pero **no hay forma de asignarlos**; tampoco tienen usuarios. Las protecciones al cambiar un rol son: nadie edita su propia cuenta, no se puede dejar a la cuenta sin administrador y el rol destino debe estar en esa lista.

### 2.2 Cómo se decide si alguien puede hacer algo

1. **Permiso (guard):** cada endpoint declara `@Roles(...)`. El `RolesGuard` exige **todos** los permisos listados.
2. **Permiso dentro del servicio:** algunos permisos no están en el guard, se comprueban con `tenant.can(...)` adentro (rutas, asignación, agenda, créditos). Ver hallazgo R-05.
3. **Alcance de datos (F13):** el permiso dice *si* puede; el alcance dice *sobre qué*. Se resuelve por capacidad, no por nombre de rol: `data:scope:all` > `data:scope:subtree` > `data:scope:branch` > nada (= solo lo propio).
4. **Los permisos viajan en el token de acceso (15 min).** Se recalculan al renovarlo desde el rol vigente. Ver R-01.

| Rol | Alcance | Qué ve |
|---|---|---|
| Super admin, Administrador, Auditor, Consulta | `data:scope:all` | Toda la cuenta |
| Gerente | `data:scope:subtree` | Su oficina y lo que cuelga de ella (asignado a la raíz = todo) |
| Supervisor | `data:scope:branch` | Su oficina y lo que cuelga de ella; de los créditos, sólo los que **tienen responsable** |
| Cobrador | _ninguno_ | Sólo lo suyo (responsable, temporal o apoyo vigentes) |

## 3. Matriz rol × permiso

| Familia | Permiso | Super admin | Admin | Gerente | Supervisor | Cobrador | Auditor | Consulta |
|---|---|---|---|---|---|---|---|---|
| Cobranza (mora) | `collection:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
|  | `collection:write` | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
|  | `collection:export` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Pagos | `payment:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
|  | `payment:write` | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
|  | `payment:approve` | ✅ | ✅ | ✅ | — | — | — | — |
| Rutas | `route:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
|  | `route:write` | ✅ | ✅ | ✅ | ✅ | — | — | — |
|  | `route:assign` | ✅ | ✅ | ✅ | ✅ | — | — | — |
|  | `route:execute` | ✅ | ✅ | — | — | ✅ | — | — |
| Agenda | `agenda:read` | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
|  | `agenda:write` | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
|  | `agenda:assign` | ✅ | ✅ | ✅ | ✅ | — | — | — |
| Catálogos | `catalog:read` | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
|  | `catalog:write` | ✅ | ✅ | ✅ | — | — | — | — |
| Clientes | `client:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
|  | `client:write` | ✅ | ✅ | ✅ | — | ✅ | — | — |
|  | `client:pii:read` | ✅ | ✅ | ✅ | — | — | ✅ | — |
|  | `client:import` | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
|  | `client:import:replace` | ✅ | ✅ | — | — | — | — | — |
| Créditos | `credit:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — |
|  | `credit:write` | ✅ | ✅ | ✅ | — | ✅ | — | — |
|  | `credit:pii:read` | ✅ | ✅ | ✅ | — | — | ✅ | — |
| Asignación | `assignment:write` | ✅ | ✅ | ✅ | ✅ | — | — | — |
| Reportes | `report:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
|  | `report:export` | ✅ | ✅ | ✅ | — | — | ✅ | — |
| Cuenta | `account:read` | ✅ | ✅ | ✅ | — | — | — | — |
|  | `account:write` | ✅ | ✅ | — | — | — | — | — |
| Personas | `user:read` | ✅ | ✅ | ✅ | — | — | — | — |
|  | `user:write` | ✅ | ✅ | — | — | — | — | — |
|  | `user:invite` | ✅ | ✅ | — | — | — | — | — |
| Roles y auditoría | `role:read` | ✅ | ✅ | — | — | — | — | — |
|  | `role:write` | ✅ | ✅ | — | — | — | — | — |
|  | `audit:read` | ✅ | ✅ | — | — | — | ✅ | — |
| Oficinas | `office:read` | ✅ | ✅ | ✅ | ✅ | — | — | — |
|  | `office:write` | ✅ | ✅ | — | — | — | — | — |
| Alcance de datos | `data:scope:all` | ✅ | ✅ | — | — | — | ✅ | ✅ |
|  | `data:scope:subtree` | ✅ | ✅ | ✅ | — | — | — | — |
|  | `data:scope:branch` | ✅ | ✅ | — | ✅ | — | — | — |
| **Total** | | **39** | **39** | **28** | **19** | **16** | **12** | **7** |

**Cuántos endpoints exige cada permiso** (indica cuánto «pesa» en la API; cero = no lo exige ningún guard):

| Permiso | Endpoints |
|---|---:|
| `account:read` | 4 |
| `account:write` | 4 |
| `agenda:assign` | 1 |
| `agenda:read` | 4 |
| `agenda:write` | 11 |
| `assignment:write` | 6 |
| `audit:read` | 2 |
| `catalog:read` | 1 |
| `catalog:write` | 3 |
| `client:import` | 11 |
| `client:import:replace` | 0 |
| `client:pii:read` | 1 |
| `client:read` | 6 |
| `client:write` | 20 |
| `collection:export` | 2 |
| `collection:read` | 10 |
| `collection:write` | 5 |
| `credit:pii:read` | 0 |
| `credit:read` | 3 |
| `credit:write` | 9 |
| `data:scope:all` | 0 |
| `data:scope:branch` | 0 |
| `data:scope:subtree` | 0 |
| `office:read` | 3 |
| `office:write` | 10 |
| `payment:approve` | 1 |
| `payment:read` | 4 |
| `payment:write` | 2 |
| `report:export` | 5 |
| `report:read` | 12 |
| `role:read` | 1 |
| `role:write` | 0 |
| `route:assign` | 0 |
| `route:execute` | 0 |
| `route:read` | 20 |
| `route:write` | 0 |
| `user:invite` | 2 |
| `user:read` | 4 |
| `user:write` | 3 |

## 4. Qué puede hacer cada rol, módulo por módulo

Cada celda es **cuántos endpoints del módulo puede llamar el rol** (según el guard; `todo` = todos, `—` = ninguno). El alcance por oficina recorta además *sobre qué* datos.

| Módulo | Endpoints | Super admin | Admin | Gerente | Supervisor | Cobrador | Auditor | Consulta |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Agenda | 16 | **todo** | **todo** | **todo** | **todo** | 15 | — | — |
| Analítica (`/analytics`) | 6 | **todo** | **todo** | **todo** | **todo** | **todo** | **todo** | **todo** |
| Archivos subidos | 2 | **todo** | **todo** | **todo** | **todo** | **todo** | **todo** | **todo** |
| Asignación de créditos | 5 | **todo** | **todo** | **todo** | **todo** | — | — | — |
| Autenticación y sesión | 23 | **todo** | **todo** | **todo** | **todo** | **todo** | **todo** | **todo** |
| Campo (visitas) | 4 | **todo** | **todo** | **todo** | **todo** | **todo** | **todo** | **todo** |
| Categorías de mora | 2 | **todo** | **todo** | 1 | 1 | 1 | 1 | 1 |
| Catálogos | 4 | **todo** | **todo** | **todo** | 1 | 1 | — | — |
| Clientes | 25 | **todo** | **todo** | **todo** | 6 | **todo** | 6 | 6 |
| Créditos | 13 | **todo** | **todo** | **todo** | 4 | 12 | 3 | — |
| Cuenta (`/accounts`) | 9 | **todo** | **todo** | 5 | 1 | 1 | 2 | 1 |
| Dispositivos push | 3 | **todo** | **todo** | **todo** | **todo** | **todo** | **todo** | **todo** |
| Exportes | 5 | **todo** | **todo** | **todo** | — | — | **todo** | — |
| Importación de cartera | 10 | **todo** | **todo** | **todo** | 9 | 9 | — | — |
| Importación de clientes | 1 | **todo** | **todo** | **todo** | — | **todo** | — | — |
| Mora | 14 | **todo** | **todo** | **todo** | **todo** | **todo** | 9 | 9 |
| Notificaciones | 3 | **todo** | **todo** | **todo** | **todo** | **todo** | **todo** | **todo** |
| Oficinas | 10 | **todo** | **todo** | 2 | 2 | — | — | — |
| Pagos | 7 | **todo** | **todo** | **todo** | 6 | 6 | 4 | 4 |
| Personas (`/users`) | 12 | **todo** | **todo** | 6 | 2 | 2 | 3 | 2 |
| Roles | 1 | **todo** | **todo** | — | — | — | — | — |
| Rutas | 16 | **todo** | **todo** | **todo** | **todo** | **todo** | **todo** | **todo** |
| Salud | 2 | **todo** | **todo** | **todo** | **todo** | **todo** | **todo** | **todo** |
| Tableros | 6 | **todo** | **todo** | **todo** | **todo** | **todo** | **todo** | **todo** |
| Tipos de oficina | 3 | **todo** | **todo** | 1 | 1 | — | — | — |
| **Total** | **202** | **202** | **202** | **180** | **133** | **152** | **98** | **88** |

### 4.1 Lectura por rol

- **Super administrador / Administrador** (202/202). Todo, incluida la administración de la cuenta (`account:write`), oficinas (`office:write`), personas (`user:write`, `user:invite`), catálogos, auditoría y el modo destructivo de importación (`client:import:replace`). Son los **únicos** que pueden cambiar el rol de una persona, invitar, crear oficinas o ver la auditoría de la cuenta. Hoy son idénticos: no hay ningún permiso de plataforma.
- **Gerente** (180/202). Opera sobre su subárbol: clientes y créditos (lee y escribe), pagos (incluye **aprobar**), rutas (asigna), asignación de créditos, catálogos (**escribe**), exportes, PII. Puede **leer** la cuenta, el árbol de oficinas y la lista de personas. **No** puede escribir oficinas, invitar, cambiar roles, editar la cuenta ni ver la auditoría.
- **Supervisor** (133/202). Reparte y supervisa su oficina: asigna créditos, rutas y agenda; registra pagos; importa cartera; lee oficinas. **No** crea ni edita clientes ni créditos (no tiene `client:write` / `credit:write`), no ve la PII por permiso, no entra a Cuenta ni a Equipo, y no tiene los exportes de `report:export` (sí el de Mora, `collection:export`).
- **Cobrador** (152/202). Trabaja lo suyo: crea y edita clientes y créditos, registra pagos, ejecuta rutas y agenda, importa su cartera, ve su tablero de Inicio (desde 2026-11-04, acotado a lo suyo). **No** asigna, no ve oficinas, personas ni cuenta. Tiene más endpoints que el supervisor (152 vs 133) **precisamente** por tener `client:write` y `credit:write`.
- **Auditor** (98/202). Lectura de toda la cuenta con PII, exportes y auditoría. Sin agenda ni importación.
- **Consulta** (88/202). Lectura de toda la cuenta; no exporta ni ve PII.

## 5. Dónde se aplica el alcance por oficina

| Módulo | ¿Aplica alcance por oficina? | Nota |
|---|:-:|---|
| Mora, Cartera (créditos), Clientes, Pagos, Exportes | ✅ | Misma regla (`moraAccessConditions`); F13 P5. |
| Agenda, Rutas, Campo, Asignaciones, Importaciones | ✅ | |
| Analítica | ✅ | Incluye el tablero del cobrador (sólo lo suyo). |
| Oficinas | ✅ | El detalle de una oficina fuera de alcance es 404. |
| **Personas (`/users`)** | 🔴 **No** | Quien tiene `user:read` (el gerente) ve **toda la cuenta**. R-02. |
| **Archivos subidos (`/uploads/:name`)** | 🔴 **No** | Cualquier sesión del tenant puede pedir cualquier archivo por nombre. R-06. |
| Tableros | Por creador | Cada quien edita los suyos; `account:write` edita cualquiera. |
| Notificaciones, dispositivos | Por usuario | Correcto. |
| Cuenta, catálogos, categorías de mora | A nivel de cuenta | Correcto: son configuración del tenant. |

## 6. Lo que ve cada rol en la web

| Pantalla | Permiso | Super admin | Admin | Gerente | Supervisor | Cobrador | Auditor | Consulta |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Inicio | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Cartera | `client:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Importar | `client:import` | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| Mora | `collection:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Agenda | `agenda:read` | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| Rutas | `route:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Pagos | `payment:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Equipo | `user:read` | ✅ | ✅ | ✅ | — | — | — | — |
| Cuenta | `account:read` | ✅ | ✅ | ✅ | — | — | — | — |
| Exportar | `report:export` | ✅ | ✅ | ✅ | — | — | ✅ | — |
| Mi perfil | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Pestañas de Cuenta** | |  |  |  |  |  |  |  |
| &nbsp;&nbsp;General | `account:read` | ✅ | ✅ | ✅ | — | — | — | — |
| &nbsp;&nbsp;Plan | `account:read` | ✅ | ✅ | ✅ | — | — | — | — |
| &nbsp;&nbsp;Cobranza | `account:read` | ✅ | ✅ | ✅ | — | — | — | — |
| &nbsp;&nbsp;Mensajes | `catalog:read` | ✅ | ✅ | ✅ | — | — | — | — |
| &nbsp;&nbsp;Catálogos | `catalog:read` | ✅ | ✅ | ✅ | — | — | — | — |
| &nbsp;&nbsp;Oficinas | `office:read` | ✅ | ✅ | ✅ | — | — | — | — |
| &nbsp;&nbsp;Facturación | `account:read` | ✅ | ✅ | ✅ | — | — | — | — |
| &nbsp;&nbsp;Actividad | `audit:read` | ✅ | ✅ | — | — | — | — | — |
| &nbsp;&nbsp;Avanzado | `account:write` | ✅ | ✅ | — | — | — | — | — |

Dos huecos de interfaz que salen de esta tabla:
- **El supervisor tiene `office:read` pero no puede llegar a Oficinas:** la pantalla vive dentro de Cuenta y Cuenta exige `account:read`, que el supervisor no tiene. La API se lo permite; la web no se lo ofrece.
- **El auditor tiene `audit:read` pero no ve «Actividad»:** también vive en Cuenta, y tampoco tiene `account:read`.

**Móvil.** Entran `ACCOUNT_ADMIN`, `MANAGER`, `SUPERVISOR` y `COLLECTOR` (`MOBILE_ROLES`). Los permisos que gobiernan pantallas: `assignment:write` y `collection:write` (ficha de mora), `client:import` (pestaña «Más»), `account:read`/`account:write` (datos de la cuenta), `user:invite` y `user:write` (miembros).

### 6.1 Verificación en vivo (2026-11-04, cuenta DEMO)

Cuerpo vacío: `403` = el permiso lo negó; `400/404/200` = el permiso pasó.

| Llamada | Cobrador | Supervisor | Gerente | Coincide con la matriz |
|---|:-:|:-:|:-:|:-:|
| `POST /clients` | 400 | **403** | 400 | ✅ |
| `POST /credits` | 400 | **403** | 400 | ✅ |
| `POST /payments` | 400 | 400 | 400 | ✅ |
| `POST /branches` | **403** | **403** | **403** | ✅ (sólo administrador) |
| `POST /catalogs/BANK` | **403** | **403** | 400 | ✅ |
| `POST /assignments/bulk` | **403** | 400 | 400 | ✅ |
| `GET /users` | **403** | **403** | 200 | ✅ (el gerente ve toda la cuenta: R-02) |
| `GET /branches` | **403** | 200 | 200 | ✅ |
| `GET /accounts/me` | **403** | **403** | 200 | ✅ |
| `GET /roles` | **403** | **403** | **403** | ✅ (sólo administrador) |
| `GET /exports/backup` | **403** | **403** | **403** | ✅ (sólo quien ve toda la cuenta) |
| `GET /exports/mora` | **403** | **403** | 200 | ✅ (`report:export`) |
| `GET /mora/export.csv` | 200 | 200 | 200 | ✅ (`collection:export`, acotado) |
| `GET /analytics/summary` | 200 | 200 | 200 | ✅ (acotado por alcance) |

Además, con el cobrador de Padilla: ve **1** crédito (el suyo), recibe **404** al abrir uno de otra agencia, y `/analytics/*` devuelve sólo su crédito y su propia fila. El supervisor de una agencia no puede asignar un crédito a la supervisora regional ni a otra agencia (`OUT_OF_AGENCY`).

## 7. Hallazgos

Severidad: **Alta** = riesgo de seguridad o de datos entre oficinas; **Media** = incoherencia que ya molesta o abre un riesgo menor; **Baja** = higiene.

| # | Sev. | Hallazgo | Evidencia | Recomendación |
|---|:-:|---|---|---|
| **R-01** | Alta | **La sesión no se revoca al desactivar a alguien ni al cambiarle el rol.** El access token trae los permisos y dura 15 min; renovar sí relee el rol y bloquea al inactivo, pero hasta entonces el token viejo sigue valiendo. Un administrador degradado a cobrador conserva poder de administrador hasta 15 min. | `UsersService.updateMember` no llama a `SessionService.revokeAll`; `JwtAuthGuard` sólo consulta `isRevoked(sessionId)`. | Al desactivar, cambiar rol o (futuro) cambiar permisos: `revokeAll(userId)`. La revocación ya se chequea por petición, así que sería inmediata. |
| **R-02** | Alta | **La lista de personas no se acota por oficina.** El gerente regional ve (y puede sumar a su oficina) personal de toda la cuenta, incluida otra regional. | `GET /users` devuelve las 26 personas al gerente de Chuquisaca; `UsersService.list` no usa alcance. | Acotar `/users` y «añadir persona» al subárbol (+ personas sin oficina). Ya está en `STATUS` de F13. |
| **R-03** | Media | **El supervisor no puede crear clientes ni créditos** (`client:write`, `credit:write` ausentes). Choca con la regla definida («el supervisor y el gerente regional crean y asignan dentro de su oficina»). | `POST /clients` y `POST /credits` → 403 para el supervisor; 133 vs 152 endpoints frente al cobrador. | Introducir `client:create` / `credit:create` separados de la edición y darlos con la regla de §9. |
| **R-04** | Media | **El permiso de PII de clientes no se aplica.** Quien puede leer un cliente lo ve completo (el «revelado» queda auditado) aunque no tenga `client:pii:read`; `credit:pii:read` no lo lee nadie. | Comentario en `ClientsController.findOne` («los permisos finos son F3/P10»); `credit:pii:read` sin ninguna referencia en la API. | Decidir: aplicar `client:pii:read` (enmascarar sin él, con excepción de lo que el cobrador necesita para llamar) o retirar ambos permisos y dejar sólo la auditoría. |
| **R-05** | Media | **Permisos que sólo se comprueban dentro de los servicios:** `route:write`, `route:assign`, `route:execute` (y partes de agenda, asignación y créditos). Los controladores de rutas y campo exigen sólo `route:read`; el 400 que dio `POST /routes` al cobrador es de validación, no del permiso. | Matriz de §3: 0 endpoints exigen esos tres permisos; `route-access.ts` y `field.service.ts` los comprueban. Hay pruebas unitarias, pero un endpoint nuevo que olvide la comprobación quedaría abierto. | Declararlos en `@Roles` por método (el guard) y dejar el servicio sólo para el alcance fino. |
| **R-06** | Media | **Archivos subidos sin permiso ni alcance.** `POST /uploads` y `GET /uploads/:name` sólo piden sesión: cualquier rol (incluidos consulta y auditor) puede subir, y cualquiera del tenant puede leer cualquier archivo si conoce el nombre. Lo mitiga que el nombre es un hash. | `UploadsController`: sin `@Roles`; aislamiento sólo por carpeta de tenant. | Exigir permiso para subir (p. ej. `client:write`/`collection:write`) y, para leer, comprobar que el archivo pertenece a algo visible por el alcance de quien pide. |
| **R-07** | Media | **No hay forma de modificar permisos, y diseñarla exige separar por tenant.** `role:write` no lo exige ningún endpoint; `roles`/`role_permissions` son globales. | `RoleService`/`roles.controller` sólo listan; `prisma.role.findUnique({ where: { name } })` global. | Ver §8. |
| **R-08** | Media | **`dashboards` permite a cualquier rol con `report:read` crear tableros propios** (ahora también el cobrador), sin tope ni permiso específico. | `POST /dashboards` → 400 (pasó) para los tres roles. Edición ajena exige `account:write`. | Tope de tableros por persona o permiso `dashboard:write`. Bajo riesgo: los datos igual van acotados. |
| **R-09** | Baja | `AUDITOR` y `VIEWER` existen, no son asignables y no tienen usuarios: nunca se ejercitaron en vivo. | `MOBILE_ROLES` excluye a ambos; 0 usuarios. | Definir si se activan; si sí, asignarlos desde la web y probarlos de punta a punta. |
| **R-10** | Baja | Huecos de interfaz: el supervisor no llega a Oficinas y el auditor no ve «Actividad» (ambas dentro de Cuenta, que exige `account:read`). | §6. | Dar acceso a esas pestañas por su propio permiso, o ubicarlas fuera de Cuenta. |
| **R-11** | Baja | `SUPER_ADMIN` = `ACCOUNT_ADMIN`; no existe permiso de plataforma ni alcance `global` (el valor existe en el enum y nadie lo usa). | `ROLE_PERMISSIONS`: ambos `Object.values(Permission)`. | Fase de plataforma, aparte (ver `F13/STATUS`). |
| **R-12** | Baja | **Quién invita:** sólo el administrador (`user:invite`); el gerente no puede incorporar a su gente aunque sea de su subárbol. | `POST /users/invite` → 403 para el gerente. | Decidir si el gerente regional invita dentro de su subárbol (tendría que ir con R-02). |
| **R-13** | Baja | **Pares:** un supervisor puede asignar créditos a otro supervisor de su mismo nivel. «Nunca superior» sí se cumple (`OUT_OF_AGENCY`). | `assertAssignable`: destinatarios `COLLECTOR` o `SUPERVISOR`. | Decidir si se limita a cobradores y a sí mismo. |

## 8. Cómo implementar «sólo SUPER_ADMIN y ACCOUNT_ADMIN modifican permisos»

**Hoy:** se cumple de hecho (nadie más puede, porque no existe la operación), y el cambio de rol de una persona ya exige `user:write`, que sólo tienen esos dos roles.

**Lo que no se puede hacer tal cual:** dejar que un administrador edite `role_permissions`. Esa tabla es **de todos los tenants**; el cambio de un administrador alteraría la cuenta de todos los demás.

**Propuesta de diseño:**
1. **Roles base globales, sólo `SUPER_ADMIN`.** `role_permissions` queda como el valor por defecto de la plataforma; sólo `SUPER_ADMIN` (consola de plataforma, fase aparte) lo edita.
2. **Ajustes por tenant, `ACCOUNT_ADMIN`.** Una tabla nueva (p. ej. `account_role_permissions`: `account_id`, `role_id`, `permission_id`, `granted`) con las diferencias respecto al base, bajo `account_id` + RLS. Los permisos efectivos de un rol en un tenant = base + diferencias.
3. **Barandas** (no negociables, validadas en el servidor): un administrador **no puede** conceder un permiso que él no tenga; **no puede** tocar `ACCOUNT_ADMIN` ni `SUPER_ADMIN`; **no puede** quitarse a sí mismo `role:write`/`user:write`; los permisos de alcance (`data:scope:*`) no se mezclan (un rol tiene uno solo); y siempre queda al menos un administrador.
4. **Aplicación inmediata** (depende de R-01): al guardar un cambio de permisos, revocar las sesiones de los afectados.
5. **Auditoría:** cada cambio queda en `audit_logs` con el antes y el después.
6. **Pantalla** en Cuenta › «Roles y permisos» (la matriz de §3, editable), visible sólo con `role:read` y editable sólo con `role:write`. Esos dos permisos pasan a **exigirse de verdad** en los endpoints (hoy `role:write` no se exige en ninguno).

## 9. Reglas ya definidas por la usuaria (para F14)

1. **Sólo `SUPER_ADMIN` y `ACCOUNT_ADMIN` modifican permisos** (§8).
2. **Quién crea clientes:**
   - El **cobrador** crea sólo a su nombre y no puede asignarlos a otro; el cliente queda en la oficina del cobrador. Al importar, todo queda asignado a él.
   - El **supervisor** y el **gerente regional** crean y pueden asignar a cualquier persona de su oficina (o de su subárbol, el regional).
   - El **gerente de la raíz** (y el administrador en una cuenta con varias oficinas) **no crea** clientes.
   - En una cuenta de **una sola oficina** (cobrador independiente, empresa de un solo lugar) el administrador actúa como cobrador y sí crea.
3. **Asignar:** un rol por encima del cobrador asigna a sí mismo o a cualquier usuario de una oficina hija; **nunca hacia arriba**.
4. **Un cliente vive con su responsable hasta que se reasigne** (hoy el cliente no guarda dueño ni oficina: R-03).

## 10. Plan sugerido

| Orden | Trabajo | Resuelve |
|:-:|---|---|
| 1 | Revocar sesiones al desactivar / cambiar rol | R-01 |
| 2 | Acotar `/users` y «añadir persona» al subárbol | R-02 |
| 3 | Cliente con responsable y oficina; `client:create`/`credit:create`; reglas de §9 | R-03, §9 |
| 4 | Declarar `route:*` y los permisos «sólo servicio» en los guards | R-05 |
| 5 | Decidir y aplicar (o retirar) los permisos de PII | R-04 |
| 6 | Permiso y alcance en archivos subidos | R-06 |
| 7 | Tablas por tenant + editor de permisos con barandas | R-07, §8 |
| 8 | Limpieza: tableros, huecos de interfaz, roles sin usar, invitar por gerente | R-08–R-13 |

---
_Generado a partir del código (`ROLE_PERMISSIONS`, metadatos de Nest de los 202 endpoints) y de pruebas en vivo; las tablas de §3, §4 y §6 salen del código, no se escribieron a mano._
