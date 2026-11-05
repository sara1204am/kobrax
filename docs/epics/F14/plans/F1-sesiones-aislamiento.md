> ESTADO: EN EJECUCIÓN — tareas 1–15 hechas (2026-11-05); G5 corrido con una falla ajena abierta; G6/G7 pendientes. Validado (PASS 2026-11-05) — G4: 11/11 ítems; D-1, D-2 y D-5 APROBADAS por la usuaria el 2026-11-05 (D-3 y D-4 son detalles de implementación dentro de H-2). Advertencia: el rollback incluye una sentencia DDL de una línea (no es código de producto).

# Plan F1 · Sesiones y aislamiento

Insumos: `../ROLES-PERMISOS-PLAN.md` §C.6 (sesiones), §C.8 (alcance de Personas), §E Fase 1; decisiones **H-2** (versiones en JWT), **H-3/H-13** (no tocan F1), **H-7** (responsabilidad en el crédito). Estado inicial releído **hoy 2026-11-04** (clase VERIFICADO salvo donde se diga).

## 1. Objetivo
Que un cambio de rol, oficina o desactivación de una membresía surta efecto en la **siguiente petición** (no a los 15 min), y cerrar las tres fugas intra-tenant más graves: lista de Personas sin alcance (R-02), clientes sin crédito visibles para toda la cuenta (N-12, interino) y archivos legibles por nombre por cualquier sesión del tenant (R-06 mínimo).

## 2. Rama
`f14/p1-sesiones-aislamiento` (desde `f14/roles-permisos`, que ya contiene el arnés y las decisiones). Commits locales; **sin push/PR** hasta que la usuaria lo pida.

## 3. Estado inicial con evidencia (releído hoy)
| # | Hecho | Evidencia |
|---|---|---|
| E1 | El guard solo consulta la denylist por sesión; no hay versión de membresía ni de política | `auth/guards/jwt-auth.guard.ts:43`; `AuthenticatedUser` :8-14 |
| E2 | `AccessClaims` no lleva `av`/`pv`; `signAccess` firma los permisos tal cual | `auth/token.service.ts:7-13,37` |
| E3 | `SessionService` solo tiene `isRevoked` (`EXISTS`), `revokeOne`, `revokeAll`; `revokeRows(accountId, sessionId)` es privado y revoca por sesión | `auth/session.service.ts:37-47,73-110` |
| E4 | `issueTokens` toma los permisos de `permissions.forRole(roleId)`; `refresh` ya relee la membresía activa y re-deriva permisos desde DB (no del JWT) | `auth.service.ts:436,533-537,561` |
| E5 | `updateMember` cambia rol / activo / oficina **sin** invocar `SessionService` ni bump alguno → R-01 | `users/users.service.ts:158-253` (update en :227) |
| E6 | `list()` no filtra por alcance (solo RLS de cuenta); `GET /users/:id`, `/activity`, `/activity/events` igual (`user:read`) → R-02 | `users.service.ts:69-75`; `users.controller.ts:45-73` |
| E7 | Otros escritores de rol/oficina/estado de membresía: `branches.service.ts:500-501,540-553,578-579` (altas/bajas de asignaciones y `branchId`), `accounts.service.ts:134` (alta), `users.service.ts:306` (invitación), `ownership.service.ts:72-73` (solo `isOwner`) | grep hoy |
| E8 | Cambio / restablecimiento de contraseña **ya** llama `revokeAll(userId)` (cierra el DESCONOCIDO de F0) | `auth/password.service.ts:179,194` |
| E9 | No existe ruta que ponga `users.status` en inactivo/suspendido (solo `isActive` de la membresía) → «desactivación global» no tiene hoy un disparador | grep `user.update`/`status:` hoy |
| E10 | **`platform_settings` NO existe** (ni en `schema.prisma` ni en SQL). El plan técnico la daba por existente (§C.6, F1) | grep hoy, 0 resultados → **CONTRADICTORIO resuelto aquí**: se crea en `f14_01` |
| E11 | No hay `@nestjs/schedule`; los trabajos periódicos usan `setInterval` + `unref` en `OnApplicationBootstrap` | `common/plan/plan-lifecycle.service.ts:46-59` |
| E12 | `@Roles(...)` exige **todos** los permisos (`every`); no existe «cualquiera de» (el `@Authz({any})` es de F3) | `auth/guards/roles.guard.ts:26-27` |
| E13 | `visibleClientIdsSql` une clientes con crédito visible **con todos** los clientes sin crédito vivo de la cuenta | `mora/mora-query.ts:173-178` |
| E14 | `Client` **no tiene** `created_by` ni `registered_branch_id` (solo F2 los iba a añadir) | `schema.prisma` `model Client` (grep hoy, 0) |
| E15 | `POST /uploads` sin permiso (solo sesión); `GET /uploads/:name` sirve cualquier archivo de la carpeta del tenant por nombre (`<sha256>.<ext>`) | `uploads/uploads.controller.ts:14-30`; `uploads.service.ts` |
| E16 | Referencias a archivos subidos: `profiles.photo_url`/`payment_qr_url` (`schema.prisma:268,271`), `photo_urls` (:757,779,831), `client_attachments.file_url` (:862), `field_evidences.file_url` (:1550), `payments.receipt_url` (:1612); los de importación se sirven por su endpoint (no por `/uploads`) | `schema.prisma` |
| E17 | Web: el middleware solo refresca cuando **falta** la cookie de acceso; con la cookie presente un 401 de la API no dispara refresh. `apiCall` no reintenta | `apps/web/src/middleware.ts:70-72`; `lib/bff.ts:80-125` |
| E18 | Móvil: `authedFetch` ya refresca ante **cualquier** 401 (salvo `isCredentialRejection`) y reintenta **una vez**; si persiste, `clearSession()` | `apps/mobile/src/api-client.ts:62-76` |
| E19 | RLS: el contexto de la transacción lo fija `withTenant`; trabajos de sistema usan `withSystemTenant` | `database/prisma.service.ts:78-118` |

