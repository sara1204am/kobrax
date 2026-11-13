# ADR-0003 · Cómo se representa el árbol de oficinas

- Estado: **APROBADA** (alternativa A)
- Quién decide: la usuaria · Fecha de aprobación: 2026-11-02 · Fuente: «confirmo G1 y las 4 decisiones» (decisión D-1 de `discovery/09-brechas.md` §11: extender `branches` con padre y tipo; ruta materializada si el rendimiento lo pide).

## Contexto
Hoy existe `Branch` (`schema.prisma:134`), una lista plana por cuenta con `managerUserId`, sin padre ni tipo. Créditos, rutas y pagos apuntan a ella (`branch_id`), y `user_accounts.branch_id` ubica a cada persona en una sola oficina (único por usuario y cuenta, `schema.prisma:291,304`). — VERIFICADO.

## Problema
Para tener niveles (regional, nacional) hace falta una jerarquía. ¿Se extiende la tabla actual o se crea otra?

## Alternativas consideradas
- A. **Extender `branches`** (padre, tipo, ruta del nodo). Pro: las referencias existentes siguen valiendo; menor superficie de cambio. Contra: mezcla en una tabla oficinas operativas y agrupaciones.
- B. **Tabla nueva de unidades organizacionales** y migrar las referencias. Pro: modelo limpio. Contra: toca todas las tablas y consumidores (ver HUB-001…HUB-024).
- C. **Agrupación sin árbol** (etiqueta de regional en cada agencia). Pro: mínimo. Contra: no admite más de dos niveles ni alcance por subárbol.

## Evidencia
- `branchId`/`branch_id` aparece en 29 archivos de `apps/api/src` (92 apariciones; búsqueda del 2026-10-29 con specs excluidos) — VERIFICADO por conteo; la relevancia de cada archivo NO está verificada hasta G1.
- La unicidad `[userId, accountId]` impone una oficina por persona hoy.
- El código de agencia ya es único entre vivas (migración `20261021110000_branch_code_unique`) — NO VERIFICADO el contenido; solo se vio el nombre.

## Decisión
**Alternativa A: se extiende `branches`** con `parent_id`, `type_id` (catálogo `branch_types` por cuenta, R1) y ruta materializada (`path`, `depth`). Las referencias `branch_id` existentes siguen valiendo. Sin `ltree` (H-08-02): consultas de subárbol por prefijo de `path`. Detalle en `../target/01-modelo-organizacional.md`.

## Consecuencias
Condiciona el diseño de `target/01` y la complejidad de la migración de datos.
