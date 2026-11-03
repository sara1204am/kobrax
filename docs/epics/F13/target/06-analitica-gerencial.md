# Objetivo · 06 · Analítica gerencial

> **Estado: BORRADOR G2 (2026-11-02).** Evidencia: H-02-06, H-05-08, V6 (releído), L-16. Criterio de producto: no reemplazar el core de los bancos; dar resúmenes por nodo (memoria `pitch-bancos-piloto`).

## Pregunta que responde
¿Qué ve cada nivel gerencial y de dónde salen esos datos?

## Hoy
La analítica corre SQL directo sobre `credits`, `payments` y `route_plans` con varias consultas por carga, filtra por `branchId` **solo si se lo pasan** y no aplica el alcance del solicitante: basta `report:read` (MANAGER, SUPERVISOR, AUDITOR, VIEWER) para ver toda la cuenta (B-S7, P0).

## Objetivo
1. **Alcance obligatorio:** cada consulta recibe el `OfficeScope` del solicitante (02). `branchId` pasa a significar «este nodo y su subárbol», acotado por el alcance.
2. **Consolidados por nodo** agregando por prefijo de `path`. Cada nivel (agencia, regional, central) ve su subárbol; la central ve todo.
3. **Dos dimensiones** (D-6): recaudo por *oficina histórica del pago* y cartera/saldo por *oficina actual del crédito*. Un reporte indica cuál usa; mover créditos no reescribe el recaudo pasado.
4. **Rendimiento:** primero consultas con índices `(account_id, branch_id)` y `path`; tablas de resumen por nodo solo si la medición de la fase G lo exige (datos sintéticos). No se construyen por adelantado.
5. Exportes y notificaciones: decidir si respetan el subárbol (desconocido, D-7) antes de migrarlos.

## Impacto por perfil de tenant
| Perfil | Qué cambia | Qué NO debe cambiar | Cómo se comprueba |
|---|---|---|---|
| Gratuito individual | nada: admin ve toda la cuenta | cifras del dashboard | R-1 (cifras idénticas antes/después) |
| Equipo | un supervisor deja de ver toda la cuenta | cifras del admin | R-2, R-4 |
| Grande | consolidados por regional/central | aislamiento | R-3, R-5, prueba de carga |

## Entradas HUB que cambiarían
`analytics.service.ts` (las cinco consultas y el filtro Prisma espejo), `analytics.dto.ts`, dashboard web.
