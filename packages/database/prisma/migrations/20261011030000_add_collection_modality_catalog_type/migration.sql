-- Un tipo de catálogo nuevo: COLLECTION_MODALITY (cómo conviene cobrarle). F4/13 · capa de datos para la IA.
--
-- ⚠️ **Va en una migración PROPIA, sin una sola sentencia más.** `ALTER TYPE ... ADD VALUE` no puede
-- convivir con el uso del valor agregado dentro de la misma transacción, y Prisma envuelve cada
-- migración en una.

ALTER TYPE "CatalogType" ADD VALUE IF NOT EXISTS 'COLLECTION_MODALITY';