## 4. Alcance / fuera de alcance
**Dentro**
1. Versiones: `user_accounts.authz_version`, `platform_settings.policy_version`, claims `av`/`pv`, guard con `MGET` de 3 claves, `401 AUTHZ_STALE`, fail-closed, flag `AUTHZ_VERSION_CHECK`.
2. Escritura consistente DB↔Redis con **outbox transaccional** + reconciliador (30 s).
3. Bump + revocación de sesiones de la cuenta en: `updateMember` (rol, oficina, activo), asignaciones de `branches.service`, reactivación.
4. Endpoint «cerrar sesiones de un miembro» (`POST /users/:id/sessions/revoke`, permiso `user:sessions:revoke` nuevo, auditado `SESSION_REVOKE`).
5. Alcance de Personas: `GET /users`, `/users/:id`, `/activity`, `/activity/events` (R-02).
6. N-12 interino en `visibleClientIdsSql` + columna `clients.created_by` nullable (ver D-1).
7. Archivos mínimo (R-06): permiso para subir, y lectura solo de lo visible.
8. Clientes: web reintenta una vez ante `AUTHZ_STALE`; móvil ya lo cumple (se prueba).

**Fuera** (no se toca en F1): tabla `files` y enlaces firmados (F4); `Role.level`/tiers y política `member.invite` (F3/F5); traspaso de propiedad que deja admin al dueño anterior (`ownership.service.ts:71-74`, fase de plataforma); editor de permisos (F5/F6); `client:delete` (F2); RLS por oficina (F2); desactivación **global** de `users.status` (no hay disparador, E9; se deja el método `revokeAllForUser` listo y probado).

## 5. Dependencias
- Decisiones **APROBADAS**: H-2 (versiones y fail-closed), H-7. Sin ADR nuevo.
- Fase anterior (F0): la usuaria la dio por cubierta («empieza F1»); el único residual de F0 que F1 necesitaba (`password.service.ts`) se cerró con E8.
- G3 PASS por equivalencia (STATUS). G4 de este plan = lo que desbloquea tocar código.

