-- F14 · F2 — clientes vivos SIN oficina de registro tras el backfill de f14_04.
-- Son los que no tienen créditos vivos, o los tienen en varias oficinas (o alguno sin oficina). No es un error: la usuaria decide caso a caso.
-- Los ven ALL/SUBTREE y su creador (`created_by`). Uso: psql "$DATABASE_URL" -f prisma/verify/f14-cliente-registro.sql
SELECT c.account_id,
       c.id AS client_id,
       c.created_by,
       COUNT(cr.id) FILTER (WHERE cr.deleted_at IS NULL)                      AS creditos_vivos,
       COUNT(DISTINCT cr.branch_id) FILTER (WHERE cr.deleted_at IS NULL)       AS oficinas_distintas,
       COUNT(*) FILTER (WHERE cr.deleted_at IS NULL AND cr.branch_id IS NULL)  AS creditos_sin_oficina
FROM clients c
LEFT JOIN credits cr ON cr.client_id = c.id
WHERE c.deleted_at IS NULL AND c.registered_branch_id IS NULL
GROUP BY c.account_id, c.id, c.created_by
ORDER BY c.account_id, creditos_vivos DESC;

-- Resumen por cuenta.
SELECT c.account_id,
       COUNT(*)                                             AS clientes_vivos,
       COUNT(*) FILTER (WHERE c.registered_branch_id IS NULL) AS sin_oficina_de_registro
FROM clients c WHERE c.deleted_at IS NULL GROUP BY c.account_id ORDER BY sin_oficina_de_registro DESC;
