-- Agenda S4: plantillas de mensaje de WhatsApp como catálogo configurable por tenant.
-- `ALTER TYPE ... ADD VALUE` no puede correr dentro de una transacción con otros cambios en PG,
-- por eso esta migración lleva SOLO el nuevo valor de enum (el seed carga las 3 plantillas demo).
-- Se aplica con `prisma migrate deploy` (no `dev`): la shadow DB choca con las policies RLS del módulo.
ALTER TYPE "CatalogType" ADD VALUE IF NOT EXISTS 'WHATSAPP_TEMPLATE';
