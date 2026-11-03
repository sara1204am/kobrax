# F13 · STATUS

> Única fuente del estado real. Si otro archivo lo contradice, manda este y se corrige el otro.
> Última actualización: **2026-10-29**.

## Fase vigente
**Arnés (G0) — creado y auto-validado.** Siguiente etapa: Discovery (G1), **todavía no autorizada**.

## Gates de la épica

| Gate | Estado | Justificación / evidencia | Fecha |
|---|---|---|---|
| G0 Arnés completo y validado | **PASS** | Estructura creada; validación en `execution/VERIFICATIONS.md` (V-001…V-004): enlaces resueltos, README ≤60 líneas, sin contradicciones entre RULES/GATES/STATUS, mapa de «dónde responder» cubre el criterio de éxito. La usuaria aún no lo ha revisado. | 2026-10-29 |
| G1 Discovery completo | **PASS (confirmado por la usuaria, 2026-11-02)** | Archivos `00…10` completos; `09-brechas.md` consolidado. **Salvedad registrada:** las filas de `hub/HUB.md` siguen `SEMBRADO` (el criterio de G1 pedía `VERIFICADO`); se verifican por entrada al planear cada fase (A4). Hallazgos de agentes sin recontrastar están marcados; los críticos fueron releídos (09 §1). | 2026-11-02 |
| G2 Arquitectura objetivo | **EN CURSO (borrador)** | `target/01…09` escritos. Falta: aprobar ADR-0002 y ADR-0004 (propuestas con decisión recomendada), mapa `09-brechas` ↔ `target`, revisión de la usuaria. | 2026-11-02 |
| G3 Roadmap y planes aprobados | NOT STARTED | Depende de G2. `ROADMAP.md` es hoy solo hipótesis. | — |
| G4–G7 | NOT STARTED | Son por fase; no existe ninguna fase aprobada. | — |

Vocabulario: PASS · FAIL · BLOCKED · NOT_APPLICABLE · (NOT STARTED = aún no se evalúa).

## Autorizaciones vigentes
| Puede hacerse | No puede hacerse |
|---|---|
| Crear y editar documentación bajo `docs/epics/_framework/`, `docs/epics/F13/`, `docs/epics/F14/` y el skill `.claude/skills/epic-fase/` | Modificar código de producto, `schema.prisma`, migraciones, API, web, móvil, infraestructura |
| Leer cualquier archivo del repo (solo lectura) | Empezar Discovery sin autorización |
| Actualizar el índice `docs/epics/README.md` | Dar por aprobada una PROPUESTA de ADR |

## Decisiones (resumen; detalle en `decisions/DECISIONS.md`)
- Aprobada: ADR-0001 (F13 absorbe F3; el número F13 se mantiene).
- Propuestas sin aprobar: ADR-0002 (frontera F13/F14), ADR-0003 (representación del árbol), ADR-0004 (tenant sin jerarquía).

## Bloqueos y preguntas abiertas
- Respondidas el 2026-11-02 las 3 preguntas de niveles/pertenencia/creación (ver `decisions/DECISIONS.md`, R1–R5). 2026-11-02 (2.ª ronda): solo el super admin crea oficinas a cualquier nivel (R5); F13 es base de roles y permisos (R6); referencia UI en `C:\Tutator\gallium-10` (R2). Sin preguntas abiertas de esas tres.
- Autorización para iniciar Discovery.
- Estado de la alineación móvil↔web (`../F10/plans/alineacion-web/README.md`, ronda 3): F13 y F14 deben coordinarse con ella antes de tocar el móvil.
- Los cuatro puntos del handoff anterior siguen DESCONOCIDOS: si `Role.level` se usa, si analítica se protege con `report:read`, si el JWT/sesión móvil expone `branch_id`, si hay policies RLS por alcance fuera de `prisma/rls/`.

## Trabajo ajeno en el árbol (no es de F13)
La rama `feat/cuenta-refactor` tiene cambios sin confirmar de otra tarea (cuenta/facturación). El arnés no los toca ni los incluye en ningún commit de F13.
