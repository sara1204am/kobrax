# F14 · HANDOFF

## Sesión 2026-11-05
- **Dónde quedó:** F1 **construida y verificada**, sin cerrar. Plan validado (G4 PASS; D-1, D-2, D-5 aprobadas por la usuaria). Rama `f14/p1-sesiones-aislamiento`, **commits locales, sin push**.
- **Terminado (tareas 1–15 del plan):**
  - Datos: migración `20261105000000_f14_01_authz_versions` (`user_accounts.authz_version`, `platform_settings`, `authz_version_outbox`, `clients.created_by`, permiso `user:sessions:revoke`), RLS de la outbox y `rls/005_authz_functions.sql`. Aplicado a la DB de desarrollo.
  - API: `AuthzVersionService` (MGET, outbox transaccional, reconciliador 30 s), claims `av`/`pv`, guard con `AUTHZ_STALE` / `AUTHZ_UNAVAILABLE` (fail-closed) y flag `AUTHZ_VERSION_CHECK`, `issueTokens`/`refresh` leen versiones de la DB, `updateMember` y `branches.service` suben la versión y cierran las sesiones de la cuenta al desactivar, `POST /users/:id/sessions/revoke`, alcance de Personas (lista y detalle), N-12 interino + `created_by`, `@RolesAny`, subida con permiso y lectura de archivos con `UploadAccessService`.
  - Web: `apiCall` renueva y reintenta una vez, ruta `/api/auth/renew`, header `x-k-path` en el middleware. Móvil: sin cambio de código, solo prueba.
- **Falta:** G6 (`/code-review` + recorrido de impacto), G7 (PHASES-LOG, docs de producto `docs/producto/…`), y decidir qué hacer con los 2 FAIL ajenos.
- **Decisiones aprobadas:** H-1…H-13; D-1 (`created_by` en F1), D-2 (subir exige permiso de escritura; AUDITOR/VIEWER pierden la foto de perfil hasta F4), D-5 (perfil legible por todo el tenant). **Pendientes:** ninguna.
- **Para la usuaria (leer):**
  1. **Despliegue:** `migrate deploy` no basta; hay que re-aplicar `rls/001_enable_rls.sql` y `rls/005_authz_functions.sql`. Tras desplegar, todas las sesiones reciben un `AUTHZ_STALE` único y renuevan solas.
  2. Tu API de desarrollo sigue corriendo el build viejo (los `nest start --watch` que tienes abiertos lo reconstruyen); la DB ya tiene lo nuevo.
  3. `execution/INCIDENTS.md`: `route-lifecycle.it.ts` falla (3 paradas en vez de 2; probable herencia de F13, no demostrada) y `tsc` del móvil falla en `datos.tsx` (previo).
  4. `user:sessions:revoke` lo tienen ACCOUNT_ADMIN y SUPER_ADMIN (el plan decía también MANAGER, pero no tiene `user:write`).
- **Archivos cambiados:** `packages/database` (schema, migración, rls/001, rls/005, seed), `packages/shared` (permiso), `apps/api` (auth, users, branches, clients, imports, mora-query, uploads, office-scope, config, specs, `test/integration/authz-versions.it.ts`, `package.json`), `apps/web` (`lib/bff.ts`, `middleware.ts`, `app/api/auth/renew`, test), `apps/mobile/src/api-client.test.ts`, `docs/epics/F14/**`.
- **Verificaciones:** ver `execution/VERIFICATIONS.md` (V-001…V-009).
- **Siguiente paso autorizado:** ninguno por iniciativa propia: **esperar la orden de la usuaria** para G6/G7 (cada transición de gate se confirma con ella) y para decidir los incidentes abiertos.