## 6. Archivos afectados (IDs HUB en `../hub/HUB.md`)
| Capa | Archivo | HUB |
|---|---|---|
| Datos | `packages/database/prisma/schema.prisma` (`UserAccount.authzVersion`, `PlatformSetting`, `AuthzVersionOutbox`, `Client.createdBy`); migración `…_f14_01_authz_versions`; `rls/` política de la outbox; `seed`/`verify_isolation.sql` | H14-001…003 |
| API | `auth/token.service.ts`, `auth/guards/jwt-auth.guard.ts`, `auth/guards/roles.guard.ts` + `decorators/roles.decorator.ts` (`@RolesAny`), `auth/session.service.ts`, `auth/auth.service.ts`, nuevo `auth/authz-version.service.ts` (+ reconciliador), `auth/auth.module.ts` | H14-004…008 |
| API | `users/users.service.ts`, `users.controller.ts`, `member-detail.service.ts`, `branches/branches.service.ts`, `accounts/accounts.service.ts` (alta de membresía fija versión) | H14-009…011 |
| API | `common/office-scope/office-scope.ts` (+ `.service.ts`): visibilidad de miembros | H14-012 |
| API | `mora/mora-query.ts:173-178`, `clients/clients.service.ts` (fija `created_by` al crear), `clients/import/client-import.service.ts` | H14-013 |
| API | `uploads/uploads.controller.ts`, `uploads.service.ts` (+ resolvedor de visibilidad) | H14-014 |
| API | `config/env.validation.ts` (`AUTHZ_VERSION_CHECK`), `apps/api/package.json` (script `test`) | H14-015 |
| Shared | `packages/shared`: permiso `user:sessions:revoke`, código `AUTHZ_STALE` | H14-016 |
| Web | `lib/bff.ts` (`apiCall`), ruta `app/api/auth/renew`, `middleware.ts` | H14-017 |
| Móvil | `src/api-client.ts` (solo prueba; sin cambio previsto) | H14-018 |

Los 14 archivos que usan `apiCall` en web se enumeran al ejecutar la tarea 17 (no se modifican uno a uno: el cambio es central).

## 7. Invariantes que aplican
F14-A: **H-2** (permisos en JWT + `av` + `pv`; discrepancia ⇒ `401 AUTHZ_STALE`; el cliente refresca y reintenta **una** vez; el refresh nunca reutiliza permisos del JWT; fail-closed si Redis cae), **H-7** (la responsabilidad vive en el crédito; no se crea «cobrador dueño» del cliente — `created_by` es solo trazabilidad). F14-B: rama por fase; sin G4 no hay código; spec nuevo registrado en el script `test` (F13/RULES B12); migraciones aditivas. Principios de CLAUDE.md: `account_id` en toda tabla operativa (la outbox lo lleva; `platform_settings` es catálogo global, igual que `roles`/`permissions`), RLS, auditoría de toda mutación, `strict` sin `any`, respuestas `{data, meta, error}`.

## 8. Perfiles de tenant y protección del gratuito individual (RULES C)
- **FREE individual** (una oficina, un usuario ADMIN con `data:scope:all`): ve todo a su alcance; `GET /users` devuelve solo a él; sus clientes sin crédito siguen visibles (alcance ALL); sus archivos siguen legibles (alcance ALL). Único efecto: **una única renovación silenciosa de token tras el despliegue** (bump global) — invisible si el cliente reintenta.
- **Equipo con oficinas** (supervisor / gerente regional / cobrador): cambia lo previsto (R-02, N-12, R-06). Riesgo de regresión del cobrador que crea un cliente y aún no tiene crédito → mitigado con `created_by` (D-1).
- **Regresión del gratuito individual** (definida, se ejecuta en G5): login → crear cliente → crear crédito → registrar pago → subir foto y verla → cambiar de rol a sí mismo no aplica (`cannotEditSelf`); verificar que no hay `AUTHZ_STALE` visible ni 401 residual y que `GET /users` lo lista a él.

**Cruce con la alineación móvil↔web en curso (F13/RULES D1, releído 2026-11-04):** `F10/plans/alineacion-web/README.md` está EN EJECUCIÓN (ronda 3) y rige P-3 (el API es la autoridad de permisos; el móvil no decide con caché) y P-2 (decisiones F10 vigentes). F1 **no cambia código móvil**: solo agrega una prueba a `api-client.ts`, que ya refresca ante cualquier 401 y reintenta una vez (E18). No pisa ninguna fase de la alineación; sí **requiere** que la app móvil actual tolere el 401 `AUTHZ_STALE`, lo cual cumple.

