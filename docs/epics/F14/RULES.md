# F14 · RULES

Heredan íntegras `../F13/RULES.md` §A (proceso), §B (guardrails de producto), §C (tenant gratuito individual) y §D (coordinación móvil). Este archivo solo añade lo propio de F14.

## F14-A · Decisiones que son reglas (aprobadas 2026-11-04, `ROLES-PERMISOS-PLAN.md` §H)
- H-1 roles por tenant: plantilla global + copia por tenant (Alt. C).
- H-2 permisos en el JWT + `authz_version` (membresía) + `policy_version` (global); discrepancia → `401 AUTHZ_STALE`; el cliente refresca y reintenta **una** vez; el refresh nunca reutiliza permisos del JWT; fail-closed si Redis cae.
- H-3 `member.invite`: rol destino de tier **estrictamente inferior** y oficina del subárbol. H-13: un solo `ACCOUNT_ADMIN` por tenant, asignado solo por SUPER_ADMIN; el gerente sí invita AUDITOR/VIEWER.
- H-7 la responsabilidad vive en el **crédito**; el cliente no tiene cobrador dueño.
- H-10 ventana offline móvil: 8 h cobrador / 2 h `assignment:write` y `user:write`.
- H-11 un único SUPER_ADMIN de infraestructura; interruptor externo; escritura de soporte con consentimiento del ACCOUNT_ADMIN.
- H-12 `client:delete` aparte, borrado lógico, solo ACCOUNT_ADMIN por defecto.

## F14-B · Reglas de trabajo
- Rama por fase: `f14/p<N>-<nombre>`. Commits locales; push/PR solo si la usuaria lo pide.
- Sin PASS de G4 (plan de la fase validado) no se modifica código de producto.
- Todo spec nuevo de la API se registra en el script `test` de `apps/api/package.json` (F13/RULES B12).
- Migraciones: aditivas salvo las aprobadas (p. ej. borrado de `user_permission_overrides`, H-4).
