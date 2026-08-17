-- Qué clase de crédito es. Va en la ficha del cliente, debajo del código: «BLK-002488 · Crédito de
-- consumo».
--
-- POR QUÉ UNA COLUMNA Y NO `metadata`
-- `metadata` guarda lo operativo sin columna propia (cuota congelada, próximo vencimiento, referencia
-- externa). Esto es otra cosa: es **cómo se llama el producto**, se muestra en pantalla al lado del
-- código y es lo primero por lo que una empresa va a querer partir su cartera («consumo» contra
-- «microcrédito»). Un dato que se lee y se va a filtrar es una columna; dentro del JSON sería una
-- consulta incómoda el día que haga falta.
--
-- Sin índice: todavía no se filtra por esto. Cuando se filtre, se agrega — no antes.

ALTER TABLE "credits" ADD COLUMN "type_code" TEXT;
