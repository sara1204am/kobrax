-- Agenda S5+S6: motivo del desenlace no ejecutado + cadena de reprogramaciones.
-- Una sola columna de motivo: un ítem termina CANCELLED o RESCHEDULED, nunca los dos,
-- y el status dice qué catálogo aplica (CANCEL_REASON / RESCHEDULE_REASON).
ALTER TABLE "agenda_items" ADD COLUMN "reason_code" TEXT;
ALTER TABLE "agenda_items" ADD COLUMN "rescheduled_from_id" TEXT;

-- Sin cambios de RLS: la política de agenda_items ya cubre la tabla entera.
