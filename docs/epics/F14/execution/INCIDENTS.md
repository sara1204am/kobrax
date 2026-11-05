# F14 · Incidentes

| Fecha | Qué | Estado |
|---|---|---|
| 2026-11-05 | `route-lifecycle.it.ts` (F4/12) falla con 3 paradas en vez de 2 en la corrida completa de integración. No lo causa F1 (no toca rutas); probable herencia de F13 P2·B6 (`routes/` cambió 2026-11-02, el test es de 2026-10-09). **Sin demostrar contra línea base.** | ABIERTO — decidir si se corrige en F1 o se registra en F13 |
| 2026-11-05 | `apps/mobile` no pasa `tsc`: `app/cuenta/datos.tsx` (tipo `AccountForm`). Previo y ajeno a F1. | ABIERTO |
| 2026-11-05 | `prisma generate` no pudo reemplazar el `.dll.node` del motor (procesos `nest start --watch` del usuario lo tienen abierto). Los tipos y el esquema embebido sí se actualizaron; el motor es el mismo (misma versión). Quedaron archivos `query_engine-windows.dll.node.tmp*` en `node_modules/.prisma/client`. | NOTA |
