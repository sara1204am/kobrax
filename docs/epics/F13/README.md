# EPIC-F13 · Organización multi-oficina — punto de entrada

> Lee solo esto primero. Es corto a propósito. Protocolo común: [`../_framework/README.md`](../_framework/README.md).

## Qué es F13
Hacer que Kobrax funcione para una organización con **varios niveles de oficina** (hoy se estudia: Nacional → Regional → Agencia),
sin romper a quien hoy trabaja con una sola oficina o solo. Absorbe lo que F3 diferido tenía de «Identidad y Organización»
([ADR-0001](./decisions/ADR-0001-f13-absorbe-f3.md)). Los roles y permisos finos son la épica siguiente: [F14](../F14/README.md).

## Dos requisitos de la usuaria (2026-10-29) que mandan sobre todo lo demás
1. **Escalar hacia el tenant más grande** (banco con regionales y agencias) sin rediseñar después.
2. **El tenant gratuito individual sigue trabajando tranquilo**: nada nuevo que configurar, ver ni pagar. Ver [`RULES.md`](./RULES.md) §C.

## Estado en una línea
Fase vigente y gates: [`STATUS.md`](./STATUS.md). Hoy: **arnés creado; Discovery NO iniciado; no se toca código de producto.**

## Lectura obligatoria al abrir una sesión (en este orden)
1. `README.md` (este) → 2. [`STATUS.md`](./STATUS.md) → 3. [`RULES.md`](./RULES.md) → 4. [`HANDOFF.md`](./HANDOFF.md) → 5. plan vigente en [`plans/`](./plans/) si existe.
Después, **solo lo que la tarea pida**. Antes de cambiar algo transversal: [`hub/HUB.md`](./hub/HUB.md).

## Mapa
| Carpeta / archivo | Para qué |
|---|---|
| [`STATUS`](./STATUS.md) · [`PROGRESS`](./PROGRESS.md) · [`HANDOFF`](./HANDOFF.md) · [`GATES`](./GATES.md) | Control y continuidad |
| [`discovery/`](./discovery/README.md) | Cómo está construido hoy, con evidencia |
| [`target/`](./target/README.md) | Arquitectura objetivo (se escribe DESPUÉS de discovery) |
| [`decisions/`](./decisions/DECISIONS.md) | ADR: propuestas vs aprobadas |
| [`hub/`](./hub/HUB.md) | Puntos de integración, mapa de impacto y de verificación |
| [`ROADMAP.md`](./ROADMAP.md) · [`plans/`](./plans/README.md) | Fases globales · plan por fase (just-in-time) |
| [`execution/`](./execution/README.md) | Fases ejecutadas, verificaciones, regresiones, incidencias, release |

## Dónde responder cada pregunta
| Pregunta | Mirar |
|---|---|
| ¿Qué es F13 y en qué fase estamos? | este README + `STATUS` |
| ¿Qué reglas aplican? | `RULES` |
| ¿Qué está decidido y qué no? | `decisions/DECISIONS.md` |
| ¿Dónde está la evidencia del estado actual? | `discovery/` |
| ¿Qué depende de X? | `hub/HUB.md`, `hub/IMPACT-MAP.md` |
| ¿Qué puedo modificar ya? | `STATUS` → «Autorizaciones vigentes» |
| ¿Cómo verifico? | `hub/VERIFICATION-MAP.md` |
| ¿Cómo sigo donde se quedó la sesión anterior? | `HANDOFF` |

## Límites duros
- Sin PASS de G4 **no se modifica** código de producto, Prisma, migraciones, API, web, móvil ni infraestructura.
- Avanzar de etapa (arnés → discovery → arquitectura → implementación) exige autorización explícita de la usuaria.
- Skill: `/epic-fase F13 retomar | plan <fase> | validar <fase> | cerrar <fase>`.
