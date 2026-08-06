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
| **P1.b** | `plans/agenda/` | 🟢 | **Agenda pivotada a módulo propio** (agendados por fecha): fundación + S1–S6, un plan por pantalla | P0 |
| **P2+P4** | `plans/cartera/` | 🟢 | **Módulo CARTERA (Clientes y Préstamos)** — [spec](../../flows/Cliente_Prestamo.pdf). Absorbe gestiones **y** pagos: la ficha de cobranza (V4) *es* la pantalla de gestión y de pago. Incluye alta cliente+préstamo (3 modos de captura), lista de cartera, y el módulo `uploads` (fotos, hash SHA-256) que P8 reusa | P1 |
| **P3** | `plans/P3-rutas.md` | 🟢 | Rutas sin mapa: lifecycle, lista de paradas, confirmar/iniciar, resumen jornada | P1 |
| **P5** | `plans/P5-import-movil.md` | 🟢 | Import móvil (perfil independiente): bulk + carga rápida. **Gap web: ver §4** | P1 |
| — | — | 🔵 | **⟰ Frontera dev build (`expo prebuild`) ⟱** | — |
| **P6** | `plans/P6-offline-sync.md` | 🔵 | Dev build + WatermelonDB (schema espejo) + `SyncService` (FIFO/backoff/conflictos); **retro-encaje** en los services de P1–P5 | P0–P5 |
| **P7** | `plans/P7-mapas.md` | 🔵 | MapLibre online+offline (packs región); vistas de mapa de Rutas | P3, P6 |
| **P8** | `plans/P8-evidencia.md` | 🔵 | Cámara + GPS + firma + **SHA-256 sobre buffer original**; `evidence.service`. **Reusa el módulo `uploads` que construye Cartera** (subida + hash); le agrega GPS y el vínculo a `field_evidences` | P6, Cartera |
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

## 5. 🔜 ORDEN DE TRABAJO ACORDADO (2026-08-06) — empezar por acá

> **Esta es la cola vigente.** Decidida con la usuaria el 2026-08-06, después de cerrar los módulos
> Cartera / Agenda / Rutas / Import / Cuenta y de barrer los permisos. Al retomar una sesión, seguir
> **este orden**, de arriba hacia abajo. Marcar cada ítem al terminarlo.

| # | Qué | Estado | Notas |
|---|---|---|---|
| **1** | **Los 4 sueltos** | ✅ **2026-08-06** | |
| 1.a | "Cobrado hoy" del Home deja de ser `—` | ✅ | Suma los pagos del día **filtrando por quién los registró**: `GET /payments` devuelve los del tenant |
| 1.b | **Pantalla de notificaciones** | ✅ | `app/notificaciones.tsx`; el 🔔 del Home lleva siempre, tenga o no pendientes |
| 1.c | **Cobro por QR** | ✅ | **Sin pasarela, por decisión:** el cobrador muestra la foto del QR de SU banco (`Profile.paymentQrUrl`, se carga en Mi perfil) y registra el pago a mano con método QR. Ver abajo |
| 1.d | **Leer Excel en el import** | ✅ | Va **`exceljs`, no `xlsx`** (corrige import R7): SheetJS quedó en 0.18.5 en npm con CVEs sin arreglar, y esto parsea archivos que sube el usuario |
| **2** | **Home más funcional** | ⬜ | Cierra la tanda de sueltos: el Home es la primera pantalla del día y hoy es casi sólo contadores |
| **3** | **P6 · offline / WatermelonDB** | ⬜ | El hueco más grande: hoy la app es 100% online contra el principio no negociable #4. Incluye el retro-encaje en los services de todos los módulos ya construidos |
| **4** | **P9 · push + SSL pinning** | ⬜ | `expo-notifications` sin instalar; el pinning corre en NO-OP (lo avisa Metro en cada arranque) |
| **5** | **Limpieza y orden de todo el módulo celular** | ⬜ | Pasada final: `/ponytail-review` pendiente de cuenta e import, deduplicar, `BASE-INVENTORY` al día |

### El cobro por QR, y por qué no usa `payment_requests` (2026-08-06)

El backend tiene `payment_requests` (`POST /payment-requests` + `/confirm`), y **queda sin usar a
propósito**. Genera un `qrPayload` con formato propio (`KOBRAX|ref|monto`) que no es EMVCo ni el
estándar del BCB — **ningún banco ni billetera lo lee** — y una URL `pay.kobrax.demo` que no existe;
además `confirmRequest`, que es lo que realmente crea el pago, exige `PAYMENT_APPROVE`, que el
COLLECTOR no tiene. Construirlo habría dado una pantalla que no cobra un peso.

Lo que se construyó es lo que ya se hace en la calle: el cobrador carga la foto del QR de su cuenta
bancaria en **Mi perfil** (`Profile.paymentQrUrl`), la muestra a pantalla completa desde la hoja de
pago cuando elige método QR, el deudor paga desde su banco y el cobro **se registra a mano**. Cero
pasarela. Cuando haya una integración real, `src/qr-cobro.tsx` es la pantalla que la consume y
`payment_requests` el backend que la respalda.

### Diferido a la **segunda versión** (decisión de la usuaria, 2026-08-06)
- **P8 · firma digital** — la evidencia sigue funcionando sin ella: foto + **SHA-256** + GPS ya están
  construidos (`uploads` + `field-integrity`). Lo único que se posterga es el canvas de firma y su
  hash. **No bloquea nada del orden de arriba**; cuando entre, reusa el mismo módulo `uploads`.

### Sigue fuera de esta cola (sin fecha, ya estaba así)
- **Import S5 (reparto)** y **S6 (carga rápida)** · la tarjeta de KPIs de Import S2.
- **Cuenta S5** (cartera por lote): falta `POST /cases/assign-bulk` + pantalla; tiene la Q4 abierta.
- **P10 · gating RBAC** (F3) · extras de Agenda (plantillas WhatsApp, adjuntos, campañas, ABM).
- **Import web (admin)**: es F9, fuera del alcance móvil (ver §4).

### Deuda de verificación que arrastra la cola
La **validación visual por cable** de agenda S5+S6, rutas S3–S6, cuenta S0–S4 e import. La hace la
usuaria (la app no corre headless). Y un bug **sin reproducir**: error nativo de MapLibre
`easeTo` en el mapa — descartado que sea por coordenadas nulas (el backend ya las filtra en
`cases.service.ts`) y no está en el JS de la lib.

---

## 6. Índice rápido

- Qué/por qué por slice → [`EPIC-F10-app-mobile.md`](../EPIC-F10-app-mobile.md)
- Pantallas Figma → endpoint → DB → [`ui-screen-map.md`](./ui-screen-map.md)
- Orden + workflow + gaps (este doc) → estado vivo; actualizar §3/§4 tras cada auditoría.
- Handoff de sesión → [`docs/HANDOFF.md`](../../HANDOFF.md)