## 9. Riesgos
| # | Riesgo | Mitigación |
|---|---|---|
| R1 | Redis caído ⇒ 401 masivo (hoy `isRevoked` ya falla igual) | Fail-closed aprobado (H-2); código `AUTHZ_UNAVAILABLE` distinto de `AUTHZ_STALE` para no provocar bucle de refresh; métrica/log de alerta |
| R2 | Bucle de refresh si `av` de la DB ≠ valor en Redis | `refresh` lee `av` de **DB** en la misma tx y rellena Redis; el guard compara contra Redis, que el reconciliador deja alineado; un segundo `AUTHZ_STALE` tras reintento ⇒ login |
| R3 | Web: un 401 con cookie presente no refresca (E17); sin tratamiento el usuario queda atascado | `apiCall` en handlers/acciones: refresca y reintenta una vez y escribe cookies; en RSC (no puede escribir cookies) redirige a `/api/auth/renew?next=…` (handler que renueva y vuelve); con tope de un salto (`renewed=1`) |
| R4 | Rotación del refresh: refrescar sin poder persistir cookies quema el refresh | Solo se refresca donde se pueden escribir cookies (handlers y `/api/auth/renew`); jamás en RSC |
| R5 | Clave de versión ausente en Redis (flush) | Cache-miss ⇒ lectura de DB y relleno (fail-safe) |
| R6 | Tokens emitidos antes del despliegue no traen `av`/`pv` | Se tratan como stale ⇒ refresh transparente (comportamiento buscado; flag `off` los acepta) |
| R7 | Carrera: cambio de rol justo mientras se emite un token | `av` se lee en la misma transacción que el rol (refresh) y el bump ocurre en la tx del cambio ⇒ el token nuevo o ya trae la versión nueva o queda stale |
| R8 | Filtro de Personas deja sin ver a alguien que el actor debe gestionar | Pruebas de alcance por tipo (ALL/SUBTREE/BRANCH/OWN) + integración `office-scope.it.ts` ampliada; flag de reversa no aplica: revisión manual en G5 |
| R9 | N-12 interino oculta clientes legítimos sin crédito a SUBTREE/BRANCH/OWN | `created_by` visible para su creador; clientes históricos sin crédito y sin `created_by` solo los ve ALL/SUBTREE (según plan) — se informa a la usuaria |
| R10 | Archivos: imágenes de listas rompen si la política es demasiado estricta | Perfil (foto/QR) legible por cualquier miembro del tenant; huérfano legible por quien lo subió (auditoría `upload`); ALL ve todo |
| R11 | Reconciliador duplica envíos o se atrasa | `SET` idempotente con versión monótona (`GREATEST` vía script Lua o comparación) y marca `processed_at`; intervalo 30 s |

## 10. Pruebas
**Existentes que deben seguir en verde:** `token.service.spec.ts`, `session.service.spec.ts`, `auth.service.spec.ts`, `password.service.spec.ts`, `users.service.spec.ts`, `member-detail.service.spec.ts`, `office-scope.spec.ts`, `clients.scope.spec.ts`, `permission-gates.spec.ts`, `prisma-scope.spec.ts`, `uploads.service.spec.ts`; integración `office-scope.it.ts`; web `bff.test.ts`; móvil `api-client` test.
**Nuevas (se registran en el script `test` de `apps/api/package.json`; integración en `test:integration`; web/móvil en sus scripts):**
- `auth/authz-version.service.spec.ts`: bump, publicación, outbox, reconciliación tras fallo de Redis, miss ⇒ DB.
- `auth/guards/jwt-auth.guard.spec.ts`: sesión revocada; `av` viejo; `pv` viejo; token sin `av`/`pv` (flag on ⇒ stale, off ⇒ pasa); Redis lanza ⇒ 401 `AUTHZ_UNAVAILABLE`.
- `auth/auth.service.spec.ts` (ampliar): `issueTokens`/`refresh` emiten `av`/`pv` desde DB; refresh no copia permisos del JWT; membresía inactiva ⇒ inválido.
- `users/users.session-revocation.spec.ts`: cambio de rol, de oficina, desactivación, reactivación; **membresía desactivada no toca sesiones de otro tenant**.
- `users/users.scope.spec.ts` + ampliar `common/office-scope/office-scope.spec.ts`: Personas por alcance (gerente de una regional no ve otra; supervisor ve su oficina; sin oficina solo ALL/raíz; siempre a sí mismo).
- `mora/client-visibility.spec.ts`: sin crédito vivo ⇒ solo ALL/SUBTREE o `created_by = yo`.
- `uploads/uploads.access.spec.ts`: subir sin permiso ⇒ 403; leer archivo de cliente no visible ⇒ 404; huérfano propio ⇒ ok; perfil ⇒ ok; ALL ⇒ ok.
- `test/integration/authz-versions.it.ts`: flujo real con Postgres+Redis (cambio de rol ⇒ la siguiente petición con el token viejo da `AUTHZ_STALE`, refresh y reintento ⇒ 200; Redis detenido ⇒ 401).
- Web `lib/bff.test.ts` (ampliar): reintento único ante `AUTHZ_STALE`, sin bucle; ruta `renew`. Móvil: test de `authedFetch` con 401 `AUTHZ_STALE` ⇒ refresca y reintenta una vez; segundo 401 ⇒ `clearSession`.
- `verify_isolation.sql`: `authz_version_outbox` aislada por tenant.

