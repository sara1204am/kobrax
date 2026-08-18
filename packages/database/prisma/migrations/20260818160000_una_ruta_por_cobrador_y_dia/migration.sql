-- Una ruta por cobrador y por día.
--
-- La jornada de una persona es una sola. Sin esta restricción, un doble toque en «generar ruta» o un
-- borrador que se sincroniza dos veces dejan dos rutas del mismo día, y la pantalla del supervisor
-- termina mostrando once rutas de la misma cobradora.
--
-- El índice que había cubría exactamente las mismas columnas, así que el unique lo reemplaza: no
-- hace falta mantener los dos (un unique ya sirve para buscar por esas columnas).

DROP INDEX IF EXISTS "route_plans_account_id_collector_id_planned_date_idx";

CREATE UNIQUE INDEX "route_plans_account_id_collector_id_planned_date_key"
  ON "route_plans" ("account_id", "collector_id", "planned_date");
