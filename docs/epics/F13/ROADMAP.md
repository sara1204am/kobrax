# F13 · ROADMAP global

> ⚠️ **HIPÓTESIS DE TRABAJO — NO APROBADA.** Nace de la conversación del 2026-10-29, antes de Discovery. Se confirma, corrige o reemplaza en **G3**.
> Orden pedido por la usuaria: **DB → API/backend → diseño de entrada por oficina → módulos**. Los planes técnicos se crean al empezar cada fase (`plans/`), no antes.

## Reglas del roadmap
- Cada fase tiene: objetivo · dependencias · entregables · gates (G4–G7) · criterios de aceptación.
- **Criterio transversal de aceptación de toda fase:** regresión del perfil gratuito individual en PASS (RULES §C) y suite del paquete tocado en PASS con salida registrada.
- Nada se construye antes de G3 PASS; ninguna fase empieza sin G4 PASS.

## Etapas de la épica (con gates de épica)
| Etapa | Qué | Sale con | Estado |
|---|---|---|---|
| Arnés | Estructura de trabajo | G0 | PASS (2026-10-29) |
| Discovery | Cómo está construido hoy | G1 | No autorizado |
| Arquitectura | Objetivo + brechas + ADR aprobados | G2 | — |
| Roadmap | Este documento, ya con evidencia | G3 | — |

## Fases de implementación (hipótesis; cada una repite G4→G7)
| Fase | Objetivo (hipótesis) | Depende de | Entregables esperados | Aceptación (a precisar en G3) |
|---|---|---|---|---|
| **P1 · Datos** | Esquema y datos para representar la organización | G3; ADR-0003 y ADR-0004 aprobados | Migraciones **aditivas**, relleno de datos, script `verify/*.sql` | Verificación SQL PASS; ningún consumidor existente roto (HUB) |
| **P2 · API** | Cálculo único del alcance, endpoints de organización, reglas de creación, resúmenes | P1 cerrada | Servicio de alcance; módulos adaptados uno por uno; specs registrados en `test` | Equivalencia con el comportamiento actual en tenants sin jerarquía; aislamiento entre tenants |
| **P3 · Acceso** | Cómo entra una persona por su oficina (selección, sesión, contexto) | P2 | Diseño y contrato de sesión/contexto | Un tenant de una sola oficina no ve cambios |
| **P4 · Web por módulo** | Adaptar Equipo, Cartera, Mora, Rutas, Pagos, Dashboard, Cuenta, Import | P3 | Un módulo por rama | Cada módulo con sus pruebas y regresión individual |
| **P5 · Móvil** | Coordinar con la alineación en curso; aplicar oficina/rol | P3 y estado de la alineación | Contrato y pruebas móviles | Offline intacto |
| **G · Gerencia** | Ingesta desde sistemas externos, resúmenes, prueba de carga | P2 | Contrato de ingesta, resúmenes, informe de rendimiento | Medición con datos sintéticos |

## Entrega a F14 (roles)
F14 arranca con lo que `target/02` y `target/04-05` dejen definido. Ver [`../F14/README.md`](../F14/README.md) y ADR-0002.

## Qué falta para convertir esto en roadmap real
Discovery (G1), arquitectura (G2) y respuestas de la usuaria a las preguntas abiertas de `decisions/DECISIONS.md`.
