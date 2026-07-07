# F10 · Plan de Construcción — orden, workflow y estado del ecosistema

> **Doc maestro operativo de F10.** El [EPIC](../EPIC-F10-app-mobile.md) dice *qué* y *por qué*;
> el [ui-screen-map](./ui-screen-map.md) mapea las ~32 pantallas Figma → endpoint → DB.
> **Este doc dice en qué ORDEN se construye, CÓMO (rama + revisión por etapa) y qué falta del ecosistema.**
> Última auditoría de consistencia: **2026-07-03** (backend/db/vistas verificados contra código real).

---

## 1. Orden de construcción (una etapa = un plan = una rama)

Racional (confirmado en [ui-screen-map §7](./ui-screen-map.md)): **leer antes de escribir · deps baratas primero · nativo (mapas/cámara/offline) al final en dev build.** El offline **no** va primero: la UI se construye online y los services se estructuran para enchufar WatermelonDB en su etapa (decisión §0 del ui-screen-map).

| Etapa | Plan | Build | Alcance | Depende de |
|---|---|---|---|---|
| **P0** | `plans/P0-fundacion.md` | 🟢 | Tokens parity (shared↔`theme.ts`), `components/ui` (Header/StatusBadge/ListRow/BottomSheet ✅ hoy), tabs ✅ hoy, **`apiClient` + NetInfo + `OfflineIndicator` (Zustand)**, install Reanimated/haptics/FlashList | — |
| **P1** | `plans/P1-home-agenda.md` | 🟢 | Home + Agenda (solo lectura): `GET routes/cases/notifications`, KPIs en cliente, FlashList | P0 |
| **P2** | `plans/P2-gestiones.md` | 🟢 | Gestiones (escritura online): `POST activities`, transiciones, promesa, BottomSheet de acciones | P1 |
| **P3** | `plans/P3-rutas.md` | 🟢 | Rutas sin mapa: lifecycle, lista de paradas, confirmar/iniciar, resumen jornada | P1 |
| **P4** | `plans/P4-pagos.md` | 🟢 | Pago en campo: `POST /payments` idempotente, `payment-requests`, `AmountInput` | P2 |
| **P5** | `plans/P5-import-movil.md` | 🟢 | Import móvil (perfil independiente): bulk + carga rápida. **Gap web: ver §4** | P1 |
| — | — | 🔵 | **⟰ Frontera dev build (`expo prebuild`) ⟱** | — |
| **P6** | `plans/P6-offline-sync.md` | 🔵 | Dev build + WatermelonDB (schema espejo) + `SyncService` (FIFO/backoff/conflictos); **retro-encaje** en los services de P1–P5 | P0–P5 |
| **P7** | `plans/P7-mapas.md` | 🔵 | MapLibre online+offline (packs región); vistas de mapa de Rutas | P3, P6 |
| **P8** | `plans/P8-evidencia.md` | 🔵 | Cámara + GPS + firma + **SHA-256 sobre buffer original**; `evidence.service` | P6 |
| **P9** | `plans/P9-push-pinning.md` | 🔵 | Push (asignaciones) + `collector.location` + **SSL pinning con pins reales** | P6 |
| **P10** | `plans/P10-rbac-gating.md` | 🔵 | Gating por capacidad/rol (F3): cobrador vs supervisor; capacidad `clients.import` | F3 |

> **Convención de planes:** un archivo `plans/PN-*.md` por etapa, **creado just-in-time al empezarla** (no se scaffoldean los 11 de una: las etapas tardías se afinan con lo aprendido). Cada plan lleva: objetivo, pantallas Figma que cubre (node-ids del ui-screen-map), endpoints/tablas que toca, auditoría de reuso, checklist de tareas, reglas de fase, DoD y **rama**.
> **Cómo se crea/valida (skills):** `/f10-etapa P#` redacta el plan **iterando con el usuario** (modificar, confirmar pantallas) hasta darlo por completo, reusando `BASE-INVENTORY.md` para no duplicar. Antes de tocar código pasa por `/f10-validar-plan P#` (gate **PASS/FAIL**). **Sin PASS no arranca el desarrollo.**
> **Figma es la base, con economía de tokens:** cada pantalla se referencia por **node-id** del ui-screen-map; los planes solo **listan** pantallas (nombre + node-id), sin diseños incrustados. **Cero pulls de Figma en la planificación**; el pull (`get_design_context`, screenshot solo si hace falta) es **just-in-time por pantalla en la construcción**. Nunca traer las ~32 de una.
> **P0 y parte de Slice 0 ya están hechos** (tabs + fundación UI, sesión de hoy). P0 se cierra con apiClient + OfflineIndicator.

---

## 2. Workflow por etapa — dev siempre limpio

**Regla:** `main` solo recibe etapas **verdes y revisadas**. Nada se mezcla a medias.

