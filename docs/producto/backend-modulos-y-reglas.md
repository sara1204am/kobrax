# Backend de Kobrax: módulos, endpoints y reglas de negocio

Documento técnico/funcional generado leyendo el código de `apps/api/src` (NestJS) y `packages/shared`, `packages/database`. Estado: árbol de trabajo del 2026-10-09 (rama con cambios sin commitear). Cada regla cita archivo y, cuando aplica, símbolo; lo que no se pudo confirmar está marcado «no verificado».

Nota de alcance: `apps/api/src/modules` contiene **20 directorios** de módulo (accounts, agenda, analytics, arrear-categories, arrears, assignments, auth, catalogs, clients, credits, dashboards, exports, field-ops, imports, mora, notifications, payments, routes, uploads, users) más un spec transversal (`permission-gates.spec.ts`); `users` aloja además el controller de `roles`. No hay un 21.º directorio. Complementos transversales en `apps/api/src/common/`. El modelo de datos está en `modelo-de-datos.md`.

## Índice de reglas de negocio (dónde mirar)

| Regla | Sección |
|---|---|
| Cálculo de mora y días de atraso, método `oldest_unpaid` / `first_default` | mora, arrears |
| Puntaje de prioridad (CRITICAL/HIGH/MEDIUM/LOW) | mora |
| Categorías de mora (rangos por cuenta) | mora, arrear-categories |
| Episodios de mora (apertura/cierre por trigger) | mora; detalle SQL en `modelo-de-datos.md` §4 |
| Promesas de pago | mora, agenda |
| Asignaciones, temporales, apoyo y handoff | assignments |
| Modos de importación y reconciliación, ausentes, idempotencia por hash | imports, clients (import de clientes) |
| Aplicación de pagos e idempotency-key | payments |
| Integridad de evidencia (SHA-256, deduplicación) | field-ops, uploads |
| Optimización de rutas (OSRM y degradación) | routes |
| Límites de plan | common/plan |

---

# Parte 1 · Acceso, cuenta y soporte
## Convenciones comunes a todos los módulos de esta parte

- Prefijo global `/api` (`apps/api/src/main.ts`: `app.setGlobalPrefix('api')`). Las rutas de las tablas ya lo incluyen.
- Toda respuesta se envuelve en `{ data, meta, error }` (`common/interceptors/transform.interceptor.ts`); los errores salen por `common/filters/global-exception.filter.ts` con `error.code`. Los `StreamableFile` (descargas) no se envuelven.
- Cadena de guards de los endpoints autenticados: `JwtAuthGuard` (Bearer + denylist de sesión en Redis) → `TenantGuard` (exige `accountId`) → `RolesGuard` (`@Roles(...)`: el usuario debe tener TODOS los permisos listados; si no, 403 `AUTH_002`). Fuente: `modules/auth/guards/*.ts`.
- Los permisos viajan en el access token y se resuelven por rol desde `role_permissions` (`PermissionsService.forRole`). El mapa base rol→permisos está en `packages/shared/src/constants/permissions.ts` (`ROLE_PERMISSIONS`), que también consume el seed.
- «Permiso requerido = ninguno» significa: solo sesión (o público si se indica).

---

## auth

**Responsabilidad.** Identidad y sesión: login por máquina de estados, MFA TOTP, refresh con rotación, sesiones, recuperación/cambio de contraseña, invitaciones y cambio de empresa. Código: `apps/api/src/modules/auth/` (`auth.service.ts`, `token.service.ts`, `session.service.ts`, `mfa.service.ts`, `password.service.ts`).

### Endpoints (`auth.controller.ts`, prefijo `/api/auth`)

| Método | Ruta | Permiso / protección | Qué hace |
|---|---|---|---|
| POST | `/api/auth/login` | público; rate limit 5/60 s por email+IP | Verifica password (bcrypt). Devuelve el siguiente paso: `mfa`, `mfa_setup`, `select_account` o tokens. |
| POST | `/api/auth/mfa/challenge` | público (pre-auth token `mfa`); 5/60 s por IP | Valida TOTP o backup code y continúa al paso de empresa. |
| POST | `/api/auth/select-account` | público (pre-auth `select_account`) | Elige empresa cuando el usuario tiene ≥2 membresías activas; emite tokens. |
| POST | `/api/auth/mfa/setup/start` | público (pre-auth `mfa_enroll`) | Inicia enrolamiento MFA obligatorio durante el login (devuelve otpauth URL + secreto). |
| POST | `/api/auth/mfa/setup/verify` | público (pre-auth `mfa_enroll`) | Confirma el código, activa MFA, devuelve 8 backup codes y completa el login. |
| POST | `/api/auth/mfa/setup/skip` | público (pre-auth `mfa_enroll`) | «Lo hago después»: completa el login sin activar MFA. |
| POST | `/api/auth/mfa/enroll` | Bearer | Genera secreto TOTP (cifrado) sin activar. |
| POST | `/api/auth/mfa/verify` | Bearer | Activa MFA con un código válido; emite 8 backup codes en claro una sola vez. |
| POST | `/api/auth/mfa/disable` | Bearer | Desactiva MFA tras re-autenticar con password o código MFA; borra secreto y backup codes. 204. |
| POST | `/api/auth/mfa/backup-codes/regenerate` | Bearer | Regenera los 8 backup codes (requiere MFA activo). |
| POST | `/api/auth/refresh` | refresh token en body; 30/60 s por IP | Rota el refresh token y emite nuevo par. |
| POST | `/api/auth/logout` | refresh token en body | Revoca refresh y sesión; la mete en la denylist. 204. |
| POST | `/api/auth/forgot-password` | público; 3/3600 s por email | Genera token de reset y lo envía por correo; respuesta siempre `{ok:true}` (anti-enumeración). |
| POST | `/api/auth/reset-password` | público (token) | Fija nueva contraseña con token de reset. |
| GET | `/api/auth/invitation/:code` | público; 10/60 s por IP | Datos para pintar la pantalla de aceptar invitación. |
| POST | `/api/auth/invitation/accept` | público; 10/3600 s por IP | Fija contraseña y activa al invitado (no emite tokens; luego hace login). |
| POST | `/api/auth/change-password` | Bearer | Cambia contraseña conociendo la actual. |
| GET | `/api/auth/me` | Bearer | Identidad: usuario, perfil, rol, permisos, `mfaEnabled`, `requiresPasswordChange`, `sessionId`. |
| GET | `/api/auth/accounts` | Bearer | Empresas del usuario (cross-tenant). |
| POST | `/api/auth/switch-account` | Bearer | Cambia de empresa: revoca la sesión actual, emite tokens del destino y audita `SWITCH_ACCOUNT`. |
| GET | `/api/auth/sessions` | Bearer | Sesiones activas (cross-tenant), marca la actual. |
| DELETE | `/api/auth/sessions/:id` | Bearer | Revoca una sesión propia (idempotente). 204. |
| DELETE | `/api/auth/sessions` | Bearer | Revoca todas excepto la actual. 204. |

### Reglas verificadas

- **Login (máquina de estados)** `auth.service.ts:login`: password → (MFA si `mfaEnabled`) → (MFA setup obligatorio si algún rol activo es `SUPER_ADMIN`/`ACCOUNT_ADMIN`, constante `CRITICAL_ROLES`) → (selección de empresa si ≥2) → tokens. Usuario inexistente o no `ACTIVE`: se compara contra un hash ficticio (anti-timing) y se responde `invalidCredentials`.
- **Bloqueo**: 5 intentos fallidos (`KOBRAX.MAX_FAILED_LOGINS`) → bloqueo 15 min (`ACCOUNT_LOCK_MINUTES`) en `users.lockedUntil`; un login exitoso resetea el contador (`packages/shared/src/constants/kobrax.constants.ts`). Un reset de contraseña también limpia el bloqueo (`password.service.ts`).
- **Empresas bloqueadas**: las membresías en cuentas `SUSPENDED`/`CANCELLED`/`INACTIVE` no permiten login; `TRIAL` y `ACTIVE` sí (`activeMemberships`). Sin ninguna membresía válida: `noActiveTenant`.
- **MFA obligatorio postergable**: `mfaSetupSkip` permite entrar sin MFA indefinidamente (decisión de producto 2026-07-31 documentada en el código); el aviso es blando en el cliente vía `mfaEnabled` de `/auth/me`.
- **Tokens** (`token.service.ts`, `config/env.validation.ts`): access JWT 15 min por defecto (`JWT_EXPIRES_IN`), claims `sub, accountId, roleId, permissions, sessionId, type:'access'`; refresh JWT 7 días (`JWT_REFRESH_EXPIRES_IN`) con secreto distinto, `jti` aleatorio; en BD solo se guarda el SHA-256 del `jti`. Pre-auth token: 5 min, `type:'pre_auth'` con `purpose` (`mfa`, `mfa_enroll`, `select_account`); nunca da acceso a recursos.
- **Rotación de refresh** (`auth.service.ts:refresh`): compare-and-swap sobre `revokedAt`; si el token ya revocado se reusa dentro de `GRACE_MS = 10 s` se responde `refreshRetry` (carrera legítima); fuera de la gracia es reuso: se revoca toda la `familyId` y la sesión y se responde `reuseDetected`.
- **Denylist de sesión**: Redis `revoked_session:<id>` con TTL 7 días; `JwtAuthGuard` la consulta en cada request (revocación instantánea).
- **MFA** (`mfa.service.ts`): TOTP; el secreto se cifra con AES-256-GCM (`CryptoService`); 8 backup codes `xxxxx-xxxxx` guardados como SHA-256, de un solo uso (consumo atómico con CAS).
- **Contraseña**: política en `packages/shared/src/validation/password-policy.ts` — mínimo 8, una mayúscula, un número, un símbolo; bcrypt work factor 12; tope 72 bytes (`common/validation/max-bytes.ts`).
- **Reset**: token válido 30 min (`RESET_TTL_MS`), almacenado hasheado, de un solo uso. Sin SMTP configurado el correo se loguea (`[SIN SMTP]`) en vez de enviarse; `forgotPassword` también loguea el token en `[DEV]` (`password.service.ts`).
- **Invitación**: código Crockford base32 de 10 símbolos (50 bits), hasheado, vigencia 7 días (`users.service.ts: INVITE_TTL_MS`), un solo uso; el invitado es un `User` `PENDING`. El código del reset y el de invitación comparten tabla (`password_reset_tokens`) y se rechazan mutuamente.
- **Cambio de empresa**: emite credenciales operativas para otro tenant; revoca la sesión previa y deja auditoría `SWITCH_ACCOUNT` en la empresa de origen.

**Jobs/cron:** ninguno. **Eventos/realtime:** ninguno.

---

## accounts

**Responsabilidad.** Datos del propio tenant y registro público de nuevas cuentas (`modules/accounts/`).

| Método | Ruta | Permiso | Qué hace |
|---|---|---|---|
| POST | `/api/accounts` | público; 10/3600 s por IP | Registro: crea cuenta + usuario + perfil + membresía de dueño + rangos de mora por defecto en una transacción. No emite tokens (el cliente hace login después). |
| GET | `/api/accounts/me` | `account:read` | Datos de la cuenta + uso de plan (`PlanLimitsService.usageAll`). |
| PATCH | `/api/accounts/me` | `account:write` | Edita razón social, NIT, país, moneda, zona horaria, decimales y método de mora (`settings`). Audita. |

**Reglas verificadas** (`accounts.service.ts`):
- Plan elegible al registrarse: solo `FREE`, `PROFESSIONAL`, `BUSINESS` (`SIGNUP_PLANS`); `ENTERPRISE` queda fuera por ser endpoint público.
- Plan pago nace en `TRIAL` 30 días (`TRIAL_DAYS`), `trialEndsAt` en `settings`; al vencer cae a FREE (job de ciclo de vida). FREE nace `ACTIVE`.
- Defaults: país `BO`, moneda `BOB`. El dueño recibe rol `ACCOUNT_ADMIN`, `isOwner`, `isDefault`.
- Se siembran las categorías de mora `A 1–30`, `B 31–60`, `C 61+` (`DEFAULT_ARREAR_CATEGORIES`).
- El id de la cuenta se genera en la app para poder abrir el contexto RLS antes del insert. Unicidad de email por `users.email @unique` (P2002 → `emailTaken`).
- El plan y los topes NO se editan desde el producto (solo CLI de plan, ver `common/plan`).

---

## users (users + roles)

**Responsabilidad.** Miembros del tenant, invitaciones, desactivación con traspaso, perfil propio y catálogo de roles (`modules/users/`).

| Método | Ruta | Permiso | Qué hace |
|---|---|---|---|
| GET | `/api/users/me/profile` | ninguno (solo sesión) | Perfil propio. |
| PATCH | `/api/users/me/profile` | ninguno | Edita perfil propio (el cobrador puede corregir su teléfono). |
| GET | `/api/users` | `user:read` | Miembros activos e inactivos. |
| POST | `/api/users/invite` | `user:invite` | Invita (crea `User` PENDING + código + correo). |
| POST | `/api/users/:id/invite/resend` | `user:invite` | Reenvía invitación (solo PENDING). |
| PATCH | `/api/users/:id` | `user:write` | Cambia rol/activo/datos de un miembro; `:id` es `userId`. |
| DELETE | `/api/users/:id` | `user:write` | Cancela invitación pendiente (a un activo se lo desactiva con PATCH). 204. |
| GET | `/api/roles` | `role:read` | Lista de roles (`roles.controller.ts`). |

**Reglas verificadas** (`users.service.ts`):
- Nadie puede editarse/eliminarse a sí mismo (`cannotEditSelf`).
- Roles asignables desde el producto: `MOBILE_ROLES` = `ACCOUNT_ADMIN`, `SUPERVISOR`, `COLLECTOR` (`packages/shared/src/constants/roles.ts`); es regla de servidor (`roleNotAllowed`).
- No se puede dejar a la cuenta sin `ACCOUNT_ADMIN` activo (`lastAdmin`).
- Invitar y reactivar consumen un asiento: `plan.assertRoom('users', tx)` dentro de la transacción; un invitado pendiente ya cuenta (`userAccount.count({isActive:true})`).
- Desactivar a alguien con trabajo pendiente (agenda `SCHEDULED`, créditos como responsable vigente, rutas `PLANNED`/`IN_PROGRESS`) exige `reassignToUserId`; `handOver` traspasa créditos (vía `AssignmentService.apply`, motivo `BULK_REASSIGN`), agenda, rutas (si el destinatario ya tiene ruta ese día, la del saliente se cancela y sus visitas quedan libres) y revoca coberturas `TEMPORAL`/`APOYO`.
- Destino de traspaso válido solo si `isAssignable` (activo, rol asignable, no el mismo).

