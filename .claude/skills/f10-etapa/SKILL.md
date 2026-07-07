---
name: f10-etapa
description: Crea y arranca una etapa (P0–P10) del build de F10 App Mobile siguiendo docs/epics/F10/BUILD-PLAN.md. Redacta el plan ITERANDO con el usuario hasta darlo por completo, con contenido mínimo obligatorio; PREGUNTA cuando falta un dato (node-id, endpoint, decisión de diseño, dep nueva); hace auditoría de reuso contra BASE-INVENTORY para no construir dos veces; el plan debe pasar el gate /f10-validar-plan (PASS) antes de tocar código; soporta pausar/retomar rápido (flag "pause"); y aplica el workflow de rama+revisión (main siempre limpio). Usar cuando el usuario diga "creá P#", "arrancá la etapa P#", "plan de P#", "/f10-etapa P#", "pausá P#", o quiera construir la siguiente etapa del móvil.
---

# f10-etapa — crear/arrancar una etapa del build móvil F10

Objetivo: convertir una fila del [BUILD-PLAN](../../docs/epics/F10/BUILD-PLAN.md) en un **plan ejecutable** y luego construirlo, **reusando al máximo la base ya creada** y sin ensuciar `main`.

**Argumento:** el id de etapa (`P0`…`P10`). Si no viene, preguntar cuál. Una invocación = una etapa.

Los principios NO-NEGOCIABLES del `CLAUDE.md` raíz (multi-tenant, offline-first, TS estricto sin `any`, evidencia inmutable, `{data,meta,error}`) y la mentalidad ponytail (reuso antes que código nuevo) aplican en todo momento.

---

## Paso A — Cargar contexto (siempre, antes de nada)

Leer, en este orden:
1. `docs/epics/F10/BUILD-PLAN.md` → la **fila de esta P** (alcance, build 🟢/🔵, deps, deltas de contrato §3).
2. `docs/epics/F10/plans/BASE-INVENTORY.md` → qué existe ya para reusar.
3. `docs/epics/F10/ui-screen-map.md` §4 → las **pantallas Figma** de esta etapa (node-ids) + endpoint + tabla.
4. `docs/epics/EPIC-F10-app-mobile.md` → la historia/DoD de la slice correspondiente.
5. Si ya existe `docs/epics/F10/plans/PN-*.md`, **continuar** ese plan, no recrearlo.

No inventar nada que no esté en estos docs o en el código. Ver Paso E (preguntar).

---

## Paso B — Auditoría de reuso (anti-duplicación) — OBLIGATORIA

Antes de proponer un solo artefacto nuevo, armar la tabla de reuso:

1. Listar las **capacidades** que la etapa necesita (ej.: badge de estado, fila de caso, input de monto, llamar `GET /cases`, store de conectividad, hash SHA-256…).
2. Para cada una, buscar si ya existe: leer BASE-INVENTORY **y** `grep` real en `apps/mobile/src`, `apps/mobile/app`, `packages/shared`. El código manda sobre el índice.
3. Clasificar cada capacidad:
   - **REUSAR** → path exacto del artefacto existente (lo más común; preferir siempre esto).
   - **EXTENDER** → existe algo cercano; se le agrega una prop/variante en su archivo actual (NO se copia).
   - **NUEVO** → no existe nada reusable. Solo permitido si: (a) se justifica en una línea, y (b) **se ubica para reuso futuro** (regla abajo).

**Regla de ubicación (dónde vive lo nuevo):**
- UI usada por ≥2 pantallas → `apps/mobile/src/ui.tsx` (no dentro de una screen).
- Tipo / enum / constante / util de **dominio** → `packages/shared` (NUNCA redefinir en el móvil `CaseStatus`, transiciones, montos, hashes…).
- Lógica de datos / red / store → un `*.service.ts` / store Zustand en `src/`, no dentro del componente.
- Algo de un solo uso y local a una screen → puede vivir en la screen.

Todo artefacto NUEVO reusable se **agrega a BASE-INVENTORY** al cerrar la etapa (Paso F).

---

## Paso C — Redactar el plan `docs/epics/F10/plans/PN-<nombre>.md` (ITERATIVO con el usuario)

El plan **no se escribe de una y se ejecuta**. Se redacta un borrador, se muestra al usuario, y se **itera en rondas** (modificar secciones, confirmar/ajustar las pantallas y el alcance, agregar lo que falte) hasta que el usuario lo dé por completo. Cada ronda: aplicar cambios al archivo, resumir qué cambió, y preguntar qué más falta. **No se pasa a construir mientras el usuario tenga ajustes.**

**Contenido MÍNIMO obligatorio** (si un ítem no se puede completar con los docs/código → Paso E, preguntar; no rellenar con supuestos):

