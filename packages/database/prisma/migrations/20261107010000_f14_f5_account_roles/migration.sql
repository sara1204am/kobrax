-- F14 · F5 (ADR-F14-01, H-1) — roles POR CUENTA: seis plantillas globales y una copia por cuenta, con linaje.
--
-- POR QUÉ
-- Hasta hoy el rol de una persona es una fila GLOBAL (`roles`, nombre único en todo el sistema) y sus permisos salen de `role_permissions`, igual para
-- todas las empresas. Para que una empresa pueda ajustar los permisos de SUS roles (F7) sin tocar a ninguna otra, cada cuenta necesita sus propios roles.
-- Modelo C: la PLANTILLA global sólo se usa al crear la cuenta y en un *rollout* explícito; la copia es de la cuenta y es lo que se consulta en tiempo de
-- ejecución. `source` dice, por permiso, si viene de la plantilla o lo cambió un administrador.
--
-- ADITIVO: `user_accounts.role_id` NO se toca; `account_role_id` convive un release (rollback). Dos triggers los mantienen sincronizados en cualquier
-- camino que escriba una membresía (la API, el seed, un UPDATE a mano), así el código viejo y el nuevo ven el mismo rol.
-- `SUPER_ADMIN` NO es plantilla de cuenta (pasa a la plataforma, migración siguiente): sus membresías históricas conservan `role_id` y `account_role_id` nulo.
--
-- El permiso de alcance `data:scope:*` es excluyente: a lo sumo uno por rol. Las copias del administrador conservan sólo `data:scope:all`
-- (el más amplio; en todo el código `all` prevalece sobre `subtree` y `branch`, así que el comportamiento no cambia).
--
-- ROLLBACK: DROP de las tablas nuevas y de `user_accounts.account_role_id`; `role_id` sigue siendo la fuente.

