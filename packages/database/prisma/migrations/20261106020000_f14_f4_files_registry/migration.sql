-- F14 · F4 (ADR-F14-07) — registro de archivos y de sus dueños.
--
-- POR QUÉ
-- Hoy un archivo subido sólo se sabe de quién es mirando, uno por uno, todos los lugares donde alguna tabla guarda su URL (adjuntos,
-- fotos de ubicación, comprobantes, evidencias…) con una consulta de UNION y `LIKE` sobre JSON (`UploadAccessService`). Esa consulta se
-- olvida de casos (fotos de las personas relacionadas, logo de la cuenta), no escala y no deja dónde colgar una auditoría ni una
-- limpieza. Acá cada archivo (una fila por contenido: su nombre en disco es el SHA-256) y cada dueño (una fila por referencia) quedan
-- registrados. Es ADITIVO: las columnas de URL de las demás tablas NO se tocan; el móvil y la web siguen leyendo las URLs de siempre.
--
-- El relleno inserta lo que ya existe como ATTACHED. No inventa los archivos subidos que nunca se ataron (no hay de dónde saber su
-- extensión): para ésos la lectura conserva, un release, la regla anterior («los subió esta misma persona»).
--
-- RLS: igual que las demás tablas operativas, `rls/001_enable_rls.sql` (tenant_isolation + FORCE) y `rls/verify_files.sql`.
-- ROLLBACK: DROP TABLE "file_owners"; DROP TABLE "files"; DROP TYPE "FileOwnerEntity"; DROP TYPE "FileStatus";

CREATE TYPE "FileStatus" AS ENUM ('PENDING', 'ATTACHED', 'ORPHAN');
CREATE TYPE "FileOwnerEntity" AS ENUM (
  'CLIENT_ATTACHMENT', 'CLIENT_LOCATION', 'CLIENT_RELATION', 'COLLATERAL', 'PAYMENT_RECEIPT',
  'PROFILE_PHOTO', 'PROFILE_QR', 'ACCOUNT_LOGO', 'FIELD_EVIDENCE', 'IMPORT_RUN'
);