1. **Objetivo** — 1–2 frases.
2. **Rama** — `f10/PN-<nombre>` (kebab).
3. **Build** — 🟢 Expo Go / 🔵 dev build (según BUILD-PLAN).
4. **Pantallas Figma** — el diseño **base es Figma** (file `daLWsKQGC4Sd1NacU9fmrP`); cada pantalla se referencia por su **node-id** del ui-screen-map. En el plan van la lista de pantallas (nombre + node-id) que la etapa cubre. **NO se hacen pulls de Figma en la planificación** — ver "Economía de Figma/tokens" abajo.
5. **Contrato** — endpoints reales (con prefijo `/api`, deltas C1–C5 del BUILD-PLAN si aplican) + tablas que toca. KPIs/estado offline según decisiones cerradas (KPIs en cliente, etc.).
6. **Auditoría de reuso** — la tabla del Paso B (capacidad → REUSAR/EXTENDER/NUEVO + path). Es la sección que evita construir dos veces; sin ella el plan no está completo.
7. **Artefactos nuevos** — solo los justificados, cada uno con su ubicación de reuso.
8. **Tareas** — checklist ordenada (leer/datos antes que escritura).
9. **Reglas de la fase** — las 3 de §3.3 del epic (sol→contraste; gama baja→perf en UI thread; animación con propósito) + las específicas de la etapa (§ "Reglas por fase" abajo).
10. **DoD** — funcional + verificación (`type-check` + `jest` + `expo export`) + validación visual por la usuaria. Reusar los DoD del epic §7.
11. **Riesgos / decisiones abiertas** — lo que quede por confirmar.

---

### Economía de Figma / tokens (regla transversal)

El diseño base es Figma, pero traerlo cuesta tokens (sobre todo `get_screenshot`, que son imágenes). Disciplina:
- **Planificación (Paso C): CERO pulls de Figma.** Se trabaja solo con los **node-ids + nombres** del ui-screen-map (texto barato). Las pantallas se confirman con el usuario **por lista de texto** (nombre + node-id), nunca renderizando screenshots.
- **Construcción (Paso F): pull just-in-time, de a UNA pantalla,** la que se está por implementar. Preferir `get_design_context` (estructurado, más barato) y recurrir a `get_screenshot` **solo** si hace falta detalle visual que el context no da. No re-pullear lo ya traído; no traer las ~32 de una.
- Nunca volcar screenshots/design-context completos a la conversación "por las dudas". Se trae lo mínimo del nodo que se va a construir.

## Paso D — CONFIRMAR puntos clave (parte de la iteración)

Durante las rondas del Paso C, confirmar explícitamente con el usuario:
- alcance y **pantallas** de la etapa (confirmarlas, no asumirlas),
- **decisiones de reuso** (sobre todo cada artefacto NUEVO y cada EXTENDER),
- **deps nuevas a instalar** (ej. Reanimated/haptics/FlashList en P1; MapLibre en P7),
- contrato de endpoints/tablas,
- cualquier decisión abierta del Paso C.

Obligatorio **después de crear P0 y en cada P siguiente**. Usar `AskUserQuestion` cuando haya bifurcaciones reales; si es solo confirmación, pedir OK explícito.

## Paso E-bis — GATE de validación (obligatorio, antes de cualquier código)

Cuando el usuario da el plan por completo, correr el skill **`/f10-validar-plan P#`**. Ese skill audita el plan contra el mínimo y la calidad (reuso, contrato real, pantallas confirmadas, DoD, no-negociables) y devuelve **PASS** o **FAIL** con motivos.

- **FAIL** → volver al Paso C, corregir lo señalado, re-iterar con el usuario, y re-validar. **No se escribe una línea de código.**
- **PASS** → recién ahí se habilita el Paso F (desarrollo).

El desarrollo (rama + código) **no arranca nunca** sin un PASS del validador.

---

## Paso E — Preguntar cuando falta (no inventar)

Disparar una pregunta (`AskUserQuestion`) si falta cualquiera de estos y no está en docs/código:
- un **node-id** de pantalla o su diseño no es claro,
- un **endpoint/campo** de contrato ambiguo o no verificado,
- una **decisión de producto** no cerrada (revisar las 5 decisiones + BUILD-PLAN antes de preguntar),
- una **dep/clave nueva** (librería, API key, tile source, push, pins),
- un choque con un principio no-negociable.

Regla: preguntar barato ahora < reconstruir después.

---

## Paso F — Implementar, verificar, cerrar (workflow de BUILD-PLAN §2)

> **Precondición dura:** solo se entra acá con **PASS** del Paso E-bis. Sin PASS, no hay rama ni código.

1. `git checkout -b f10/PN-<nombre>`.
2. Construir según el plan, **reusando** lo del Paso B. Cada P se apoya en la base de las P previas. Pull de Figma **just-in-time por pantalla** (ver "Economía de Figma/tokens"): `get_design_context` del node-id que toca, screenshot solo si hace falta.
3. Verificar (la app no corre headless): `pnpm --filter @kobrax/mobile type-check` + `test` + `npx expo export --platform android`.
4. Revisar: `/code-review` (correctitud) + `/ponytail-review` (bloat). Aplicar findings, re-verificar.
5. Handoff visual a la usuaria (emulador / gama baja).
6. Merge a `main` solo con 3+4+5 verdes; borrar la rama.
7. **Actualizar** `BASE-INVENTORY.md` (artefactos nuevos), el estado de la etapa en `BUILD-PLAN.md`, y la memoria de proyecto.

