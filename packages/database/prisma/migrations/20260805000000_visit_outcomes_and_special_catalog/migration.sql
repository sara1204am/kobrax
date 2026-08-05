-- Rutas S5 (RT-6): valores de enum nuevos, SOLOS en su migración.
--
-- Postgres no deja usar un valor agregado con `ALTER TYPE ... ADD VALUE` dentro de la misma
-- transacción que lo agregó, y Prisma corre cada migración en una transacción. Si esto viajara
-- junto con la columna que lo usa, la migración fallaría. Mismo motivo por el que
-- `20260711000000_add_whatsapp_template_catalog` va sola.

-- Dirección incorrecta: la dirección no corresponde. Distinto de NOT_FOUND, que es "fui y no estaba".
ALTER TYPE "VisitOutcome" ADD VALUE IF NOT EXISTS 'WRONG_ADDRESS';

-- Gestión especial: fallecimiento, enfermedad grave, etc. La categoría concreta va en `details`.
ALTER TYPE "VisitOutcome" ADD VALUE IF NOT EXISTS 'SPECIAL';

-- Catálogo (por tenant) de esas categorías especiales.
ALTER TYPE "CatalogType" ADD VALUE IF NOT EXISTS 'SPECIAL_CATEGORY';