---

## catalogs

**Responsabilidad.** Catálogos configurables por tenant en una tabla genérica `catalog_items` (`modules/catalogs/`).

| Método | Ruta | Permiso | Qué hace |
|---|---|---|---|
| GET | `/api/catalogs/:catalog` | `catalog:read` | Ítems activos (no borrados), por `sortOrder`, `label`. |
| POST | `/api/catalogs/:catalog` | `catalog:write` | Crea ítem (`code`, `label`, `sortOrder`, `metadata`). |
| PATCH | `/api/catalogs/:catalog/:id` | `catalog:write` | Edita label/orden/activo/metadata. |
| DELETE | `/api/catalogs/:catalog/:id` | `catalog:write` | Soft-delete (`deletedAt`, `isActive=false`). |

Tipos (enum `CatalogType`, `schema.prisma`): `PAYMENT_METHOD, BANK, EXPECTED_RESULT, PRIORITY, ADDRESS_TYPE, PHONE_TYPE, CANCEL_REASON, RESCHEDULE_REASON, REMINDER_CATEGORY, CAMPAIGN, CURRENCY, WHATSAPP_TEMPLATE, SPECIAL_CATEGORY, COLLATERAL_TYPE, CREDIT_TYPE`. Todo cambio se audita (`catalog_item`). `:catalog` se valida con `ParseEnumPipe`.

---

## arrear-categories

**Responsabilidad.** Rangos de la categoría de mora de la cuenta (`modules/arrear-categories/`). La categoría se **calcula** con los días de mora y los rangos vigentes; no se guarda en el crédito (`packages/shared/src/utils/arrear-category.ts: categoryForDays`).

| Método | Ruta | Permiso | Qué hace |
|---|---|---|---|
| GET | `/api/arrear-categories` | `collection:read` | Rangos vigentes ordenados. |
| PUT | `/api/arrear-categories` | `account:write` | Reemplaza el juego completo (validado, transaccional, auditado antes/después). |

**Reglas** (`validateArrearCategories`): debe haber al menos una; códigos no vacíos y únicos; `fromDays` entero ≥ 1; `toDays` ≥ `fromDays`; la primera empieza en el día 1; sin huecos ni solapes; solo la última puede ser abierta (`toDays=null`). Códigos de error: `EMPTY, CODE_EMPTY, CODE_DUPLICATE, RANGE_INVALID, TO_BEFORE_FROM, NOT_STARTING_AT_1, GAP, OVERLAP, OPEN_ENDED_NOT_LAST`. `categoryForDays(days<1)` → `null` (al día). Sin caché: el cambio rige en la siguiente petición. El `PUT` actualiza por `code` (conserva id), borra las ausentes y crea las nuevas.

---

## uploads

**Responsabilidad.** Primitivo de almacenamiento de archivos (`modules/uploads/`).

| Método | Ruta | Permiso | Qué hace |
|---|---|---|---|
| POST | `/api/uploads` | solo sesión (JwtAuth+Tenant+Roles sin `@Roles`) | Sube imagen (campo `file`); devuelve `{url, hash, size, mimeType}`. |
| GET | `/api/uploads/:name` | solo sesión | Sirve la imagen del tenant en sesión. |

**Reglas** (`uploads.service.ts`): solo `image/jpeg|png|webp`, máx 8 MB (`MAX_UPLOAD_BYTES`); el archivo se nombra `<sha256>.<ext>` (hash del buffer original → mismo contenido = un solo archivo, deduplicación y no adivinable); se aísla por carpeta `UPLOADS_DIR/<accountId>/`; el nombre servido debe cumplir `^[0-9a-f]{64}\.(jpg|png|webp)$`. `storeDocument` guarda reportes de importación (pdf/xlsx/xls/csv/txt) en `imports/<sha256>.<ext>`. **Driver = disco local**; el propio código dice que S3/R2 se implementa cuando haya bucket (ver «Integraciones externas»). Cada subida se audita (`upload`).

---

## exports

**Responsabilidad.** Descargas de datos de la cuenta (`modules/exports/`). Todo el controller exige `report:export`.

| Método | Ruta | Permiso | Qué hace |
|---|---|---|---|
| GET | `/api/exports/clients` | `report:export` | CSV de clientes (documento y contacto descifrados). |
| GET | `/api/exports/locations` | `report:export` | CSV de ubicaciones. |
| GET | `/api/exports/mora` | `report:export` | CSV de créditos en mora (episodio abierto); `take: 1000`. |
| GET | `/api/exports/agenda` | `report:export` | CSV de la agenda. |
| GET | `/api/exports/backup` | `report:export` | JSON gzip con clientes (contactos, ubicaciones, relaciones, garantías, adjuntos), créditos, actividades, episodios, pagos y agenda; PII descifrada. |

**Reglas:** la PII sale en claro y cada llamada se audita como `export:<kind>` acción `EXPORT` (`exports.service.ts:logExport`). El backup excluye rutas, catálogos y dashboards (documentado en el código). El export de mora está limitado a 1000 filas (`take: 1000`).

---

## dashboards

**Responsabilidad.** Tableros personalizables por tenant (`dashboards` + `dashboard_widgets`) (`modules/dashboards/`). Controller completo con `@Roles(report:read)`.

| Método | Ruta | Permiso | Qué hace |
|---|---|---|---|
| GET | `/api/dashboards` | `report:read` | Lista (predeterminado primero). |
| GET | `/api/dashboards/:id` | `report:read` | Detalle con widgets. |
| POST | `/api/dashboards` | `report:read` | Crea (hasta 60 widgets). |
| PATCH | `/api/dashboards/:id` | `report:read` + autoría | Edita; el layout se reemplaza entero tras bloquear la fila. |
| POST | `/api/dashboards/:id/duplicate` | `report:read` | Copia «(copia)», nunca predeterminada. |
| DELETE | `/api/dashboards/:id` | `report:read` + autoría | Soft-delete. |

**Reglas** (`dashboards.service.ts`): solo el creador o quien tenga `account:write` puede modificar/borrar (`notYours`); marcar `isDefault` exige `account:write`, salvo que no exista aún un predeterminado; `x` se recorta a `12 - w` (grilla de 12 columnas); DTO: `x 0–11`, `y 0–200`, `w 1–12`, `h 1–20`, máx 60 widgets. Tipos de widget (`WIDGET_TYPES`): `kpi, line_chart, bar_chart, donut_chart, table, map, funnel, gauge, calendar, list, histogram, text`.

---

## analytics

**Responsabilidad.** Seis agregaciones del dashboard, calculadas en SQL bajo RLS (`modules/analytics/`). Controller con `@Roles(report:read)`. Todos aceptan los mismos filtros: `dateFrom`, `dateTo` (`YYYY-MM-DD`), `branchId`, `collectorId` (CSV, máx 50), `priority` (CSV, máx 20), `source` (fuente de cartera).

| Método | Ruta | Permiso | Qué hace |
|---|---|---|---|
| GET | `/api/analytics/summary` | `report:read` | KPIs: saldo, mora, tasa de mora, créditos en mora, recaudado vs período anterior, desglose por fuente. |
| GET | `/api/analytics/portfolio-aging` | `report:read` | Cartera por tramos de mora. |
| GET | `/api/analytics/collector-performance` | `report:read` | Ranking por responsable del crédito. |
| GET | `/api/analytics/agenda-summary` | `report:read` | Agenda por tipo/estado y cumplimiento. |
| GET | `/api/analytics/visit-map` | `report:read` | Paradas del último día con paradas dentro del período. |
| GET | `/api/analytics/collection-trend` | `report:read` | Serie de recaudo y saldo; `granularity` = `day|week|month`. |

**Reglas verificadas** (`analytics.service.ts`):
- «Créditos en mora» = créditos con episodio de mora abierto (`credit_arrear_episodes.ended_at IS NULL`); el ranking agrupa por `assigned_manager_id` (F4/08).
- Ventana por defecto: últimos 7 días; se compara con la ventana anterior de igual largo; rango máximo 366 días (se recorta el inicio).
- Tramos (`AGING_BUCKETS`, `packages/shared/src/utils/aging.ts`): `1–30, 31–90, 91–180, 181–360, 361–450, >450` (códigos `D1_30, D31_90, D91_180, D181_360, D361_450, D450_PLUS`). **Distintos** de las categorías de mora configurables.
- El pago se atribuye a quien lo registró (`registered_by`).
- Serie de recaudo: Kobrax se reconstruye hacia atrás desde el saldo actual; cartera externa usa el último snapshot reportado (las ausentes no cortan la curva); `generate_series` incluye días en cero.
- El intervalo del `date_trunc` se toma de una tabla fija, nunca del input.
- Sin `account_id` manual en las consultas: lo da la RLS (`withTenant`).

---


---

# Parte 2 · Cartera: clientes, créditos, importación, pagos, asignaciones

## clients

**Responsabilidad.** Deudores (personas o empresas) con sus subrecursos: contactos (teléfono/email), ubicaciones, relaciones (garantes, referencias), garantías (bienes), adjuntos y bitácora. Aplica el cifrado de PII y la deduplicación por documento. Fuente: `apps/api/src/modules/clients/clients.controller.ts`, `clients.service.ts`, `clients.serializer.ts`.

Todos los endpoints llevan `JwtAuthGuard, TenantGuard, RolesGuard` y el prefijo global `/api` (`apps/api/src/main.ts`: `setGlobalPrefix('api')`).

| Método | Ruta | Permiso | Qué hace |
|---|---|---|---|
| POST | `/api/clients` | `client:write` | Alta atómica de cliente + contactos + ubicaciones + relaciones + garantías en una transacción. Idempotente si el móvil manda `id` propio. |
| POST | `/api/clients/duplicate-check` | `client:read` | Avisa de posibles duplicados antes del alta: mismo carnet (bloquea) o mismo nombre (avisa). POST para no dejar el carnet en la URL. |
| GET | `/api/clients` | `client:read` | Lista; con `view=portfolio` trae deuda agregada (SUM), peor mora (MAX) y nº de créditos, ordenado en SQL. |
| GET | `/api/clients/:id` | `client:read` | Ficha. `?reveal=true` devuelve PII en claro y deja `audit` `client/PII_REVEAL`. |
| GET | `/api/clients/:id/pdf` | `client:read` | Legajo en PDF (usa el mismo revelado auditado). |
| PATCH | `/api/clients/:id` | `client:write` | Edita datos; si cambia el documento recalcula el blind index y revalida unicidad. |
| DELETE | `/api/clients/:id` | `client:write` | Baja lógica (`status=INACTIVE`, `deleted_at`). Rechaza si tiene créditos `ACTIVE`. |
| POST/PATCH/DELETE | `/api/clients/:id/contacts[/:cid]` | `client:write` | CRUD de teléfonos/emails (valor cifrado). |
| POST/PATCH/DELETE | `/api/clients/:id/locations[/:lid]` | `client:write` | CRUD de ubicaciones (dirección cifrada). |
| POST/PATCH/DELETE | `/api/clients/:id/relations[/:rid]` | `client:write` | CRUD de relaciones (garante/contacto); permite vincular créditos que respalda. |
| GET | `/api/clients/:id/timeline` | `client:read` | Bitácora (UNION ALL de pagos, agenda y gestiones); cada fuente entra sólo si quien mira tiene `payment:read`, `agenda:read` o `collection:read`. |
| POST/PATCH/DELETE | `/api/clients/:id/collaterals[/:gid]` | `client:write` | CRUD de garantías (bien) y su vínculo con créditos. |
| POST/PATCH/DELETE | `/api/clients/:id/attachments[/:aid]` | `client:write` | CRUD de adjuntos del cliente. |
| POST | `/api/clients/imports` | `client:import` **y** `client:write`; `REPLACE` exige además `client:import:replace` | Import de clientes (CSV/JSON). Ver sección propia abajo. Archivo: `clients/import/client-import.controller.ts`. |

**Jobs / realtime.** Ninguno propio.

### Reglas verificadas

- **Cifrado PII.** `CryptoService` cifra con AES-256-GCM, IV aleatorio de 12 bytes, salida `iv.tag.cipher` en base64 (`common/crypto/crypto.service.ts`). Se cifran `national_id`, `tax_id`, `value` de contactos y `address` de ubicaciones (`clients.service.ts`: `enc()`, `create()`, `addContact`). Sin permiso de lectura o sin `reveal`, el serializer enmascara con `maskDocument/maskEmail/maskPhone` de `@kobrax/shared` (`clients.serializer.ts: pii()`).
- **Blind index.** `BlindIndexService.hash()` = HMAC-SHA256 hex del valor normalizado (trim, mayúsculas, sin espacios/puntos/guiones/barras) con `APP_BLIND_INDEX_KEY` (32 bytes, distinta de la de cifrado, validada al arrancar) (`common/crypto/blind-index.service.ts`). Se guarda en `clients.national_id_hash`; la normalización es contractual (cambiarla invalida los hashes). La búsqueda `q` compara la cadena ENTERA contra el hash (exacto o nada) y, en paralelo, por nombre sin tildes (`name-search.ts`).
- **Unicidad de documento.** `create()` y `update()` buscan `nationalIdHash` (incluye dados de baja, igual que el índice único) y lanzan `CLIENT_DUP` (`clientDuplicate()`); la carrera contra el índice único también se traduce a `CLIENT_DUP`.
- **Alta idempotente.** Si `dto.id` ya existe (no borrado) se devuelve el existente sin auditar de nuevo (reintento de cola offline). El tope de clientes del plan se verifica con `plan.assertRoom('clients', tx, { soft: Boolean(dto.id) })` después del chequeo de documento.
- **Baja.** `remove()` bloquea si hay créditos `ACTIVE` no borrados (`clientHasActiveCredits`).
- **Auditoría.** Todas las mutaciones llaman `audit.record` con `redactKeys: CLIENT_REDACT` (la PII no entra en claro al snapshot).
- **Duplicados por nombre.** `duplicateCheck` usa la llave `nameKey` (`common/name-key.ts`: sin tildes, sin mayúsculas, sin orden) con candidatos por la palabra más larga y `translate()` en SQL; devuelve documento enmascarado y nº de créditos, sin PII en claro.

