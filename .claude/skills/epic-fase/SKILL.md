---
name: epic-fase
description: Opera una épica grande con arnés (F13 hoy; F14 y futuras) siguiendo docs/epics/_framework. Modos - retomar (carga el contexto mínimo y dice cuál es el siguiente paso autorizado), plan <fase> (crea el plan de fase just-in-time), validar <fase> (gate PASS/FAIL del plan, G4), cerrar <fase> (G7, actualiza HUB/HANDOFF). Nunca avanza de etapa ni de gate sin autorización explícita de la usuaria. Usar con "/epic-fase F13 retomar", "retomá F13", "plan de la fase P1 de F13", "validá el plan", "cerrá la fase". No reemplaza a /f10-etapa ni /f10-validar-plan (esos son del móvil F10).
---

# epic-fase — operar una épica con arnés

**Argumentos:** `<épica> <modo> [fase]`. Épica = `F13` (directorio `docs/epics/<épica>/`). Si falta algo, preguntar.
Protocolo y plantillas: `docs/epics/_framework/README.md` y `TEMPLATES.md`. No duplicar su contenido aquí.

## Modo `retomar` (el predeterminado)
1. Leer, **en este orden y nada más**: `README.md` → `STATUS.md` → `RULES.md` → `HANDOFF.md` → plan vigente en `plans/` (si hay).
2. Reportar en ≤10 líneas: fase vigente, gates, decisiones aprobadas vs pendientes, **siguiente paso autorizado** (el de `HANDOFF`/`STATUS`).
3. Verificar rápido contra el árbol real (`git status`): si hay cambios de producto que `HANDOFF` no menciona → registrar en `execution/INCIDENTS.md` y avisar antes de seguir.
4. Si el «siguiente paso autorizado» es «ninguno», **detenerse** y esperar la orden de la usuaria. No iniciar la etapa siguiente por iniciativa propia.
5. Cargar más documentación solo si la tarea lo pide (un archivo de `discovery/`, un ADR, entradas del HUB).

## Modo `plan <fase>`
Precondición: G3 PASS y fase anterior cerrada (G7). Si no, parar y decirlo.
1. Crear `plans/<fase>-<nombre>.md` con la plantilla T4. Estado inicial: **releer hoy el código** de cada archivo afectado (no copiar de discovery).
2. Consultar `hub/HUB.md` e `IMPACT-MAP.md` para cada archivo; listar IDs HUB afectados.
3. Llenar §8 de la plantilla: perfiles de tenant afectados y cómo se protege el gratuito individual (RULES §C).
4. Iterar con la usuaria hasta darlo por completo. Preguntar lo que falte; no rellenar con supuestos.
5. Dejar `> ESTADO: BORRADOR` hasta pasar `validar`.

## Modo `validar <fase>` (gate G4) — solo lee y reporta
Cada ítem PASS/FAIL con evidencia; un FAIL bloquea.
1. Las 13 secciones de T4 existen y están llenas (sin «TBD»).
2. El estado inicial cita `archivo:línea` y fue releído hoy.
3. Todo archivo afectado tiene entrada HUB consultada; el cambio transversal figura en `IMPACT-MAP`.
4. Las decisiones que sustenta están **APROBADAS** (no PROPUESTA).
5. Respeta `RULES.md` (§A–§D); menciona los IDs que aplican.
6. §8 (perfiles de tenant) presente y con regresión del gratuito individual definida.
7. Pruebas: las existentes y las nuevas; las nuevas **registradas** en el script `test` de su paquete (RULES B12).
8. Rollback descrito; migraciones solo aditivas salvo ADR aprobado.
9. Orden de tareas: datos → API → web → móvil.
10. Si toca móvil: cruce con la alineación en curso registrado (RULES D1).
11. Sin código en el plan, sin dumps ni capturas.
Salida: `VALIDACIÓN PLAN <fase> — PASS|FAIL` con lista de bloqueantes (ítem, qué falta, acción) y advertencias. No aprobar por cansancio.

## Modo `cerrar <fase>` (G5–G7)
1. G5: ejecutar y **pegar salida** en `execution/VERIFICATIONS.md` (comandos de `hub/VERIFICATION-MAP.md`); incluye regresión del perfil gratuito individual.
2. G6: `/code-review` y recorrido de `IMPACT-MAP` por cada entrada HUB tocada.
3. G7: actualizar HUB (cambio realizado, prueba, estado), `PROGRESS`, `STATUS`, `HANDOFF`, `PHASES-LOG`, y los docs de producto afectados (`docs/producto/…`).
4. Marcar cada gate con PASS/FAIL/BLOCKED/NOT_APPLICABLE y justificación. **No** abrir la fase siguiente.

## Flujo de rama (heredado de F10)
Rama `f13/<fase>-<nombre>` desde `main` → construir → verificar → `/code-review` → merge solo con todo verde. Nunca arrastrar cambios ajenos del árbol de trabajo (RULES D2).

## Reglas duras
- **Sin PASS de G4 no se modifica código de producto.**
- Una PROPUESTA de ADR no es una decisión.
- Toda afirmación lleva clase de evidencia; los documentos nunca prueban más que INFERIDO.
- Si doc y código se contradicen: registrar CONTRADICTORIO y resolver antes de seguir.
- Cada transición de gate se confirma con la usuaria (excepción explícita a la regla de mínimo de confirmaciones).
- Al terminar la sesión: reescribir `HANDOFF.md` (plantilla T6) y actualizar `PROGRESS.md`.
