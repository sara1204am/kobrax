-- Garantías del crédito: la personal (garante) y la no personal (el bien).
--
-- Las dos son N:N contra `credits`, y por el mismo motivo: **el vínculo es del par, no de la cosa**.
-- Un cliente puede tener dos créditos con garantes distintos; la misma persona puede garantizar los
-- dos; y el mismo vehículo puede respaldar los dos. Con una columna `credit_id` en el garante o en
-- la garantía, respaldar el segundo crédito obligaba a cargar todo de nuevo — dos filas con el mismo
-- nombre, las mismas fotos y el mismo valor, que después hay que mantener sincronizadas a mano.
--
-- `collaterals` cuelga del CLIENTE y no del crédito: si colgara del crédito, el bien que respalda
-- dos créditos habría que cargarlo y fotografiarlo dos veces.
--
-- ⚠️ **Falta correr `prisma/rls/001_enable_rls.sql`** después de esta migración: las tres tablas
-- llevan `account_id` y su política de aislamiento vive ahí, NO acá.

CREATE TABLE "credit_guarantors" (
    "relation_id" TEXT NOT NULL,
    "credit_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_guarantors_pkey" PRIMARY KEY ("relation_id","credit_id")
);

CREATE TABLE "collaterals" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "type" TEXT,
    "description" TEXT NOT NULL,
    "estimated_value" DECIMAL(14,2),
    "currency" TEXT,
    "photo_urls" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collaterals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "collateral_credits" (
    "collateral_id" TEXT NOT NULL,
    "credit_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collateral_credits_pkey" PRIMARY KEY ("collateral_id","credit_id")
);

CREATE INDEX "credit_guarantors_account_id_credit_id_idx" ON "credit_guarantors"("account_id", "credit_id");
CREATE INDEX "collaterals_account_id_client_id_idx" ON "collaterals"("account_id", "client_id");
CREATE INDEX "collateral_credits_account_id_credit_id_idx" ON "collateral_credits"("account_id", "credit_id");

-- `CASCADE` del lado del dueño: ni el vínculo del garante ni el de la garantía existen sin la fila
-- que los ata. Borrar un garante y dejar sus vínculos sueltos sería basura que nadie puede alcanzar.
ALTER TABLE "credit_guarantors" ADD CONSTRAINT "credit_guarantors_relation_id_fkey"
  FOREIGN KEY ("relation_id") REFERENCES "client_relations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "credit_guarantors" ADD CONSTRAINT "credit_guarantors_credit_id_fkey"
  FOREIGN KEY ("credit_id") REFERENCES "credits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "collaterals" ADD CONSTRAINT "collaterals_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "collateral_credits" ADD CONSTRAINT "collateral_credits_collateral_id_fkey"
  FOREIGN KEY ("collateral_id") REFERENCES "collaterals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collateral_credits" ADD CONSTRAINT "collateral_credits_credit_id_fkey"
  FOREIGN KEY ("credit_id") REFERENCES "credits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
