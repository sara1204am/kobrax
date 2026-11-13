> ESTADO: VALIDADO (G4 PASS 2026-11-07, 11/11). D-1 aprobada por la usuaria; D-2…D-7 derivan de H-1, H-4, H-5, H-9, H-11, H-13 y ADR-F14-01/08/10 (aprobados 2026-11-04). Advertencias: D-2…D-7 no fueron aprobadas una por una; el diseño de plataforma (sesiones de soporte, consentimiento) es amplio y se construye por etapas dentro de la fase.

# Plan F5 · Roles por cuenta y plataforma

> Resuelve **R-07 (modelo)**, **R-11 (plataforma)**, **N-02, N-03, N-05, R-09** del plan maestro (`ROLES-PERMISOS-PLAN.md` §C.4, §C.5 y §E «Fase 5»). Va después de F4. Es la base del editor de roles de F7.

## 1. Objetivo
Que los permisos de cada persona salgan de los **roles de su propia cuenta** (copias de seis plantillas, con linaje y con la marca de cuáles se alejaron de la plantilla) y no de una constante de código igual para todas las empresas; que el rol viaje en el token como clave (`roleKey`) y no por nombre global; que el `SUPER_ADMIN` deje de ser un rol de empresa y pase a una persona de plataforma única, con interruptor externo y acceso a una cuenta sólo por sesión de soporte limitada, vencible y —para escribir lo sensible— consentida por el administrador de esa cuenta.

## 2. Rama
`f14/p5-roles-por-cuenta`, desde `f14/p4-pii-archivos` (F4 aún no está en `main`).

## 3. Estado inicial con evidencia (releído 2026-11-06)

| # | Hallazgo | Evidencia | Clase |
|---|---|---|---|
| E1 | `Role` es **global** (`name` único en todo el sistema, sin `accountId`); `UserAccount.roleId` apunta a él. Existen `Permission`, `RolePermission` y `UserPermissionOverride`. **No existen** `account_roles`, `account_role_permissions`, `role_templates`, `platform_users` ni `support_sessions`. | `schema.prisma:287-356,359-383` | VERIFICADO |
| E2 | Los permisos del token salen de la **base**: `PermissionsService.forRole(roleId)` lee `role_permissions`; `ROLE_PERMISSIONS` (código) sólo alimenta el seed y listas de roles de notificaciones y pruebas. Se llama al emitir y al refrescar el token. | `auth/permissions.service.ts:13`; `auth.service.ts:445,551`; `seed.ts:1865`; `notifications/realtime.helpers.ts:24-28` | VERIFICADO |
| E3 | Claims del acceso: `sub, accountId, roleId, permissions[], sessionId, av, pv`. No hay clave de rol. `/auth/me` devuelve el **nombre** del rol buscándolo por `roleId`. | `auth/token.service.ts:7-17,44`; `auth.service.ts:353-410,372-375` | VERIFICADO |
| E4 | Código que decide por **nombre** de rol: MFA crítico (`SUPER_ADMIN`, `ACCOUNT_ADMIN`), roles reservados, `MOBILE_ROLES`, `ASSIGNABLE_ROLES`, `FIELD_ROLES`, la lista de supervisión de notificaciones y literales `'ACCOUNT_ADMIN'` en usuarios, propiedad de la cuenta, planes y alta de cuenta; en web, filtros `roleName === 'COLLECTOR'` y `'ACCOUNT_ADMIN'`. | `auth/mfa-policy.ts:13`; `common/authz/tier.ts:19`; `shared/constants/roles.ts:11`; `assignments/assignment-rules.ts:34`; `users/member-detail.service.ts:22`; `users.service.ts:184,214,223,209,337,544`; `accounts/ownership.service.ts:56`; `accounts.service.ts:76`; `plan-lifecycle.service.ts:138`; `plan-usage-alerts.service.ts:85`; web `rutas/page.tsx:94`, `rutas/planificar/page.tsx:55`, `ownership-transfer.tsx:26` | VERIFICADO |
| E5 | El nivel (`tier`) de un rol sale de `Role.level` (SUPER_ADMIN 100, ACCOUNT_ADMIN 90, MANAGER 70, SUPERVISOR 50, COLLECTOR 30, AUDITOR 20, VIEWER 10) y lo leen las políticas de invitar, asignar rol y asignar crédito; el comentario del código dice que F5 lo cambia por el de la cuenta. | `seed.ts:123-130`; `common/authz/tier.ts:9,14`; `facts-loader.ts:94,104`; `member-invite.policy.ts:39`; `member-assign-role.policy.ts:48-53`; `credit-assign.policy.ts:36,44` | VERIFICADO |
| E6 | `user_permission_overrides`: **sin ningún lector ni escritor** en el código de la API (sólo un test que afirma que una migración no la toca); creada en la migración inicial; tiene policy de empresa. | `schema.prisma:339-356`; `migrations/20260616022844_init_pillars_1_to_4`; `rls/001_enable_rls.sql:100-106` | VERIFICADO |
| E7 | `av` (versión de la membresía) se sube con `AuthzVersionService.bumpInTx` y se publica a Redis; `pv` (global) sólo la suben migraciones por SQL; ningún código de la aplicación la incrementa. Un cambio de permisos de un rol de UNA cuenta hoy no tiene camino. | `auth/authz-version.service.ts:112-141,154-177`; `migrations/20261105020000_f14_03_policy_version_bump` | VERIFICADO |
| E8 | Alta de cuenta: busca el rol global `ACCOUNT_ADMIN` por nombre y crea la membresía; no crea ninguna fila de rol por cuenta. `roles`, `permissions` y `role_permissions` son globales y sin RLS. `auth_memberships()` (SECURITY DEFINER) junta con `roles` para devolver el nombre del rol que usa el MFA. | `accounts/accounts.service.ts:76-77,135`; `rls/001_enable_rls.sql:108-111`; `rls/002_auth_functions.sql:11-37` | VERIFICADO |
| E9 | El móvil y la web piden roles a `GET /roles`, que hoy filtra por `MOBILE_ROLES` y por nivel inferior; el selector manda `roleId`. | `users.service.ts:544-548`; web `equipo/invite-dialog.tsx:15,56`; móvil `src/account-form.ts:101-130` | VERIFICADO |
| E10 | El arnés de integración crea miembros por **nombre** de rol (`addMember(...,roleName)` busca el `Role` global); 19 llamadas en las pruebas. | `test/integration/harness.ts:112-123` | VERIFICADO |
| E11 | No hay entidad de plataforma: el `SUPER_ADMIN` es un rol más de la tabla global y puede estar en una membresía de empresa; no hay interruptor externo, sesiones de soporte ni `actor_type` en la auditoría. | `schema.prisma:287-301`; ausencia en E1; `audit_logs` sin esas columnas | VERIFICADO |

