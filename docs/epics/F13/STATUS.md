# F13 · STATUS

> Única fuente del estado real. Si otro archivo lo contradice, manda este y se corrige el otro.
> Última actualización: **2026-10-29**.

## Fase vigente
**Construcción P1–P4 hecha y verificada en ramas locales (sin push). Cerrada con salvedades (G7).** Rama de integración `f13/multi-oficina` = `f13/p4-movil`. Código en el worktree `C:\Startup Kobrax\kobrax-f13-web`.

## Gates de la épica

| Gate | Estado | Justificación / evidencia | Fecha |
|---|---|---|---|
| G0 Arnés completo y validado | **PASS** | Estructura creada; validación en `execution/VERIFICATIONS.md` (V-001…V-004): enlaces resueltos, README ≤60 líneas, sin contradicciones entre RULES/GATES/STATUS, mapa de «dónde responder» cubre el criterio de éxito. La usuaria aún no lo ha revisado. | 2026-10-29 |
| G1 Discovery completo | **PASS (confirmado por la usuaria, 2026-11-02)** | Archivos `00…10` completos; `09-brechas.md` consolidado. **Salvedad registrada:** las filas de `hub/HUB.md` siguen `SEMBRADO` (el criterio de G1 pedía `VERIFICADO`); se verifican por entrada al planear cada fase (A4). Hallazgos de agentes sin recontrastar están marcados; los críticos fueron releídos (09 §1). | 2026-11-02 |
| G2 Arquitectura objetivo | **PASS por delegación (2026-11-02)** | `target/01…09` escritos y revisados por una revisión independiente (Fable, 2026-11-02) que pidió cambios ya incorporados a ADR-0002/0004 y `target/01,03`. ADR-0003 y ADR-0004 APROBADAS por la usuaria; ADR-0002 adoptada por delegación («empieza con todas las fases hasta el final»), junto con R13, D-5 y AUDITOR/VIEWER (revisables). | 2026-11-02 |
| G3 Roadmap y planes aprobados | **PASS por delegación (2026-11-02)** | Fases P1–P4 ejecutadas siguiendo `discovery/09-brechas.md` §10; los planes por fase se materializaron como briefings a agentes (no como `plans/*.md` T4): **desviación del marco**, ver «Desviaciones». | 2026-11-02 |
| G4 Plan de fase | **DESVIADO** | No se escribieron `plans/P*.md` (T4) ni se corrió `/epic-fase validar`; el plan de cada fase fue el briefing al agente, basado en `target/` y `09-brechas`. La usuaria delegó la ejecución completa. | 2026-11-02 |
| G5 Verificación | **PASS con salvedades** | Evidencia real en `execution/VERIFICATIONS.md`: API 1816/1816 (base 1732), integración 158/158, shared 465/465, móvil 977/977 (= base), web 7 fallos = los 7 preexistentes. **Salvedades:** sin navegador real, sin prueba de carga, migración sin probar sobre copia de producción. | 2026-11-03 |
| G6 Revisión y transversal | **PASS** | Revisión independiente (Fable) del diff completo: 0 P0; P1 (alta de crédito sin oficina, alcance de `GET /credits/:id`) y P2 corregidos o documentados como limitación conocida. Verificado de nuevo por el coordinador tras las correcciones (VERIFICATIONS). | 2026-11-03 |
| G7 Cierre | **PASS con salvedades** | `HANDOFF`, `STATUS`, `VERIFICATIONS`, docs de producto actualizados. Salvedades: HUB/IMPACT-MAP no actualizados entrada por entrada (desviación registrada); UI no vista en navegador real; migración no probada sobre copia de producción. | 2026-11-03 |

Vocabulario: PASS · FAIL · BLOCKED · NOT_APPLICABLE · (NOT STARTED = aún no se evalúa).

## Autorizaciones vigentes
| Puede hacerse | No puede hacerse |
|---|---|
| Construir P1–P4 y tocar el móvil si hace falta (delegación de la usuaria, 2026-11-02) | Push, PR o merge a `main` sin orden de la usuaria |
| Probar en las bases `kobrax_f13` / `kobrax_it` | Tocar la base de desarrollo `kobrax` o los servidores de la usuaria |

## Decisiones (resumen; detalle en `decisions/DECISIONS.md`)
- Aprobadas: ADR-0001, ADR-0003, ADR-0004 (revisada). Adoptada por delegación: ADR-0002. Requisitos R1–R15 y restricciones A-1…A-10 en `decisions/DECISIONS.md`.
- Adoptadas por la IA sin respuesta explícita (revisables): R13 (MANAGER = `data:scope:subtree`, asignado a la raíz), D-5 (reasignación masiva), AUDITOR/VIEWER con alcance total.

## Bloqueos y preguntas abiertas (para la usuaria)
- **El MANAGER no se puede invitar ni asignar por la API** (`isMobileRole`, `users.service.ts:146,235`): R13 («MANAGER → raíz») solo se cumple por migración/seed. Crear un gerente regional nuevo exige levantar esa restricción, que es de roles (F14). Decidir si se adelanta.
- **ENTERPRISE `branches = 100`** es un piso provisional (la grilla dice «a medida»). Confirmar el número.
- **Supervisor sin `office:read`:** no ve los selectores de oficina en Cartera/Dashboard (Mora tiene respaldo). Propuesta: darle `office:read` acotado a su alcance. Decidir.
- **Importación:** sin oficina deducible usa la de quien importa; si tampoco hay, 422. Confirmar.
- **Pagos en analítica** para SUPERVISOR/SUBTREE: oficina histórica del pago en su subárbol o créditos propios. Confirmar.
- **Antes de desplegar:** correr las migraciones sobre una copia de producción y revisar `verify/oficinas-arbol.sql`.

## Desviaciones del marco (registradas, no ocultas)
- No hay `plans/P*.md` (T4) ni `/epic-fase validar`: G4 desviado por delegación (ver tabla).
- `execution/PHASES-LOG.md`, `HUB` e `IMPACT-MAP` no se actualizaron entrada por entrada; las filas HUB siguen `SEMBRADO` salvo lo anotado en `execution/VERIFICATIONS.md`. Pendiente de G7.
- Dos agentes trabajaron en ramas/worktrees aparte (`f13/p2-alcance`, `f13/p3-web`) y se integraron por merge en `f13/p4-movil`.

## Trabajo ajeno (no es de F13)
Los 7 fallos de web y los 2 errores de type-check del móvil (`app/cuenta/datos.tsx`) son preexistentes (D-8) y no se tocaron.
