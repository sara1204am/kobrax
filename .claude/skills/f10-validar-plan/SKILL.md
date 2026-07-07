---
name: f10-validar-plan
description: Valida un plan de etapa F10 (docs/epics/F10/plans/PN-*.md) contra el mínimo y la calidad exigidos ANTES de permitir desarrollo. Devuelve PASS o FAIL con motivos accionables. Es el gate que el skill /f10-etapa debe pasar antes de escribir una línea de código. Usar cuando el usuario diga "validá el plan P#", "el plan está listo?", "/f10-validar-plan P#", o cuando /f10-etapa llega al gate de validación.
---

# f10-validar-plan — gate de calidad del plan de etapa

Audita el plan de una etapa F10 y decide si está listo para construir. **No escribe código ni modifica el plan** — solo evalúa y reporta. La corrección la hace `/f10-etapa` (Paso C) re-iterando con el usuario.

**Argumento:** el id de etapa (`P0`…`P10`) o el path del plan. Si no viene, preguntar.

## Qué leer
1. El plan: `docs/epics/F10/plans/PN-*.md`.
2. Contra qué se valida: `docs/epics/F10/BUILD-PLAN.md` (§1 alcance, §3 deltas de contrato, §2 workflow), `BASE-INVENTORY.md`, `ui-screen-map.md` (node-ids/endpoints), `EPIC-F10-app-mobile.md` (DoD §7), y el **código real** cuando haga falta verificar un endpoint/artefacto.

## Checklist de validación (cada ítem PASS/FAIL con evidencia)

**Completitud (las 11 secciones mínimas del plan existen y están llenas):**
1. Objetivo claro.
2. Rama `f10/PN-*` definida.
3. Build 🟢/🔵 correcto según BUILD-PLAN.
4. **Pantallas Figma** con node-ids reales, **confirmadas con el usuario** (no "TBD", no supuestos).
5. **Contrato** con endpoints reales (prefijo `/api`, deltas C1–C5 respetados) + tablas — verificados contra código, no contra el texto viejo del map.
6. **Auditoría de reuso** presente y no vacía: cada capacidad marcada REUSAR/EXTENDER/NUEVO con path.
7. Artefactos NUEVOS: cada uno justificado + con ubicación de reuso (ui.tsx / packages/shared / service), no dentro de una screen si se usa en ≥2.
8. Tareas ordenadas (leer/datos antes que escritura).
9. Reglas de la fase (3 de §3.3 + específicas de la P).
10. DoD con verificación (`type-check` + `jest` + `expo export`) + validación visual usuaria.
11. Riesgos/decisiones abiertas listados (o explícito "ninguno").

**Calidad (más allá de que exista la sección):**
12. **Anti-duplicación:** ningún NUEVO reimplementa algo del BASE-INVENTORY / shared (enums de dominio, tokens, hash, cliente HTTP, sesión, `ListRow`/`StatusBadge`/`BottomSheet`…). Si lo hace → FAIL con el path que debía reusar.
13. **Se apoya en las P previas:** reusa lo que dejaron las etapas anteriores; no re-crea base.
14. **No-negociables** (CLAUDE.md raíz): multi-tenant por capacidad no por `tenantType`; offline-first (acción nunca bloqueada); TS estricto sin `any`; evidencia inmutable/hash sobre original (si la P la toca); `{data,meta,error}`.
15. **Decisiones cerradas respetadas:** KPIs en cliente, 5 tabs Figma, MapLibre, import móvil+web, offline anclado al sync de oficina.
16. **Sin preguntas pendientes sin resolver:** nada crítico marcado "preguntar" quedó sin respuesta del usuario.
17. **Economía de Figma/tokens:** las pantallas se listan por **nombre + node-id** (Figma es la base), el plan **no** tiene screenshots/design-context incrustados, y los pulls quedan diferidos a la construcción (just-in-time por pantalla). Si el plan trae imágenes o dumps de Figma → FAIL (bloat de tokens).

## Salida

Reportar en este formato:

```
VALIDACIÓN PLAN P# — <PASS | FAIL>

FAIL (bloqueantes):
- [#ítem] <qué falta / qué está mal> → <acción concreta para corregir>

Advertencias (no bloquean, mejorar si se puede):
- ...

Veredicto: <PASS = listo para /f10-etapa Paso F> | <FAIL = volver a Paso C, corregir e iterar>
```

- **PASS** solo si TODOS los ítems bloqueantes (1–16) pasan. Una sola falla crítica → **FAIL**.
- Ser concreto: citar el ítem, el path, y la corrección. Nada de "mejorar el plan" genérico.
- No aprobar por cansancio: el gate existe para que el desarrollo arranque sobre un plan sólido y sin duplicación. Ante la duda en un no-negociable o en reuso → FAIL.
