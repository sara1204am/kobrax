# Discovery · 05 · Seguridad y autorización

> **Estado: COMPLETO 2026-11-02.** Método: `../../_framework/README.md` §2 (clases de evidencia) · hallazgo = plantilla T1.
> Pistas previas relacionadas: ver `00-leads.md` (resueltas aquí: L-03, L-04..L-08, L-20). Solo lectura; fecha de verificación de todo: 2026-11-02.
> Rutas relativas a la raíz del repo. Por R9 (JWT/RLS por alcance van después de la base) este archivo describe el estado actual; no propone diseño.

## Qué debe responder
- Cómo se resuelve un permiso desde el rol hasta el endpoint (JWT, guards, overrides).
- Qué contiene el token/sesión (¿viaja la oficina?).
- Si `Role.level` o los overrides por usuario se usan.
- Qué impide a un usuario ver otra oficina hoy, capa por capa (UI, API, base).
- Auditoría de cambios de oficina/alcance.

## Fuentes leídas
`apps/api/src/modules/auth/{guards/*,token.service.ts,permissions.service.ts,auth.service.ts,mfa-policy.ts}`, `common/context/tenant-context.service.ts`, `database/prisma.service.ts`, `packages/shared/src/constants/{permissions,roles}.ts`, `enums/permission.enum.ts`, `packages/database/prisma/{schema.prisma,seed.ts,rls/*.sql}`, `modules/permission-gates.spec.ts`.

## Lente de tenant (resumen)
(a) Individual: `ACCOUNT_ADMIN` dueño con todos los permisos y alcance total; los guards no le estorban. (b) Equipo pequeño: roles globales fijos (7); el supervisor es el único con alcance por agencia. (c) Grande: no hay rol por oficina ni permiso de «gestionar mi subárbol»; quien administra oficinas tiene que ser `ACCOUNT_ADMIN`.

## Hallazgos

### H-05-01 · Cadena de autorización: JWT → guards → permiso
- Clase: VERIFICADO
- Evidencia: `apps/api/src/modules/auth/guards/jwt-auth.guard.ts:31-53` (verifica Bearer, consulta denylist de sesiones en Redis, arma `request.user = {userId, accountId, roleId, permissions, sessionId}`); `guards/tenant.guard.ts:13-19` (solo comprueba que haya `accountId`, no valida recursos); `guards/roles.guard.ts:16-33` (exige TODOS los permisos de `@Roles(...)` presentes en `req.user.permissions`; sin `@Roles` deja pasar). Permisos al emitir token: `auth/auth.service.ts:436` `permissions.forRole(roleId)`; `auth/permissions.service.ts:13-19` lee `role_permissions` (tabla global).
- Hecho: el permiso se evalúa en el servidor desde la lista plana de permisos embebida en el JWT (15 min); `TenantGuard` no hace la comprobación por recurso que describe `apps/api/src/modules/auth/CLAUDE.md`.
- Implica para la épica: un permiso nuevo («gestionar oficinas») se engancha agregándolo al enum + `ROLE_PERMISSIONS` + `@Roles` en el controller; un permiso «por oficina» no cabe en este mecanismo (es global al token).
- HUB: —

### H-05-02 · Qué contiene el token/sesión: la oficina NO viaja (L-20, parte JWT)
- Clase: VERIFICADO
- Evidencia: `apps/api/src/modules/auth/token.service.ts:8-14` (`AccessClaims`: `sub, accountId, roleId, permissions, sessionId`); `jwt-auth.guard.ts:8-14` (`AuthenticatedUser` igual); `common/context/tenant-context.service.ts:5-18` (`RequestContext`: `accountId, userId, permissions, sessionId, requestId, ip, userAgent, appVersion`). `branch_id` aparece solo en `MembershipRow` (`auth.service.ts:39`), que sirve para elegir cuenta, no entra al token.
- Hecho: ni el token, ni la sesión, ni el contexto del request traen oficina; cada cálculo de alcance relee `user_accounts.branch_id` (ver 02 H-02-11).
- Implica para la épica: F13 puede mantener JWT intacto (R9) calculando el conjunto de oficinas visibles por solicitud en servidor; la rotación de token (15 min) no afectaría cambios de oficina.
- HUB: —

