# F14 · HUB — puntos de integración (mínimo para F1)

> Regla A4: no se implementa un cambio transversal sin consultar este archivo. Estado: `VERIFICADO <fecha>` = releído ese día contra el código. Un ID no se reutiliza. Se completa fase a fase.
> Cruza con el HUB de F13 (`../../F13/hub/HUB.md`): HUB-002 (UserAccount), HUB-009/010 (RLS/alcance), HUB-011 (mora-query), HUB-021 (users), HUB-022 (branches), HUB-023 (auth).

| ID | Archivo y símbolo | Responsabilidad | Consumidores | Riesgo | Fase | Prueba | Estado |
|---|---|---|---|---|---|---|---|
| H14-001 | `packages/database/prisma/schema.prisma:357` `UserAccount` (+`authz_version`) | Versión de autorización de la membresía | auth, users, branches (F13 HUB-002) | Alto: toda sesión | F1 | `authz-version.service.spec.ts` | VERIFICADO 2026-11-04 |
| H14-002 | `schema.prisma` `PlatformSetting` (**no existe hoy**) | `policy_version` global (singleton) | guard, auth | Medio | F1 | idem | VERIFICADO 2026-11-04 (ausente) |
| H14-003 | `schema.prisma` `AuthzVersionOutbox` (nuevo) + `rls/` | Outbox transaccional DB→Redis | `AuthzVersionService` | Medio | F1 | `verify_isolation.sql` | VERIFICADO 2026-11-04 (ausente) |
| H14-004 | `auth/token.service.ts:7-13,37` `AccessClaims`/`signAccess` | Claims del access (`av`,`pv`) | guard, auth.service, tests de token | Alto | F1 | `token.service.spec.ts` | VERIFICADO 2026-11-04 |
| H14-005 | `auth/guards/jwt-auth.guard.ts:43` | Autenticación + revocación + versiones | **todos** los endpoints | Alto | F1 | `jwt-auth.guard.spec.ts` (nuevo) | VERIFICADO 2026-11-04 |
| H14-006 | `auth/guards/roles.guard.ts:26-27`, `decorators/roles.decorator.ts` | Permisos «todos»; se añade «cualquiera» | todos los controladores | Medio | F1 | `permission-gates.spec.ts` | VERIFICADO 2026-11-04 |
| H14-007 | `auth/session.service.ts:37-110` | Denylist, revocación por sesión/usuario/cuenta | guard, auth, password, users | Alto | F1 | `session.service.spec.ts` | VERIFICADO 2026-11-04 |
| H14-008 | `auth/auth.service.ts:436,488-561,208` | Emisión/refresh de tokens, cambio de cuenta | web, móvil | Alto | F1 | `auth.service.spec.ts` | VERIFICADO 2026-11-04 |
| H14-009 | `users/users.service.ts:69-75,158-253,306` | Lista, edición e invitación de miembros | Equipo web, móvil | Alto | F1 | `users.service.spec.ts` | VERIFICADO 2026-11-04 |
| H14-010 | `users/users.controller.ts:45-115`, `member-detail.service.ts` | Rutas de Personas y actividad | web Equipo | Medio | F1 | `member-detail.service.spec.ts` | VERIFICADO 2026-11-04 (controller) |
| H14-011 | `branches/branches.service.ts:500-579`; `accounts/accounts.service.ts:134` | Escriben asignaciones / membresía | Cuenta › Agencias | Medio | F1 | `branches.service.spec.ts` | VERIFICADO 2026-11-04 |
| H14-012 | `common/office-scope/office-scope.ts`, `.service.ts` | Única fuente de «qué oficinas veo» | mora, agenda, rutas, analítica | Alto | F1 | `office-scope.spec.ts`, `office-scope.it.ts` | VERIFICADO 2026-11-04 |
| H14-013 | `mora/mora-query.ts:173-178` `visibleClientIdsSql`; `clients/clients.service.ts`; `clients/import/client-import.service.ts` | Visibilidad de clientes | Cartera, Clientes, Pagos, Exportes | Alto | F1 | `clients.scope.spec.ts`, `client-visibility.spec.ts` | VERIFICADO 2026-11-04 |
| H14-014 | `uploads/uploads.controller.ts:14-30`, `uploads.service.ts` | Subida y lectura de archivos | adjuntos, comprobantes, perfil, evidencias | Alto | F1 | `uploads.service.spec.ts`, `uploads.access.spec.ts` | VERIFICADO 2026-11-04 |
| H14-015 | `config/env.validation.ts`; `apps/api/package.json` script `test` | Flag `AUTHZ_VERSION_CHECK`; registro de specs | CI | Bajo | F1 | — | VERIFICADO 2026-11-04 |
| H14-016 | `packages/shared` permisos y códigos | `user:sessions:revoke`, `AUTHZ_STALE` | api, web, móvil | Medio | F1 | `permission-gates.spec.ts` | VERIFICADO 2026-11-04 |
| H14-017 | `apps/web/src/lib/bff.ts:80-125` `apiCall`; `src/middleware.ts:70-72`; `app/api/auth/renew` (nuevo) | Reintento ante `AUTHZ_STALE` | 14 archivos con `apiCall` | Alto | F1 | `bff.test.ts` | VERIFICADO 2026-11-04 |
| H14-018 | `apps/mobile/src/api-client.ts:62-76` `authedFetch` | 401 ⇒ refresh + 1 reintento | todo el móvil | Medio | F1 | test de api-client | VERIFICADO 2026-11-04 |
| H14-019 | `apps/api/src/app.module.ts:76-77` (`APP_GUARD`) | Registro de guards globales: hoy sólo `RateLimit` y `AppVersion`; F3 añade `JwtAuthGuard`, `TenantGuard`, `AuthzGuard` (orden explícito) | **todos** los controladores, `health`, pruebas que levantan la app | Alto | F3 | `authz-coverage.spec.ts`, integración completa | PLANEADO 2026-11-05 |
| H14-020 | `auth/decorators/authz.decorator.ts`, `auth/guards/authz.guard.ts` (nuevos) | Metadato único de acceso + guard con negación por defecto (`log`/`enforce`) | 41 controladores | Alto | F3 | `authz.guard.spec.ts` | PLANEADO |
| H14-021 | `common/authz/*` (nuevo) | `AuthorizationService`, `PolicyService`, `FactsLoader` | los 13 servicios con `tenant.can`, F2/F4/F7 | Alto | F3 | `authorization.service.spec.ts`, `policy.service.spec.ts` | PLANEADO |
| H14-022 | `modules/**/*.controller.ts` (41) y `health/health.controller.ts` | Retirar `@UseGuards` por controlador; declarar públicos/autenticados | todo el API | Alto | F3 | `authz-coverage.spec.ts` | PLANEADO |
| H14-023 | `routes.controller.ts`, `agenda.controller.ts`, `credits.controller.ts`, `dashboards.controller.ts` (+ F13 HUB-012, 017, 020) | Puertas «sólo en el servicio» de R-05 declaradas en el guard, sin cambiar quién puede | web y móvil (rutas, agenda, castigo, dashboards) | Medio | F3 | `permission-gates.spec.ts` + snapshot | PLANEADO |
| H14-024 | `permission-gates.spec.ts`, `authz-coverage.spec.ts` (nuevo), `docs/epics/F14/authz-snapshot.json` (nuevo) | Cobertura total y snapshot aprobado | CI | Medio | F3 | el propio spec | PLANEADO |

