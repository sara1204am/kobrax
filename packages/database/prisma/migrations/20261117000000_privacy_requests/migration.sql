-- Privacidad (B6): solicitudes de derechos de las personas y su seguimiento. Aditiva (solo crea).
-- Reversible solo antes de tener datos: DROP TABLE privacy_request_events, privacy_requests; y los 3 tipos Privacy*.
-- Los eventos son evidencia (solo INSERT): trigger aquí y REVOKE/GRANT + RLS de privacy_requests en prisma/rls/005c_privacy_requests.sql.

-- CreateEnum
CREATE TYPE "PrivacyRequestType" AS ENUM ('ACCESS', 'RECTIFICATION', 'ERASURE', 'RESTRICTION', 'OBJECTION', 'PORTABILITY', 'WITHDRAW_CONSENT', 'OTHER');

-- CreateEnum
CREATE TYPE "PrivacyRequestStatus" AS ENUM ('RECEIVED', 'IN_REVIEW', 'NEEDS_INFO', 'APPROVED', 'REJECTED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "PrivacySubjectKind" AS ENUM ('APP_USER', 'DEBTOR_VIA_ORG');

-- CreateTable
CREATE TABLE "privacy_requests" (
    "id" TEXT NOT NULL,
    "subject_kind" "PrivacySubjectKind" NOT NULL,
    "type" "PrivacyRequestType" NOT NULL,
    "status" "PrivacyRequestStatus" NOT NULL DEFAULT 'RECEIVED',
    "requester_user_id" TEXT NOT NULL,
    "account_id" TEXT,
    "subject_label" TEXT,
    "description" TEXT NOT NULL,
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "privacy_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "privacy_request_events" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "status" "PrivacyRequestStatus" NOT NULL,
    "note" TEXT,
    "actor_kind" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "privacy_request_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "privacy_requests_requester_user_id_created_at_idx" ON "privacy_requests"("requester_user_id", "created_at");

-- CreateIndex
CREATE INDEX "privacy_requests_account_id_status_created_at_idx" ON "privacy_requests"("account_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "privacy_requests_subject_kind_status_created_at_idx" ON "privacy_requests"("subject_kind", "status", "created_at");

-- CreateIndex
CREATE INDEX "privacy_request_events_request_id_created_at_idx" ON "privacy_request_events"("request_id", "created_at");

-- AddForeignKey
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_requester_user_id_fkey" FOREIGN KEY ("requester_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "privacy_request_events" ADD CONSTRAINT "privacy_request_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "privacy_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Inmutabilidad de los eventos: reutiliza la función de la migración 20261116100000_legal_foundations.
CREATE TRIGGER privacy_request_events_immutable BEFORE UPDATE OR DELETE ON "privacy_request_events"
  FOR EACH ROW EXECUTE FUNCTION legal_forbid_mutation();
CREATE TRIGGER privacy_request_events_no_truncate BEFORE TRUNCATE ON "privacy_request_events"
  FOR EACH STATEMENT EXECUTE FUNCTION legal_forbid_mutation();
