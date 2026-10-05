-- Central de Mora (F4/07 · T1): índice para listar y ordenar créditos por días de mora.
-- Sólo un índice: no cambia columnas ni datos. Idempotente.
--
-- `GET /mora` ordena por `credits.days_past_due` (default, descendente) con el filtro `dpd >= 1`.
-- Sin este índice el listado recorre y ordena todos los créditos del tenant (≈300 mil en la base de
-- desarrollo). El orden de las columnas es el del `ORDER BY` de la consulta: tenant, días de mora
-- descendente, id (el desempate que evita que LIMIT/OFFSET repita o saltee filas entre páginas).
--
-- 🔴 Es un índice **parcial sólo por `deleted_at IS NULL`**, que la consulta escribe como literal y por
-- eso el planificador lo puede usar. Un parcial por `days_past_due > 0` NO serviría: la consulta manda
-- el piso como parámetro (`>= $n`) y Postgres no puede demostrar que implica `> 0`.
--
-- `CREATE INDEX` sin CONCURRENTLY porque Prisma corre cada migración en una transacción. Sobre una tabla
-- muy grande toma un lock de escritura mientras se construye: aplicarla en una ventana tranquila.
CREATE INDEX IF NOT EXISTS "credits_account_dpd_idx"
  ON "credits" ("account_id", "days_past_due" DESC, "id")
  WHERE "deleted_at" IS NULL;
