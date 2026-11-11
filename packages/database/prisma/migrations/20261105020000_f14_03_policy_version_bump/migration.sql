-- F14 · F1 — sube la versión de política: f14_01 y f14_02 agregaron `user:sessions:revoke` a roles que ya tienen sesión abierta.
-- Con pv distinto, el próximo request de cada token vivo recibe AUTHZ_STALE y renueva con los permisos nuevos (H-2).
-- Regla desde acá: toda migración que cambie `role_permissions` sube `policy_version` en la misma migración.
UPDATE "platform_settings" SET "policy_version" = "policy_version" + 1, "updated_at" = now() WHERE "id" = 1;