## 4. Alcance / fuera de alcance

**Dentro**
- Tablas `role_templates`, `role_template_permissions`, `account_roles`, `account_role_permissions`; columnas `risk`, `reserved`, `requires` en `permissions`; clave foránea nueva `user_accounts.account_role_id` **junto** a `role_id` durante un release (rollback). Relleno: seis plantillas, copias por cada cuenta existente, membresías reapuntadas.
- Las copias se crean solas al crear una cuenta (trigger) y quedan con linaje (`template_key`) y `source` por permiso.
- `PermissionsService.forMembership` lee `account_role_permissions` (con caché versionada); `roleKey` en el token y en `/auth/me`; las listas de roles por nombre pasan a `roleKey` y, donde cabe, a capacidad; `tier` sale del rol de la cuenta.
- `GET /roles` devuelve los roles de la cuenta asignables; la regla «a lo sumo un `data:scope:*` por rol» como restricción.
- Retiro de `user_permission_overrides` (H-4) tras verificar que no tiene filas en ningún entorno.
- **Plataforma (D-1):** `platform_users` con una única fila `SUPER_ADMIN` (semilla / CLI, sin API ni pantalla de alta), MFA obligatorio, sin membresía; interruptores externos `PLATFORM_ACCESS_ENABLED` y `SUPPORT_WRITE_ENABLED`; `support_sessions` con vencimiento ≤ 240 min y subconjunto de permisos; consentimiento del administrador de la cuenta para escritura sensible; `actor_type` y `support_session_id` en la auditoría; inicio de sesión de plataforma aparte; comando de plataforma para el *rollout* de permisos nuevos (con *dry-run*).
- Web: pantalla de la cuenta «Accesos de soporte» (ver, aceptar, revocar) y el aviso «Sesión de soporte · vence HH:MM».

