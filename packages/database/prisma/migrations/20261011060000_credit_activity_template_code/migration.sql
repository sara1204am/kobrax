-- F4/13 · E5 — Plantilla de mensaje elegida en una gestión de WhatsApp.
--
-- ADITIVO: una columna NULABLE en `credit_activities` (append-only: no se reescribe ninguna fila). Lo anterior queda en NULL.
-- El nombre dice «elegida» y no «enviada» a propósito: abrir `wa.me` no confirma el envío.

ALTER TABLE "credit_activities" ADD COLUMN "template_code" TEXT;
