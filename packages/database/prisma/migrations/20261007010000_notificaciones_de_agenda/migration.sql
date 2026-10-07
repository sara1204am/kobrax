-- F4/11 · Etapa 4 — avisos de agenda.
--
-- Tres tipos nuevos y el enlace a la gestión: con `agenda_item_id` la campanita lleva a la gestión de la que habla el
-- aviso (hasta hoy solo podía hablar de un cliente o un crédito).
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'AGENDA_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'AGENDA_CHANGED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'AGENDA_OVERDUE';

ALTER TABLE "notifications" ADD COLUMN "agenda_item_id" TEXT;