**Fuera**
- Crear roles personalizados desde la interfaz y editar permisos (F7). Aquí el modelo los admite (`template_key` nulo) pero no hay endpoint de alta.
- Cambios en el móvil (F8): `MOBILE_ROLES` no cambia (H-5); el móvil sigue recibiendo `roleId` y el nombre legible; ver tarea de web/móvil.
- Pasarela de pagos, facturación, y todo lo comercial.
- Retirar la columna `user_accounts.role_id` (se hace en un release posterior al de esta fase).

## 5. Dependencias
F1, F3, F2, F2b y F4 (rama anterior). ADR-F14-01, 08, 10; H-1, H-4, H-5, H-9, H-11, H-13 (aprobadas 2026-11-04).

### Decisiones de la fase
| ID | Decisión | Estado |
|---|---|---|
| D-1 | F5 incluye la plataforma completa (platform_users, interruptores, sesiones de soporte, consentimiento, `actor_type`), no sólo los roles por cuenta. | **APROBADA** por la usuaria (2026-11-06) |
| D-2 | Modelo C: plantilla global + copia por cuenta con linaje; la plantilla **no se consulta en tiempo de ejecución**. | Aprobada (H-1) |
| D-3 | `user_accounts.role_id` y `account_role_id` conviven un release; el código nuevo lee `account_role_id`; el cierre de la columna vieja es posterior. | Derivada de ADR-F14-01 (rollback del plan maestro) |
| D-4 | El permiso de tenant `data:scope:*` es excluyente: a lo sumo uno por rol de cuenta. | Derivada del plan maestro (§C.4) |
| D-5 | Un solo `ACCOUNT_ADMIN` por cuenta se mantiene (H-13); los demás roles de plantilla pueden tener varias personas. | Aprobada (H-13) |
| D-6 | El *rollout* de un permiso nuevo a las cuentas es un comando de plataforma explícito, con *dry-run*, que sólo inserta filas `source='TEMPLATE'` en roles sin divergencia y sube las versiones de las membresías afectadas. | Derivada de ADR-F14-01 |
| D-7 | `SUPPORT_WRITE_ENABLED` y `PLATFORM_ACCESS_ENABLED` se leen del entorno del servidor, apagados por omisión; los cambios se registran en el log del proceso. | Aprobada (H-11) |

### Cruce con la alineación móvil en curso (regla D1)
Leído `../F10/plans/alineacion-web/README.md` (ronda 4, 2026-10-10). F5 **no cambia código del móvil ni los contratos que consume**: `GET /roles` conserva su forma (`id`, nombre legible, nivel) y el token conserva `roleId` y `permissions`; `roleKey` es un campo nuevo que el móvil ignora; `/auth/me` sigue devolviendo el nombre del rol. Lo que F8 debe adoptar queda en la tarea 11.

## 6. Archivos afectados (IDs HUB; los nuevos se crean al cerrar la fase)

| ID HUB | Archivo / símbolo | Cambio |
|---|---|---|
| H14-046 (nuevo) | `schema.prisma`, migraciones nuevas, `rls/` (`007_…`, verify) | tablas de plantillas y de roles por cuenta, `permissions` ampliada, `account_role_id`, trigger de copias al crear la cuenta, restricción de `data:scope:*`, RLS, relleno |
| H14-047 (nuevo) | `auth/permissions.service.ts`, `auth.service.ts`, `auth/token.service.ts`, `auth/guards/jwt-auth.guard.ts` | permisos por membresía, `roleKey` en el token y en `/auth/me` |
| H14-048 (nuevo) | `auth/mfa-policy.ts`, `common/authz/tier.ts` + `facts-loader.ts` + políticas, `assignments/assignment-rules.ts`, `users/member-detail.service.ts`, `notifications/realtime.helpers.ts`, `users.service.ts`, `accounts/*`, `common/plan/*`, `packages/shared/src/constants/roles.ts` | consumidores de nombre de rol → `roleKey` / capacidad / tier de la cuenta |
| H14-049 (nuevo) | `accounts.service.ts` (alta), `seed.ts`, `rls/002_auth_functions.sql` (`auth_memberships`) | copias al crear la cuenta; semilla de plantillas y de la persona de plataforma; MFA por la nueva fuente |
| H14-050 (nuevo) | migración de retiro, `schema.prisma` | `user_permission_overrides` fuera |
| H14-051 (nuevo) | nuevo `platform/` (login de plataforma, sesiones de soporte, consentimientos, *rollout*), `jwt-auth.guard.ts` (actor de plataforma), `audit` (`actor_type`, `support_session_id`), `config` | plataforma |
| H14-052 (nuevo) | web: «Accesos de soporte» en Seguridad / Cuenta, aviso de sesión de soporte, selector de roles, filtros `roleName`; textos es/en | interfaz |
| H14-053 (nuevo) | `test/integration/harness.ts` y las pruebas que crean miembros por nombre | siguen funcionando con roles por cuenta |
| H14-014/001/004/005 (existen) | uploads, `UserAccount`, `signAccess`, `JwtAuthGuard` | consultados: el token y el guard cambian de claims |

