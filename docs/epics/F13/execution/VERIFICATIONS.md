# F13 · Verificaciones

> Plantilla T5. **Sin salida pegada, la fila no cuenta.** Todas las verificaciones de G0 son de solo lectura sobre la documentación; no se ejecutó código de producto.
> Script usado: `check_harness.py` (en el directorio temporal de la sesión; no forma parte del repo).

| ID | Fecha | Fase | Qué se verificó | Comando | Resultado | PASS/FAIL |
|---|---|---|---|---|---|---|
| V-001 | 2026-10-29 | Arnés | Todo enlace relativo de los documentos nuevos resuelve | `python -I check_harness.py` | 1.ª corrida: `files: 48 links checked: 87 broken: 1` (`execution/README.md → ./VERIFICATIONS.md`, aún no creado). Corregido creando este archivo. 2.ª corrida: ver V-001b | PASS tras corrección |
| V-001b | 2026-10-29 | Arnés | Reverificación de enlaces | idem | `files: 49 links checked: 87 broken: 0` | PASS |
| V-002 | 2026-10-29 | Arnés | `F13/README.md` ≤ 60 líneas (lectura inicial pequeña) | idem | `F13 README lines: 47 (<=60: True)` | PASS |
| V-003 | 2026-10-29 | Arnés | Sin instrucciones contradictorias entre STATUS / HANDOFF / GATES / RULES / DECISIONS / ADR | `python -I check_harness.py` (sección Consistencia) + lectura | `ADR-0001: header=APROBADA index_match=True` · ADR-0002/0003/0004: `PROPUESTA`, `index_match=True` · `STATUS dice Discovery sin autorizar: True` · `HANDOFF siguiente paso = ninguno: True` · `ROADMAP marcado hipotesis: True` | PASS |
| V-004 | 2026-10-29 | Arnés | Una sesión nueva puede responder el criterio de éxito leyendo solo README → STATUS → RULES → HANDOFF | ver tabla siguiente | Cada pregunta tiene su archivo y existe | PASS |

## V-004 · Criterio de éxito → dónde se responde
| Debe poder… | Archivo |
|---|---|
| Entender qué es F13 y su objetivo | `README.md` («Qué es F13»), `../EPIC-F13-…md` §2 |
| Identificar la fase vigente | `STATUS.md` («Fase vigente») |
| Leer las reglas aplicables | `RULES.md` |
| Recuperar decisiones aprobadas | `decisions/DECISIONS.md` |
| Encontrar evidencia del estado actual | `discovery/` (hoy `00-leads.md`; Discovery no iniciado) |
| Consultar dependencias | `hub/HUB.md`, `hub/IMPACT-MAP.md` |
| Saber qué puede y qué no modificar | `STATUS.md` («Autorizaciones vigentes») |
| Ejecutar un plan de fase | `plans/README.md` + skill `/epic-fase` |
| Verificar resultados | `hub/VERIFICATION-MAP.md`, este archivo |
| Actualizar documentación y entregar contexto | `GATES.md` G7, `HANDOFF.md`, `_framework/TEMPLATES.md` T6 |

## V-005 · El arnés no tocó código de producto
`git status --porcelain` (2026-10-29): rutas del arnés = `docs/epics/README.md` (modificado) y nuevos `.claude/skills/epic-fase/`, `docs/epics/EPIC-F13-…md`, `docs/epics/F13/`, `docs/epics/F14/`, `docs/epics/_framework/`. Los demás archivos modificados (`apps/…`, `packages/…`) **ya estaban modificados por otro trabajo** de la rama `feat/cuenta-refactor` y no son de F13. Resultado: PASS (cero archivos de producto de F13).

## Limitaciones de esta validación
- El skill `epic-fase` no se ha invocado nunca; solo se comprobó que sus rutas existen. Su primera ejecución real será `retomar`.
- No se probó con una sesión realmente nueva: V-004 es una verificación de cobertura documental, no una simulación.
- Las clases de evidencia del HUB y de `00-leads.md` se asignaron a partir de lo leído el 2026-10-29; no se releyó el código para esta validación.