-- ── Permisos: riesgo, reservado, dependencias ─────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE "permissions"
  ADD COLUMN "risk" TEXT NOT NULL DEFAULT 'LOW',
  ADD COLUMN "reserved" TEXT,
  ADD COLUMN "requires" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD CONSTRAINT "permissions_risk_check" CHECK ("risk" IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  ADD CONSTRAINT "permissions_reserved_check" CHECK ("reserved" IS NULL OR "reserved" IN ('PLATFORM', 'ADMIN_CORE'));
UPDATE "permissions" SET "risk" = 'HIGH' WHERE "code" IN ('client:delete', 'client:import:replace', 'credit:write_off', 'assignment:write', 'report:export', 'client:pii:read', 'user:write', 'role:write', 'account:write', 'office:write');
-- «Núcleo del administrador»: lo que el ACCOUNT_ADMIN no puede perder (el editor de F7 se apoya en esto).
UPDATE "permissions" SET "reserved" = 'ADMIN_CORE' WHERE "code" IN ('role:write', 'user:write', 'account:write', 'office:write');

-- ── Tablas ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE "role_templates" (
  "key"               TEXT         NOT NULL,
  "tier"              INTEGER      NOT NULL,
  "tenant_assignable" BOOLEAN      NOT NULL DEFAULT true,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "role_templates_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "role_template_permissions" (
  "template_key"  TEXT NOT NULL,
  "permission_id" TEXT NOT NULL,
  CONSTRAINT "role_template_permissions_pkey" PRIMARY KEY ("template_key", "permission_id"),
  CONSTRAINT "role_template_permissions_template_fkey" FOREIGN KEY ("template_key") REFERENCES "role_templates" ("key") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "role_template_permissions_permission_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "role_template_permissions_permission_id_idx" ON "role_template_permissions" ("permission_id");

CREATE TABLE "account_roles" (
  "id"           TEXT         NOT NULL,
  "account_id"   TEXT         NOT NULL,
  "key"          TEXT         NOT NULL,
  /** NULL = rol personalizado de la cuenta (sin plantilla). */
  "template_key" TEXT,
  "tier"         INTEGER      NOT NULL,
  "is_system"    BOOLEAN      NOT NULL DEFAULT true,
  "version"      INTEGER      NOT NULL DEFAULT 1,
  /** Cuándo se alejó de su plantilla por primera vez (lo marca el editor de F7); nulo = igual a la plantilla. */
  "diverged_at"  TIMESTAMP(3),
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL,
  "deleted_at"   TIMESTAMP(3),
  CONSTRAINT "account_roles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "account_roles_template_fkey" FOREIGN KEY ("template_key") REFERENCES "role_templates" ("key") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "account_roles_account_id_key_key" ON "account_roles" ("account_id", "key");
CREATE INDEX "account_roles_account_id_idx" ON "account_roles" ("account_id");

CREATE TABLE "account_role_permissions" (
  "account_role_id" TEXT         NOT NULL,
  "permission_id"   TEXT         NOT NULL,
  "account_id"      TEXT         NOT NULL,
  /** TEMPLATE = viene de la plantilla; CUSTOM = lo agregó un administrador de la cuenta. */
  "source"          TEXT         NOT NULL DEFAULT 'TEMPLATE',
  "granted_by"      TEXT,
  "granted_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "account_role_permissions_pkey" PRIMARY KEY ("account_role_id", "permission_id"),
  CONSTRAINT "account_role_permissions_source_check" CHECK ("source" IN ('TEMPLATE', 'CUSTOM')),
  CONSTRAINT "account_role_permissions_role_fkey" FOREIGN KEY ("account_role_id") REFERENCES "account_roles" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "account_role_permissions_permission_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "account_role_permissions_account_id_idx" ON "account_role_permissions" ("account_id");
CREATE INDEX "account_role_permissions_permission_id_idx" ON "account_role_permissions" ("permission_id");

ALTER TABLE "user_accounts" ADD COLUMN "account_role_id" TEXT;
ALTER TABLE "user_accounts" ADD CONSTRAINT "user_accounts_account_role_fkey" FOREIGN KEY ("account_role_id") REFERENCES "account_roles" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "user_accounts_account_id_account_role_id_idx" ON "user_accounts" ("account_id", "account_role_id");

-- ── Plantillas: las seis de empresa, desde los roles globales que existen hoy ─────────────────────────────────────────────────────
INSERT INTO "role_templates" ("key", "tier", "tenant_assignable", "updated_at")
SELECT r."name", r."level", r."name" <> 'ACCOUNT_ADMIN', now() FROM "roles" r WHERE r."name" <> 'SUPER_ADMIN';

-- Permisos de cada plantilla = los de su rol global, dejando UN solo data:scope:* (el más amplio: all > subtree > branch).
INSERT INTO "role_template_permissions" ("template_key", "permission_id")
SELECT r."name", p."id"
FROM "role_permissions" rp
JOIN "roles" r ON r."id" = rp."role_id" AND r."name" <> 'SUPER_ADMIN'
JOIN "permissions" p ON p."id" = rp."permission_id"
WHERE NOT (
  (p."code" = 'data:scope:branch' AND EXISTS (SELECT 1 FROM "role_permissions" x JOIN "permissions" xp ON xp."id" = x."permission_id" WHERE x."role_id" = r."id" AND xp."code" IN ('data:scope:all', 'data:scope:subtree')))
  OR (p."code" = 'data:scope:subtree' AND EXISTS (SELECT 1 FROM "role_permissions" x JOIN "permissions" xp ON xp."id" = x."permission_id" WHERE x."role_id" = r."id" AND xp."code" = 'data:scope:all'))
);

-- ── «A lo sumo un data:scope:* por rol» (plantilla y rol de cuenta) ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION enforce_single_data_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_code text; v_other text;
BEGIN
  SELECT code INTO v_code FROM permissions WHERE id = NEW.permission_id;
  IF v_code LIKE 'data:scope:%' THEN
    IF TG_TABLE_NAME = 'account_role_permissions' THEN
      SELECT p.code INTO v_other FROM account_role_permissions x JOIN permissions p ON p.id = x.permission_id
      WHERE x.account_role_id = NEW.account_role_id AND p.code LIKE 'data:scope:%' AND x.permission_id <> NEW.permission_id LIMIT 1;
    ELSE
      SELECT p.code INTO v_other FROM role_template_permissions x JOIN permissions p ON p.id = x.permission_id
      WHERE x.template_key = NEW.template_key AND p.code LIKE 'data:scope:%' AND x.permission_id <> NEW.permission_id LIMIT 1;
    END IF;
    IF v_other IS NOT NULL THEN
      RAISE EXCEPTION 'Un rol sólo puede tener un permiso de alcance (data:scope:*): ya tiene % y se intentó agregar %', v_other, v_code USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER account_role_permissions_single_scope BEFORE INSERT OR UPDATE OF permission_id ON "account_role_permissions" FOR EACH ROW EXECUTE FUNCTION enforce_single_data_scope();
CREATE TRIGGER role_template_permissions_single_scope BEFORE INSERT OR UPDATE OF permission_id ON "role_template_permissions" FOR EACH ROW EXECUTE FUNCTION enforce_single_data_scope();

-- ── Las copias de una cuenta nueva ────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION create_account_roles(p_account_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t record; v_id text;
BEGIN
  FOR t IN SELECT key, tier FROM role_templates LOOP
    v_id := NULL;
    INSERT INTO account_roles (id, account_id, key, template_key, tier, is_system, updated_at)
    VALUES (gen_random_uuid()::text, p_account_id, t.key, t.key, t.tier, true, now())
    ON CONFLICT (account_id, key) DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NOT NULL THEN
      INSERT INTO account_role_permissions (account_role_id, permission_id, account_id, source)
      SELECT v_id, rtp.permission_id, p_account_id, 'TEMPLATE' FROM role_template_permissions rtp WHERE rtp.template_key = t.key;
    END IF;
  END LOOP;
END $$;

-- Relleno: toda cuenta existente recibe sus seis roles.
SELECT create_account_roles("id") FROM "accounts";

-- Una cuenta nueva recibe sus roles sola, por cualquier camino que la cree.
CREATE OR REPLACE FUNCTION accounts_create_roles() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM create_account_roles(NEW.id);
  RETURN NEW;
END $$;
CREATE TRIGGER accounts_create_roles AFTER INSERT ON "accounts" FOR EACH ROW EXECUTE FUNCTION accounts_create_roles();

-- ── account_role_id sigue a role_id (y al revés no hace falta: el código nuevo escribe ambos) ──────────────────────────────────
CREATE OR REPLACE FUNCTION user_accounts_sync_account_role() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id text;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.account_role_id IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.account_role_id IS DISTINCT FROM OLD.account_role_id AND NEW.role_id IS NOT DISTINCT FROM OLD.role_id THEN RETURN NEW; END IF;
  SELECT ar.id INTO v_id FROM account_roles ar JOIN roles r ON r.name = ar.key
  WHERE ar.account_id = NEW.account_id AND r.id = NEW.role_id AND ar.deleted_at IS NULL;
  NEW.account_role_id := v_id; -- nulo si el rol global no tiene plantilla (SUPER_ADMIN): conserva sólo role_id
  RETURN NEW;
END $$;
CREATE TRIGGER user_accounts_sync_account_role BEFORE INSERT OR UPDATE OF role_id ON "user_accounts" FOR EACH ROW EXECUTE FUNCTION user_accounts_sync_account_role();

UPDATE "user_accounts" ua SET "account_role_id" = ar."id"
FROM "account_roles" ar JOIN "roles" r ON r."name" = ar."key"
WHERE ar."account_id" = ua."account_id" AND r."id" = ua."role_id";

-- Regla desde f14_03: toda migración que cambie permisos sube policy_version.
UPDATE "platform_settings" SET "policy_version" = "policy_version" + 1, "updated_at" = now() WHERE "id" = 1;
