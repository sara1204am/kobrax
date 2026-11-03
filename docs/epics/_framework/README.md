# Marco de épicas grandes (`_framework`)

> Protocolo común para épicas que cruzan DB, API, web y móvil y duran más de una sesión.
> **No es un framework**: son las reglas que F13 necesitó y que otra épica (p. ej. F14) puede copiar tal cual.
> Nació de F13; si una regla no se usó en una segunda épica, se puede borrar.

## 1. Qué reutiliza (y de dónde) — no se duplica

| Necesidad | Mecanismo que YA existía | Dónde |
|---|---|---|
| Estructura de una épica (10 secciones) | Plantilla de epic | `docs/epics/README.md` |
| Planes por etapa, creados al empezarla | Convención just-in-time | `F10/BUILD-PLAN.md` §1 |
| Gate de plan PASS/FAIL | `f10-validar-plan` (atado al móvil) | `.claude/skills/f10-validar-plan/` |
| Rama + verificación + `/code-review` + merge | Workflow por etapa | `F10/BUILD-PLAN.md` §2 |
| Verificación de datos en DB | Scripts SQL de solo lectura | `packages/database/prisma/verify/*.sql` |
| «El código manda sobre el documento» | Regla de lectura | `docs/producto/README.md` |
| Confirmaciones mínimas | Regla de sesión | `.claude/rules/prompts-confirmation.md` |

Lo único nuevo: clases de evidencia, gates G0–G7, protocolo de contexto, HUB, ADR y el skill genérico `epic-fase`.

## 2. Clases de evidencia (toda afirmación lleva una)

| Clase | Significa | Exige |
|---|---|---|
| **VERIFICADO** | Se leyó el código o se ejecutó algo en esa sesión | `archivo:línea` (o comando + resultado) + fecha |
| **INFERIDO** | Se deduce de otra cosa verificada, o viene de un documento | Qué se infirió y de qué |
| **NO VERIFICADO** | Se vio mencionado (grep, doc, nombre de archivo) pero no se leyó | Dónde se vio |
| **DESCONOCIDO** | No se sabe; hay que averiguarlo | Pregunta concreta y quién la responde |
| **CONTRADICTORIO** | Dos fuentes dicen cosas distintas | Ambas fuentes; se resuelve antes de seguir |

Reglas: un documento nunca da más que INFERIDO. Una hipótesis jamás se escribe como funcionalidad existente. Una propuesta de la IA no es una decisión aprobada (ver ADR).

## 3. Protocolo de contexto entre sesiones

Lectura **obligatoria y pequeña**, en este orden: `README` → `STATUS` → `RULES` → `HANDOFF` → plan vigente (si existe).
Después, solo lo que la tarea pida (un archivo de discovery, un ADR, las entradas del HUB afectadas).
Los documentos **no sustituyen** leer el código. Si doc y código se contradicen: se anota en `discovery/09-brechas.md` como CONTRADICTORIO y se resuelve antes de continuar.

## 4. Gates (vocabulario común)

Cada gate vale **PASS · FAIL · BLOCKED · NOT_APPLICABLE**, siempre con justificación y evidencia. Terminar una tarea nunca abre el siguiente gate: lo abre la autorización explícita de la usuaria.

| Gate | Pregunta que responde |
|---|---|
| G0 | ¿El arnés está completo y validado? |
| G1 | ¿Discovery completo y evidenciado? |
| G2 | ¿Arquitectura objetivo documentada y contrastada con lo actual? |
| G3 | ¿Roadmap, dependencias y planes de fase aprobados? |
| G4 | ¿Plan específico de la fase aprobado antes de tocar código? |
| G5 | ¿Verificación funcional, técnica, de seguridad y regresión? |
| G6 | ¿Code review e impacto transversal revisados? |
| G7 | ¿Cierre documental: HUB y HANDOFF al día? |

G4–G7 se repiten **por fase**; G0–G3 son de la épica.

## 5. Cómo instanciar una épica nueva

1. Copiar el esqueleto de `docs/epics/F13/` (carpetas `discovery/ target/ decisions/ hub/ plans/ execution/` y los 6 archivos de control).
2. Reemplazar identidad, gates y reglas propias; **borrar** el contenido de F13 (no heredar sus hallazgos).
3. Registrar la épica en `docs/epics/README.md` y crear `EPIC-Fxx-*.md` con la plantilla de 10 secciones.
4. Invocar `/epic-fase Fxx retomar`.
5. Plantillas de ADR, plan, hallazgo, fila HUB y bloque de handoff: [`TEMPLATES.md`](./TEMPLATES.md).

## 6. Antipatrones

- Escribir un plan de fase antes de que Discovery y Arquitectura estén cerrados.
- Marcar una verificación como exitosa sin su salida pegada.
- Cambiar un punto transversal sin haber consultado el HUB.
- Dar por aprobado algo que solo propuso la IA.
- Avanzar de etapa «porque ya se terminó la anterior».
