# F14 · HANDOFF

## Sesión 2026-11-04
- **Dónde quedó:** `/epic-fase F14 retomar` hecho; se creó el arnés mínimo (STATUS, RULES, HANDOFF) y se releyó código de sesiones para el plan de F1. **No se escribió el plan de F1 ni código de producto.**
- **Terminado:** auditoría, `ROLES-PERMISOS-PLAN.md` (commit `914a76b`), 13 decisiones H-1…H-13 aprobadas.
- **Falta:** `plans/F1-sesiones-aislamiento.md` (plantilla T4, 13 secciones), `hub/HUB.md` mínimo para los archivos de F1, `execution/VERIFICATIONS.md`, validación G4.

### Estado inicial de F1 releído HOY (VERIFICADO 2026-11-04)
- `apps/api/src/modules/auth/guards/jwt-auth.guard.ts:43` solo consulta `sessions.isRevoked(sessionId)`; `AuthenticatedUser` (:8-14) no lleva `av`/`pv`.
- `token.service.ts:7-13` `AccessClaims` sin `av`/`pv`; `signAccess` en :37.
- `session.service.ts:37-47` denylist `revoked_session:{id}` con `EXISTS`; `revokeAll(userId)` en :98 existe.
- `auth.service.ts:436` `issueTokens` arma permisos con `permissions.forRole(roleId)`; `refresh` (:488) ya re-deriva rol y permisos desde `userAccount` activo (:533-537) y emite access nuevo (:561). Falta: `av`/`pv`, y que la membresía inactiva invalide solo ese tenant.
- `permissions.service.ts:13` `forRole` lee `role_permissions` global.
- `users.service.ts:158` `updateMember`: guard `lastAdmin` en :172-188 (cuenta «otros administradores»); **no invoca `SessionService`** → R-01 confirmado. `list()` en :69 sin filtro de alcance (solo RLS de cuenta) → R-02 confirmado.
- `ownership.service.ts:71-74`: el traspaso deja al dueño anterior como admin (contradice H-13; se corrige en la fase de plataforma, no en F1).

### Archivos de F1 pendientes de releer antes del plan
`uploads.controller.ts`, `mora-query.ts:173-178`, web `middleware.ts`/`bff.ts`, móvil `api-client.ts:68-74`, modelo Prisma (`user_accounts`, `platform_settings`), `apps/api/package.json` script `test`.

- **Decisiones pendientes:** ninguna.
- **Archivos cambiados:** solo documentación en `docs/epics/F14/`.
- **Verificaciones:** no corridas.
- **Siguiente paso autorizado:** escribir `plans/F1-sesiones-aislamiento.md` (modo `plan F1`), validarlo (G4) y, con PASS, crear la rama `f14/p1-sesiones-aislamiento` y ejecutar F1. La usuaria autorizó avanzar entre fases, `migrate reset` en dev y commits locales (sin push).
