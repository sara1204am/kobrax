-- Pagos · N° de recibo o factura del papel que entregó quien cobró.
--
-- ADITIVO: una columna NULABLE en `payments`. Los pagos anteriores quedan en NULL; ninguna fila se reescribe.
-- Es DISTINTO de `receipt_number`: ese es el correlativo que asigna el sistema; éste es lo que está impreso en el
-- recibo (o la factura) físico, texto libre porque cada oficial o empresa numera a su manera. Opcional.
-- El ledger es inmutable: se escribe en el INSERT y no se toca.

ALTER TABLE "payments" ADD COLUMN "receipt_reference" VARCHAR(40);
