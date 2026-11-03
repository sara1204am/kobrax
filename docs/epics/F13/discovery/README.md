# F13 · Discovery — cómo está construido hoy

> **Estado: NO INICIADO.** Se abre solo con G0 PASS + autorización explícita de la usuaria. Aquí **no se propone solución ni se edita código**.

## Método
1. Un archivo por área (`00…09`). Cada hallazgo usa la plantilla T1 de `../../_framework/TEMPLATES.md` con su clase de evidencia y `archivo:línea`.
2. Se lee el código; los documentos solo sirven para contrastar (y dar CONTRADICTORIO si difieren).
3. Cada hallazgo que toca un punto de integración se enlaza a su fila del HUB, y esa fila pasa de `SEMBRADO` a `VERIFICADO <fecha>` con consumidores y dependencias llenos.
4. Cada hallazgo se mira con la **lente de tenant** (gratuito individual / equipo / grande).
5. Las pistas de `00-leads.md` se resuelven una por una: confirmada, refutada o DESCONOCIDA.
6. `09-brechas.md` se completa al final.

## Archivos
| # | Archivo | Área |
|---|---|---|
| 00 | [inventario](./00-inventario.md) · [leads](./00-leads.md) | Inventario general · pistas previas (no es discovery) |
| 01 | [modelo-datos](./01-modelo-datos.md) | Esquema, RLS, migraciones, datos |
| 02 | [backend-api](./02-backend-api.md) | Módulos, endpoints, alcance, analítica |
| 03 | [web](./03-web.md) | Panel web |
| 04 | [movil](./04-movil.md) | App móvil y desfase con la web |
| 05 | [seguridad-autorizacion](./05-seguridad-autorizacion.md) | Roles, permisos, token, RLS |
| 06 | [sync-importacion](./06-sync-importacion.md) | Import, datos externos, sync móvil |
| 07 | [tests-calidad](./07-tests-calidad.md) | Pruebas y verificaciones |
| 08 | [dependencias](./08-dependencias.md) | Infra, planes, terceros |
| 09 | [brechas](./09-brechas.md) | Actual vs requerido; contradicciones; desconocidos |

## Cierre (G1)
Ver `../GATES.md` → G1.
