-- Reportes públicos: confirmación del correo de quien escribe (solo THIRD_PARTY). Aditiva.
-- Reversible: ALTER TABLE privacy_requests DROP COLUMN contact_verify_hash, DROP COLUMN contact_verify_expires_at, DROP COLUMN contact_verified_at;
ALTER TABLE "privacy_requests" ADD COLUMN "contact_verify_hash" TEXT;
ALTER TABLE "privacy_requests" ADD COLUMN "contact_verify_expires_at" TIMESTAMP(3);
ALTER TABLE "privacy_requests" ADD COLUMN "contact_verified_at" TIMESTAMP(3);