```
1. rama         git checkout -b f10/PN-nombre         (ej. f10/P1-home-agenda)
2. construir    seguir plans/PN-*.md
3. verificar    pnpm --filter @kobrax/mobile type-check   (tsc)
                pnpm --filter @kobrax/mobile test         (jest-expo)
                cd apps/mobile; npx expo export --platform android   (bundle Metro)
4. revisar      /code-review        (correctitud)
                /ponytail-review    (sobre-ingeniería / bloat)
                — aplicar findings, re-verificar —
5. visual       la usuaria valida en emulador/gama baja (la app no corre headless)
6. merge        a main solo con 3+4+5 en verde; borrar la rama
```

- **No se inventan agentes ni skills nuevos:** el repo ya trae `/code-review`, `/simplify`, `/verify`, `/ponytail-review`. Eso ES la "regla de revisión".
- **Verificación mobile** (no corre headless): siempre `type-check` + `jest` + `expo export`. La validación visual/hardware la hace la usuaria (ver [[kobrax-mobile-verify-limits]]).
- **DoD hardware** (§3.3 epic): una pantalla núcleo (pago o lista) a 60 fps y arranque < 2 s en Android barato **antes de escalar** el resto.

---

## 3. Consistencia del ecosistema — auditoría 2026-07-03 ✅

Verificado contra código real (no asumido). **Backend y DB cubren F10 al 100%**: los 23 endpoints y los 16 modelos que el diseño consume **existen**. Deltas de contrato a respetar al construir:

| # | Delta | Realidad (fuente de verdad) | Acción |
|---|---|---|---|
| C1 | Prefijo `/api` | `app.setGlobalPrefix('api')` (main.ts). El móvil ya usa base `…:4010/api` (`api.ts`) | ✅ ya OK, no tocar |
| C2 | Visitas | Controlador en `@Controller('visits')` → **`/api/visits`** y `/api/visits/:id/evidence`. **`/field-visits` NO existe** | Usar `/visits` (map ya corregido) |
| C3 | Idempotencia de pago | `payments.idempotencyKey` (`@@unique([accountId, idempotencyKey])`). **No hay `payments.reference`** (`reference` vive en `payment_requests`) | Sync/mobile mapea a `idempotencyKey`; header `Idempotency-Key` |
| C4 | Import | `POST /api/clients/imports` con `mode: RECONCILE\|UPSERT_ONLY\|REPLACE` + flag `dryRun` (booleano, no un "modo") | Contrato de P5 |
| C5 | FK evidencia | Schema real: `field_evidences.visitId → field_visits`. `packages/database/CLAUDE.md` dice `activityId → activities` (**desactualizado**) | Schema manda; corregir ese CLAUDE.md cuando se toque P8 |

Notas de sync (relevantes para P6): `case_activities`, `field_visits`, `field_evidences`, `payments` son **append-only** (sin `updatedAt`/`deletedAt`) → el cliente solo INSERTA, nunca UPDATE local hacia esas tablas. Las 14 tablas llevan `accountId` (multi-tenant OK).

---

## 4. Vistas faltantes — constancia (qué falta y cuándo)

### Móvil (`apps/mobile`)
- **Auth:** ✅ completo (login/mfa/setup/select/forgot/unlock/biometric/force-change/offline).
- **Shell de campo:** ✅ 5 tabs + fundación UI (hoy). Inicio con datos **dummy**; Agenda/Rutas/Cobranza son **placeholders**.
- **De campo (real): 0 de ~32 construidas.** Se construyen en su etapa (col. "cuándo" = la P# de §1):
  - HOME (2 pantallas) → **P1** · AGENDA+GESTIONES+NOTIF (13) → **P1/P2** · RUTAS sin mapa (7) → **P3**, con mapa (6) → **P7** · PAGO (2) → **P4** · IMPORT (9) → **P5**.
  - Detalle node-id por pantalla: [ui-screen-map §4](./ui-screen-map.md).

### Web (`apps/web`) — lo que F10 asume del lado admin
- ✅ **Panel F9 existe** (base que F10 da por sentada): `/panel/{clients,credits,cases}` (lista + detalle), settings, auth.
- ❌ **IMPORT web (admin multiusuario) NO existe.** F10 §4.1 define un perfil "empresa mediana/grande" que carga datos desde **web (admin) → baja al móvil**. Ese módulo web (`/panel/import` o similar) **está completamente sin construir**, y su **gating por capacidad `clients.import`** (F3) tampoco.
  - **Cuándo:** es F9/F3, **fuera del alcance móvil de F10**. Se deja en constancia aquí para que no se pierda. El endpoint backend (`POST /clients/imports`) ya existe → es solo UI web. Sugerencia: engancharlo cuando se retome F9 o junto a **P5** si se quiere paridad import móvil↔web en la misma pasada.

---

## 5. Índice rápido

- Qué/por qué por slice → [`EPIC-F10-app-mobile.md`](../EPIC-F10-app-mobile.md)
- Pantallas Figma → endpoint → DB → [`ui-screen-map.md`](./ui-screen-map.md)
- Orden + workflow + gaps (este doc) → estado vivo; actualizar §3/§4 tras cada auditoría.
- Handoff de sesión → [`docs/HANDOFF.md`](../../HANDOFF.md)
