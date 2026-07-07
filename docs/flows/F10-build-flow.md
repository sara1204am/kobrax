# Flujo de construcción F10 — skills `f10-etapa` + `f10-validar-plan`

> Cómo se construye la App Mobile (EPIC F10), etapa por etapa, con dos skills que garantizan
> **planes completos, sin duplicación, y validados antes de escribir código**. `main` siempre queda limpio.
>
> Los skills viven en `.claude/skills/` (versionados en el repo). Este doc explica **qué son y cómo usarlos**.

---

## 1. El flujo de un vistazo

```
              ┌─────────────────────────────────────────────────────────────┐
              │  /f10-etapa P#                                               │
              │                                                             │
  usuario ──▶ │  A. cargar contexto  (BUILD-PLAN · BASE-INVENTORY · map)    │
              │  B. auditoría de reuso  (REUSAR / EXTENDER / NUEVO)         │
              │  C. redactar plan  ◀───────┐  ITERAR con el usuario         │
              │  D. confirmar puntos clave │  (modificar, confirmar vistas)  │
              │  E. preguntar si falta ────┘  hasta darlo por COMPLETO       │
              └───────────────┬─────────────────────────────────────────────┘
                              │  plan completo
                              ▼
              ┌─────────────────────────────────────────────────────────────┐
              │  /f10-validar-plan P#   ── GATE ──▶  PASS / FAIL             │
              └───────────────┬─────────────────────────────┬───────────────┘
                     FAIL ◀───┘ (volver a C, corregir)      │ PASS
                                                            ▼
              ┌─────────────────────────────────────────────────────────────┐
              │  /f10-etapa P#  · Paso F:  rama → construir → verificar      │
              │  → /code-review + /ponytail-review → visual → merge a main   │
              │  → actualizar BASE-INVENTORY + BUILD-PLAN + memoria          │
              └─────────────────────────────────────────────────────────────┘
```

**Regla dura: el desarrollo NO arranca sin un PASS del validador.**

---

## 2. Los dos skills

### `/f10-etapa P#` — crear y arrancar una etapa
Convierte una fila del [BUILD-PLAN](../epics/F10/BUILD-PLAN.md) en un plan ejecutable y luego lo construye.

- **Argumento:** el id de etapa (`P0`…`P10`). Una invocación = una etapa.
- **Redacta el plan iterando con vos** (Paso C): borrador → mostrar → ajustar/confirmar pantallas → repetir hasta que lo des por completo. No arranca a codear con ajustes pendientes.
- **Auditoría de reuso obligatoria** (Paso B): antes de proponer algo nuevo, revisa [`BASE-INVENTORY.md`](../epics/F10/plans/BASE-INVENTORY.md) + `grep` real y clasifica cada capacidad en **REUSAR / EXTENDER / NUEVO**. Lo NUEVO solo si nada reusable existe, y se ubica para reuso futuro.
- **Pregunta cuando falta** (Paso E): node-id, endpoint/campo, decisión de producto, dep/clave nueva. No inventa.
- **Gate** (Paso E-bis): corre `/f10-validar-plan`. Sin PASS, no hay código.
- **Construye** (Paso F): rama `f10/PN-*` → verifica (`type-check`+`jest`+`expo export`) → `/code-review`+`/ponytail-review` → validación visual tuya → merge → actualiza inventario/estado/memoria.

### `/f10-validar-plan P#` — el gate PASS/FAIL
Audita el plan contra 16 ítems (11 de completitud + 5 de calidad: anti-duplicación, apoyo en P previas, no-negociables, decisiones cerradas, sin preguntas pendientes). **No escribe código ni edita el plan** — solo evalúa y reporta motivos accionables. Una sola falla crítica → **FAIL**.

---

## 3. Cómo se usa (paso a paso típico)

```
1. /f10-etapa P0
     → arma el borrador del plan, te muestra alcance + pantallas + tabla de reuso
2. iterás:  "cambiá esto", "esta pantalla va también", "confirmo el contrato"
     → el skill edita docs/epics/F10/plans/P0-*.md en cada ronda
3. cuando decís "listo":
     → corre /f10-validar-plan P0
        · FAIL → te dice qué corregir; volvés al punto 2
        · PASS → habilitado para construir
4. /f10-etapa P0  (Paso F)  → rama, código, verificación, review, merge
```

