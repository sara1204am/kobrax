# F9 · Auditoría de trazabilidad de F14

> Fecha: 2026-11-08 · Rama `f14/p9-cierre` · Fuente: matriz §I de `ROLES-PERMISOS-PLAN.md` (13 riesgos R-xx + 14 hallazgos N-xx).
> Para cada hallazgo se registra **qué lo cierra** y **qué prueba lo cubre** (archivo y caso). Tres estados (D-7 del plan de F9):
> **PROBADO** (hay una prueba automática que fallaría si volviera) · **VERIFICACIÓN SQL** (lo comprueba un `verify_*.sql` sobre la base real) · **SIN PRUEBA** (no hay prueba que lo proteja; se anota por qué y quién lo atiende).
> Los casos citados se leyeron hoy en los archivos; no se copiaron de documentos.

## Resumen

| Estado | Hallazgos |
|---|---|
| PROBADO (prueba automática) | 22 |
| PROBADO + VERIFICACIÓN SQL | 5 (R-06, R-11, N-01, N-02, N-10) |
| Sin prueba | 0 |

27 de 27 con prueba. Durante la auditoría aparecieron dos hallazgos que parecían sin prueba: **N-09** sí la tenía (la busqué mal al principio) y **N-02** no la tenía; ese hueco se cerró en esta fase con el bloque 6/7 de `verify_catalog.sql`. Lo que esta auditoría **no** prueba está al final.

## Riesgos R-xx

| Hallazgo | Cierre (fase) | Prueba | Estado |
|---|---|---|---|
| R-01 sesiones no se revocan al cambiar rol | F1: versión de autorización `av`/`pv` en el token; `AUTHZ_STALE` | `test/integration/authz-versions.it.ts` (token nuevo trae `av`/`pv`; cerrar sesiones deja el token inválido y auditado; token anterior a F1 = `AUTHZ_STALE`, no 500); `auth/authz-version.service.spec.ts`; móvil `session.test.ts` | PROBADO |
| R-02 `/users` sin alcance | F2: filtro por oficina | `authz-versions.it.ts` («el gerente de una regional no ve a las personas de otra; el administrador ve a todos»); `users/member-detail.service.spec.ts` | PROBADO |
| R-03 cliente sin oficina/creador; supervisor no crea | F2: `registered_branch_id`, `created_by`, política `client.create` | `f2-responsabilidad.it.ts` (el cobrador registra en SU oficina; el gerente elige una oficina de su alcance y fuera se le niega; el dueño crea sin pedir oficina); `policies/client-create.spec.ts`; `verify_authz.sql` 5/5 (columnas) | PROBADO |
| R-04 PII no aplicada | F4: proyección + máscara + `reveal` | `f4-pii-archivos.it.ts` (supervisor ve enmascarado y revela con acción explícita y auditoría; el listado enmascara para todos); `common/authz/pii.service.spec.ts`; `clients/clients.pii.spec.ts` | PROBADO |
| R-05 permisos sólo en servicios | F3: `AuthzGuard` negación por defecto + políticas | `modules/authz-coverage.spec.ts` + `test/integration/authz-coverage.it.ts` (todo endpoint declara su contrato; el castigo pasa por la política); `permission-gates.spec.ts`; `common/authz/authz.spec.ts` | PROBADO |
| R-06 archivos sin dueño ni control | F1 (mínimo), F4: tabla `files`, enlaces firmados | `f4-pii-archivos.it.ts` (subida = PENDING y sólo quien la sube la abre; enlace firmado abre sin sesión, firma alterada o archivo ajeno no; ORPHAN al quitar la foto); `uploads/files.service.spec.ts`, `uploads.access.spec.ts`; **`verify_files.sql`** (3 comprobaciones) | PROBADO + SQL |
| R-07 sin edición de permisos | F5/F7: roles por cuenta y editor `/roles` | `f7-editor-roles.it.ts`; `modules/roles/roles.service.spec.ts`, `roles.dto.spec.ts`; `common/authz/policies/role-edit-permissions.spec.ts`; `packages/shared/.../utils/role-edit.spec.ts`; web `seguridad/roles` | PROBADO |
| R-08 dashboards con `report:read` | F3: `dashboard:write` | `modules/dashboards/dashboards.service.spec.ts` (el widget conserva su id, uno ajeno no se cuela); contrato en `authz-coverage.it.ts` | PROBADO |
| R-09 AUDITOR/VIEWER no asignables | F5: asignables desde la web | `users/users.service.spec.ts` («rechaza un rol que no se asigna por aquí (AUDITOR es de la web)» para el móvil); `f4-pii-archivos.it.ts` (VIEWER no exporta, ve comprobantes); `f8-movil.it.ts` (persona de consulta sin revelar, 403 `PII_REVEAL_DENIED`) | PROBADO |
| R-10 huecos de navegación | F6 | web `lib/nav.test.ts` («R-10 · el supervisor ve Organización y Equipo, aunque no tenga `account:read`»); `lib/cuenta-tabs.test.ts` | PROBADO |
| R-11 SUPER_ADMIN = ACCOUNT_ADMIN | F5: plataforma separada, una sola persona, sesiones de soporte | `f5-roles-plataforma.it.ts` (índice único: una sola persona de plataforma; el administrador ve que soporte pidió acceso y consintió); `modules/platform/platform.spec.ts`; **`verify_platform.sql`** (5/5, nuevo en F9) | PROBADO + SQL |
| R-12 gerente no invita | F2 (H-3): política `member.invite` | `policies/member-invite.spec.ts` («el gerente invita a un rol de tier inferior en una oficina de su alcance»); `f2-responsabilidad.it.ts` («el gerente regional invita a un cobrador a una agencia de su regional») | PROBADO |
| R-13 pares | F2 (H-8): política `credit.assign` | `policies/credit-assign.spec.ts`; `f2-responsabilidad.it.ts` (supervisor asigna a un cobrador de su agencia; el gerente, de tier mayor, a un supervisor) | PROBADO |