### H-05-03 · Permisos de alcance y por rol (L-04, L-05)
- Clase: VERIFICADO
- Evidencia: `packages/shared/src/constants/permissions.ts:15-124`:
  - `ACCOUNT_ADMIN` = `Object.values(Permission)` (`:18`), `SUPER_ADMIN` igual (`:16`)
  - `MANAGER`: `DATA_SCOPE_ALL` (`:46`), `ACCOUNT_READ`, `USER_READ` (`:44-45`), `ASSIGNMENT_WRITE`, `REPORT_READ/EXPORT`; **sin** `ACCOUNT_WRITE`, `USER_WRITE`, `USER_INVITE`
  - `SUPERVISOR`: `DATA_SCOPE_BRANCH` (`:70`), `ASSIGNMENT_WRITE`, `REPORT_READ`, `AGENDA_ASSIGN`, `ROUTE_ASSIGN`; **sin** `USER_READ`, `ACCOUNT_*`
  - `COLLECTOR`: sin alcance (cae en OWN); `AUDITOR`/`VIEWER`: `DATA_SCOPE_ALL` (`:112,122`)
  - `packages/shared/src/enums/permission.enum.ts:86,93` define `DATA_SCOPE_ALL` y `DATA_SCOPE_BRANCH`; `:2-3` `PermissionScope` incluye `GLOBAL = 'global'` («solo SUPER_ADMIN»).
  - Migración que movió al supervisor: `packages/database/prisma/migrations/20261004010000_alcance_supervisor_agencia` (existe; contenido no releído, solo el mapa actual).
  - Prueba que lo fija: `apps/api/src/modules/permission-gates.spec.ts:273-279` (alcance por rol) y `:281-290` (castigar = solo ACCOUNT_ADMIN, MANAGER, SUPER_ADMIN).
- Hecho: hay exactamente tres niveles de alcance de datos (`ALL`, `BRANCH`, ninguno = OWN); `BRANCH` significa hoy «mi agencia única». No hay un permiso que diga «mi subárbol».
- Implica para la épica: el subárbol puede expresarse reinterpretando `data:scope:branch` (el alcance sigue siendo por permiso, RULES C5), sin permiso nuevo; pero el seed/permisos de roles son fuente única en `ROLE_PERMISSIONS` y cambiarlos exige migración + `permission-gates.spec.ts`.
- HUB: —

### H-05-04 · Roles: globales, 7, `level` casi sin uso, overrides sin uso (L-06, L-20)
- Clase: VERIFICADO
- Evidencia: `packages/database/prisma/schema.prisma:215-227` (`Role`: `name @unique`, sin `account_id`, `level Int`, `isSystem`); `seed.ts:114-121` (levels 100/90/70/50/30/20/10) y `:1855` (upsert); `apps/api/src/modules/users/users.service.ts:429` (único uso funcional: `orderBy: { level: 'desc' }` en `listRoles`) y `users.serializer.ts:46` (devuelve `level`). Ningún guard, servicio ni política compara `level`. Modelo `UserPermissionOverride` existe (`schema.prisma:266-282`) pero no se usa en la API: `auth/permissions.service.ts:5-8` («Los overrides por usuario se incorporan en el Slice 4») y grep de `PermissionOverride|permission_override` en `apps/api/src` solo da ese comentario.
- Hecho: `Role.level` es solo de presentación/orden; las diferencias entre roles viven únicamente en `role_permissions`. Los overrides por usuario están modelados y NO se aplican. Los roles no son editables por tenant (`GET /roles` con `role:read` lista solo 3, `users.service.ts:427-432`; no existe `role:write` en ningún controller, grep).
- Implica para la épica: no hay jerarquía de roles que respetar ni que pisar con la jerarquía de oficinas; roles personalizados por tenant (F14) requerirían tocar el esquema (hoy global). Los overrides serían el gancho natural para F14 pero hoy están muertos.
- HUB: —