### Import de clientes (CSV/JSON)

Archivos: `clients/import/import-plan.ts`, `client-import.service.ts`, `import.dto.ts`.

- `mode`: `RECONCILE | UPSERT_ONLY | REPLACE`; `source`: `csv | json`; `dryRun` opcional; `mapping` campo canónico → columna.
- **Emparejamiento**: por blind index del documento. Sin documento, la fila siempre se crea (no se puede deduplicar). Documento repetido dentro del archivo → `DUP_IN_FILE` (inválida).
- **Ausentes**: sólo en `RECONCILE` y `REPLACE`, sobre existentes con documento que no matchearon: si tienen crédito `ACTIVE` pasan a `needsReview` (NO se dan de baja); si no, `toSoftDelete` (`INACTIVE` + `deleted_at`). En `UPSERT_ONLY` los ausentes no se tocan.
- **`REPLACE` hoy se comporta igual que `RECONCILE`** en `planImport` (no se encontró lógica adicional); lo único distinto es que el controller exige `client:import:replace`.
- **Idempotencia**: SHA-256 del contenido (`content` CSV o `JSON.stringify(rows)`); si ya existe un `client_import_runs` `DONE` con ese `file_hash`, devuelve `idempotentSkip: true` con los contadores previos y no escribe.
- **Dry-run**: calcula el plan y devuelve contadores + `invalid`, sin tocar la base ni registrar corrida.
- Al aplicar: `plan.assertRoom('clients', tx, { cuantos })` rechaza el archivo entero si excede el tope; nacionalId es clave y no se actualiza en `updateClient`.

---

## credits

**Responsabilidad.** Obligaciones financieras: alta con motor de cálculo único, cronograma, estado, mora (días y método), castigo, vínculo a cliente. Archivos: `credits.controller.ts`, `credits.service.ts`, `credit-math.ts`, `packages/shared/src/utils/{credit-engine,arrears-method,loan}.ts`.

| Método | Ruta | Permiso | Qué hace |
|---|---|---|---|
| POST | `/api/credits` | `credit:write` | Alta (con `terms` → motor; sin `terms`, cuota congelada o cronograma amortizado). Idempotente con `id` propio. |
| GET | `/api/credits` | `credit:read` | Lista. |
| GET | `/api/credits/:id` | `credit:read` | Detalle. |
| GET | `/api/credits/:id/schedule` | `credit:read` | Cronograma. |
| PATCH | `/api/credits/:id` | `credit:write` (reasignar responsable exige además `assignment:write`, verificado en el service) | Edita; redefinir condiciones sólo sin pagos. |
| POST | `/api/credits/:id/write-off` | `credit:write` + alcance `data:scope:all` | Castigar (condición, no estado). |
| DELETE | `/api/credits/:id/write-off` | idem | Revertir castigo. |
| POST | `/api/credits/:id/recalculate-arrears` | `credit:write` | Recalcula mora a `asOf`. |
| POST | `/api/credits/:id/arrears` | `credit:write` | Marca mora a mano (`days`). |
| POST | `/api/credits/:id/arrears/clear` | `credit:write` | Poner al día (modos `next_period`, `date`, `none`). |
| POST | `/api/credits/:id/link-client` | `credit:write` | Mueve el crédito a otro cliente (D2). |
| POST | `/api/credits/link-review/:clientId/confirm` | `credit:write` | «Es una persona nueva»: cierra la revisión del cliente provisional. |

**Jobs.** El recálculo diario de mora vive en `modules/arrears` (documentado en otro apartado); `credits` no tiene cron propio.

### Reglas verificadas

- **Motor único de cronograma.** `buildSchedule` es un adaptador sobre `calculateCredit` de `@kobrax/shared` (misma función que la vista previa web/móvil). Trabaja en céntimos enteros; la última cuota absorbe el redondeo (Σ capital = principal, saldo final 0). `scheduleIsBalanced` valida Σ cuotas = principal + Σ interés (±1 céntimo) y, si falla, `scheduleInvalid()`.
- **Definiciones** (`CreditDefinition`): `calculated`, `agreed_installment`, `agreed_total`. **Interés** `simple|compound`. **Amortización** `fixed_installment|fixed_principal|single_payment`. **Frecuencias** `DAILY|WEEKLY|BIWEEKLY|MONTHLY|QUARTERLY|SEMIANNUAL|ANNUAL` (`OFFERED_FREQUENCIES` en UI: DAILY, WEEKLY, BIWEEKLY, MONTHLY). Reglas D2–D20 en cabecera de `credit-engine.ts` (tasa como porcentaje por período; compuesto + capital fijo no se ofrece; cuota acordada sin nº de cuotas = préstamo abierto; seguro de desgravamen y cargos opcionales).
- **Saldo (D15).** Nace como total pendiente de cobro (cronograma o cuota×n); en préstamo abierto es el capital y `balanceBasis='principal'`. «Ya en curso» (`initialState`) usa `registeredState`.
- **Origen externo bloqueado.** Créditos de importación (`isExternalOrigin`) no se pueden marcar/poner al día ni redefinir (`creditLocked`); `recalculateArrears` los salta (`skipped: 'EXTERNAL_ORIGIN'`): su mora la manda el archivo.
- **Cálculo de días de atraso.**
  - Con cronograma: `computeArrears` (`credit-math.ts`): cuota en mora si no está `PAID` y `dueDate + graceDays < asOf`; `daysOverdue = floor((asOf − (cuota más antigua + gracia)) / día)`; `overdueAmount = Σ(amount − paidAmount)`; `interest = overdueAmount × dailyMoratoriumRate × días` (default 0,001/día); `penalty = overdueAmount × penaltyRate`. Marca las cuotas vencidas `OVERDUE` y reemplaza el snapshot `arrears` del crédito (un snapshot por crédito).
  - Sin cronograma: `arrearsFromDueDate(nextDueDate, saldo, asOf)` = días desde `nextDueDate` si saldo > 0,005 (`loan.ts`).
  - Mora declarada a mano: se guarda `metadata.moraSince` (fecha, no días) y `manualArrears` la hace envejecer sola; el recálculo no la pisa (`skipped: 'MANUAL_ARREARS'`).
  - **Método (D20)** `arrearsMethod`: `oldest_unpaid` (default, mora desde la cuota impaga más antigua) o `first_default` (bancario: la fecha del primer atraso se fija y no se mueve mientras haya atraso; días = máx(base, días desde esa fecha)). Se guarda en el crédito; cambiarlo con pagos registrados se bloquea (`creditHasPayments`). Función: `arrears-method.ts: withArrearsMethod/arrearsByMethod`.
  - Poner al día mueve la fecha de vencimiento (nunca borra el síntoma); el cierre del episodio de mora lo hace el trigger de base al quedar `days_past_due = 0` (comentario en `clearArrears`).
- **Castigo.** `writeOff` sólo con `credit:write` **y** `data:scope:all` (gerente/administrador); escribe `written_off_at/by/reason`, no cambia `status` ni cierra la mora; `status: 'WRITTEN_OFF'` por PATCH se rechaza (`writeOffUseEndpoint`). Idempotente.
- **Responsable.** Elegir a otra persona exige `assignment:write`; sin elegir, quien no puede asignar queda como responsable (`CREATE_OWN`). Toda escritura pasa por `AssignmentService.apply`.
- **Vincular cliente (D2).** `linkClient` re-apunta actividades, agenda, paradas y pedidos de cobro al cliente elegido, guarda el vínculo `client_external_keys` (NAME) para próximas importaciones, y si el provisional queda vacío hereda contactos/ubicaciones y se da de baja.
- **Plan.** `plan.assertRoom('credits', tx, {soft})` en el alta.

---

## imports

**Responsabilidad.** Importación de cartera desde reportes del core ajeno (PDF o CSV/Excel), reconciliación idempotente, asignación al importar, vínculo asesor↔usuario, historial de corridas con detalle por registro. Archivos: `modules/imports/*`.

| Método | Ruta | Permiso | Qué hace |
|---|---|---|---|
| GET | `/api/imports/portfolio/config` | `client:import` | Configuración de importación del tenant + catálogo de campos, presets y última corrida. |
| PATCH | `/api/imports/portfolio/config` | `client:import` | Cambia la configuración (valida invariantes §3.1; `fields.x = null` quita el campo; `reset`). |
| POST | `/api/imports/portfolio` | `client:import` | Multipart `file`. `dryRun=true` = vista previa; `?columnsOnly=true` = sólo etiquetas/columnas; `reportDate`; `assignments` (JSON). Tope 15 MB. |
| GET | `/api/imports/portfolio/runs` | `client:import` | Historial paginado con búsqueda y filtros (fechas, `reportFrom/To`, `createdBy`, `q`). |
| GET | `/api/imports/portfolio/runs/:id` | `client:import` | Resumen de una corrida. |
| GET | `/api/imports/portfolio/runs/:id/items` | `client:import` | Movimientos por registro (filtro `action`). |
| GET | `/api/imports/portfolio/runs/:id/file` | `client:import` **y** `client:pii:read` | Descarga/abre el documento original (`?download=1`). |
| GET | `/api/imports/portfolio/advisors` | `client:import` | Códigos de asesor ↔ usuario. |
| PUT | `/api/imports/portfolio/advisors/:code` | `client:import` | Vincula código de asesor a `userId`. |
| DELETE | `/api/imports/portfolio/advisors/:code` | `client:import` | Desvincula. |

(Más el import de clientes `POST /api/clients/imports`, descrito en `clients`.)

**Jobs / realtime.** Ninguno propio; el trabajo de mora posterior usa `reportedAsOf` y `staleAfterDays` (D9) para no abrir episodios con datos viejos (ver `credits.service.ts: accountConfig`, `staleAfterDays`).

### Reglas verificadas

- **Formas de archivo** (`ProfileKind`): `rows` (CSV y Excel `.xlsx`; la decisión CSV/zip la toman los bytes, `parseRowsFile`), `pdf-rows`, `pdf-blocks`. El PDF/planilla incorrecto para el perfil → `FILE_SHAPE_MISMATCH`; `.xls` (OLE2) → `XLS_LEGACY_NOT_SUPPORTED`; firma no coincide → `SIGNATURE_MISMATCH`; sin registros → `NO_RECORDS_MAPPED`. Topes anti-DoS de PDF: 2000 páginas, 500.000 items (`pdf-blocks.parser.ts`). Mime aceptados por el controller: PDF, xlsx, xls, csv, text/plain. Si `source = manual` → `IMPORT_DISABLED`; sin campos emparejados → `IMPORT_NOT_CONFIGURED`.
- **Modo.** La corrida de cartera siempre se registra como `mode: 'RECONCILE'` (`portfolio-import.service.ts`); no hay `UPSERT_ONLY` ni `REPLACE` en cartera. **Nunca borra ni desactiva** (`portfolio-plan.ts`).
- **Llave de identidad.** `(fuente 'PSF', nº de operación)` → `credits.external_source` + `credits.external_id`. `code` es sólo rótulo. Única fuente hoy: constante `FILE_SOURCE = 'PSF'`.
- **Plan (`planPortfolioImport`).**
  - En archivo + existe y es elegible → `toUpdate` (si estaba `ABSENT`, `reappeared`).
  - En archivo + no existe → `toCreate`.
  - Fila sin código: con apellido/nombre → `invalid NO_CODE`; sin nombre → ignorada. Código que no parece operación (totales/notas) → ignorada.
  - Código repetido en el archivo → `invalid DUP_IN_FILE`. Campo obligatorio vacío → `invalid MISSING_<CAMPO>` (la fila entra completa o no entra).
  - Existe pero fuera del alcance o borrada → `invalid MATCHES_OUT_OF_SCOPE`.
