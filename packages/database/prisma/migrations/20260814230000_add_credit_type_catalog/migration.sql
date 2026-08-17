-- Un tipo de catálogo nuevo: CREDIT_TYPE (qué clase de crédito es — consumo, microcrédito, vivienda…).
--
-- ⚠️ **Va en una migración PROPIA, sin una sola sentencia más.** `ALTER TYPE ... ADD VALUE` no puede
-- convivir con el uso del valor agregado dentro de la misma transacción, y Prisma envuelve cada
-- migración en una. La columna que lo usa va en la migración siguiente.

ALTER TYPE "CatalogType" ADD VALUE IF NOT EXISTS 'CREDIT_TYPE';