### H-05-05 · Rol asignable por API limitado a tres; MANAGER/AUDITOR/VIEWER solo por web/seed (L-07)
- Clase: VERIFICADO
- Evidencia: `packages/shared/src/constants/roles.ts:11` (`MOBILE_ROLES = [ACCOUNT_ADMIN, SUPERVISOR, COLLECTOR]`); `apps/api/src/modules/users/users.service.ts:143-147,235` rechaza con `roleNotAllowed` cualquier otro `roleId` (también en la web: es regla de servidor).
- Hecho: el comentario dice que los otros roles «se administran desde la web», pero el servidor rechaza ese cambio desde cualquier cliente; MANAGER, AUDITOR, VIEWER solo existen por seed/BD (matiza L-07, que decía «web»).
- Implica para la épica: no se puede hoy dar a nadie rol de gerente/regional desde el producto. Cualquier jerarquía que dependa de gerentes/regionales choca con esto (relevante para ADR-0002 y F14).
- HUB: —

### H-05-06 · Quién puede gestionar oficinas (L-08) y qué es «super admin» (R5)
- Clase: VERIFICADO
- Evidencia: `apps/api/src/modules/branches/branches.controller.ts:17-43` (`GET` → `user:read`; `POST/PATCH/DELETE/members` → `account:write`). Permisos `account:write`: solo `ACCOUNT_ADMIN` y `SUPER_ADMIN` (`permissions.ts:16,18`; MANAGER solo `account:read`, `:44`). Otros usos de `account:write`: `accounts.controller.ts:83,103,111` (solicitudes, traspaso de dueño, editar cuenta), `arrear-categories.controller.ts:27`, `dashboards.service.ts:54,70`.
- Hecho: «super admin» existe como valor de enum `RoleType.SUPER_ADMIN` y como fila de rol (level 100, `seed.ts:115`) con exactamente los mismos permisos que `ACCOUNT_ADMIN` (`Object.values(Permission)`); no se halla ningún usuario SUPER_ADMIN sembrado (el seed solo crea `owner@kobrax.demo` como ACCOUNT_ADMIN, `seed.ts:222`), ningún código lo trata distinto de ACCOUNT_ADMIN salvo `mfa-policy.ts:13` (rol crítico para MFA) y tests, y el scope `global` documentado (`permission.enum.ts:3`) no se usa en ningún guard. El token lleva un solo `accountId`; RLS acota a ese tenant (`prisma.service.ts:138`, `rls/001_enable_rls.sql`). La documentación `modules/auth/CLAUDE.md:44` dice «SUPER_ADMIN → solo Kobrax».
- Hecho: hoy no existe un super admin operativo. «Quien crea oficinas» es el administrador del tenant (`account:write`), que además es el dueño del tenant individual; nada distingue «super admin de la organización» de «administrador de cuenta».
- Implica para la épica: R5 («solo el super admin crea oficinas a cualquier nivel») choca con un hecho: si «super admin» = SUPER_ADMIN (rol de plataforma), el cliente no puede crear sus oficinas; si = administrador de la cuenta, ya es el comportamiento actual con `account:write`. Hay que definir qué es en G2/ADR-0002 (cuenta vs plataforma). Un permiso nuevo exclusivo (p. ej. `office:write`) tendría que asignarse a ACCOUNT_ADMIN vía `ROLE_PERMISSIONS`.
- HUB: —

### H-05-07 · Capas que impiden ver otra oficina hoy
- Clase: VERIFICADO
- Evidencia: **UI:** cosmético (`apps/web/src/lib/cuenta-tabs.ts:30-31`, citado en RULES B4). **API:** solo Mora/Agenda/Rutas(créditos elegibles)/Asignación/field-ops (ver 02 H-02-01, H-02-07); Cartera, Clientes, Pagos y Analítica no filtran (02 H-02-06/07). **Base:** RLS por `account_id` en todas las tablas operativas (`packages/database/prisma/rls/001_enable_rls.sql:22-60`, policy genérica por tenant); `app.scope`/`app.current_user_id` se fijan (`prisma.service.ts:138-140`) pero ninguna policy los lee (`rls/002_scope.sql:7-9`; grep de `app_current_scope|app_scope_sees_all|app_current_user` en `packages/database` solo en ese archivo). Fuera de `prisma/rls/` las migraciones con `CREATE POLICY` son 7 (`add_client_import_runs`, `add_agenda_module`, `historial_de_importaciones`, `rutas_f4_12`, `device_push_tokens`, `client_income_profiles`, `account_requests`), y ninguna referencia `app_current_scope`.
- Hecho: el aislamiento entre oficinas es 100 % de aplicación y parcial; la base solo aísla tenants (resuelve L-03 y L-20 «policies RLS fuera de prisma/rls/» → no hay policies por alcance en ningún lado).
- Implica para la épica: RLS por subárbol sería nuevo (R9: fase posterior). Mientras tanto, la corrección del cálculo en app es lo único que protege. `app_scope_sees_all()` ya está diseñado como punto de extensión para `'branch'`.
- HUB: —