## IMPACT-MAP (F1)
- **(F3) Cambiar quién registra los guards (H14-019/022)** ⇒ todos los controladores, `health`, `main.ts` (versionado), rutas públicas (`auth`, `accounts`, `health`), pruebas de integración que levantan la app, `permission-gates.spec.ts`, `uploads.access.spec.ts` (usa `RolesGuard`).
- **(F3) Migrar `tenant.can` (H14-021)** ⇒ F13 HUB-012 (agenda), 013 (asignaciones), 015 (importación), 017 (créditos), 019 (clientes), 020 (rutas), H14-009/012 (users, office-scope); `dashboards`, `field-ops`, `mora` no tienen entrada F13: se cubren con H14-021.
- **Cambiar claims / guard (H14-004/005)** ⇒ revisar H14-008 (emisión), H14-017/018 (clientes), tests de token, cualquier mock de `AuthenticatedUser`.
- **Cambiar `visibleClientIdsSql` (H14-013)** ⇒ Cartera, Clientes, Pagos, Exportes (consumen la subconsulta), F13 HUB-011/019.
- **Cambiar visibilidad de Personas (H14-009/012)** ⇒ «añadir persona», reparto (`assignableRows`), Equipo web.
- **Cambiar uploads (H14-014)** ⇒ adjuntos de cliente, comprobante de pago, foto/QR de perfil, evidencias, PDF/exportes que incrustan imágenes (`clients/:id/pdf`, `routes/:id/pdf`).

## Estado tras F1 (2026-11-05, commits locales en `f14/p1-sesiones-aislamiento`)
H14-001…018 pasan a **MODIFICADO F1** y probados (ver `../execution/VERIFICATIONS.md`). Archivos nuevos: `auth/authz-version.service.ts`, `uploads/upload-access.service.ts`, `rls/005_authz_functions.sql`, `web/app/api/auth/renew/route.ts`, migración `20261105000000_f14_01_authz_versions`.
Cambios respecto del plan: `user:sessions:revoke` lo tienen ACCOUNT_ADMIN y SUPER_ADMIN (MANAGER no: no tiene `user:write`); outbox transaccional (D-3); `AUTHZ_UNAVAILABLE` (D-4); `created_by` adelantado (D-1).
**Despliegue:** `migrate deploy` NO basta: hay que re-aplicar `rls/001_enable_rls.sql` (policy de la outbox, grant de `platform_settings`) y `rls/005_authz_functions.sql` (funciones `authz_outbox_*`, `authz_membership_version`). Un solo comando: `pnpm --filter @kobrax/database db:rls` (aplica los seis scripts de `rls/`, idempotentes). Segunda migración de F1: `20261105010000_f14_02_manager_sessions_revoke` (MANAGER también tiene `user:sessions:revoke`).
