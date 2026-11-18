-- Legal: documentos versionados, aceptaciones y consentimientos. Aditiva (solo crea). Reversible solo antes de tener datos:
-- DROP TABLE consent_records, user_legal_acceptances, legal_document_versions; y los 5 tipos Legal*.
-- Estas tablas son EVIDENCIA: una vez con filas, NO se borran (el trigger lo impide a propósito).

-- CreateEnum
CREATE TYPE "LegalDocumentType" AS ENUM ('TERMS', 'PRIVACY', 'COOKIES', 'DPA', 'ACCEPTABLE_USE', 'AI_POLICY');

-- CreateEnum
CREATE TYPE "LegalAcceptanceAction" AS ENUM ('ACCEPTED', 'ACKNOWLEDGED');

-- CreateEnum
CREATE TYPE "LegalAcceptanceSource" AS ENUM ('SIGNUP_WEB', 'SIGNUP_MOBILE', 'INVITATION_WEB', 'INVITATION_MOBILE', 'RE_ACCEPT', 'PROFILE', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "LegalConsentPurpose" AS ENUM ('MARKETING', 'ANALYTICS', 'COOKIES_NON_ESSENTIAL');

-- CreateEnum
CREATE TYPE "LegalConsentStatus" AS ENUM ('GRANTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "legal_document_versions" (
    "id" TEXT NOT NULL,
    "type" "LegalDocumentType" NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'es',
    "version" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "content_sha256" TEXT NOT NULL,
    "is_material" BOOLEAN NOT NULL DEFAULT false,
    "change_summary" TEXT,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_by" TEXT,

    CONSTRAINT "legal_document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_legal_acceptances" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT,
    "document_version_id" TEXT NOT NULL,
    "content_sha256" TEXT NOT NULL,
    "action" "LegalAcceptanceAction" NOT NULL,
    "source" "LegalAcceptanceSource" NOT NULL,
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "user_agent" TEXT,
    "app_version" TEXT,

    CONSTRAINT "user_legal_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "purpose" "LegalConsentPurpose" NOT NULL,
    "status" "LegalConsentStatus" NOT NULL,
    "document_version_id" TEXT,
    "source" "LegalAcceptanceSource" NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "user_agent" TEXT,
    "app_version" TEXT,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "legal_document_versions_type_locale_effective_at_idx" ON "legal_document_versions"("type", "locale", "effective_at");

-- CreateIndex
CREATE UNIQUE INDEX "legal_document_versions_type_locale_version_key" ON "legal_document_versions"("type", "locale", "version");

-- CreateIndex
CREATE INDEX "user_legal_acceptances_user_id_accepted_at_idx" ON "user_legal_acceptances"("user_id", "accepted_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_legal_acceptances_user_id_document_version_id_action_key" ON "user_legal_acceptances"("user_id", "document_version_id", "action");

-- CreateIndex
CREATE INDEX "consent_records_user_id_purpose_recorded_at_idx" ON "consent_records"("user_id", "purpose", "recorded_at");

-- AddForeignKey
ALTER TABLE "user_legal_acceptances" ADD CONSTRAINT "user_legal_acceptances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_legal_acceptances" ADD CONSTRAINT "user_legal_acceptances_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "legal_document_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "legal_document_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Inmutabilidad: las tres tablas son de solo INSERT. Un trigger impide UPDATE y DELETE a cualquier rol (incluido el dueño de las
-- tablas) y otro impide TRUNCATE. El REVOKE al rol de la aplicación va en prisma/rls/007_legal.sql (lo aplica `db:rls`).
CREATE OR REPLACE FUNCTION legal_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % es evidencia legal y no admite % (solo INSERT)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER legal_document_versions_immutable BEFORE UPDATE OR DELETE ON "legal_document_versions"
  FOR EACH ROW EXECUTE FUNCTION legal_forbid_mutation();
CREATE TRIGGER legal_document_versions_no_truncate BEFORE TRUNCATE ON "legal_document_versions"
  FOR EACH STATEMENT EXECUTE FUNCTION legal_forbid_mutation();

CREATE TRIGGER user_legal_acceptances_immutable BEFORE UPDATE OR DELETE ON "user_legal_acceptances"
  FOR EACH ROW EXECUTE FUNCTION legal_forbid_mutation();
CREATE TRIGGER user_legal_acceptances_no_truncate BEFORE TRUNCATE ON "user_legal_acceptances"
  FOR EACH STATEMENT EXECUTE FUNCTION legal_forbid_mutation();

CREATE TRIGGER consent_records_immutable BEFORE UPDATE OR DELETE ON "consent_records"
  FOR EACH ROW EXECUTE FUNCTION legal_forbid_mutation();
CREATE TRIGGER consent_records_no_truncate BEFORE TRUNCATE ON "consent_records"
  FOR EACH STATEMENT EXECUTE FUNCTION legal_forbid_mutation();
