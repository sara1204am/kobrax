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

## IMPACT-MAP (F1)
- **Cambiar claims / guard (H14-004/005)** ⇒ revisar H14-008 (emisión), H14-017/018 (clientes), tests de token, cualquier mock de `AuthenticatedUser`.
- **Cambiar `visibleClientIdsSql` (H14-013)** ⇒ Cartera, Clientes, Pagos, Exportes (consumen la subconsulta), F13 HUB-011/019.
- **Cambiar visibilidad de Personas (H14-009/012)** ⇒ «añadir persona», reparto (`assignableRows`), Equipo web.
- **Cambiar uploads (H14-014)** ⇒ adjuntos de cliente, comprobante de pago, foto/QR de perfil, evidencias, PDF/exportes que incrustan imágenes (`clients/:id/pdf`, `routes/:id/pdf`).
