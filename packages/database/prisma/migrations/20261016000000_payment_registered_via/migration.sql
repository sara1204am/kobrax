-- Pagos · desde dónde se registró: `WEB` o `MOBILE`.
--
-- ADITIVO: una columna NULABLE en `payments`. Los pagos anteriores quedan en NULL (se muestran «—»: no se sabe, y no se
-- inventa). Mismo criterio que `field_visits.source`. Es descriptivo, no una puerta de seguridad: lo declara el cliente.
-- El ledger es inmutable: se escribe en el INSERT y no se toca.

ALTER TABLE "payments" ADD COLUMN "registered_via" VARCHAR(10);