- **Ausentes (D4).** Un crédito elegible que no viene → `toMarkAbsent` sólo en la transición (si ya estaba `ABSENT` no se repite): `sync_status = ABSENT`, `absent_since = fecha de corte` (o día de la corrida), se guarda un snapshot `ABSENT` y evento de auditoría `EXTERNAL_ABSENT`. Estado y saldo intactos. Con `absentRule = 'set-current'` (default) y crédito no cerrado, además `days_past_due = 0` (`toSetCurrent`); con `'no-touch'` o `'ask'` no se toca la mora (`'ask'` se trata como `no-touch` en `run`).
- **Reaparición.** Al venir de nuevo: `sync_status = PRESENT`, `absent_since = null`; si estaba cerrado y la etiqueta de estado no se mapea, vuelve a `ACTIVE` (`updatedStatus`, B-4).
- **Actualización parcial (D9).** Al actualizar sólo se escribe lo que la fila trae (`null` = no está la columna); al crear, columnas `NOT NULL` reciben 0 y `metadata.importMissing` marca lo desconocido.
- **Idempotencia por hash.** `fileHash = SHA-256(file)`. Si ya hay una corrida `DONE` con ese hash y `template` no nulo: al confirmar devuelve `idempotentSkip: true` (sin escribir); con `assignments` → 409 `ALREADY_APPLIED`. En vista previa informa `alreadyApplied`. Un reporte con fecha de corte anterior al último aplicado en el mismo alcance → 400 `REPORT_OUTDATED`. La fecha de corte manual no puede ser futura (`INVALID_REPORT_DATE`).
- **Vista previa obligatoria**: `dryRun=true` devuelve buckets `toCreate/toUpdate/toSetCurrent/toMarkAbsent/invalid/warnings`, `plan {roomLeft, over}` y sugerencias de asignación; no escribe nada (ni guarda el archivo). Al confirmar el plan se **recalcula** en el servidor.
- **Alcance (D8).** `resolveImportOwnership` (`import-assignment.ts`): quien tiene `assignment:write` (modo `CHOOSE`) con asesor vinculado → alcance `official` = ese usuario; sin vínculo y alcance empresa → `ADVISOR_NOT_LINKED`. Quien no reparte (cobrador, modo `SELF`) sólo importa su cartera: asesor de otra persona → `ADVISOR_BELONGS_TO_OTHER`; asesor sin vincular → `ADVISOR_NOT_LINKED`; sin asesor → alcance `official` = él mismo. Alcances de config: `official | branch | account`.
- **Asignación al importar.** Nuevos: en `SELF`, a quien importa (`IMPORT_OWN`); en `CHOOSE`, lo elegido (`IMPORT_CHOSEN`) o la sugerencia del asesor/alcance (`IMPORT_SUGGESTED`); si queda alguno sin responsable → 400 `UNASSIGNED_NEW_CREDITS`. Existentes conservan su responsable salvo reasignación explícita (`IMPORT_REASSIGN`, con `expectedFrom` → conflicto aborta toda la corrida). Cobrador que manda `assignments` → `assignmentForbidden`. Supervisor sólo reparte dentro de su agencia (`assertImportAgency`). Topes `MAX_CODES=5000`, `MAX_GROUPS=200`; `assignments` debe traer `version: 1`.
- **Match de clientes para operaciones nuevas** (`client-match.ts`, `resolveClients`), en orden: (1) vínculo confirmado `client_external_keys` (NAME); (2) carnet por blind index; (3) coincidencia por nombre (`nameKey`) → cliente provisional con `link_review_pending = true` y `metadata.linkSuggestions` (`NAME_MATCH` / `SAME_NAME_IN_FILE`); (4) cliente nuevo. Varias filas con el mismo nombre en el archivo van a un solo cliente marcado a revisar. Hasta 5000 candidatos por palabras del nombre (`MAX_CANDIDATES`). Contactos y direcciones sólo rellenan huecos (`fillContactGaps`), nunca pisan ni acumulan.
- **Estado.** `STATUS_MAP` por defecto: VIGENTE→ACTIVE, VENCIDO→DEFAULTED, CASTIGADO→castigo (`written_off_at`, no estado), CANCELADO→CANCELLED; `statusMap` del tenant manda; etiqueta desconocida no cambia el estado. Moneda: `BOLIV*`→BOB, `DOLAR/DÓLAR*`→USD, otro literal.
- **Snapshots y auditoría.** Cada corrida escribe `credit_external_snapshots` (reportado: saldo, mora, estado, `raw`), `client_import_runs` (conteos: created, updated, setCurrent, absent, reappeared, ignored, needsReview, errors; `report_as_of`, `advisor_code`, `scope`, archivo almacenado `file_key`) y `client_import_run_items` con acciones `CREATED | UPDATED | REAPPEARED | SET_CURRENT | ABSENT | REJECTED` (antes/después). Auditoría: `portfolio_import/IMPORT` y por crédito `EXTERNAL_APPEARED | EXTERNAL_ABSENT | EXTERNAL_REAPPEARED`.
- **Límites de plan.** `plan.roomLeft('credits')` en la vista previa; `assertRoom('credits')` y `assertRoom('clients')` (nº de grupos nuevos) antes de escribir: un archivo que se pasa se rechaza entero.
- **Archivo original.** Se guarda al confirmar (`UploadsService.storeDocument(file, mime, 'imports')`, nombrado por hash) y se descarga con doble permiso porque contiene PII sin enmascarar.
- **Transacción.** Todo dentro de `withTenant`; si algo falla (agencia, conflicto, tope) la corrida se deshace entera.

---

## payments

**Responsabilidad.** Ledger inmutable de cobros, aplicación a cuotas/saldo/mora, comprobante y solicitudes de pago QR/link. Archivos: `payments.controller.ts`, `payments.service.ts`, `payment-apply.ts`, `dto/payment.dto.ts`.

| Método | Ruta | Permiso | Qué hace |
|---|---|---|---|
| POST | `/api/payments` | `payment:write` | Registra un pago. Header opcional `Idempotency-Key`. |
| GET | `/api/payments` | `payment:read` | Ledger paginado (filtros `creditId`, `clientId`, `source`, `from`, `to`, `sort`, `dir`). |
| GET | `/api/payments/:id` | `payment:read` | Detalle. |
| POST | `/api/payment-requests` | `payment:write` | Crea solicitud de pago (QR/link), vence en 24 h. |
| GET | `/api/payment-requests/:id` | `payment:read` | Estado de la solicitud. |
| POST | `/api/payment-requests/:id/confirm` | `payment:approve` | Concilia: crea el pago y marca la solicitud `PAID`. |

**Eventos.** `DomainEvent.PAYMENT_REGISTERED` (`payment.registered`) al registrar y al confirmar solicitud; lo consume `NotificationsService` (emite `RealtimeEvent.PAYMENT_REGISTERED` a supervisores y crea notificación). Ver módulo `notifications`.

### Reglas verificadas

- **Idempotencia.** Con `Idempotency-Key`, si ya hay un pago con esa clave se devuelve ese (`idempotentReplay: true`) sin reaplicar ni emitir evento. Unicidad `(account_id, idempotency_key)` en BD. Si dos envíos simultáneos chocan, la transacción perdedora se repite UNA vez y responde como replay (`register()`).
- **Aplicación (`applyCore`).**
  - `amount > 0`; fecha opcional `paymentDate`: no futura (tolerancia 10 min) ni de hace más de `PAYMENT_BACKDATE_DAYS = 30`.
  - `visitId`, si viene, debe corresponder al mismo crédito.
  - Crédito propio: debe estar `ACTIVE` (`CREDIT_NOT_ACTIVE`) y `amount ≤ saldo + 0,005` (`PAYMENT_001`, «excede el saldo»).
  - `applyPayment` imputa a las cuotas no pagadas de la más antigua (menor `number`) a la más nueva: `PARTIAL` o `PAID` (`paid_at`).
  - El saldo siempre se descuenta del monto (`newBalance = max(0, saldo − monto)`), con o sin cronograma; al llegar a ~0 el crédito pasa a `PAID`.
  - `creditPatchAfterPayment`: en crédito sin cronograma, la próxima fecha avanza un período sólo si el pago cubre la cuota (`installmentAmount − 0,005`); luego recalcula `days_past_due` con el método del crédito (D20); saldado → 0. El trigger de episodios cierra la mora.
- **Cartera externa (PSF).** El pago es un hecho de cobranza: sólo escribe el `Payment` (cuenta como recuperado); no toca cuotas, saldo, mora ni estado y no exige que esté activo ni valida saldo (D3).
- **Inmutabilidad.** `payments` no tiene `updated_at` ni `deleted_at`; el schema lo documenta como «INMUTABLE por diseño». **No existe endpoint de reversión/anulación de pagos** (no encontrado en controller/service).
- **Recibo.** `receiptNumber = MAX(receipt_number) + 1` por cuenta, con unicidad `(account_id, receipt_number)`; una colisión (P2002) se traduce a `PAYMENT_DUP` (409).
- **Otras unicidades.** `(account_id, external_transaction_id)` evita duplicar una referencia externa.
- **Comprobante.** `receiptUrl` + `receiptHash` (64 hex, SHA-256 del buffer original calculado por `POST /api/uploads`).
- **Canal.** `PaymentChannel`: `KOBRAX_COLLECTED` (default) o `EXTERNAL_CONFIRMED`; `PaymentMethod`: `CASH, TRANSFER, QR, CARD, MOBILE_PAYMENT`.
- **Solicitud QR/link.** `reference` aleatoria de 12 bytes base64url; `qrPayload = KOBRAX|<ref>|<monto>`; `url = https://pay.kobrax.demo/<ref>` (placeholder, **sin pasarela de pago real integrada**); estados `PENDING, PAID, EXPIRED, CANCELLED`. `confirmRequest` exige `PENDING` y crédito asociado (`PAYREQ_STATE`). No se encontró un job que marque `EXPIRED`.
- **QR de pago del perfil.** `paymentQrUrl` se guarda en el perfil de usuario (`users.service.ts`).
- **Auditoría.** `payment/CREATE` con monto, método, canal, fecha, visita y `externalCredit`.

---

## assignments

**Responsabilidad.** Único lugar que escribe quién es responsable de un crédito (`credit_assignments` + copia `credits.assigned_manager_id`), reemplazos temporales y ayudas, traspaso de agenda y su vencimiento. Archivos: `assignment.service.ts`, `assignment-rules.ts`, `assignment-handoff.ts`, `assignments.controller.ts`.

| Método | Ruta | Permiso | Qué hace |
|---|---|---|---|
| GET | `/api/assignments/assignees` | `assignment:write` | A quién se puede asignar (cobradores/supervisores activos + uno mismo); el supervisor sólo ve su agencia. |
| POST | `/api/assignments/bulk` | `assignment:write` | Reasigna el responsable de varios créditos (cada uno en su transacción; devuelve `changed` y `skipped`). |
| POST | `/api/assignments/temporary` | `assignment:write` | Reemplazo temporal con `expiresAt` y `reason`. |
| POST | `/api/assignments/support` | `assignment:write` | Ayuda: segundo cobrador, `expiresAt` opcional. |
| DELETE | `/api/assignments/:id` | `assignment:write` | Revoca temporal o ayuda (el responsable no se revoca: se reasigna). |

**Job.** `AssignmentService.onApplicationBootstrap` crea un `setInterval` de **15 min** (`ASSIGNMENT_EXPIRY_INTERVAL_MS`, `unref`) que ejecuta `expireDue()`: obtiene los tenants vivos con la función SQL `promise_due_account_ids()` y por cada uno revoca coberturas `TEMPORAL`/`APOYO` con `expires_at <= now` (hasta 500 por corrida), devuelve la agenda marcada y escribe `EXPIRE_TEMPORARY`/`EXPIRE_SUPPORT` en `audit_logs` en la misma transacción. Idempotente.

### Reglas verificadas

- **Tipos** (`CreditAssignmentKind`): `PRINCIPAL` (responsable), `TEMPORAL` (reemplazo con vencimiento), `APOYO` (segundo cobrador). Los tres ven y trabajan el crédito; el alcance `own` de RLS se basa en la asignación efectiva (`rls/002_scope.sql`).
- **Quién puede ser destino.** `isAssignable`: miembro activo con rol `COLLECTOR` o `SUPERVISOR`, o quien pide (el gerente que también cobra). Gerente/administrador que no es quien pide no es destino. Incumple → `assigneeNotEligible`.
- **Alcance de quien reparte.** `data:scope:all` (gerente, administrador) → `ALL`; el resto con `assignment:write` (supervisor) → `BRANCH`: sólo créditos de su agencia (`user_accounts.branch_id`) y sólo destinatarios de la misma agencia; sin agencia asignada no puede repartir (falla cerrado) → `ASSIGNMENT_OUT_OF_AGENCY` (403).
- **Apply.** Idempotente (pedir el que ya está no escribe). Revoca la permanente anterior y crea la nueva; la columna se repara si se separó. `expectedFrom` distinto del actual → `assignmentConflict`; carrera contra el índice «una permanente» (P2002) → conflicto.
- **Handoff de agenda (D10).** Al cambiar de responsable (con anterior y nuevo), los ítems de agenda `SCHEDULED` no borrados del crédito que tenía el anterior pasan al nuevo en la misma transacción; lo ejecutado/cancelado/reagendado queda a nombre de quien lo hizo.
- **Reemplazo temporal.** Requiere responsable (`assignmentNoPrincipal`), destino ≠ responsable, un solo reemplazo vigente por crédito (`assignmentDuplicate`), `expiresAt` futuro (`temporaryExpiryInvalid`). Traspasa la agenda pendiente del responsable al reemplazo marcando `details.handoffFromUserId/handoffAssignmentId`; el responsable conserva el crédito. Al revocar o vencer, sólo vuelve lo que lleva la marca y sigue `SCHEDULED` y a nombre del reemplazo, hacia quien sea el responsable hoy; lo creado/ejecutado por el reemplazo no se toca.
- **Ayuda.** Sin traspaso de agenda; duplicado vigente mismo usuario → `assignmentDuplicate('APOYO')`.
- **Bulk.** Cada crédito en su transacción: saltea `NOT_FOUND`, `ALREADY_ASSIGNED`, `OUT_OF_AGENCY`, `CONFLICT`; el destinatario se valida una vez (422 de toda la petición si no es asignable).
- **Razones** (`AssignmentReason`, sólo en auditoría): `MANUAL, CREATE_OWN, CREATE_MANUAL, IMPORT_OWN, IMPORT_SUGGESTED, IMPORT_CHOSEN, IMPORT_REASSIGN, BULK_REASSIGN`. Auditoría: `ASSIGN`, `REASSIGN`, `ASSIGN_TEMPORARY`, `ASSIGN_SUPPORT`, `REVOKE_TEMPORARY`, `REVOKE_SUPPORT`.
- **Permisos dentro de `apply`.** `apply()` no decide permisos (lo llama el import con asignaciones derivadas); `authorize()` + `assertAssignable()` se invocan explícitamente antes.

### No verificado

- Si las policies de alcance `own`/`branch` (F2 de seguridad) están efectivamente activas en la base: `rls/002_scope.sql` declara que «F1 sólo define los helpers».
- Lista exacta de permisos por rol (se leyó sólo que existen en `packages/shared/src/constants/permissions.ts`).
- Comportamiento exacto de `PlanLimitsService.assertRoom` con `soft` (sólo se vio la invocación).
- Existencia de job que expire `payment_requests` vencidas.

---

# Parte 3 · Mora, agenda, notificaciones, rutas y campo

## mora

**Responsabilidad.** Central de Mora: una fila por crédito (sin «caso»; eliminado en F4/08, migración `20261005000000_eliminar_caso`). La situación (al día / en mora) sale del episodio abierto, la prioridad es la del episodio, el responsable es `credits.assigned_manager_id` y la categoría se calcula con los rangos de la cuenta. Archivos: `apps/api/src/modules/mora/mora.service.ts`, `mora-query.ts`, `mora-episodes.ts`, `mora-promises.ts`, `mora-notes.ts`, `mora-export.service.ts`, `credit-activity.ts`.

Prefijo global de la API: `/api` (`apps/api/src/main.ts:28`, `setGlobalPrefix('api')`). Guards de todos los controladores: `JwtAuthGuard`, `TenantGuard`, `RolesGuard`.

### Endpoints (`apps/api/src/modules/mora/mora.controller.ts`)

