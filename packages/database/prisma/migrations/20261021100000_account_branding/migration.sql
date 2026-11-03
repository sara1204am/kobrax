-- Refactor de Cuenta · F4 — identidad y contacto del negocio.
-- Aditiva: seis columnas opcionales en `accounts`. La RLS (`tenant_self`) y los permisos de la tabla ya las cubren.
ALTER TABLE "accounts"
  ADD COLUMN "logo_url" TEXT,
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "email" TEXT,
  ADD COLUMN "website" TEXT,
  ADD COLUMN "address" TEXT,
  ADD COLUMN "city" TEXT;
