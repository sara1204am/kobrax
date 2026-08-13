-- Índices de cobertura para el dashboard (W8).
--
-- Las seis agregaciones no buscan una fila: **recorren la cartera entera del tenant** para sumarla.
-- Con 1600 créditos eso es un Seq Scan de 10 ms y no se nota; el problema es que crece lineal, y un
-- tenant con 100.000 créditos multiplica eso por 60 en cada una de las seis consultas de la
-- pantalla.
--
-- `INCLUDE` es lo que cambia el juego: mete en el índice las columnas que la consulta suma, así
-- PostgreSQL puede resolverla con un **index-only scan** y no tocar la tabla ni una vez. Sin las
-- columnas incluidas, el índice sólo sirve para encontrar las filas y después hay que ir a leerlas
-- igual — que es justo el trabajo caro.
--
-- ⚠️ Van sin `CONCURRENTLY` a propósito: Prisma corre cada migración dentro de una transacción y
-- `CREATE INDEX CONCURRENTLY` no puede vivir ahí. En una base con tráfico real, estos tres se crean
-- a mano con `CONCURRENTLY` fuera de la migración; con las tablas de hoy tardan milisegundos.

-- Saldo total y saldo en mora: los dos KPI de plata y el gráfico de tramos salen de acá.
CREATE INDEX IF NOT EXISTS idx_credits_analytics
  ON credits (account_id, status)
  INCLUDE (outstanding_balance, days_past_due)
  WHERE deleted_at IS NULL;

-- Lo recaudado por período y por persona: el KPI, el ranking y la línea de evolución.
CREATE INDEX IF NOT EXISTS idx_payments_analytics
  ON payments (account_id, payment_date)
  INCLUDE (amount, registered_by);

-- La agenda del período. El índice que ya existe lleva `assignee_id` en el medio, así que **no
-- sirve para un rango de fechas sin cobrador** — que es justo como abre el dashboard.
CREATE INDEX IF NOT EXISTS idx_agenda_analytics
  ON agenda_items (account_id, scheduled_date)
  INCLUDE (type, status)
  WHERE deleted_at IS NULL;