CREATE TABLE "files" (
  "id"          TEXT         NOT NULL,
  "account_id"  TEXT         NOT NULL,
  "storage_key" TEXT         NOT NULL,
  "sha256"      TEXT         NOT NULL,
  "mime"        TEXT         NOT NULL,
  "size"        INTEGER,
  "status"      "FileStatus" NOT NULL DEFAULT 'PENDING',
  "uploaded_by" TEXT,
  "attached_at" TIMESTAMP(3),
  "orphaned_at" TIMESTAMP(3),
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL,
  "deleted_at"  TIMESTAMP(3),
  CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "files_account_id_storage_key_key" ON "files" ("account_id", "storage_key");
CREATE INDEX "files_account_id_status_created_at_idx" ON "files" ("account_id", "status", "created_at");
CREATE INDEX "files_status_orphaned_at_idx" ON "files" ("status", "orphaned_at");

CREATE TABLE "file_owners" (
  "id"           TEXT              NOT NULL,
  "account_id"   TEXT              NOT NULL,
  "file_id"      TEXT              NOT NULL,
  "owner_entity" "FileOwnerEntity" NOT NULL,
  "owner_id"     TEXT              NOT NULL,
  "created_at"   TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "file_owners_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "file_owners_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "file_owners_file_id_owner_entity_owner_id_key" ON "file_owners" ("file_id", "owner_entity", "owner_id");
CREATE INDEX "file_owners_account_id_owner_entity_owner_id_idx" ON "file_owners" ("account_id", "owner_entity", "owner_id");

-- ── Relleno: toda referencia que ya existe ─────────────────────────────────────────────────────────────────────────────────────────
-- Una referencia = (cuenta, ruta del archivo, tipo de dueño, id del dueño). La ruta es el tramo `<64 hex>.<ext>` al final de la URL.
CREATE TEMP TABLE _f4_refs ON COMMIT DROP AS
SELECT account_id, substring(file_url from '[0-9a-f]{64}\.[a-z]{3,4}$') AS storage_key, 'CLIENT_ATTACHMENT'::"FileOwnerEntity" AS owner_entity, id AS owner_id
  FROM client_attachments WHERE file_url IS NOT NULL
UNION ALL
SELECT l.account_id, substring(u from '[0-9a-f]{64}\.[a-z]{3,4}$'), 'CLIENT_LOCATION'::"FileOwnerEntity", l.id
  FROM client_locations l, jsonb_array_elements_text(CASE WHEN jsonb_typeof(l.photo_urls) = 'array' THEN l.photo_urls ELSE '[]'::jsonb END) u
UNION ALL
SELECT r.account_id, substring(u from '[0-9a-f]{64}\.[a-z]{3,4}$'), 'CLIENT_RELATION'::"FileOwnerEntity", r.id
  FROM client_relations r, jsonb_array_elements_text(CASE WHEN jsonb_typeof(r.photo_urls) = 'array' THEN r.photo_urls ELSE '[]'::jsonb END) u
UNION ALL
SELECT c.account_id, substring(u from '[0-9a-f]{64}\.[a-z]{3,4}$'), 'COLLATERAL'::"FileOwnerEntity", c.id
  FROM collaterals c, jsonb_array_elements_text(CASE WHEN jsonb_typeof(c.photo_urls) = 'array' THEN c.photo_urls ELSE '[]'::jsonb END) u
UNION ALL
SELECT account_id, substring(receipt_url from '[0-9a-f]{64}\.[a-z]{3,4}$'), 'PAYMENT_RECEIPT'::"FileOwnerEntity", id
  FROM payments WHERE receipt_url IS NOT NULL
UNION ALL
SELECT account_id, substring(file_url from '[0-9a-f]{64}\.[a-z]{3,4}$'), 'FIELD_EVIDENCE'::"FileOwnerEntity", id
  FROM field_evidences WHERE file_url IS NOT NULL
UNION ALL
SELECT id, substring(logo_url from '[0-9a-f]{64}\.[a-z]{3,4}$'), 'ACCOUNT_LOGO'::"FileOwnerEntity", id
  FROM accounts WHERE logo_url IS NOT NULL
UNION ALL
-- La foto y el QR del perfil son de la PERSONA (no tienen cuenta): se toma la cuenta donde se subió (auditoría) o, si no, su primera membresía.
SELECT COALESCE(
         (SELECT al.account_id FROM audit_logs al WHERE al.entity = 'upload' AND al.entity_id = left(p.sk, 64) ORDER BY al.created_at LIMIT 1),
         (SELECT ua.account_id FROM user_accounts ua WHERE ua.user_id = p.user_id ORDER BY ua.created_at LIMIT 1)),
       p.sk, 'PROFILE_PHOTO'::"FileOwnerEntity", p.user_id
  FROM (SELECT user_id, substring(photo_url from '[0-9a-f]{64}\.[a-z]{3,4}$') AS sk FROM profiles WHERE photo_url IS NOT NULL) p
UNION ALL
SELECT COALESCE(
         (SELECT al.account_id FROM audit_logs al WHERE al.entity = 'upload' AND al.entity_id = left(p.sk, 64) ORDER BY al.created_at LIMIT 1),
         (SELECT ua.account_id FROM user_accounts ua WHERE ua.user_id = p.user_id ORDER BY ua.created_at LIMIT 1)),
       p.sk, 'PROFILE_QR'::"FileOwnerEntity", p.user_id
  FROM (SELECT user_id, substring(payment_qr_url from '[0-9a-f]{64}\.[a-z]{3,4}$') AS sk FROM profiles WHERE payment_qr_url IS NOT NULL) p
UNION ALL
SELECT account_id, file_key, 'IMPORT_RUN'::"FileOwnerEntity", id
  FROM client_import_runs WHERE file_key IS NOT NULL;

DELETE FROM _f4_refs WHERE storage_key IS NULL OR account_id IS NULL;

INSERT INTO files (id, account_id, storage_key, sha256, mime, status, attached_at, created_at, updated_at)
SELECT gen_random_uuid()::text, account_id, storage_key,
       COALESCE(substring(storage_key from '[0-9a-f]{64}'), storage_key),
       CASE lower(right(storage_key, 3)) WHEN 'jpg' THEN 'image/jpeg' WHEN 'png' THEN 'image/png' WHEN 'ebp' THEN 'image/webp' WHEN 'pdf' THEN 'application/pdf' ELSE 'application/octet-stream' END,
       'ATTACHED', now(), now(), now()
FROM (SELECT DISTINCT account_id, storage_key FROM _f4_refs) k;

INSERT INTO file_owners (id, account_id, file_id, owner_entity, owner_id)
SELECT DISTINCT ON (f.id, r.owner_entity, r.owner_id) gen_random_uuid()::text, r.account_id, f.id, r.owner_entity, r.owner_id
FROM _f4_refs r JOIN files f ON f.account_id = r.account_id AND f.storage_key = r.storage_key;
