-- Reportes públicos (formulario sin cuenta): reutiliza privacy_requests. Aditiva; no toca filas existentes.
-- Reversible solo antes de tener datos: los valores de enum no se pueden quitar en PostgreSQL (se dejan sin usar).

-- AlterEnum (los valores nuevos no se usan en esta migración, así que no hay problema con la transacción)
ALTER TYPE "PrivacySubjectKind" ADD VALUE IF NOT EXISTS 'THIRD_PARTY';
ALTER TYPE "PrivacyRequestType" ADD VALUE IF NOT EXISTS 'ABUSE_REPORT';
ALTER TYPE "PrivacyRequestType" ADD VALUE IF NOT EXISTS 'ACCOUNT_DELETION';

-- AlterTable: quien escribe desde el formulario público no tiene usuario.
ALTER TABLE "privacy_requests" ALTER COLUMN "requester_user_id" DROP NOT NULL;
ALTER TABLE "privacy_requests" ADD COLUMN "contact_email" TEXT;
ALTER TABLE "privacy_requests" ADD COLUMN "contact_name" TEXT;
ALTER TABLE "privacy_requests" ADD COLUMN "reported_subject" TEXT;

-- Coherencia: sin usuario ⇔ THIRD_PARTY, y esas filas siempre traen un correo de contacto. (Comparación por texto: el valor nuevo
-- del enum no puede usarse como literal dentro de la misma transacción en que se crea.)
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_requester_coherent"
  CHECK (("subject_kind"::text = 'THIRD_PARTY') = ("requester_user_id" IS NULL));
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_third_party_contact"
  CHECK ("subject_kind"::text <> 'THIRD_PARTY' OR "contact_email" IS NOT NULL);
