-- Prioridad puesta a mano.
--
-- POR QUE UNA COLUMNA Y NO UN FLAG BOOLEANO
-- Guarda CUANDO se fijo, no un si/no. La fecha contesta la pregunta que se hace despues -- "esto lo
-- decidio alguien hace un ano o la semana pasada?" -- y un booleano no. Cuesta lo mismo.
--
-- PARA QUE SIRVE
-- El trabajo diario de mora (modules/arrears) recalcula la prioridad de cada cobranza abierta: sale
-- del saldo, los dias de mora y el riesgo del cliente. Eso esta bien para el caso general y es
-- exactamente lo que falla en el que motivo esta columna: un deudor con dos dias de atraso cae en
-- prioridad baja aunque quien lo conoce sepa que es moroso frecuente y hay que ir hoy.
--
-- Con la fecha puesta, el job SALTEA esa cobranza al recalcular prioridad. Es la misma regla que ya
-- gobierna la mora: cada dato tiene un solo dueno, y el de esta prioridad es la persona que la fijo.
-- Volver a la automatica es poner la columna en NULL.
--
-- Sin indice: no se filtra por esto, se lee junto con la fila. Cuando se filtre, se agrega.

ALTER TABLE "collection_cases" ADD COLUMN "priority_pinned_at" TIMESTAMP(3);