## 7. Invariantes que aplican
B1 (tablas nuevas con `account_id` y RLS), B3/B4 (el servidor decide), B5 (todo cambio de rol y toda sesión de soporte se audita), B8 (migraciones aditivas; el retiro de `user_permission_overrides` está aprobado por H-4), B9, B10, B11, B12, B13, F14-A H-1, H-2, H-3, H-4, H-5, H-9, H-11, H-13; C2 y C5 (por capacidad, no por tipo de cuenta).

## 8. Perfiles de tenant y protección del gratuito individual
- **FREE / cobrador independiente:** al registrarse recibe sus seis roles copiados y queda como `ACCOUNT_ADMIN` con exactamente los mismos permisos que hoy. No configura nada; no ve pantallas nuevas salvo «Accesos de soporte» (vacía y sólo para el administrador) en Seguridad/Cuenta. El token sigue ≤ 2 KB.
- **Empresa:** sus roles pasan a ser propios; hasta F7 nadie puede editarlos (sin cambio visible). Las listas de «quién puede ser asignado/invitado» se calculan desde su rol.
- **Regresión del gratuito individual (G5):** registrarse, iniciar sesión, crear cliente y crédito, registrar un pago, exportar, cambiar foto de perfil, refrescar el token, entrar con MFA, ver sus permisos en `/auth/me`; todo igual que en la línea base.

## 9. Riesgos
1. **Romper el inicio de sesión o el refresco** (cambia la fuente de los permisos). Mitigación: doble columna un release; el emisor del token lee `account_role_id` y, si falta, `role_id` (con aviso en el log) hasta cerrar el relleno; prueba de que ambas fuentes dan los mismos permisos para toda la base.
2. **Cuentas sin sus roles** (creadas durante el despliegue). Mitigación: trigger en la tabla de cuentas + relleno + verificación SQL que falla si hay cuentas sin las seis copias.
3. **Pérdida de un permiso al copiar.** Mitigación: el relleno copia desde `role_permissions` (la fuente actual, no desde código) y una verificación compara cada rol de cuenta con su rol global.
4. **El token con `roleKey` rompe clientes viejos.** Mitigación: `roleId` se conserva en el token y `/auth/me` sigue devolviendo el nombre; `roleKey` es adicional.
5. **Sesión de soporte como puerta trasera.** Mitigación: apagada por omisión; vencimiento duro; permisos ⊆ máximo de soporte; escritura sensible sólo con consentimiento; todo audita; sin ruta para crear plataforma-usuarios (la cobertura de puertas lo prohíbe).
6. **MFA de la persona de plataforma.** Mitigación: obligatorio y probado; sin membresía de empresa.
7. **Muchas pruebas dependen de nombres de rol.** Mitigación: el arnés busca el rol de la cuenta por clave; se corrigen las 19 llamadas con un solo cambio.
8. **Carga del relleno** en una instalación grande. Mitigación: aditivo, por cuenta; documentado para ejecutar fuera de hora.

## 10. Pruebas
**Existentes que deben seguir verdes:** `permission-gates.spec`, `authz-coverage.spec`, specs de políticas (`member-invite`, `member-assign-role`, `credit-assign`, `tier`), `authz-version.service.spec`, `mfa` y `auth.service` specs, `users.service.spec`, `assignment*.spec`, `realtime.helpers.spec`, todas las pruebas de integración en `off` y `enforce`, y web (`nav.test`, `cuenta-tabs.test`, `mora.test`).

