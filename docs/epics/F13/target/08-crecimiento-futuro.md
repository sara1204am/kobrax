# Objetivo · 08 · Preparación para crecimiento futuro

> **Estado: BORRADOR G2 (2026-11-02).** Evidencia: H-08-02, H-08-06/07, H-gal-08.

## Pregunta que responde
¿Qué queda preparado para crecer y qué no se construye ahora?

## Preparado en F13 (barato y aditivo)
| Qué | Por qué crece bien |
|---|---|
| Árbol con `path` indexado y tipos como catálogo | cualquier profundidad y nombre de nivel sin código nuevo |
| `user_branch_assignments` con `role_id` | F14 asigna roles por oficina sin migrar de nuevo (R8) |
| `OfficeScopeService` único | un solo lugar donde añadir RLS por alcance o contexto de sesión después |
| `payments.branch_id` histórico + dos dimensiones de reporte | reestructurar el árbol sin descuadrar recaudo |
| `branches.external_ref` | ingesta externa por código del banco |
| Permisos `office:*` | delegación a «Administrador de sistemas» (F14) |

## Se construye después, a propósito (no es olvido)
| Qué | Cuándo / por qué |
|---|---|
| JWT/contexto de oficina y selector en el shell | fase de seguridad (A-5, R9) |
| RLS por alcance en la base | fase de seguridad; hoy la API es la única barrera (B-S6) |
| `SUPER_ADMIN` de plataforma y acceso de soporte auditado | fase aparte, plan de migración propio (R11) |
| Vista de **Mapa** de oficinas | Kobrax no tiene mapa web; después |
| Reglas padre/hijo por tipo de oficina | si el negocio las pide |
| Tablas de resumen por nodo, réplicas, cola de trabajos | solo si la medición lo justifica (hoy: un servidor, sin réplica, H-08-06) |
| Almacenamiento S3/R2 (hoy disco local, contradice `CLAUDE.md`, H-08-07) | fuera de F13 |

## Límites de diseño declarados
Profundidad máxima por defecto 8 (guardia técnica). Diseñado para miles de oficinas por cuenta con carga perezosa; **no probado** hasta la prueba de carga con datos sintéticos de la fase G.

## Impacto por perfil de tenant
| Perfil | Qué cambia | Qué NO debe cambiar | Cómo se comprueba |
|---|---|---|---|
| Gratuito individual | nada | — | R-1 |
| Equipo | puede crecer a más oficinas sin migrar | — | R-2 |
| Grande | camino claro a roles, RLS, ingesta | — | planes de fases futuras |

## Entradas HUB que cambiarían
Ninguna adicional.