## Hallazgos N-xx

| Hallazgo | Cierre (fase) | Prueba | Estado |
|---|---|---|---|
| N-01 RLS de alcance ausente | F2/F2b: políticas RESTRICTIVE `scope_*` + `SCOPE_RLS_MODE` | `f2b-rls-alcance.it.ts` (cada rol ve lo que corresponde; INSERT…RETURNING se lee de vuelta; copias coinciden con la verdad), corrida con `SCOPE_RLS_MODE=off` **y** `enforce` (ver `execution/VERIFICATIONS.md`); **`verify_scope.sql`** (6 comprobaciones) | PROBADO + SQL |
| N-02 `permissions.scope` siempre GLOBAL | F5: columna con significado (en desarrollo: ACCOUNT 36 · BRANCH 5 · OWN 4) | **`verify_catalog.sql` 6/7** (ningún permiso activo con scope GLOBAL; agregada en F9) | VERIFICACIÓN SQL |
| N-03 `user_permission_overrides` sin uso | F5: tabla retirada (H-4) | Migración `…retire_permission_overrides` aborta si la tabla tiene filas; **`release-rehearsal.sh`** paso 2 la cuenta antes de migrar; en desarrollo la tabla ya no existe | PROBADO (ensayo) |
| N-04 permisos congelados en el JWT | F1: `av` + refresco | igual que R-01 | PROBADO |
| N-05 `ROLE_PERMISSIONS` en runtime | F5: la fuente es la copia de la cuenta | `f5-roles-plataforma.it.ts` (el token sale del rol de la cuenta); **`db:permissions check`** compara rol global ↔ copia por cuenta (nuevo en F9; 0 diferencias en desarrollo y en `kobrax_it`). Queda `ROLE_PERMISSIONS` en código como **semilla de plantillas** y en `realtime.helpers.ts` (ver INCIDENTS) | PROBADO |
| N-06 móvil cachea 8 h | F8: ventana 8 h / 2 h, excepción de cuenta de una persona | móvil `session.test.ts` (`offlineWindowMs`); `f8-movil.it.ts` («la cuenta del cobrador independiente…»)  | PROBADO |
| N-07 tabs móviles sin gating | F8 | móvil `tabs.test.ts` («Inicio y Más los ve cualquiera con sesión», «Agenda, Rutas y Cobranza piden su permiso de lectura») | PROBADO |
| N-08 web sin guard de ruta | F6: `requirePermission` | web `lib/authz-check.test.ts` (un permiso que se tiene abre / que no, «sin acceso» / «cualquiera de»); `lib/nav.test.ts` | PROBADO |
| N-09 `TenantGuard` ≠ documentación | F3 (contradicción resuelta; el guard vuelve a exigir tenant) | `auth/guards/authz.guard.spec.ts` bloque «TenantGuard global — exige tenant a todo handler con sesión» («permisos sin accountId → 403 TENANT_001», «autenticado sin accountId → 403 TENANT_001»); `authz-coverage.it.ts` | PROBADO |
| N-10 doble verdad de la oficina | F2: `branch_id` único de la persona | `f2b-rls-alcance.it.ts` («las copias coinciden con la verdad en toda la base»); `verify_scope.sql` | PROBADO + SQL |
| N-11 auditoría fuera de transacción | F7: `AuditService.recordInTx` | `roles.service.spec.ts` («sin diferencias no escribe, no audita y no renueva sesiones»; el arnés del spec hace fallar la auditoría para comprobar que el cambio y la auditoría son atómicos, ver su cabecera); `f7-editor-roles.it.ts` | PROBADO |
| N-12 clientes sin crédito visibles a toda la cuenta | F2 | `f2-responsabilidad.it.ts` («el cliente sin crédito se ve por su oficina de registro … y NO por el cobrador de otra»); `mora/client-visibility.spec.ts`; `clients/clients.scope.spec.ts` | PROBADO |
| N-13 DTO acepta `branchId`/`userId` | F2/F3: el servidor resuelve; política `client.create` | `policies/client-create.spec.ts`; `f2-responsabilidad.it.ts` («fuera de [su alcance] se le niega») | PROBADO |
| N-14 `Role.level` sin función de jerarquía | F2: `tier.ts` (`tierOf`, `strictlyBelow`, `isReservedRole`) | `common/authz/tier.spec.ts`; `policies/member-assign-role.spec.ts`. Los otros usos de `Role.level` en `apps/api/src` son de lectura para esa misma función (`facts-loader.ts`) y de orden/visualización (`roles.service.ts`, `roles.serializer.ts`) | PROBADO |

## Lo que esta auditoría NO prueba

- **Que producción esté en el estado que supone la matriz.** No hay acceso a datos de producción; los ensayos de F9 corrieron sobre la base de desarrollo y una vacía. La repetición sobre una copia real es del equipo (ver `RELEASE-CHECKLIST.md`).
- **Que F8 funcione en un teléfono real.** Hay pruebas automáticas y el guion `execution/F8-casos-dispositivo.md`; **nadie lo ha corrido en un dispositivo**.
- **Que `ci.yml` funcione en GitHub.** No se pudo ejecutar fuera de allí.