Para las siguientes etapas: igual, pero el Paso B **reusa lo que dejaron las P anteriores** (por eso el inventario).

### Pausar y retomar (rápido)
- **Pausar:** "pausá" / "dejalo así" / `/f10-etapa P# pause`. El borrador queda con un encabezado `ESTADO: EN BORRADOR` + checklist `⏸️ Pendiente de confirmar`, y un renglón en `MEMORY.md`. Proceso liviano, no corta el ritmo.
- **Retomar:** `/f10-etapa P#` detecta el borrador y sigue la iteración desde lo pendiente.

---

## 4. Contenido mínimo de un plan (`plans/PN-*.md`)

Si un ítem no se puede completar con docs/código, el skill **pregunta** (no rellena con supuestos):

1. Objetivo · 2. Rama `f10/PN-*` · 3. Build 🟢/🔵 · 4. **Pantallas Figma** (node-ids, confirmadas) ·
5. **Contrato** (endpoints reales con `/api` + tablas, deltas C1–C5) · 6. **Auditoría de reuso** (tabla) ·
7. Artefactos nuevos (justificados + ubicación) · 8. Tareas ordenadas · 9. Reglas de fase ·
10. DoD (verificación + visual) · 11. Riesgos/decisiones abiertas.

### Figma es la base — y cómo se consume sin quemar tokens
El diseño de referencia es el **Figma "Kobrax movil"** (file `daLWsKQGC4Sd1NacU9fmrP`); cada pantalla se identifica por su **node-id**, ya mapeado en [`ui-screen-map.md`](../epics/F10/ui-screen-map.md) junto con su endpoint y su tabla. El plan solo **lista** las pantallas (nombre + node-id); no incrusta diseños.

Los pulls de Figma cuestan tokens (sobre todo `get_screenshot`, que son imágenes), así que:
- **En la planificación: cero pulls.** Se trabaja con node-ids + nombres (texto barato) y se confirman las pantallas **por lista**, sin renderizar screenshots.
- **En la construcción: pull just-in-time, de a una pantalla** (la que se está por implementar), preferiendo `get_design_context` (estructurado, más barato) y usando `get_screenshot` solo si falta detalle visual. No se traen las ~32 de una ni se re-pullea lo ya traído.

---

## 5. Anti-duplicación — el inventario

[`docs/epics/F10/plans/BASE-INVENTORY.md`](../epics/F10/plans/BASE-INVENTORY.md) es el índice vivo de todo lo reusable: enums/tokens/utils de `packages/shared`, la fundación UI (`ui.tsx`), cliente HTTP (`api.ts`), servicios de sesión/auth, etc. El skill lo **lee** en el Paso B y lo **actualiza** al cerrar cada etapa.

**Regla de oro:** algo usado en ≥2 lugares vive ahí y se importa — nunca se copia ni se re-implementa. Ubicación de lo nuevo: UI→`ui.tsx`, dominio (tipos/enums/util)→`packages/shared`, datos/red/store→`*.service.ts`.

---

## 6. Workflow de rama (main siempre limpio)

`main` solo recibe etapas **verdes y revisadas**:
```
rama f10/PN-* → construir → type-check + jest + expo export
→ /code-review + /ponytail-review (aplicar findings, re-verificar)
→ validación visual de la usuaria (la app no corre headless)
→ merge solo con todo verde; borrar la rama
```
No se inventan agentes/skills nuevos para revisar: se usan los del repo (`/code-review`, `/simplify`, `/verify`, `/ponytail-review`).

---

## 7. Mapa de archivos

| Qué | Dónde |
|---|---|
| Skill crear/arrancar etapa | `.claude/skills/f10-etapa/SKILL.md` |
| Skill validar plan (gate) | `.claude/skills/f10-validar-plan/SKILL.md` |
| Orden + workflow + auditoría de consistencia | `docs/epics/F10/BUILD-PLAN.md` |
| Inventario anti-duplicación | `docs/epics/F10/plans/BASE-INVENTORY.md` |
| Planes por etapa (JIT) | `docs/epics/F10/plans/PN-*.md` |
| Pantallas Figma → endpoint → DB | `docs/epics/F10/ui-screen-map.md` |
| Qué/por qué por slice | `docs/epics/EPIC-F10-app-mobile.md` |
| Este flujo | `docs/flows/F10-build-flow.md` |