| Método | Ruta | Permiso | Qué hace |
|---|---|---|---|
| GET | `/api/mora` | `collection:read` | Lista paginada de créditos en mora (SQL crudo, mismos filtros/orden/alcance que el export). Audita `PII_REVEAL` una vez por consulta si devuelve ubicaciones. |
| GET | `/api/mora/export.csv` | `collection:read` + `collection:export` | CSV de lo que se está viendo; tope 50.000 filas (`MORA_CSV_MAX_ROWS`), por encima responde 422 `MORA_001` antes de escribir. Audita `export:mora`/`EXPORT`. |
| GET | `/api/mora/export.pdf` | `collection:read` + `collection:export` | PDF; tope 5.000 filas (`MORA_PDF_MAX_ROWS`). |
| GET | `/api/mora/branches` | `collection:read` | Oficinas para el filtro. |
| GET | `/api/mora/:creditId` | `collection:read` | Ficha del crédito (404 si está fuera de alcance, no 403). Trae hasta 100 gestiones y asignaciones. |
| GET | `/api/mora/:creditId/episodes` | `collection:read` | Historial de episodios de mora (más reciente primero, numerados cronológicamente). |
| GET | `/api/mora/:creditId/metrics` | `collection:read` | Métricas de recuperación (`computeRecoveryMetrics` de shared) sobre la mora actual. |
| GET | `/api/mora/:creditId/promises` | `collection:read` | Promesas de pago con su estado derivado. |
| GET | `/api/mora/:creditId/notes` | `collection:read` | Notas (post-it), hasta 200, más recientes primero. |
| POST | `/api/mora/:creditId/activities` | `collection:write` | Registra una gestión (CALL/VISIT/MESSAGE/NOTE) con resultado y, si promete, la promesa. Idempotente por `id` de cliente. |
| PATCH | `/api/mora/:creditId/priority` | `collection:write` | Fija la prioridad del episodio abierto (`{priority}`) o la suelta (`{priority:null}`); 409 `MORA_007` si está al día. |
| POST | `/api/mora/:creditId/notes` | `collection:write` | Crea nota. |
| PATCH | `/api/mora/:creditId/notes/:noteId` | `collection:write` | Edita nota: texto/tipo sólo autor o quien tenga `assignment:write`; mover/redimensionar/pintar cualquiera. |
| DELETE | `/api/mora/:creditId/notes/:noteId` | `collection:write` | Borrado lógico; sólo autor o `assignment:write` (403 `MORA_005`). |

### Reglas de negocio verificadas

**Alcance de datos (D8)** — `mora-query.ts:moraScopeOf` / `moraAccessConditions`: `data:scope:all` → todo el tenant; `data:scope:branch` (supervisor) → los créditos a su cargo más los de su agencia (`user_accounts.branch_id = credits.branch_id`) que tengan responsable; sin ninguno (cobrador) → sólo responsable/TEMPORAL/APOYO vigentes. Un crédito sin responsable sólo lo ve alcance total. Un supervisor sin agencia sólo ve lo suyo.

**Días de atraso** — se escriben en `credits.days_past_due`; los calcula el job diario (ver `arrears`) según de quién es la mora (`arrearsSourceOf`, `packages/shared/src/utils/loan.ts`):
- `IMPORTED` (origen externo): manda el archivo; no se recalcula.
- `MANUAL` (`metadata.moraSince` presente): `manualArrears(moraSince, saldo, hoy)`; se deriva de la fecha, no se guarda el número.
- `CALCULATED`: con cronograma, `computeArrears` (`apps/api/src/modules/credits/credit-math.ts`): cuota en mora si no está `PAID` y `dueDate + graceDays < asOf`; `daysOverdue = floor((asOf − (cuota vencida más antigua + gracia)) / 1 día)`; luego `withArrearsMethod` (`packages/shared/src/utils/arrears-method.ts`). Sin cronograma, desde `metadata.nextDueDate` (`arrearsFromDueDate`: 0 si saldo ≤ 0,005). Sin cronograma ni fecha ni marca: el job no toca el crédito.
- Método de mora (D20): `oldest_unpaid` (default: desde la cuota impaga más antigua) o `first_default` (desde el primer atraso; `days = max(base, hoy − arrearsSince)`; la fecha se borra al quedar al día). Defaults de gracia/mora: `DEFAULT_ARREAR_PARAMS` = `dailyMoratoriumRate 0.001`, `penaltyRate 0`, `graceDays 0`, sobreescribibles en `accounts.configuration.arrears`.
- Monto vencido (`mora.serializer.ts`): `SCHEDULE` = Σ (amount − paidAmount) de cuotas con `dueDate < hoy` y no pagadas; `REPORTED` = `metadata.pastDueAmount` del archivo; manual o sin cronograma → sin dato (no se muestra 0).

**Puntaje de prioridad** — `apps/api/src/modules/arrears/arrears-priority-score.ts`:
`score = (saldo/1000)·amountWeight + díasMora·daysWeight + riskWeights[segmento del cliente]`. Defaults: `amountWeight 1`, `daysWeight 1`, `riskWeights {HIGH:30, MEDIUM:15, LOW:0}`; umbrales `CRITICAL ≥ 100`, `HIGH ≥ 60`, `MEDIUM ≥ 30`, si no `LOW`. Se puede pisar por cuenta en `accounts.configuration.casePriority`. Enum `CollectionPriority`: LOW, MEDIUM, HIGH, CRITICAL. La prioridad vive en el episodio abierto; si `priority_pinned_at` está puesta, el recálculo no la pisa (`arrears-priority.service.ts`). Fijarla/soltarla audita `PRIORITY_PIN` / `PRIORITY_AUTO` (`mora.service.ts:setPriority`).

**Categorías** — `packages/shared/src/utils/arrear-category.ts` + `modules/arrear-categories`: se calculan (nunca se guardan en el crédito) con `categoryForDays(días, rangos)`; `null` si `días < 1` o ningún rango cubre. Defaults de cuenta: A 1–30, B 31–60, C 61–sin tope. Validación (`validateArrearCategories`): empieza en 1, sin huecos ni solapes, sólo la última sin tope, códigos únicos. Ver sección `arrear-categories` (cubierta en otra parte del documento; aquí sólo referencia cruzada: `GET/PUT /api/arrear-categories`, `collection:read` / `account:write`).

**Episodios de mora (apertura/cierre por trigger)** — tabla `credit_arrear_episodes`, trigger `credits_track_arrear_episode()` (versión vigente en `packages/database/prisma/migrations/20261005000000_eliminar_caso/migration.sql`), disparado `AFTER INSERT` (si `days_past_due > 0`) y `AFTER UPDATE OF days_past_due, status, deleted_at, sync_status`:
- «En mora» = `deleted_at IS NULL AND days_past_due > 0 AND status NOT IN (PAID, CANCELLED)`.
- Con episodio abierto: sólo sube `max_days_past_due`. Sin episodio abierto: si hay uno cerrado con `end_reason = 'SOURCE_ABSENT'` y `sync_status = PRESENT`, lo reabre; si no, inserta uno nuevo (`started_at` = fecha declarada en metadata o `reported_as_of/hoy − días`, con `started_at_estimated` si no hay declarada; `balance_at_start`, `source`).
- Cierre (motivo): `DELETED`, `CANCELLED`, `SOURCE_ABSENT` (operación ausente del reporte), `PAID` (estado PAID o saldo ≤ 0,005), `CURRENT` (se puso al día). `ended_at = max(hoy, started_at)`, guarda `balance_at_end`.
- El castigo (`written_off_at`) es una condición independiente: un castigado con días de mora conserva el episodio abierto (castigar ya no cierra episodios; `WRITTEN_OFF` queda sólo en histórico).
- Índice único `credit_arrear_episodes_one_open_per_credit` (a lo sumo un episodio abierto por crédito; citado en `mora-query.ts`).

**Promesas** — viven en `agenda_items` con `type = PROMISE_TO_PAY` (único punto de creación: `AgendaService.createPromiseItem`). Estado derivado (`mora-promises.ts:promiseStatus`), sin columna propia: `EXECUTED` + resultado `PROMISE_KEPT` → KEPT, `PROMISE_BROKEN` → BROKEN, otro → EXECUTED; `CANCELLED`; `RESCHEDULED`; `SCHEDULED` con fecha ≥ hoy → ACTIVE, anterior → OVERDUE («vencida sin cerrar no es incumplida»). Validación al registrar (`packages/shared/src/utils/recovery-activity.ts`): tipos CALL/VISIT/MESSAGE/NOTE; nota sin resultado y con texto (máx. 1.000 car.); resultados por tipo (CALL/MESSAGE: CONTACTED, NO_ANSWER, WRONG_NUMBER, REFUSAL, PROMISE_TO_PAY; VISIT: CONTACTED, NOT_FOUND, WRONG_ADDRESS, REFUSAL, PROMISE_TO_PAY); `PROMISE_TO_PAY` y los datos de la promesa (monto > 0, fecha ≥ ayer UTC por margen horario, medio de pago) van juntos.

**Gestión (`POST activities`)** — `recordCreditActivity` crea `credit_activities` ligada al episodio abierto (o `null` si está al día) y actualiza `credits.last_action_at` (sólo informativo). Si trae `agendaItemId`, ejecuta esa gestión agendada (mismo crédito, `SCHEDULED`) en la misma transacción. Idempotencia: si el `id` ya existe responde lo guardado; si pertenece a otro crédito 409 `MORA_004`; carrera por unicidad (P2002) también devuelve la guardada.

**Notas (post-it)** — tablero con posición/tamaño acotados por `NOTE_BOARD_LIMITS` y `clampNoteBox` (shared), cascada por defecto `cascadePosition`; borrado lógico (`deletedAt`).

**Filtros de lista** (`mora-query.ts:buildMoraWhere`): por defecto sólo créditos `ACTIVE` (o `DEFAULTED` con `external_source`) con `days_past_due ≥ 1`; `todos=true` incluye al día; las operaciones externas `ABSENT` no se listan salvo `todos`; filtros de saldo, días (`dpdMin/dpdMax`), agencia, castigado, categoría, fuente, origen de la mora (IMPORTED/MANUAL/CALCULATED), responsable/sin responsable, prioridad, promesa vigente, nunca visitado / sin visita desde, último resultado de visita, ya en ruta (`excludeRouted`), zona, texto. Orden permitido: `daysPastDue`, `balance`, `priority`, `createdAt` (`MORA_SORTS`), nulos al final, desempate por `id`. Dato viejo: `staleAfterDays` (default `DEFAULT_REPORT_STALE_AFTER_DAYS = 2`, configurable en `accounts.configuration.importConfig.staleAfterDays`).

**Export** — mismo query que la lista, en lotes de 1.000 por transacción; documento y direcciones enmascarados/PII según el servicio; el tope se valida antes del primer byte.

**Eventos/realtime.** Ninguno propio (la mora no emite eventos de dominio).
**Jobs asociados.** `ArrearsJobService` (ver sección siguiente).

---

## arrears (jobs de mora)

**Responsabilidad.** Tarea de sistema sin endpoints (`apps/api/src/modules/arrears/arrears.module.ts`): deja los días de mora al día y recalcula la prioridad del episodio abierto. No abre ni cierra episodios (lo hace el trigger) y **no notifica**.

| Job | Intervalo | Qué hace | Archivo |
|---|---|---|---|
| `ArrearsJobService.run` | `setInterval` 6 h (`ARREARS_INTERVAL_MS`), arranca en `onApplicationBootstrap` | Enumera tenants vivos con la función SQL `promise_due_account_ids()` (SECURITY DEFINER, `rls/004_notification_functions.sql`) y escanea cada uno bajo su RLS en lotes de 200 créditos (`ARREARS_BATCH`), cada lote en su transacción con tope 60 s (`ARREARS_TX_TIMEOUT_MS`). Un fallo en un tenant no frena a los demás. Idempotente. | `arrears-job.service.ts` |

Reglas verificadas:
- Alcance de créditos: `deleted_at IS NULL` y (`status ACTIVE` o `DEFAULTED` con `externalSource` no nulo). Los `DEFAULTED` propios (puestos a mano) no se reinterpretan.
- `sync_status = ABSENT` se salta entero (la mora es la del último reporte).
- Si no se sabe de dónde sale la mora (sin cronograma, sin `nextDueDate`, sin marca, sin archivo) no se escribe.
- Si cambian `days_past_due` o `arrearsSince` (en metadata) hace `credit.update`, que dispara el trigger de episodios.
- Luego, con saldo > 0,005 y días ≥ 1, `ArrearsPriorityService.recomputeForCredit` (respeta la prioridad fijada a mano).
- Si falta la función `promise_due_account_ids()` (no se aplicó `rls/004`), el job se omite con warning.

---

## arrear-categories (referencia cruzada)

`apps/api/src/modules/arrear-categories`. `GET /api/arrear-categories` (`collection:read`) lista los rangos vigentes; `PUT /api/arrear-categories` (`account:write`) reemplaza el juego completo, valida (400 `ARREAR_CATEGORIES_INVALID` con `details.errors`), conserva ids por código, borra los que faltan, audita antes/después. Sin caché: un cambio rige en la siguiente petición.

---

## agenda

**Responsabilidad.** Gestiones agendadas por crédito: llamada, visita, WhatsApp, recordatorio, promesa de pago (`AgendaItemType`: CALL, VISIT, WHATSAPP, REMINDER, PROMISE_TO_PAY). Estados persistidos (`AgendaItemStatus`): SCHEDULED, EXECUTED, CANCELLED, RESCHEDULED; «pendiente» y «vencida» son derivadas (SCHEDULED en/antes de hoy). Modos de hora (`ScheduleTimeMode`): FIXED, LAPSE (franja MORNING/AFTERNOON/NIGHT), RANGE. «Hoy» es el día civil de la zona horaria de la cuenta (`TenantClockService`), no el UTC del servidor.

### Endpoints (`apps/api/src/modules/agenda/agenda.controller.ts`)

