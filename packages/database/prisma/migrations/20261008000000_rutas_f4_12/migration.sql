-- F4/12 · Rutas — autoría, ciclo de vida, ubicación de la parada, visita registrada desde el panel, pago ligado a la
-- visita y pedidos de cambio sobre rutas ajenas.
--
-- Todo es ADITIVO y nullable (o con default): el móvil de hoy sigue funcionando sin tocar nada.

-- ── Ruta: quién la armó y cuándo pasó cada cosa ───────────────────────────────
ALTER TABLE "route_plans"
  ADD COLUMN "created_by" TEXT,
  ADD COLUMN "started_at" TIMESTAMP(3),
  ADD COLUMN "completed_at" TIMESTAMP(3),
  ADD COLUMN "cancelled_at" TIMESTAMP(3),
  ADD COLUMN "status_reason" TEXT;

-- ── Parada: la ubicación concreta (ref suave a client_locations) ──────────────
ALTER TABLE "route_stops" ADD COLUMN "location_id" TEXT;

-- ── Visita: quién la registró, desde dónde y a cuál corrige (sigue siendo inmutable) ──
ALTER TABLE "field_visits"
  ADD COLUMN "registered_by" TEXT,
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'MOBILE',
  ADD COLUMN "corrects_visit_id" TEXT;

-- ── Pago: la visita en la que se cobró (opcional) ─────────────────────────────
ALTER TABLE "payments" ADD COLUMN "visit_id" TEXT;
CREATE INDEX "payments_account_id_visit_id_idx" ON "payments"("account_id", "visit_id");

-- ── Avisos de ruta ────────────────────────────────────────────────────────────
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ROUTE_CHANGE_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ROUTE_CHANGE_DECIDED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ROUTE_CANCELLED';
ALTER TABLE "notifications" ADD COLUMN "route_id" TEXT;

-- ── Pedidos de cambio ─────────────────────────────────────────────────────────
CREATE TYPE "RouteChangeKind" AS ENUM ('ADD_STOP', 'REMOVE_STOP', 'REORDER', 'CANCEL');
CREATE TYPE "RouteChangeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

CREATE TABLE "route_change_requests" (
  "id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "route_id" TEXT NOT NULL,
  "requested_by" TEXT NOT NULL,
  "kind" "RouteChangeKind" NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "reason" TEXT NOT NULL,
  "status" "RouteChangeStatus" NOT NULL DEFAULT 'PENDING',
  "decided_by" TEXT,
  "decided_at" TIMESTAMP(3),
  "decision_note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "route_change_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "route_change_requests_account_id_route_id_status_idx" ON "route_change_requests"("account_id", "route_id", "status");
CREATE INDEX "route_change_requests_account_id_requested_by_idx" ON "route_change_requests"("account_id", "requested_by");

ALTER TABLE "route_change_requests" ADD CONSTRAINT "route_change_requests_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "route_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: igual que el resto de las tablas operativas (ver prisma/rls/001_enable_rls.sql).
ALTER TABLE "route_change_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "route_change_requests" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "route_change_requests";
CREATE POLICY tenant_isolation ON "route_change_requests"
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kobrax_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "route_change_requests" TO kobrax_app;
  END IF;
END $$;