### H-05-08 · Analítica se protege con `report:read` pero sin alcance (L-20)
- Clase: VERIFICADO
- Evidencia: `apps/api/src/modules/analytics/analytics.controller.ts:17-19` (`@Roles(Permission.REPORT_READ)`); poseen `report:read`: MANAGER, SUPERVISOR, AUDITOR, VIEWER (`permissions.ts:42,64,108,120`); detalle del filtrado en 02 H-02-06.
- Hecho: `report:read` decide quién ve el tablero, no qué parte de los datos.
- Implica para la épica: en el modelo nuevo, un supervisor de una agencia con `report:read` vería el tenant entero si no se añade alcance a analítica (fuga preexistente que un árbol vuelve más visible).
- HUB: —

### H-05-09 · Auditoría de cambios de oficina/alcance
- Clase: VERIFICADO
- Evidencia: `apps/api/src/modules/branches/branches.service.ts:117,144,156,179-185` (create/update/delete de oficina y asignación masiva con `before/after.branchId`); `users/users.service.ts:211-217` (cambio de rol/oficina/estado con before/after); creación de cuenta con audit manual `accounts.service.ts:126-144`.
- Hecho: toda mutación de pertenencia a oficina y de rol queda auditada con antes/después; el audit usa `AuditService` con el contexto del request (`entity: 'branch'` / `'user_account'`).
- Implica para la épica: cualquier tabla nueva de pertenencia N:M o de nodos debe auditar igual (RULES B5); mover un nodo con descendientes cambia el alcance de muchos usuarios y requiere un evento de auditoría propio.
- HUB: —

### H-05-10 · Tenant gratuito/individual frente a los guards
- Clase: VERIFICADO
- Evidencia: `accounts.service.ts:113-115` (rol `ACCOUNT_ADMIN`, sin oficina); `permissions.ts:18`; `mfa-policy.ts:13` (ACCOUNT_ADMIN es rol crítico → MFA exigible; `auth.service.ts:321`).
- Hecho: el individual pasa todos los guards sin configuración y tiene `data:scope:all`; no se gestiona ninguna oficina.
- Implica para la épica: cualquier guard nuevo de oficina debe tratar «sin nodos» como acceso total para ACCOUNT_ADMIN (equivalencia, RULES §E) y no exigir permisos nuevos al flujo de registro.
- HUB: —

## Contradicciones y desconocidos

- **CONTRADICTORIO:** `apps/api/src/modules/auth/CLAUDE.md:44-54` describe `SUPER_ADMIN` «solo Kobrax» con scope `global`, pero el código no implementa el scope global (H-05-06) y `ROLE_PERMISSIONS` lo iguala a ACCOUNT_ADMIN. Se registra para `09-brechas.md`.
- **CONTRADICTORIO:** el mismo CLAUDE.md muestra un `TenantGuard` que valida el recurso por `:id`; el real solo verifica `accountId` (H-05-01).
- **CONTRADICTORIO menor:** `roles.ts:3-6` (MANAGER/AUDITOR/VIEWER «se administran desde la web») vs servidor que rechaza (H-05-05).
- **DESCONOCIDO:** si existe algún usuario `SUPER_ADMIN` en bases reales (demo/producción). Solo se leyó el seed. Responde: consulta de lectura sobre `user_accounts` + `roles` (script `prisma/verify/`).
- **DESCONOCIDO:** contenido y efecto de la migración `20261004010000_alcance_supervisor_agencia` (solo se leyó su nombre y el mapa actual de permisos).
- **DESCONOCIDO:** cómo el cliente web/móvil usa `data:scope:*` y `isOwner` para ocultar UI (queda para 03/04).
- **DESCONOCIDO:** si `role_permissions` en una base real coincide con `ROLE_PERMISSIONS` (el JWT sale de la DB, no del mapa; `permissions.ts:8-13` ya registró una divergencia pasada). Responde: comparar tabla vs mapa con un script.