| Método | Ruta | Permiso | Qué hace |
|---|---|---|---|
| GET | `/api/agenda` | `agenda:read` | Agendados de un día (`date`) o de un rango (`from`/`to`). |
| GET | `/api/agenda/overdue` | `agenda:read` | Vencidas (SCHEDULED con fecha < hoy del tenant), paginadas. |
| GET | `/api/agenda/summary` | `agenda:read` | Pendientes, vencidas, próximas y, con `agenda:assign`, carga por persona. |
| GET | `/api/agenda/assignees` | `agenda:assign` | A quién se puede asignar (cobradores/supervisores activos del alcance). |
| GET | `/api/agenda/clients/:clientId/context` | `agenda:write` | Créditos agendables del cliente + teléfonos y direcciones en claro (audita `PII_REVEAL`); hora recomendada. |
| POST | `/api/agenda/clients/:clientId/contacts` | `agenda:write` | Alta de teléfono desde el formulario de agendar (cifra y audita vía `ClientsService`). |
| POST | `/api/agenda/clients/:clientId/locations` | `agenda:write` | Alta de dirección. |
| PATCH | `/api/agenda/clients/:clientId/locations/:locationId` | `agenda:write` | Corrige una dirección (ej. marcar el punto). |
| POST | `/api/agenda` | `agenda:write` | Crea gestión (idempotente por `id` de cliente; 409 si el id es de otro crédito). |
| GET | `/api/agenda/:id` | `agenda:read` | Detalle con CI en claro (audita), saldo, dato de ejecución e historial. |
| POST | `/api/agenda/:id/complete` | `agenda:write` | Ejecuta: crea `credit_activity` con el episodio abierto, `status = EXECUTED`, `resultActivityId`. |
| POST | `/api/agenda/:id/postpone` | `agenda:write` | Pospone la hora el mismo día (`toTime` absoluta o `minutes`); sigue SCHEDULED. |
| PATCH | `/api/agenda/:id` | `agenda:write` | Edita tipo/details/hora/observaciones/responsable (sólo el creador). |
| POST | `/api/agenda/:id/cancel` | `agenda:write` | Cancela con motivo de catálogo (CANCELLED, queda visible). |
| POST | `/api/agenda/:id/reschedule` | `agenda:write` | Reagenda a otro día: original → RESCHEDULED, crea nuevo con `rescheduledFromId`. |
| DELETE | `/api/agenda/:id` | `agenda:write` | Soft-delete de una pendiente (responde 200 con el ítem, no 204). |

### Reglas verificadas (`agenda.service.ts`)
- **Alcance**: sin `agenda:assign` (cobrador) sólo ve los suyos (`assigneeId = userId`); con `agenda:assign` ve los de los créditos de su alcance de mora (`visibleCredits`; todo si `data:scope:all`). Fuera de alcance → 404.
- **Asignación**: el agendado nace del responsable del crédito (`assignedManagerId`), o de quien agenda si no hay. Un `assigneeId` explícito sólo lo acepta quien tiene `agenda:assign` (salvo el propio) y debe ser cobrador/supervisor activo de su alcance (`agencyViolations`, `assignment-rules.ts`).
- **Editar/eliminar**: sólo el creador (`assertCreator`, sin excepción para administrador); los automáticos sin creador son de su responsable. Sólo si sigue SCHEDULED (`agendaNotSchedulable`).
- **Crear**: fecha no anterior a hoy del tenant; `details` validado con `validateAgendaDetails`; el teléfono/dirección deben ser del cliente; una visita exige dirección con latitud/longitud; promesa: monto ≤ saldo (salvo créditos externos/PSF), medio de pago y banco contra catálogo del tenant.
- **Promesa**: `createPromiseItem` es la única vía (la usan `POST /agenda` y `POST /mora/:id/activities`); hora fija. Recordatorio automático (`REMINDER`) el día anterior por la mañana (franja MORNING) al mismo responsable, sólo si ese día es posterior a hoy; se cancela al ejecutar, reagendar, cancelar o eliminar la promesa (vínculo `details.promiseItemId`). Para cambiar la fecha de una promesa hay que reagendar.
- **Completar**: `outcome` debe pertenecer a `AGENDA_OUTCOMES_BY_TYPE[tipo]`; una visita que lleva una parada de ruta activa se rechaza (`agendaVisitInRoute`) porque se registra desde la parada; reintento con el mismo resultado devuelve lo hecho. Tipo de actividad: CALL→CALL, VISIT→VISIT, WHATSAPP→MESSAGE, PROMISE_TO_PAY/REMINDER→NOTE.
- **Posponer**: sólo hacia adelante y el mismo día; un día pasado exige reagendar; `toTime` es idempotente ante reintento de la cola offline; pasa a hora FIXED.
- **Reagendar**: copia asignado y creador del original; la promesa mueve `promiseDate`; deja cadena para el historial.
- **Vínculo a ruta** (`agenda-route-link.ts`): reagendar/cancelar/eliminar/reasignar una VISIT la saca de la ruta (`detachVisitFromRoute`: ruta PLANNED → borra la parada y reenumera; ruta IN_PROGRESS y parada sin visitar → SKIPPED; visitada no se toca). Crear/reagendar/reasignar una VISIT la mete como última parada de la ruta PLANNED del responsable ese día (`attachVisitToPlannedRoute`); sin ruta, entra al generarla.
- **Hora recomendada** (`recommended-slot.ts`): se cuentan los contactos efectivos (ejecutados con gestión real) por franja; se recomienda la franja con más contactos si hay ≥ 2 (`MIN_CONTACTS`); empata a favor de la más temprana.

### Jobs

| Job | Intervalo | Qué hace |
|---|---|---|
| `InstallmentReminderService` (`installment-reminders.service.ts`) | 6 h | «Cobrar cuota»: crea un `REMINDER` para el responsable cuando una cuota vence en los próximos 3 días (`INSTALLMENT_REMINDER_HORIZON_DAYS`). Créditos propios: cuota impaga del cronograma; importados sin cronograma: `metadata.nextDueDate` si el reporte no está viejo. Omite créditos sin responsable, pagados, cancelados, castigados o borrados. Idempotente: id determinista `md5(creditId|cuota-o-fecha)` + `skipDuplicates`. |
| `AgendaOverdueService` (`agenda-overdue.service.ts`) | 6 h | Resumen diario: a cada responsable activo con gestiones SCHEDULED de días anteriores le crea UNA notificación `AGENDA_OVERDUE`; dedupe de 20 h (`AGENDA_OVERDUE_DEDUPE_MS`). |

### Eventos
`notifyAgenda` emite en el `EventBusService` `AGENDA_ASSIGNED` / `AGENDA_CHANGED` (kinds: ASSIGNED, REASSIGNED, UPDATED, RESCHEDULED, CANCELLED, DELETED) sólo cuando otra persona hace el cambio sobre una gestión ajena; nunca rompe la operación. Los traduce `NotificationsService` (ver más abajo).

---

## notifications

**Responsabilidad.** Traduce eventos de dominio a notificaciones persistidas, las empuja por WebSocket y por canales externos, expone la bandeja del usuario y registra dispositivos de push. Scope `own`: sólo ve/gestiona las suyas (sin `@Roles`: cualquier sesión con empresa).

### Endpoints
| Método | Ruta | Permiso | Qué hace |
|---|---|---|---|
| GET | `/api/notifications` | sesión con tenant (sin `@Roles`) | Bandeja paginada del usuario, filtro `unread`. |
| POST | `/api/notifications/read-all` | idem | Marca todas como leídas (204). |
| POST | `/api/notifications/:id/read` | idem | Marca una (404 si no es suya). |
| POST | `/api/notifications/devices` | idem | Registra/renueva el token FCM de una instalación (upsert por `installationId`; desactiva el mismo token en otro usuario de la empresa; limpia tokens sin verse hace 60 días). |
| GET | `/api/notifications/devices` | idem | Dispositivos propios, sin el token. |
| DELETE | `/api/notifications/devices/:installationId` | idem | Revoca (204, idempotente). |

### Jobs
| Job | Intervalo | Qué hace |
|---|---|---|
| `PromiseDueService` (`promise-due.service.ts`) | 6 h | Aviso `PROMISE_DUE` («Cuota próxima a vencer») por la primera cuota impaga que vence en ≤ 3 días por crédito, al responsable y al reemplazo TEMPORAL vigente; omite pagados/cancelados/castigados/borrados; dedupe por (usuario, crédito) en 20 h. Enumera tenants con `promise_due_account_ids()`. Nota: pese al nombre, avisa **cuotas** próximas, no promesas de pago. |

### Realtime (`notifications.gateway.ts`, `realtime.helpers.ts`, `packages/shared/src/types/realtime.ts`)
- Socket.io, namespace `/events`. El handshake exige access token (`auth.token` o `Authorization: Bearer`) y consulta la denylist de sesión; sin token válido se desconecta.
- Rooms derivadas en el servidor (nunca las declara el cliente): `tenant:{accountId}`, `user:{userId}` y, si el token tiene `route:assign`, `tenant:{accountId}:supervisors`.
- Eventos: `payment.registered` y `route.completed` (a supervisores del tenant), `notification` (a la room del usuario), `collector.location` (cliente→servidor; sólo con `route:execute`, coordenadas válidas, throttle de 5 s por socket `LOCATION_THROTTLE_MS`; persiste `users.last_known_lat/lng/last_location_at` y reemite a supervisores del mismo tenant).
- CORS del socket lo restringe `SocketIoAdapter` con `SOCKET_CORS_ORIGIN` (`apps/api/src/common/ws/socket-io.adapter.ts`).

### Traducción de eventos (`notifications.service.ts`)
`PAYMENT_REGISTERED` → feed + notificación persistida a supervisores (roles con `route:assign`); `ROUTE_COMPLETED` → ídem (tipo SYSTEM); `ROUTE_NOTICE` → ROUTE_ASSIGNED / ROUTE_CANCELLED / ROUTE_CHANGE_REQUESTED / ROUTE_CHANGE_DECIDED; `AGENDA_ASSIGNED` → AGENDA_ASSIGNED; `AGENDA_CHANGED` → AGENDA_CHANGED. Siempre se persiste (aunque el destinatario esté offline) y después se entrega por WS y por canales.

### Canales de salida (`notification-channel.ts`, `push/*`)
- **Push FCM (HTTP v1, sin SDK)** (`push/fcm.client.ts`): firma JWT con la cuenta de servicio (`FCM_SERVICE_ACCOUNT_JSON_B64` o `FCM_SERVICE_ACCOUNT_FILE`). Sin credenciales queda apagado y no falla. Lista cerrada de tipos que salen por push con texto genérico (`push.service.ts:GENERIC_COPY`): ROUTE_ASSIGNED, ROUTE_CHANGE_REQUESTED, ROUTE_CHANGE_DECIDED, AGENDA_ASSIGNED, AGENDA_CHANGED, PROMISE_DUE. El `data` sólo lleva ids opacos (`type`, `nid`, `uid`, `rid`, `aid`, `cid`); `tag` = id de notificación para no duplicar. 2 intentos por dispositivo; token muerto (UNREGISTERED, NOT_FOUND, INVALID_ARGUMENT, SENDER_ID_MISMATCH) o 5 fallos seguidos lo desactivan.
- **SMS y email**: son **stubs** que sólo escriben en log (`SmsNotificationChannel`, `EmailNotificationChannel`); no hay proveedor real conectado.

---

## routes

**Responsabilidad.** Rutas de campo por cobrador y día: armado, paradas, vista previa/optimización con OSRM, cierre, cancelación, pedidos de cambio y hoja de ruta en PDF. Una parada es por crédito. Estados de ruta (`RouteStatus`): PLANNED → IN_PROGRESS → COMPLETED, o CANCELLED (`ROUTE_TRANSITIONS`, `packages/shared/src/utils/route-rules.ts`). Estados de parada: PENDING ↔ IN_ROUTE, → SKIPPED; VISITED sólo se llega registrando una visita (`STOP_TRANSITIONS`).

### Endpoints (`apps/api/src/modules/routes/routes.controller.ts`)
Todos exigen sólo `route:read` como puerta mínima; la capacidad real la decide el service.

| Método | Ruta | Permiso (puerta) | Qué hace |
|---|---|---|---|
| POST | `/api/routes` | `route:read` (+ regla en service) | Crea ruta vacía (idempotente por `id`). |
| POST | `/api/routes/generate` | `route:read` (+ service) | Genera ruta desde créditos elegidos o los en mora del cobrador. |
| POST | `/api/routes/plan-preview` | `route:read` (+ `route:assign`/`route:write`/`route:execute`) | Vista previa de puntos sin guardar. |
| POST | `/api/routes/leg` | idem | Camino por calles entre dos puntos. |
| GET | `/api/routes` | `route:read` | Lista (cobrador: sólo las suyas). |
| GET | `/api/routes/:id` | `route:read` | Detalle con paradas, direcciones en claro (audita `PII_REVEAL`), `capabilities`, pedidos pendientes. |
| PATCH | `/api/routes/:id` | `route:read` (+ service) | Cambia estado (iniciar/completar/cancelar). |
| GET | `/api/routes/:id/pdf` | `route:read` | Hoja de ruta PDF (`route-pdf.ts`). |
| GET | `/api/routes/:id/preview` | `route:read` | Polilínea, distancia, minutos, ETA por parada, sugerencia. |
| POST | `/api/routes/:id/optimize` | `route:read` (+ service) | Aplica el orden sugerido. |
| POST | `/api/routes/:id/stops` | `route:read` (+ service) | Agrega parada al final. |
| PATCH | `/api/routes/:id/stops/:sid` | `route:read` (+ service) | Cambia estado, posición o dirección (`locationId`) de una parada. |
| DELETE | `/api/routes/:id/stops/:sid` | `route:read` (+ service) | Quita parada PENDING (204; borrado real y reenumera). |
| POST | `/api/routes/:id/change-requests` | `route:read` (+ service) | Pide un cambio sobre una ruta ajena. |
| GET | `/api/routes/:id/change-requests` | `route:read` | Lista (quien arma ve todos; el resto sólo los suyos). |
| PATCH | `/api/routes/:id/change-requests/:rid` | `route:read` (+ service) | Aprueba, rechaza o retira. |

