-- F14 · F5 (ADR-F14-08, H-11) — la plataforma: una persona única de infraestructura y sesiones de soporte con consentimiento.
--
-- QUÉ CAMBIA
--  · `platform_users`: UNA sola fila (índice único sobre una constante), sin membresía en ninguna empresa, con MFA obligatorio. No hay endpoint ni
--    pantalla que cree, edite o promueva a nadie a plataforma: se aprovisiona por seed / CLI (`PLATFORM_ADMIN_EMAIL`).
--  · `support_sessions`: el acceso EXCEPCIONAL de plataforma a una cuenta. Vence (≤ 240 min), lleva el motivo y un ticket, un subconjunto de permisos, y —para
--    escritura sensible— el consentimiento del ACCOUNT_ADMIN de esa cuenta (`consent_status`).
--  · `audit_logs`: `user_id` pasa a ser nulo (la persona de plataforma no es un usuario de empresa) y se agregan `actor_type`, `actor_id` y
--    `support_session_id` para que todo lo que hace plataforma quede marcado como tal.
--  · Permiso nuevo de empresa `support:consent` (quien acepta o revoca accesos de soporte): lo reciben los administradores, en las plantillas Y en las
--    copias que cada cuenta ya tiene (lección de F4: un permiso nuevo necesita su migración de datos, no sólo el seed).
--  · Ningún permiso de plataforma se concede a un rol de empresa: los permisos de plataforma no están en el catálogo de empresa (viven en código, enum aparte).
--  · `platform_rollout_permission`: el *rollout* de un permiso nuevo a las copias de las cuentas (comando de plataforma, con *dry-run*).
--
-- ROLLBACK: DROP de las tablas y la función; `audit_logs.user_id` vuelve a NOT NULL sólo si no hay filas de plataforma.

