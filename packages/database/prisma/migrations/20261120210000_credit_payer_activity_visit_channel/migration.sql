-- «Quién responde por el crédito» pasa a ser un dato DEL CRÉDITO (antes vivía suelto en cada gestión).
ALTER TABLE "credits" ADD COLUMN "payer_party" "payer_party";

-- Se rellena con el último valor que ya tenían las gestiones de cada crédito: nadie pierde lo que ya dijo.
UPDATE "credits" c
SET "payer_party" = a."payer_party"
FROM (
  SELECT DISTINCT ON ("credit_id") "credit_id", "payer_party"
  FROM "credit_activities"
  WHERE "payer_party" IS NOT NULL
  ORDER BY "credit_id", "created_at" DESC
) a
WHERE a."credit_id" = c."id";

-- La gestión guarda qué dirección se visitó (visita) y por qué canal se mandó (mensaje). Ambos opcionales.
ALTER TABLE "credit_activities" ADD COLUMN "location_id" TEXT;
ALTER TABLE "credit_activities" ADD COLUMN "channel" VARCHAR(20);