### Reglas verificadas
- **Una ruta por cobrador y día**: `@@unique([accountId, collectorId, plannedDate])` en `RoutePlan` (schema) + comprobación previa que responde `routeAlreadyForDay` en vez de un P2002 (`routes.service.ts:routeOfDay`); migración `20260818160000_una_ruta_por_cobrador_y_dia`.
- **Fecha planificable**: `hoy ≤ día ≤ hoy + 14` (`ROUTE_MAX_DAYS_AHEAD`), con el día de la empresa.
- **Capacidades** (`route-access.ts:routeRoles`): `manager` = `route:assign` o `route:write`; `admin` = `route:assign` y `route:execute`; `canManage` (armar: agregar/quitar/mover) = creador o admin o (ruta legada sin creador y manager/cobrador); `canRun` (iniciar/cerrar/cancelar/visitar) = cobrador de la ruta, creador, admin o (legada y manager). Una ruta ajena para quien no administra responde 404. Quien no puede armar la ruta pide el cambio (`changeRequestRequired`).
- **Generación**: con `creditIds`, manda el orden recibido (sin repetidos, sólo créditos visibles para quien planifica) y las visitas agendadas del día van al final; sin `creditIds`, primero las visitas del día y luego los créditos en mora del cobrador ordenados por prioridad del episodio (CRITICAL primero) y días de mora; castigados excluidos. Las visitas agendadas pendientes entran solas (una por crédito). Sin paradas: error `noStopsToRoute`. Ubicación de cada parada: la pedida (debe ser del cliente y tener punto) o la HOME propia del cliente (o la primera propia); con `requirePoints` todas deben tener punto (`stopsWithoutPoint`). `route_plans.total_cases` cuenta paradas (nombre legado).
- **Cierre/cancelación** (`updateStatus`): iniciar/completar una ruta ajena exige motivo; completar con paradas abiertas exige motivo (las abiertas quedan SKIPPED); cancelar exige motivo y falla si ya hay visitas (`routeHasVisits`); motivo válido = 5–500 caracteres (`ROUTE_REASON_MIN/MAX`). Compatibilidad: apps anteriores a `ROUTE_CLOSE_REASON_MIN_APP_VERSION` (`'1.1.0'`, `apps/api/src/common/app-version.ts`) pueden cerrar la propia sin motivo (se audita `legacyCompat`). Al completar se emite `ROUTE_COMPLETED`; al cancelar se avisa al cobrador y al creador.
- **Optimización con OSRM** (`osrm.service.ts`): `OSRM_URL` (default `http://localhost:5000`), perfil `car`, timeout 5 s. `route` entrega polilínea GeoJSON, distancia, duración y tramos; `trip` usa `source=first&destination=last&roundtrip=false` (primera y última parada fijas). **Degradación**: el servicio nunca lanza, devuelve `null` ante caída, timeout, HTTP no OK o código ≠ `Ok`; el preview responde entonces sin geometría y con los últimos `totalDistanceKm`/`estimatedMinutes` guardados (el cliente une puntos con rectas), y `leg` devuelve `null`. Minutos = duración OSRM + 10 min de permanencia por parada pendiente (`DWELL_MIN`). Sólo se sugiere reordenar con ≥ 3 puntos y si ahorra ≥ 1 km o ≥ 10 min (`MIN_SAVED_KM`, `MIN_SAVED_MINUTES`). `optimize` conserva su lugar las paradas con hora fija, ya gestionadas o sin punto. El `preview` escribe distancia/minutos en la ruta sólo si cambiaron y la ruta está abierta.
- **Cambio de dirección de una parada**: `PATCH …/stops/:sid` con `locationId`; sólo `canManage` y sólo parada PENDING; la ubicación debe ser del cliente y tener punto; se audita antes/después (`route_stop`/UPDATE).
- **Pedidos de cambio** (`route-changes.service.ts`): tipos ADD_STOP, REMOVE_STOP, REORDER, CANCEL; motivo obligatorio; quien ya puede armar la ruta recibe `ROUTE_REQUEST_NOT_NEEDED`; al aprobar se «reclama» el pedido (APPROVED) y se aplica con las reglas normales; si falla vuelve a PENDING con `changeRequestStale`. Quien lo pidió puede retirarlo (`WITHDRAW`). Se notifican `ROUTE_NOTICE` (CHANGE_REQUESTED / APPROVED / REJECTED).
- **Pago en campo**: el cobro se registra por `POST /api/payments` (módulo `payments`, puede llevar `visitId`; en migración `20261008010000_pago_en_campo_gerencia` `payment:write` se otorga también a MANAGER y SUPERVISOR). Rutas sólo expone el total cobrado por cobrador y día en el listado (`collectedByCollector`: suma de `payments.amount` por `registered_by` en el día civil de la empresa).
- **PDF**: `route-pdf.ts` dibuja la hoja de ruta (orden, dirección, mora) con los datos ya revelados y auditados por `findOne`.

### Eventos
`ROUTE_COMPLETED` (→ supervisores) y `ROUTE_NOTICE` (ASSIGNED, CANCELLED, CHANGE_REQUESTED, CHANGE_APPROVED, CHANGE_REJECTED) por `EventBusService`.

---

## field-ops (visitas y evidencia)

**Responsabilidad.** Registro de visitas de campo (append-only) y su evidencia sellada con SHA-256. Controlador montado en `/visits`.

### Endpoints (`apps/api/src/modules/field-ops/field.controller.ts`)
| Método | Ruta | Permiso | Qué hace |
|---|---|---|---|
| GET | `/api/visits` | `route:read` | Lista paginada (filtros: crédito, parada, ruta, día civil, cobrador); sin evidencias; audita `field_visit_list`/`PII_REVEAL` una vez por consulta. Cobrador: sólo las suyas. |
| GET | `/api/visits/:id` | `route:read` | Visita con evidencias; audita `PII_REVEAL`; fuera de alcance → 404. |
| POST | `/api/visits` | `route:read` (+ `route:execute` o `route:assign`/`route:write` en service) | Registra la visita. |
| POST | `/api/visits/:id/evidence` | `route:read` (+ service) | Adjunta evidencia. |

### Reglas verificadas (`field.service.ts`, `field-integrity.ts`)
- **GPS obligatorio**: latitud/longitud WGS84 finitas (`isValidGps`); `accuracy` opcional.
- **Quién registra**: el cobrador de la parada o quien administra rutas; la visita queda a nombre del cobrador de la ruta con `registeredBy` y `source` (MOBILE/WEB). Sin parada sólo el ejecutor registra una visita suelta sobre un crédito. Ruta CANCELLED rechaza.
- **Idempotencia**: por `id` de cliente (cola offline); reintento del mismo actor/parada devuelve la existente; un id usado por otro crédito/parada/actor → `visitIdTaken`. Dos envíos simultáneos: se reintenta una vez ante P2002.
- **Una visita no se edita**: una parada ya visitada rechaza otra visita (`visitStopDone`); se corrige con una NUEVA visita que declara `correctsVisitId` (genera una NOTE, no vuelve a cerrar la agenda).
- **Resultados** (`VisitOutcome`): NO_CONTACT, CONTACTED, PROMISE_TO_PAY, PARTIAL_PAYMENT, PAID, REFUSAL, NOT_FOUND, RESCHEDULED, WRONG_ADDRESS, SPECIAL (lista completa del enum en `schema.prisma`). Los `details` se validan con `validateVisitDetails` (misma función que el móvil); `SPECIAL` exige `categoryCode` activo del catálogo `SPECIAL_CATEGORY`.
- **GPS estimado**: el flag `gpsFallback` en `details` lo escribe el servidor: true si el cliente lo declara, si la carga es a nombre de otro, si `source = WEB`, o si la coordenada coincide exactamente con la de la parada (respaldo).
- **Efectos en una transacción**: parada → VISITED (+`visitedAt`); `credit_activities` tipo VISIT con el resultado (episodio abierto); si la parada nació de una visita agendada, esa gestión pasa a EXECUTED con la misma actividad; actualiza `users.last_known_lat/lng` sólo si registra el propio cobrador desde la calle; emite `collector.location` (sólo MOBILE y el propio cobrador); incrementa el contador mensual del plan `actionsPerMonth` (aviso al 80 % en segundo plano).
- **Evidencia** (`addEvidence`): tipos `EvidenceType` PHOTO, SIGNATURE, DOCUMENT, AUDIO; lleva `fileUrl`, `fileHash` y `content` base64 opcional. **Si llega `content`, el servidor recalcula SHA-256 del buffer y compara con `fileHash` (400 `evidenceHashInvalid` si no coincide)**; si sólo llega la URL el hash declarado se guarda sin verificar contra el archivo (el comentario de `field-integrity.ts` dice que en producción debería descargarse de S3/R2 y recalcular: no hay evidencia de que eso esté implementado). **Deduplicación**: si ya hay evidencia con el mismo `fileHash` en la visita se devuelve la existente (sin duplicar, sin auditar, sin contar plan). Hereda lat/lng de la visita. Audita `field_evidence`/CREATE y cuenta `photosPerMonth` contra el plan. Permitido: quien registró, su cobrador o quien administra rutas.
- **Inmutabilidad**: no existen endpoints de update/delete de visitas ni de evidencias; no encontré trigger en base que la imponga (búsqueda en migraciones y `rls/*.sql`): es garantía de la API, no de la base. El índice `field_evidences` es sólo `(account_id, visit_id)` y `(account_id, created_at)`: la deduplicación por hash es de aplicación, no una restricción única.

### Eventos
`events.emit('collector.location', …)` en el bus de dominio al registrar una visita propia desde el móvil. No encontré ningún `events.on('collector.location')` en `apps/api/src`: la reemisión a supervisores sólo la hace el gateway cuando el cliente envía `collector.location` por socket, así que que este evento del bus llegue a los supervisores no está verificado.

---

# Parte 4 · Componentes transversales (`apps/api/src/common`)

## common/audit

Código: `apps/api/src/common/audit/`.
- `AuditService.record/recordMany` escribe en `audit_logs` (`accountId`, `userId`, `action`, `entity`, `entityId`, `before`, `after`, `ip`, `userAgent`) tomando el contexto del request; **sin contexto de tenant no audita** (retorna en silencio). Un fallo de auditoría se loguea y no rompe la operación.
- `AuditInterceptor` (global, `APP_INTERCEPTOR`): handlers con `@Audit(entity, action?)` registran tras la respuesta (`POST→CREATE`, `PATCH/PUT→UPDATE`, `DELETE→DELETE`).
- `redactPII` (`redact.ts`) reemplaza por `[REDACTED]` las claves: `password, passwordHash, salt, mfaSecret, token, tokenHash, refreshToken, accessToken, nationalId, taxId, documentNumber, phone, value, address, codeHash` (insensible a mayúsculas/guion bajo, profundidad ≤ 6) más `redactKeys` por entrada.
- Jobs de sistema (plan) auditan a nombre del dueño de la cuenta con `via` (`plan-tools.service.ts: auditAsOwner`).
- Lectura: permiso `audit:read` (existe en el enum). Endpoint HTTP de lectura de auditoría: no encontrado en los controllers de esta parte (no verificado si existe en otro módulo).

## common/plan

Código: `apps/api/src/common/plan/` y catálogo `packages/shared/src/constants/plans.ts`.

**Topes por plan** (`PLANS`):

| Plan | Usuarios | Créditos activos | Clientes | Fotos/mes | Retención fotos (meses) | Acciones/mes | Precio USD |
|---|---|---|---|---|---|---|---|
| FREE | 1 | 20 | 20 | 100 | 6 | 100 | 0 |
| PROFESSIONAL | 25 | 1000 | 1000 | 5000 | 24 | 2500 | 0 base + 12/asiento |
| BUSINESS | 100 | 5000 | 5000 | 25 000 | 60 | 12 500 | 99 + 10/asiento |
| ENTERPRISE | 500 | 50 000 | 50 000 | 250 000 | 120 | 125 000 | 800 + 8/asiento |

`accounts.limits_override` (JSON) pisa los topes del plan; claves desconocidas o valores no numéricos se ignoran (`effectiveLimits`). Un `planCode` desconocido cae a FREE (el más chico). `STARTER` en la BD equivale a FREE (`planOf`).

**Qué bloquea y qué no** (`plan-limits.service.ts`):
- `assertRoom(kind, tx, {cuantos, soft})` lanza 422 `PLAN_LIMIT_REACHED` (`details: {kind, used, max}`) si `usado + cuantos > tope`. Corre **dentro** de la transacción que escribe. Solo cuentan `users`, `credits`, `clients`.
- Usos de `assertRoom`: `clients.service.ts` (alta de cliente; `soft` si viene `dto.id`, es decir alta offline ya ocurrida), `clients/import/client-import.service.ts` (cuantos = creaciones), `credits.service.ts` (alta de crédito; `soft` si viene `dto.id`), `imports/portfolio-import.service.ts` (créditos y clientes nuevos), `users.service.ts` (invitar y reactivar).
- Definición de uso: `users` = `user_accounts.isActive`; `credits` = estado `ACTIVE|DEFAULTED|RESTRUCTURED`, sin `deletedAt` ni `writtenOffAt` (PAID/WRITTEN_OFF/CANCELLED liberan lugar); `clients` = sin `deletedAt`.
- `photosPerMonth` y `actionsPerMonth` **nunca frenan**: cuentan `field_evidences` y `field_visits` del mes civil del tenant (`TenantClockService.monthStart`) y solo avisan.

**Avisos mensuales** (`plan-usage-alerts.service.ts`): invocado tras registrar visita/evidencia; al ≥80% (`PLAN_WARN_AT`) notificación `SYSTEM` a los `ACCOUNT_ADMIN` una vez por mes y tope (marca en `settings.planAlerts`); al 100% además correo interno a `MAIL_FROM`/`SMTP_USER`.

**Ciclo de vida (job)** (`plan-lifecycle.service.ts`): `setInterval` cada **6 h** (`PLAN_LIFECYCLE_INTERVAL_MS`), idempotente, itera los tenants con `promise_due_account_ids()` y escanea cada uno bajo su RLS (un fallo no frena al resto). (1) `TRIAL` con `trialEndsAt` vencido → `planCode=FREE`, `status=ACTIVE`, auditoría, notificación al admin y correo interno de venta. (2) Cuenta FREE `ACTIVE` dormida ≥ 6 meses (`DORMANT_MONTHS`) → correo al dueño, una vez por siesta (`dormantWarnedAt`). El paso a solo lectura a los 9 meses **no existe** (lo dice el código). También ejecutable por CLI: `pnpm plan:lifecycle` (`apps/api/package.json`).