CREATE TABLE "platform_users" (
  "id"            TEXT         NOT NULL,
  "email"         TEXT         NOT NULL,
  "password_hash" TEXT         NOT NULL,
  /** Secreto TOTP cifrado en reposo (AES-256-GCM, igual que el de los usuarios). Nulo hasta enrolar. */
  "mfa_secret"    TEXT,
  "mfa_enabled"   BOOLEAN      NOT NULL DEFAULT false,
  "is_active"     BOOLEAN      NOT NULL DEFAULT true,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "platform_users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "platform_users_email_key" ON "platform_users" ("email");
-- Exactamente UNA fila (H-11): el índice único sobre una constante impide una segunda.
CREATE UNIQUE INDEX "platform_users_single_row" ON "platform_users" ((true));

CREATE TABLE "support_sessions" (
  "id"               TEXT         NOT NULL,
  "account_id"       TEXT         NOT NULL,
  "platform_user_id" TEXT         NOT NULL,
  "reason"           TEXT         NOT NULL,
  "ticket"           TEXT,
  /** Permisos pedidos ∩ el máximo de soporte. La escritura sensible sólo entra al token con consentimiento. */
  "permissions"      TEXT[]       NOT NULL,
  /** ¿Pidió escritura sensible? Si sí, hace falta el consentimiento. */
  "sensitive"        BOOLEAN      NOT NULL DEFAULT false,
  "consent_status"   TEXT         NOT NULL DEFAULT 'NOT_REQUIRED',
  "consent_by"       TEXT,
  "consent_at"       TIMESTAMP(3),
  "expires_at"       TIMESTAMP(3) NOT NULL,
  "revoked_at"       TIMESTAMP(3),
  "revoked_by"       TEXT,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "support_sessions_consent_check" CHECK ("consent_status" IN ('NOT_REQUIRED', 'PENDING', 'GRANTED', 'DENIED', 'REVOKED')),
  CONSTRAINT "support_sessions_ttl_check" CHECK ("expires_at" <= "created_at" + interval '240 minutes'),
  CONSTRAINT "support_sessions_platform_user_fkey" FOREIGN KEY ("platform_user_id") REFERENCES "platform_users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "support_sessions_account_id_created_at_idx" ON "support_sessions" ("account_id", "created_at");
CREATE INDEX "support_sessions_platform_user_id_idx" ON "support_sessions" ("platform_user_id");

-- ── Auditoría: quién actuó ───────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE "audit_logs" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "audit_logs"
  ADD COLUMN "actor_type" TEXT NOT NULL DEFAULT 'USER',
  ADD COLUMN "actor_id" TEXT,
  ADD COLUMN "support_session_id" TEXT,
  ADD CONSTRAINT "audit_logs_actor_type_check" CHECK ("actor_type" IN ('USER', 'PLATFORM'));
CREATE INDEX "audit_logs_account_id_actor_type_idx" ON "audit_logs" ("account_id", "actor_type");

-- ── support:consent ──────────────────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO "permissions" ("id", "name", "code", "module", "action", "scope", "active", "risk", "updated_at")
VALUES (gen_random_uuid(), 'support:consent', 'support:consent', 'account', 'UPDATE', 'ACCOUNT', true, 'HIGH', now())
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."code" = 'support:consent' WHERE r."name" IN ('SUPER_ADMIN', 'ACCOUNT_ADMIN')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- (En una base nueva las migraciones corren ANTES del seed: las plantillas todavía no existen y las crea el seed, que ya incluye este permiso.)
INSERT INTO "role_template_permissions" ("template_key", "permission_id")
SELECT t."key", p."id" FROM "role_templates" t JOIN "permissions" p ON p."code" = 'support:consent' WHERE t."key" = 'ACCOUNT_ADMIN'
ON CONFLICT ("template_key", "permission_id") DO NOTHING;

INSERT INTO "account_role_permissions" ("account_role_id", "permission_id", "account_id", "source")
SELECT ar."id", p."id", ar."account_id", 'TEMPLATE'
FROM "account_roles" ar JOIN "permissions" p ON p."code" = 'support:consent'
WHERE ar."key" = 'ACCOUNT_ADMIN'
ON CONFLICT ("account_role_id", "permission_id") DO NOTHING;

-- ── Rollout de un permiso nuevo a las copias de las cuentas (comando de plataforma) ─────────────────────────────────────────────
-- Inserta `source='TEMPLATE'` SÓLO en los roles de cuenta que vienen de una plantilla que tiene el permiso y que NO divergieron; sube la versión de las
-- membresías afectadas (y deja la fila en la bandeja de salida para que Redis se entere). Con `p_dry_run` no escribe nada: sólo dice qué tocaría.
CREATE OR REPLACE FUNCTION platform_rollout_permission(p_code text, p_dry_run boolean DEFAULT true)
RETURNS TABLE (account_id text, role_key text, memberships integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_perm text;
BEGIN
  SELECT id INTO v_perm FROM permissions WHERE code = p_code AND active;
  IF v_perm IS NULL THEN RAISE EXCEPTION 'permiso inexistente: %', p_code; END IF;
  RETURN QUERY
  WITH target AS (
    SELECT ar.id AS role_id, ar.account_id AS acc, ar.key AS k
    FROM account_roles ar
    JOIN role_template_permissions t ON t.template_key = ar.template_key AND t.permission_id = v_perm
    WHERE ar.deleted_at IS NULL AND ar.diverged_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM account_role_permissions x WHERE x.account_role_id = ar.id AND x.permission_id = v_perm)
  ), ins AS (
    INSERT INTO account_role_permissions (account_role_id, permission_id, account_id, source)
    SELECT role_id, v_perm, acc, 'TEMPLATE' FROM target WHERE NOT p_dry_run
    RETURNING account_role_id
  ), bumped AS (
    UPDATE user_accounts ua SET authz_version = ua.authz_version + 1
    WHERE NOT p_dry_run AND ua.account_role_id IN (SELECT role_id FROM target)
    RETURNING ua.account_id AS acc, ua.user_id, ua.account_role_id, ua.authz_version
  ), outbox AS (
    INSERT INTO authz_version_outbox (id, account_id, user_id, version)
    SELECT gen_random_uuid()::text, b.acc, b.user_id, b.authz_version FROM bumped b
    RETURNING 1
  )
  SELECT t.acc, t.k, (SELECT count(*)::int FROM user_accounts u WHERE u.account_role_id = t.role_id AND u.is_active)
  FROM target t;
END $$;
REVOKE ALL ON FUNCTION platform_rollout_permission(text, boolean) FROM PUBLIC;

UPDATE "platform_settings" SET "policy_version" = "policy_version" + 1, "updated_at" = now() WHERE "id" = 1;
