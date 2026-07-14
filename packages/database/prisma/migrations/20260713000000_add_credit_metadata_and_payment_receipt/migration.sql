-- Cartera (fundación): campos operativos de cobranza + foto del comprobante.
-- Spec: docs/flows/Cliente_Prestamo.pdf §7 (los campos sin columna van a credit.metadata) y §5.4 (comprobante).
-- Sin tablas nuevas y sin enums nuevos → las policies RLS de `credits` y `payments` ya cubren estas columnas.

-- Cuota congelada, frecuencia, próxima fecha, origen, ref externa y nota.
-- Un crédito nacido en el móvil no tiene cronograma: estos son sus únicos datos de cobro.
ALTER TABLE "credits" ADD COLUMN "metadata" JSONB NOT NULL DEFAULT '{}';

-- Comprobante del pago. Inmutable: se escriben en el INSERT, nunca se actualizan.
ALTER TABLE "payments" ADD COLUMN "receipt_url" TEXT;
ALTER TABLE "payments" ADD COLUMN "receipt_hash" TEXT;
