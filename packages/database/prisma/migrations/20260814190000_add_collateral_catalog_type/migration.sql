-- Un tipo de catálogo nuevo: COLLATERAL_TYPE (qué clase de bien es una garantía).
--
-- ⚠️ **Va en una migración PROPIA, sin una sola sentencia más.** `ALTER TYPE ... ADD VALUE` no puede
-- convivir con el uso del valor agregado dentro de la misma transacción, y Prisma envuelve cada
-- migración en una. Metido junto al `CREATE TABLE` de las garantías, la migración falla entera.

ALTER TYPE "CatalogType" ADD VALUE IF NOT EXISTS 'COLLATERAL_TYPE';