## 11. Rollback
- **Flag** `AUTHZ_VERSION_CHECK=off`: el guard vuelve a comportarse como hoy (solo denylist); los claims `av`/`pv` se siguen emitiendo (inofensivos).
- **Migración `f14_01` es solo aditiva** (columna con default, 2 tablas nuevas, `clients.created_by` nullable): no requiere reversa para dejar de usarla; reversa opcional documentada: `DROP TABLE authz_version_outbox, platform_settings; ALTER TABLE user_accounts DROP COLUMN authz_version; ALTER TABLE clients DROP COLUMN created_by`.
- N-12 / Personas / archivos: revertir el commit correspondiente (cada bloque va en commit propio, ver tareas).
- Web: quitar el reintento central devuelve el comportamiento previo.

## 12. Tareas ordenadas (datos → API → web → móvil) — un commit local por bloque
**Datos**
1. Migración `f14_01`: `user_accounts.authz_version INT NOT NULL DEFAULT 1`; `platform_settings(id=1 singleton, policy_version INT NOT NULL DEFAULT 1)` con CHECK de una fila; `authz_version_outbox(id, account_id, user_id, version, created_at, processed_at)` + índice parcial `processed_at IS NULL` + RLS por tenant; `clients.created_by UUID NULL`. Actualizar `schema.prisma`, seed y `verify_isolation.sql`. *(commit 1)*
**API — versiones y sesiones**
2. `shared`: permiso `user:sessions:revoke` (asignado a ACCOUNT_ADMIN y MANAGER en `ROLE_PERMISSIONS`) y constantes `AUTHZ_STALE`/`AUTHZ_UNAVAILABLE`.
3. `AuthzVersionService`: `current(uid, acc)` (MGET/cache-miss a DB), `policyVersion()`, `bumpInTx(tx, membershipId)` (UPDATE + fila outbox en la tx), `publish()` post-commit (SET + `processed_at`), reconciliador `setInterval` 30 s con `unref`, métrica/log.
4. `TokenService`: claims `av`, `pv`. `AuthenticatedUser`: `av`, `pv`.
5. `JwtAuthGuard`: `MGET revoked_session, authz, policy`; discrepancia ⇒ `401 AUTHZ_STALE`; error de Redis ⇒ `401 AUTHZ_UNAVAILABLE`; respeta `AUTHZ_VERSION_CHECK`.
6. `AuthService.issueTokens` / `refresh`: leen `av` (membresía) y `pv` de DB en la tx; rellenan Redis; permisos siempre de `forRole`.
7. `SessionService.revokeAccountSessions(userId, accountId, reason)` y `revokeAllForUser` (reusa `revokeRows`); auditoría `SESSION_REVOKE`.
8. `UsersService.updateMember`: bump en la tx si cambian rol / oficina / activo; tras commit: publicar y, si se desactiva la membresía, revocar sus sesiones de **esa** cuenta; reactivación ⇒ bump. `branches.service` (asignar/quitar miembro, baja de oficina) ⇒ bump de los afectados. Alta de membresía (`accounts.service`, invitación) fija versión 1. Endpoint `POST /users/:id/sessions/revoke`. *(commit 2: versiones)*
**API — aislamiento**
9. `office-scope`: `memberVisibilitySql`/`visibleMemberIds(tx, scope)` puro + pruebas.
10. `UsersService.list/getById/activity*`: aplicar alcance; fuera de alcance ⇒ 404. *(commit 3: Personas)*
11. `clients.service` (crea con `created_by`), `client-import.service`; `mora-query.ts` N-12 interino. *(commit 4: N-12)*
12. `@RolesAny` + `RolesGuard`; `uploads.controller`: `POST` con `@RolesAny(client:write, collection:write, payment:write, route:execute)` (ver D-2); `GET` con resolvedor de visibilidad (ALL ⇒ existe en carpeta; si no, entidad visible o subido por mí). *(commit 5: archivos)*
13. `env.validation.ts`: `AUTHZ_VERSION_CHECK` (default `on`). Registrar specs en `test` / `test:integration`.
**Web**
14. `apiCall`: ante `AUTHZ_STALE` refresca y reintenta una vez cuando puede escribir cookies; en RSC redirige a `app/api/auth/renew` (un salto máx.). *(commit 6)*
**Móvil**
15. Prueba de `authedFetch` con `AUTHZ_STALE` (sin cambio de código si pasa). *(commit 6)*
**Cierre**
16. G5: correr comandos de `hub/VERIFICATION-MAP`-equivalente (ver `../hub/HUB.md` §Pruebas) + regresión FREE; pegar salida en `execution/VERIFICATIONS.md`. 17. G6 `/code-review` + recorrido de impacto. 18. G7: HUB, STATUS, HANDOFF, PHASES-LOG.

