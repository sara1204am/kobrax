-- F13 · P6 — el punto de la oficina en el mapa. Opcional; van las dos coordenadas o ninguna.
ALTER TABLE "branches" ADD COLUMN "latitude" DECIMAL(10,8);
ALTER TABLE "branches" ADD COLUMN "longitude" DECIMAL(11,8);
ALTER TABLE "branches" ADD CONSTRAINT "branches_location_check" CHECK (
  ("latitude" IS NULL AND "longitude" IS NULL)
  OR ("latitude" IS NOT NULL AND "longitude" IS NOT NULL AND "latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180)
);