**Nuevas (registradas en el script `test` / `test:integration`):**
- Relleno y verificación SQL: toda cuenta tiene seis roles; cada rol de cuenta tiene los mismos permisos que su rol global; cada membresía tiene `account_role_id` coherente; a lo sumo un `data:scope:*` por rol; `user_permission_overrides` ausente.
- `PermissionsService`: permisos por membresía, caché y versión; el token lleva `roleKey` y los mismos permisos que antes.
- Trigger de alta de cuenta (cuenta nueva = seis copias).
- Specs de cada consumidor que pasó a `roleKey` / tier de la cuenta.
- Plataforma: login de plataforma (MFA, interruptor apagado → 403), sesiones de soporte (vencimiento, subconjunto, escritura sensible sin consentimiento → denegada, con consentimiento → permitida, consentimiento por otra cuenta o por quien no es administrador → denegado), auditoría con `actor_type`, ausencia de rutas para crear usuarios de plataforma.
- Integración `f5-roles-por-cuenta.it.ts`: registro → token → refresco → `/auth/me`; invitar y asignar rol con las listas nuevas; cambio de un permiso en la copia de UNA cuenta no toca a otra; *rollout* con *dry-run*.
- Web: «Accesos de soporte» (aceptar / revocar), aviso de sesión.
- **Snapshot de puertas:** endpoints de plataforma y de consentimiento cambian `authz-snapshot.json`; se regenera y se pide la aprobación al cerrar G5.

## 11. Rollback
Aditivo en datos: tablas nuevas y columna nueva; `role_id` sigue y el código puede volver a leerlo. Interruptores de entorno `PLATFORM_ACCESS_ENABLED` / `SUPPORT_WRITE_ENABLED` apagados. El retiro de `user_permission_overrides` (aprobado, H-4) es la única migración no reversible por sí sola: se hace en su propia migración, después de comprobar que la tabla está vacía en cada entorno, y se respalda su definición para reconstruirla vacía. Volver atrás = revertir los commits de la rama y restaurar `AUTHZ`/`policy_version` (subida única).

## 12. Tareas ordenadas
**Datos**
1. Migración de modelo: plantillas, roles de cuenta, permisos por rol de cuenta, `permissions` ampliada, `account_role_id`, restricción de `data:scope:*`, relleno, trigger de alta de cuenta, RLS, `verify_roles.sql`; subir `policy_version`.
2. Migración de plataforma: `platform_users`, `support_sessions`, consentimientos, `actor_type` y `support_session_id` en la auditoría, RLS.
3. Migración de retiro de `user_permission_overrides` (verificada vacía).
4. Semilla: plantillas, permisos de plataforma, la única persona de plataforma por `PLATFORM_ADMIN_EMAIL`.

**API**
5. `PermissionsService.forMembership` con caché versionada; `roleKey` en el token y en `/auth/me`; guard con `actorType`.
6. Consumidores de nombre de rol → `roleKey` / capacidad / tier de la cuenta; `GET /roles` por cuenta.
7. Alta de cuenta con copias; `auth_memberships` y MFA por la fuente nueva.
8. Plataforma: login, interruptores, sesiones de soporte, consentimientos, auditoría, *rollout* por comando.
9. Arnés de integración y pruebas actualizadas.

**Web**
10. «Accesos de soporte» y aviso de sesión; selector de roles y filtros que dependían de `roleName`; es/en.

**Móvil**
11. Ninguna tarea; se anota para F8 que el móvil siga recibiendo `roleId` y nombre y que adopte `roleKey`.

## 13. Criterios de cierre
- **G5:** salida pegada en `VERIFICATIONS.md` de: unitarias de API, shared y web; integración completa en `off` y `enforce`; `verify_roles.sql`, `verify_scope.sql`, `verify_files.sql`; `tsc` limpio; regresión del gratuito individual (§8); snapshot de puertas aprobado.
- **G6:** `/code-review` con hallazgos corregidos o aceptados con motivo; recorrido del mapa de impacto por H14-001/004/005/014 y H14-046…053.
- **G7:** HUB, `STATUS`, `HANDOFF`, `VERIFICATIONS`, `INCIDENTS` y `docs/producto/roles-permisos-planes.md` al día. F6 sólo por la orden vigente de seguir F4→F7.
