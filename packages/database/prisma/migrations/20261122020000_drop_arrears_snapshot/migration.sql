-- F17 · F0b — se elimina la foto `arrears` (DESTRUCTIVA, autorizada por la usuaria).
--
-- POR QUÉ: era un derivado sin valor propio. `recalculate` la borraba y la reescribía en cada pasada; sus columnas `interest` y `penalty` salían de
-- tasas inventadas que ya valen 0 (F0) y la mora real vive en `credits.days_past_due`, `credit_arrear_episodes` y, con política sellada, en el libro del
-- interés moratorio (`payment_applications.component = LATE_INTEREST`). Ningún cliente (web ni móvil) leía la tabla; sólo la ficha del crédito la serializaba.
-- NO se pierde ningún HECHO: todo lo que contenía se recalcula de las cuotas.
--
-- ROLLBACK (la estructura, no las filas, que se regeneran con `recalculate`): ver 20260616022844_init_pillars_1_to_4 (tabla, índice y FK de `arrears`).

DROP TABLE "arrears";
