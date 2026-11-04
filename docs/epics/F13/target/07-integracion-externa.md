# Objetivo · 07 · Integración con sistemas externos

> **Estado: BORRADOR G2 (2026-11-02).** Evidencia: H-06-01, H-06-07, L-15. Criterio: Kobrax convive con el core del banco, no lo reemplaza.

## Pregunta que responde
¿Cómo entra la cartera desde sistemas externos sin sustituirlos?

## Hoy
Un único canal: archivo (`imports/portfolio`). `CreditDataOrigin.API` está reservado y ningún código lo escribe. No hay claves de máquina, colas ni `@Cron`; los trabajos periódicos son `setInterval` y CLI (H-06-10). El import de clientes (CSV) es aparte y sin oficina (H-06-07).

## Objetivo en F13 (solo lo necesario para no cerrar la puerta)
- La importación por archivo resuelve la oficina con la regla de 03 y por **código de oficina** (`code`, ya único entre vivas).
- Se reserva `external_ref` (nulable, único por cuenta) en `branches` para mapear el id de la oficina en el sistema del banco. Es aditivo y no se usa aún.

## Fuera de F13 (fase G, con plan propio)
Ingesta por API con claves por cuenta, idempotencia por referencia externa, cola con reintentos, trazabilidad por origen (`CreditDataOrigin.API`) y prueba de carga. Se diseña recién cuando exista el árbol y el alcance.

## Impacto por perfil de tenant
| Perfil | Qué cambia | Qué NO debe cambiar | Cómo se comprueba |
|---|---|---|---|
| Gratuito individual | nada | importar un archivo | R-1, R-7 |
| Equipo | el archivo puede traer «Agencia» y se valida | corridas existentes | R-7 |
| Grande | base para ingesta por API (después) | — | fase G |

## Entradas HUB que cambiarían
`portfolio-import.service.ts`, `portfolio-credit.ts`, import web y móvil.
