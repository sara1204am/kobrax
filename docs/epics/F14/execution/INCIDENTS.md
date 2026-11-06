# F14 · Incidentes

| Fecha | Qué | Estado |
|---|---|---|
| 2026-11-05 | `route-lifecycle.it.ts` (F4/12) falla con 3 paradas en vez de 2 en la corrida completa de integración. No lo causa F1 (no toca rutas); probable herencia de F13 P2·B6 (`routes/` cambió 2026-11-02, el test es de 2026-10-09). **Sin demostrar contra línea base.** | **RESUELTO 2026-11-05** — causa real: la prueba usa `hoy+5` y el seed deja una visita de Carlos esa semana (depende del día); se corrigió la prueba (V-010). No era de F13 |
| 2026-11-05 | `apps/mobile` no pasa `tsc`: `app/cuenta/datos.tsx` (tipo `AccountForm`). Previo y ajeno a F1. | **RESUELTO 2026-11-05** — `datos.tsx` ahora conserva los campos de contacto (V-011) |
| 2026-11-05 | `prisma generate` no pudo reemplazar el `.dll.node` del motor (procesos `nest start --watch` del usuario lo tienen abierto). Los tipos y el esquema embebido sí se actualizaron; el motor es el mismo (misma versión). Quedaron archivos `query_engine-windows.dll.node.tmp*` en `node_modules/.prisma/client`. | NOTA |
| 2026-11-05 | Se encontró en el árbol de `f14/p2-responsabilidad-alcance` código de producto de F2 **sin commitear y sin mencionar en HANDOFF** (migraciones `f14_04`…`f14_06`, políticas, `tierOf`, `visibleClientIdsSql`, `otherCredits`, permisos nuevos). `tsc` de la API pasa. Faltan specs, integración, web y verificaciones. | NOTA — F2 está en ejecución (tareas 1–6 en su mayoría hechas) |