---

## Pausar / retomar el plan (rápido)

El borrador de un plan puede quedar a medio armar entre sesiones. Mecanismo liviano (el archivo `plans/PN-*.md` **ES** el estado; solo hace falta un puntero):

**Pausar** — el usuario dice "pausá", "dejalo así", "seguimos después" o `/f10-etapa P# pause`:
1. Asegurar que el borrador esté guardado con un encabezado al tope:
   `> **ESTADO: EN BORRADOR — ronda N (YYYY-MM-DD). NO construir hasta PASS.**`
   seguido de `## ⏸️ Pendiente de confirmar` con el checklist de lo que falta cerrar.
2. Escribir/actualizar **un renglón** en `MEMORY.md` (auto-memoria): `- P# plan EN BORRADOR — pendiente: <2-3 ítems> — retomar con /f10-etapa P#`.
   Eso es todo. Nada de docs largos: rápido, para no cortar el ritmo.

**Retomar** — al invocar `/f10-etapa P#`, si el plan tiene el encabezado `EN BORRADOR`: leer su `## ⏸️ Pendiente de confirmar`, retomar la iteración (Paso C) desde ahí, y quitar el encabezado recién cuando el usuario lo dé por completo y pase el validador.

## Reglas por fase (específicas, se suman a las 3 de §3.3)

- **P0 Fundación** — parity `theme.ts` ↔ `packages/shared/design/tokens.ts` (no divergir colores). `apiClient` = **extender `src/api.ts`** (refresh 401 + Bearer desde SecureStore), no crear otro cliente. `OfflineIndicator` con Zustand + NetInfo, **informativo, nunca bloquea**. Instalar Reanimated/haptics/FlashList acá solo si P1 arranca enseguida.
- **P1 Home+Agenda** — solo lectura. KPIs **en cliente** (decisión cerrada). Listas con **FlashList** (no FlatList). `CaseCard`/`StopRow` → NUEVOS en `ui.tsx` sobre `ListRow`+`StatusBadge` existentes (extender, no duplicar). Estados loading/empty/error obligatorios (`EmptyState` existe).
- **P2 Gestiones** — escritura. Validar transición con `CASE_TRANSITIONS` de shared (no hardcodear). Acciones en `BottomSheet` existente. Optimistic en memoria; la cola real llega en P6 (dejar el service preparado para enchufarla).
- **P3 Rutas (sin mapa)** — lifecycle de ruta + lista de paradas reusando `ListRow`/`StatusBadge`. Nada de mapa acá (eso es P7 🔵).
- **P4 Pagos** — `AmountInput` NUEVO en `ui.tsx`. Idempotencia por header `Idempotency-Key` → `payments.idempotencyKey` (NO `reference`). Monto validado en cliente (no negativo/≤ saldo) **y** servidor.
- **P5 Import móvil** — reusar `POST /api/clients/imports` (`mode` + `dryRun`). Dejar constancia: el import **web** admin no existe (gap F9/F3), no construirlo acá salvo pedido.
- **P6 Offline/Sync 🔵** — dev build + WatermelonDB (schema espejo del subset) + `sync.service`. **Retro-encaje**: enchufar la cola en los services de P1–P5 sin reescribirlos. Tablas append-only (activities/visits/evidences/payments) → solo INSERT local.
- **P7 Mapas 🔵** — MapLibre (offline packs). Requiere tile source (preguntar clave si falta).
- **P8 Evidencia 🔵** — SHA-256 sobre **buffer original antes de comprimir** (usar `hash.utils` de shared). Foto ≤ 800 KB. GPS obligatorio. Evidencia inmutable (sin update/delete local).
- **P9 Push/pinning 🔵** — token push + `collector.location` (solo al room del propio tenant) + pins SPKI reales.
- **P10 RBAC gating 🔵** — encender por capacidad/rol (`permissions` de shared), nunca por `tenantType`. Cablear los guards que se construyeron "encendidos".

---

## Anti-patrones (rechazar)

- Redefinir en el móvil un enum/tipo/constante que ya está en `packages/shared`.
- Copiar un componente/estilo entre screens en vez de subirlo a `ui.tsx`.
- Un segundo cliente HTTP / segundo store de sesión / segundo helper de hash.
- Ramificar por `tenantType` (deuda prohibida) en vez de por capacidad.
- Empezar a codear sin **PASS del validador** (`/f10-validar-plan`), o con la tabla de reuso (Paso B) vacía.
- Escribir el plan de una y arrancar: falta la iteración con el usuario (Paso C) hasta darlo por completo.
- Mergear a `main` sin verificación + revisión verdes.
