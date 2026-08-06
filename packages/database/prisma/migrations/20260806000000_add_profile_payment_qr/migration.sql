-- QR de cobro propio del cobrador: la imagen del QR bancario que le muestra al deudor para que
-- pague desde su banco. No hay pasarela detrás — el pago se sigue registrando a mano con método QR.
-- `profiles` no lleva RLS por tenant (es 1:1 con users, que es global): no hay política que sumar.
ALTER TABLE "profiles" ADD COLUMN "payment_qr_url" TEXT;