## 13. Criterios de cierre (G5–G7)
- G5: `pnpm --filter api test` y `test:integration` en verde (salida pegada); `tsc --noEmit` api/web/mobile/shared; tests web y móvil en verde; **regresión FREE individual** (§8) pegada.
- Pruebas F.1 del plan técnico todas presentes: sesión revocada, `av`/`pv` viejos, rol cambiado, membresía desactivada sin tocar otros tenants, usuario global (método probado), Redis caído ⇒ 401, reconciliación tras fallo.
- `GET /users` del gerente de una regional no devuelve otra regional (prueba de integración).
- G6: `/code-review` sin hallazgos abiertos de severidad alta; HUB H14-001…018 actualizados.
- G7: HUB, STATUS, HANDOFF, PHASES-LOG y docs de producto afectados (`docs/producto/…` sobre sesiones y alcance de Personas) actualizados.

---
## Decisiones propias de F1 (D-1, D-2, D-5 aprobadas por la usuaria 2026-11-05; D-3 y D-4 son implementación de H-2)
- **D-1 `clients.created_by` se adelanta de F2 a F1** (nullable, solo trazabilidad, **no** es «dueño», respeta H-7). Motivo: sin él el interino de N-12 haría desaparecer al cliente recién creado para cobrador/supervisor. Si la usuaria prefiere no adelantarlo, la alternativa es aceptar esa regresión hasta F2.
- **D-2 Subida de archivos**: `user:profile` **no existe** (releído hoy; el perfil propio no exige permiso, `users.controller.ts:35-40`). Por eso `POST /uploads` exige *cualquiera de* `client:write`, `collection:write`, `payment:write`, `route:execute`. Efecto aceptado y documentado: **AUDITOR y VIEWER (solo lectura) ya no pueden subir su foto de perfil** hasta F4 (tabla `files` con dueño `profile_photo`). Alternativa si la usuaria no lo acepta: dejar `POST /uploads` abierto solo para imágenes ≤ 8 MB y huérfanas (ya es lo de hoy) — se vuelve a decidir en F4.
- **D-3 Outbox transaccional** en lugar de «encolar solo si Redis falla» (§C.6): misma intención, sin ventana en que un fallo deje a Redis desactualizado sin registro.
- **D-4 `AUTHZ_UNAVAILABLE`** (401) distinto de `AUTHZ_STALE` para el caso fail-closed; evita bucle de refresh.
- **D-5 Perfil (foto/QR) legible por todo el tenant** hasta que F4 defina la política de PII (H-6).