**Herramientas de operación** (`plan-tools.service.ts`, `plan-cli.ts`): `plan:set --account <id> [--plan X] [--override JSON|null]` y `account:suspend --account <id> [--lift]`; corren sobre `dist/`, auditan. Sin pasarela de cobro: la caída a FREE por impago es manual.

## common/crypto

`apps/api/src/common/crypto/`. `CryptoService`: AES-256-GCM, IV aleatorio de 12 bytes por registro, formato `ivB64.tagB64.cipherB64`; clave `APP_ENCRYPTION_KEY` (32 bytes en hex = 64 caracteres; falla si falta o mide otra cosa). Se usa para `mfa_secret` y PII de clientes (documento, taxId, valor de contacto, dirección: ver `exports.service.ts`/`clients.serializer.ts`). `BlindIndexService`: HMAC-SHA256 hex de `normalize(valor)` (trim → mayúsculas → quita espacios, puntos, guiones y barras) con `APP_BLIND_INDEX_KEY` (distinta de la anterior, validada al boot, fail-fast) para búsqueda/deduplicación sin exponer el valor; cambiar la normalización invalida los hashes existentes.

## common/mail

`common/mail/mail.service.ts`: nodemailer con `service: 'gmail'` (`SMTP_USER`/`SMTP_PASS`, remitente `MAIL_FROM`). Sin credenciales **solo loguea** (`[SIN SMTP]`). Sin cola ni reintentos. Plantillas: invitación (link `kobrax://invitacion?c=` + código, vence 7 días) y reset (`kobrax://reset?token=`, 30 min).

## common/backup

`common/backup/backup.service.ts`: `pg_dump --no-owner --no-privileges` contra `DATABASE_URL` (rol dueño, no `kobrax_app`), gzip a `BACKUP_DIR` (por defecto `./backups`) como `kobrax-full-<stamp>.sql.gz`, poda a 14 días (`RETENTION_DAYS`). Se dispara a mano o desde cron del host con `db:backup` (`run-backup.ts`); no hay scheduler interno ni endpoint. No es un export de cuenta (a propósito).

## common/pdf

`common/pdf/report.ts`: generador `pdfkit` con identidad de marca (tokens de color espejo de `packages/shared/src/design/tokens.ts`, A4, banda de cabecera, logo opcional en `assets/logo.png`). Lo usan `clients/client-pdf.ts`, `mora/mora-export.ts` y `routes/route-pdf.ts`.

## common/ws

`common/ws/socket-io.adapter.ts`: adapter de Socket.io con CORS restringido a `config.corsOrigins` y `credentials: true`. El gateway y los eventos están en `modules/notifications` (fuera de esta parte).

## common/events

`common/events/event-bus.service.ts`: bus en proceso (`node:events`). Eventos (`DomainEvent`): `payment.registered`, `route.completed`, `route.notice`, `agenda.assigned`, `agenda.changed`. Payloads tipados `RouteNoticePayload` (kinds `ASSIGNED|CANCELLED|CHANGE_REQUESTED|CHANGE_APPROVED|CHANGE_REJECTED`) y `AgendaEventPayload` (kinds `ASSIGNED|RESCHEDULED|CANCELLED|DELETED|UPDATED|REASSIGNED`). Los emisores/suscriptores concretos se documentan en sus módulos.

## common/guards

- `RateLimitGuard` (global, Redis): ventana fija con `INCR`+`EXPIRE`. Límite global 600 req/60 s por **token** (hash SHA-256 del `Authorization`) o por IP si no hay sesión; más el límite por handler de `@RateLimit({limit, windowSec, by:'ip'|'email'|'email-ip'})`; clave de endpoint por `Clase.método` (no por URL). Excede → 429 `RATE_LIMITED` con `retryAfterSeconds`. Rutas que contienen `/health` no se limitan. Si Redis cae, no verificado qué ocurre (no hay manejo explícito en el guard).
- `AppVersionGuard` (global): solo actúa si existe `MIN_APP_VERSION` **y** el cliente manda `x-app-version` menor → 426 `APP_001`. Exento: rutas `/auth/*` y `/health`. Versión ilegible/ausente se deja pasar. No es una puerta de seguridad (el header es del cliente). `legacyClientReason`/`ROUTE_CLOSE_REASON_MIN_APP_VERSION = '1.1.0'` (`common/app-version.ts`) decide tolerancia de apps viejas al cerrar rutas sin motivo.

## common/context

- `TenantContextInterceptor` (global): con `request.user`, abre `AsyncLocalStorage` con `accountId, userId, permissions, sessionId, requestId (x-request-id), ip, userAgent, appVersion (x-app-version, recortado a 32)`.
- `TenantClockService` / `timezoneOf`: «hoy» y «mes» del tenant en su huso: `account.timezone`, o por país (`TZ_BY_COUNTRY`: BO, PE, EC, CO, VE, CL, AR, UY, PY, BR, MX, GT, SV, HN, NI, CR, PA, DO, PR), o UTC. `civilTodayUTC`, `civilMonthStartUTC`, `civilDayStartInstant`, `wallMinutesNow`.

## common/filters, interceptors, validation

- `GlobalExceptionFilter`: `{data:null, error:{code,message,details}, meta}`. Errores de validación → `VALIDATION_ERROR` con `details.fields`. En producción los errores no-HTTP responden «Error interno» sin detalle.
- `ValidationPipe` global (`validation-pipe.ts`): `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`.
- `max-bytes.ts`: valida largo en bytes UTF-8 (password ≤ 72 por bcrypt; login ≤ 128 caracteres; email ≤ 254).

---


---

## Integraciones externas y su estado

| Integración | Estado verificado | Evidencia |
|---|---|---|
| **PostgreSQL 15** | Real. La API conecta con `APP_DATABASE_URL` (rol `kobrax_app`, sin BYPASSRLS); los backups y migraciones usan `DATABASE_URL` (rol dueño). | `config/env.validation.ts`, `database/prisma.service.ts`, `common/backup/backup.service.ts` |
| **Redis 7** | Real y requerido (`REDIS_URL`). Se usa para la denylist de sesiones revocadas (revocación instantánea) y para el rate limit; también lo consulta `/health`. | `redis/redis.module.ts`, `modules/auth/session.service.ts`, `common/guards/rate-limit.guard.ts` |
| **Almacenamiento S3 / Cloudflare R2** | **No implementado en la API.** Las subidas (fotos, comprobantes, documentos de importación) se escriben en el disco local bajo `UPLOADS_DIR` (por defecto `./uploads/<accountId>/...`). No hay cliente S3/R2 ni variables `S3_*` en `env.validation.ts` (sí figuran en el `CLAUDE.md` raíz como diseño). R2 sólo aparece como destino previsto de los tiles de mapa self-hosted. | `modules/uploads/uploads.service.ts`, `apps/mobile/src/maps/tiles.ts` |
| **Push remoto FCM (HTTP v1, Android)** | Real pero opcional. Autenticación con cuenta de servicio (JWT RS256 propio, `FCM_SERVICE_ACCOUNT_JSON_B64` o `FCM_SERVICE_ACCOUNT_FILE`); sin credenciales el envío queda apagado y no falla el flujo. El texto del push es genérico; la app trae el detalle por API. Tokens muertos se desactivan. iOS/APNs: no verificado (plataforma por defecto `android`). | `modules/notifications/push/fcm.client.ts`, `push.service.ts`, `notification-channel.ts` |
| **SMS** | **Stub.** `SmsNotificationChannel` sólo escribe en el log (nivel debug). No hay proveedor (Twilio u otro). | `modules/notifications/notification-channel.ts` |
| **Email transaccional** | Real sólo para correos del sistema vía `MailService` (SMTP con Nodemailer; recuperación de contraseña, etc.), con `SMTP_USER`/`SMTP_PASS` (contraseña de aplicación de Gmail) y `MAIL_FROM`. Sin credenciales **loguea en vez de enviar**. El canal de notificaciones `EmailNotificationChannel` es un stub. | `common/mail/mail.service.ts`, `config/env.validation.ts` |
| **WhatsApp** | **Sin API.** No hay integración con WhatsApp Business: web y móvil abren enlaces `https://wa.me/<teléfono>` (acción del usuario) y existe un catálogo de plantillas de mensaje (`CatalogType.WHATSAPP_TEMPLATE`) que el cobrador usa como texto. El tipo de gestión `WHATSAPP` de la agenda es un registro manual. | `apps/mobile/app/mora/[creditId].tsx`, `apps/mobile/src/agenda-quick.ts`, `schema.prisma` (`CatalogType`) |
| **OSRM (ruteo por calles)** | Real, self-hosted en Docker (`osrm/osrm-backend` fijado por digest; extracto OSM regional construido con `osrm-build`). URL en `OSRM_URL` (por defecto `http://localhost:5000`). Timeout 5 s; **nunca lanza: devuelve `null`** y la previsualización de ruta se degrada a línea recta. El móvil nunca le habla directo. | `modules/routes/osrm.service.ts`, `docker-compose.yml` |
| **Mapas (tiles)** | Cliente MapLibre en web (`maplibre-gl`) y móvil (`@maplibre/maplibre-react-native`). Producción prevista: `style.json` self-hosted (`NEXT_PUBLIC_MAP_STYLE_URL` / `EXPO_PUBLIC_MAP_STYLE_URL`). Mientras no exista, cae a tiles raster de openstreetmap.org, **sólo apto para desarrollo** (su política prohíbe producción y descargas masivas); los packs offline del móvil exigen la URL self-hosted. | `apps/web/src/lib/map-style.ts`, `apps/mobile/src/maps/tiles.ts`, `offline-packs.service.ts` |
| **Pasarela de pagos / QR bancario** | **No hay pasarela.** El QR es la imagen del QR bancario propio del cobrador (`profiles.payment_qr_url`); el pago se registra a mano con método QR. `PaymentRequest` existe con URL de pago placeholder (ver módulo `payments`). | `schema.prisma` (`Profile.paymentQrUrl`), `modules/payments` |
| **PSF (reportes de cartera externa)** | Integración por archivo (PDF/CSV/XLSX subido), no por API. Ver módulo `imports`. | `modules/imports` |
| **WebSockets (Socket.io)** | Real, mismo proceso de la API; CORS por `SOCKET_CORS_ORIGIN`. Ver módulo `notifications`. | `common/ws/socket-io.adapter.ts`, `modules/notifications/notifications.gateway.ts` |

---

## Seguridad transversal

- **Aislamiento multi-tenant (RLS).** Policies `tenant_isolation` (`USING`/`WITH CHECK account_id = app_current_account()`) con `ENABLE` y `FORCE ROW LEVEL SECURITY` sobre la lista `operational` de `packages/database/prisma/rls/001_enable_rls.sql`; `accounts` usa `tenant_self`; `user_permission_overrides` admite `account_id IS NULL`. Tablas globales sin RLS: `users, profiles, roles, permissions, role_permissions, mfa_backup_codes`. La API corre con rol `kobrax_app` NOBYPASSRLS (`APP_DATABASE_URL`). `PrismaService.withTenant` abre una transacción y fija con `set_config(...)` (parametrizado) `app.current_account_id`, `app.current_user_id`, `app.scope`; `withSystemTenant` es la única elevación (jobs y flujos pre-sesión).
- **Alcance dentro de la empresa.** `withTenant` fija scope `account` si el JWT tiene `data:scope:all`, si no `own`; sin contexto de request → sin scope (deny). Las funciones `app_current_user()`, `app_current_scope()`, `app_scope_sees_all()` existen en `rls/002_scope.sql`, pero ese archivo declara que **«F1 sólo define los helpers; las policies llegan en F2»** y no se encontró ninguna policy que las use en `rls/` ni en `migrations/`: el filtrado por cobrador dentro del tenant **no se verificó impuesto por la base**; `data:scope:branch` lo aplica la aplicación (`moraAccessConditions`), no RLS (comentario en `permission.enum.ts`).
- **RBAC.** 7 roles (`RoleType`: `SUPER_ADMIN, ACCOUNT_ADMIN, MANAGER, SUPERVISOR, COLLECTOR, AUDITOR, VIEWER`); permisos `recurso:acción` (`Permission`). `ACCOUNT_ADMIN` = todos menos `audit:read`; `SUPER_ADMIN` = todos. `PermissionScope` (global/account/branch/own) existe como enum, pero la regla efectiva son `data:scope:all`/`data:scope:branch`.
- **Autenticación.** Ver `auth`: bcrypt 12, JWT access 15 min / refresh 7 d con rotación y detección de reuso, denylist Redis, MFA TOTP con secreto cifrado, bloqueo de cuenta 5 intentos/15 min, comparación anti-timing.
- **Rate limiting.** Ver `common/guards`. Límites destacados: login 5/min por email+IP, forgot-password 3/h por email, registro 10/h por IP, invitación 10/min y 10/h por IP, refresh 30/min por IP.
- **Cabeceras y CORS.** `helmet()` por defecto, `enableCors({origin: config.corsOrigins, credentials: true})`, header `x-request-id` generado o propagado (`main.ts`). Orígenes: `APP_URL` y `SOCKET_CORS_ORIGIN` (default `http://localhost:3000`; `app-config.service.ts` define `corsOrigins` — detalle no verificado).
- **Auditoría.** Ver `common/audit`: inmutabilidad real de `audit_logs` no verificada (la tabla tiene policy `tenant_isolation` y grants `SELECT, INSERT, UPDATE, DELETE` a `kobrax_app` en 001); «append-only» es por convención del código.
- **Cifrado de PII.** AES-256-GCM + blind index HMAC (ver `common/crypto`); PII descifrada solo con `client:pii:read`/`credit:pii:read` o en exports (auditados).
- **Validación de entrada.** Pipe global whitelist+forbidNonWhitelisted; parámetros UUID con `ParseUUIDPipe`; enums con `ParseEnumPipe`; consultas analíticas sin cast `::uuid` ni intervalos construidos desde input.
- **Subidas.** Lista blanca de MIME, 8 MB, nombre por hash, aislamiento por carpeta de tenant, `X-Content-Type-Options: nosniff` (helmet) con tipo deducido de la extensión.
- **Secretos/entorno.** `config/env.validation.ts` (zod): `JWT_SECRET` y `JWT_REFRESH_SECRET` ≥ 16 caracteres; claves de cifrado y blind index validadas al primer uso/boot; SMTP/FCM opcionales.
