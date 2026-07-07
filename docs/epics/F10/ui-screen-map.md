# F10 · Mapa de Pantallas UI — Figma ↔ Slice ↔ Endpoint ↔ DB

> **Companion de** [`EPIC-F10-app-mobile.md`](../EPIC-F10-app-mobile.md). F10 dice *qué* construir
> por slice (motor offline, sync, evidencia, verticales). **Este doc mapea el diseño Figma** —
> las ~32 pantallas reales — a su slice, su endpoint del API y su tabla de la DB.
> No reemplaza a F10; le agrega la capa de UI que le faltaba.
>
> **Diseño:** Figma "Kobrax movil" · fileKey `daLWsKQGC4Sd1NacU9fmrP` · board raíz `81:2`.
> Pulls: `get_design_context` / `get_screenshot` con el node-id de cada fila.
>
> **⚠ Contrato real (auditoría 2026-07-03, ver [BUILD-PLAN §3](./BUILD-PLAN.md)):** todos los endpoints llevan
> prefijo **`/api`**; las visitas son **`/api/visits`** (no `/field-visits`); la idempotencia de pago es
> **`payments.idempotencyKey`** (no `reference` — ese campo vive en `payment_requests`).

---

## 0. Decisiones de esta sesión (reconciliación)

| Tema | Decisión | Nota |
|---|---|---|
| **Offline-first** | Se **mantiene** (F10 + CLAUDE.md, no-negociable). | UI se construye online primero, pero los services se estructuran para enchufar WatermelonDB en su slice. |
| **Build** | **Expo Go** mientras no haya nativo; **dev build** (`expo prebuild`) al entrar cámara/GPS/firma/pinning **y mapas**. | Split natural: Expo Go = listas/datos; dev build = mapas + evidencia + offline nativo. |
| **Tokens** | Manda `design-system.md`: **navy primario**, purple solo acento. | Las pantallas Figma usan CTA **morado** → se **normaliza a navy** al construir. |
| **Mapas** | Librería que funcione **online + offline** (ver §3). | Nativo → cae en la fase dev build, no en Expo Go. |
| **Roles** | Diferidos (F3). Se construye asumiendo **cobrador**; gating al final. | El import (§4) sirve a **dos perfiles** (independiente en móvil / admin en web) → se ubica según rol al final. |
| **Modelo offline** | **Hidratación en oficina → cobro en campo** (ver §4.1). | Sync bulk con wifi de mañana; luego opera sin señal con datos + mapa ya locales. |

---

## 1. Estado: diseño vs. código

- **Figma:** 6 secciones (módulos), ~32 pantallas reales + variantes.
- **Móvil hoy:** solo **auth/sesión** (login, mfa, mfa-setup, select-account, forgot, unlock, biometric-setup, force-password-change, offline). **Sin tab navigator. Cero features de campo.**
- **API + DB:** ✅ cubren todos los módulos (CRUD, envelope `{data,meta,error}`, guards por permiso). No se crean tablas ni endpoints nuevos — se **consumen**.

---

## 2. Tokens — corrección

`theme.ts` ya es espejo de `design-system.md`. **No se inventan colores.** Única corrección de criterio:

- **CTA primario = `navy`** (no morado). El Figma pinta botones morados; al portar, van en `navy`. Purple queda para links/MFA/estado activo (regla del design-system §2).
- Estados (`success`/`danger`/`warning`) solo para estado, nunca decoración.
- Tokens finos por pantalla (badges por `CaseStatus`/`VisitOutcome`/`CasePriority`) se extraen con `get_design_context` al construir cada una, y si falta un color **se agrega primero en `tokens.ts`** (regla del design-system).

---

## 3. Mapas — opciones online + offline

Nativo (requiere dev build). `react-native-maps` (Google/Apple) **no** hace tiles offline reales → descartado para el requisito offline.

| Opción | Offline | Costo | Nota |
|---|---|---|---|
| **MapLibre** (`@maplibre/maplibre-react-native`) | ✅ packs offline (MBTiles) | **Gratis, FOSS** | Recomendado: sin vendor lock, tiles propios/gratuitos. |
| **Mapbox** (`@rnmapbox/maps`) | ✅ offline tile packs | Free tier + API key | Más pulido; depende de cuenta Mapbox. |
| react-native-maps | ❌ (solo caché hacky) | Gratis | No cumple offline. Descartado. |

**✅ Decisión (confirmada):** MapLibre. Se integra en la **fase dev build**, junto con evidencia.

---

## 4. Módulos → pantallas → slice → endpoint → DB

Leyenda build: 🟢 Expo Go · 🔵 dev build (nativo).

### AUTH — sección `81:3` — ✅ ya construido
6 variantes de login (`70:4`, `70:110`, `70:255`, `70:357`, `70:446`, `70:508`). El login actual (`app/(auth)/login.tsx`) ya cubre el flujo. No re-construir.

### HOME / Dashboard — sección `42:3066` — Slice 3/UI
| Pantalla | node-id | Endpoint | DB | Build |
|---|---|---|---|---|
| Home Jornada Activa | `42:3069` | `GET /routes?collectorId&date` · `GET /cases?assigneeId` · `GET /notifications` | route_plans, collection_cases, notifications | 🟢 |
| Home Pre-jornada | `42:3247` | idem (estado sin ruta activa) | idem | 🟢 |

> **✅ KPIs del home = calcular en cliente** desde routes/cases/payments locales (incluye acciones offline `pending`). Son contadores intradía; el dispositivo tiene el dato más fresco hasta sincronizar. Sin endpoint de agregación nuevo (§8.1).

### AGENDA + GESTIONES + NOTIF — sección `81:4` — Slice 3–4
| Pantalla | node-id | Endpoint | DB | Build |
|---|---|---|---|---|
| Agenda Diaria | `64:4` | `GET /cases?assigneeId` / stops de ruta | collection_cases, route_stops | 🟢 |
| Detalle de Gestión | `64:425` | `GET /cases/:id` | collection_cases, case_activities | 🟢 |
| Notif + Home actualizado | `64:538` | `GET /notifications` · `POST /notifications/:id/read` | notifications | 🟢 |
| Gestión: Llamada | `65:724` | `POST /cases/:id/activities {type:CALL}` | case_activities | 🟢 |
| Gestión: Visita | `65:828` | `POST /cases/:id/activities {type:VISIT}` (+ visita real → `/visits`) | case_activities, field_visits | 🔵 (si captura GPS) |
| Gestión: WhatsApp | `65:938` | `POST /cases/:id/activities {type:MESSAGE}` + deep-link WA | case_activities | 🟢 |
| Gestión: Recordatorio | `65:1047` | `POST /cases/:id/activities {type:NOTE}` (+ notif local) | case_activities | 🟢 |
| Gestión: Promesa de pago | `65:1150` | `POST /cases/:id/activities` + `PATCH /cases/:id {status:PROMISE_TO_PAY}` | collection_cases, case_activities | 🟢 |
| Acción Llamada (sheet) | `66:1763` | (UI sheet sobre lo anterior) | — | 🟢 |
| Acción WhatsApp (envío) | `66:2195` | idem | — | 🟢 |
| Acción Promesa (full) | `66:2440` | idem promesa | — | 🟢 |
| Acción Recordatorio (full) | `66:2531` | idem recordatorio | — | 🟢 |

### RUTAS — sección `81:5` — Slice 3 (+ mapas 🔵)
| Pantalla | node-id | Endpoint | DB | Build |
|---|---|---|---|---|
| Sin ruta creada | `46:4` | `GET /routes` (vacío) · `POST /routes/generate` | route_plans | 🟢 |
| Ruta activa | `46:108` | `GET /routes/:id` (con stops) | route_plans, route_stops | 🟢 |
| Ruta completada | `46:282` | `GET /routes/:id` | route_plans | 🟢 |
| Mapa selección (vacío) | `47:471` | `GET /clients` · `GET /cases` | clients, collection_cases | 🔵 |
| Mapa + selección + card | `47:586` | `POST /routes` · `PATCH /routes/:id/stops/:sid` | route_plans, route_stops | 🔵 |
| Crear cliente desde mapa | `47:767` | `POST /clients` (+ contacts/locations) | clients, client_locations | 🔵 |
| Missing Coordinates Alert | `48:1354` | (validación UI) | — | 🔵 |
| Vista previa ruta | `49:1857` | `GET /routes/:id` | route_stops | 🟢 |
| Preview con alerta zigzag | `49:2012` | idem (aviso de orden) | route_stops | 🟢 |
| Confirmar e iniciar | `49:2185` | `PATCH /routes/:id {status:IN_PROGRESS}` | route_plans | 🟢 |
| Mapa activo (pin) | `51:541` | `GET /routes/:id` | route_stops | 🔵 |
| Detalle de parada | `51:915` | `GET /cases/:id` · `PATCH stops` · `POST /visits` | route_stops, field_visits | 🔵 |
| Registrar resultado (sheet) | `51:676` | `POST /visits {outcome}` · `POST /visits/:id/evidence` | field_visits, field_evidences | 🔵 |
| Resumen de jornada | `51:1053` | agregación visits/payments del día | field_visits, payments | 🟢 |

> Wrappers de diseño (ignorar como pantalla): `Edit ruta` `50:404`, `Group 2` `49:1854`, `Group 1` `48:1427`.

### PAGO EN CAMPO — embebido en gestión/rutas — Slice 4
| Acción | Endpoint | DB | Build |
|---|---|---|---|
| Registrar pago | `POST /payments {creditId,amount,method}` + header `Idempotency-Key` | payments (ledger inmutable) | 🟢 |
| Solicitud QR/link | `POST /payment-requests` · `POST /payment-requests/:id/confirm` | payment_requests | 🟢 |

### 4.1 Modelo de hidratación offline — "oficina → campo"

> Por qué Import va primero: es la **puerta de entrada de datos del día** para el cobrador independiente/oficina chica.

**Dos perfiles de carga:**

| Perfil | Carga desde | Cuándo |
|---|---|---|
| Cobrador independiente / oficina pequeña | **Móvil** (Excel o config ya creada en web) | Primera hora, en oficina con wifi |
| Empresa mediana/grande (multiusuario) | **Web** (admin) → baja al móvil del cobrador | Admin administra; cobrador recibe |

**Ciclo diario:**
1. **Oficina (con internet):** importar/actualizar/eliminar datos del día → **sync automático a WatermelonDB** + **descarga del pack de mapa de la región/pueblo** (MapLibre offline pack).
2. **Salida a cobrar:** ciudad = hay señal; pueblo = mapa ya cargado para la región.
3. **Zonas sin señal:** datos + mapa **ya locales** → operación 100% offline (regla no-negociable).

> Este "sync de oficina" **es** el checkpoint de hidratación de WatermelonDB (resuelve el punto de retro-encaje offline, §8.5). El pack de mapa cae en fase dev build 🔵 (MapLibre nativo); el import de datos es 🟢 Expo Go.

**Regla multi-tenant (no-negociable, principio #1):** una **sola app** para todos los tenants; las capacidades se **encienden por capacidad/rol (RBAC scope)**, nunca por `tenantType`. El import móvil aparece solo si el tenant/rol tiene la capacidad (ej. `clients.import`); el cobrador de un banco no la ve. Ramificar por capacidad escala sin tocar código; ramificar por tipo de tenant es deuda. F3 diferido → se construye con la capacidad **encendida** y el guard se cablea al final.

### IMPORT / Carga — sección `20:1046` — sirve a 2 perfiles (móvil independiente / web admin); gating por rol al final
| Pantalla | node-id | Endpoint | DB | Build |
|---|---|---|---|---|
| Inicio Sync | `24:1049` | — | — | 🟢 |
| Actualizar Archivo | `24:1907` | `POST /clients/imports` | client_import_runs | 🟢 |
| Seleccionar Archivo | `24:1981` | idem | idem | 🟢 |
| Vista Previa Importación | `24:2051` | `POST /clients/imports {dryRun:true}` | client_import_runs | 🟢 |
| Resultado con Advertencias | `24:2164` | idem | idem | 🟢 |
| Resultado de Importación | `24:2280` | `POST /clients/imports` | client_import_runs, clients | 🟢 |
| Formulario Carga Rápida | `48:1438` | `POST /clients` (+ contacts/locations) | clients | 🟢 |
| Revisar Lista Carga Rápida | `24:2468` | idem (batch) | clients | 🟢 |
| Éxito Carga Rápida | `24:2600` | — | — | 🟢 |

---

## 5. Componentes reutilizables

**Ya existen** (`src/components.tsx`): `Button` (navy/ghost), `Field` (+toggle 👁️), `ErrorBanner`, `Card`, `TextLink`, `Hero`, `PasswordChecklist`, `OtpInput`.

**Faltan (base de todo):**
| Componente | Uso | Slice |
|---|---|---|
| `TabBar` | nav inferior (todas las pantallas) | 0 |
| `Header` | app bar back+título+acciones | 0 |
| `BottomSheet` | acciones (llamada/whatsapp/resultado) | 0 |
| `StatusBadge` | `CaseStatus` / `VisitOutcome` / `CasePriority` | 0 |
| `ListRow` + `CaseCard`/`StopRow`/`ClientRow` | listas (FlashList) | 0/3 |
| `StatTile` | KPIs home/resumen | 3 |
| `AmountInput` | pago | 4 |
| `GestionCard` | "Variantes de Registro de Gestión" | 3 |
| `MapCanvas` + `MiniMapCard` | rutas (MapLibre) | 3 🔵 |
| `CameraCapture` / `SignatureCapture` / `LocationBadge` | evidencia | 2 🔵 |

> Alinear con F10 §3.3: `components/ui/` sobre tokens + Reanimated 3 + expo-haptics + FlashList. **Sin** Tamagui/Paper/Skia de base.

---

## 6. Navegación / Tabs — ✅ RESUELTO (se guía por Figma)

**Set final = 5 tabs, tal cual el Figma** (verificado en `42:3069`):

**`Inicio · Agenda · Rutas · Cobranza · Más`**

| Tab | Ícono | Contenido |
|---|---|---|
| **Inicio** | grid | Home/dashboard: progreso del día, agenda resumida, ruta activa |
| **Agenda** | calendario | Agenda diaria de gestiones |
| **Rutas** | ruta | Rutas del día (mapas en dev build 🔵) |
| **Cobranza** | documento | Pagos / cobros; badge de pendientes |
| **Más** | ••• | Overflow: Perfil, Import (supervisor), config |

> Reemplaza el `Ruta·Casos·Pagos·Perfil` de F10 §H0.3. Diferencias clave: **"Casos" no es tab** (las gestiones viven bajo Agenda/Inicio); **Pagos → "Cobranza"** como tab de primer nivel; **Perfil → dentro de "Más"**.

---

## 7. Orden de construcción (Expo Go → dev build)

**Fase Expo Go (🟢 — sin nativo):**
1. **Fundaciones** — tokens check + `TabBar`/`Header`/`BottomSheet`/`StatusBadge`/`ListRow` + navegador `(tabs)`. (F10 Slice 0, parcial)
2. **Home + Agenda** (solo lectura) — `GET routes/cases/notifications`.
3. **Gestiones** (escritura) — `POST activities`, transiciones de estado, promesa.
4. **Rutas sin mapa** (lista de paradas) — lifecycle de ruta, confirmar/iniciar, resumen.
5. **Pagos** — `POST /payments` idempotente, `payment-requests`.
6. **Import** (supervisor) — bulk + carga rápida.

**Fase dev build (🔵 — `expo prebuild`, nativo):**
7. **Mapas** (MapLibre online+offline) — vistas de mapa de Rutas.
8. **Evidencia** — cámara + GPS + firma + hash SHA-256 (F10 Slice 2).
9. **Offline/sync** — WatermelonDB + SyncService (F10 Slices 0–1) retro-encajado en los services.
10. **Push + collector.location** (F10 Slice 5) · **SSL pinning real** (F10 Slice 6).
11. **Roles/permisos** — gating por rol (cobrador vs supervisor).

Racional: leer antes de escribir · deps baratas primero · mapas/cámara/offline (nativo, caro) en dev build.

---

## 8. Decisiones pendientes (para modificar este plan)

1. ~~**KPIs home:** ¿`GET /me/summary` o cliente?~~ ✅ RESUELTO: **calcular en cliente**. Los KPIs del Home son contadores intradía (`cobrado hoy`, `7/18 gestiones`, `progreso`, `en mora`) generados por acciones **offline** del cobrador → solo el dispositivo tiene el dato fresco hasta sincronizar. Un summary del server iría atrasado por diseño. Definiciones de KPI cambiables → config hidratada en oficina, no cálculo en server.
2. ~~**Tabs:** set final de tabs (§6).~~ ✅ RESUELTO: `Inicio·Agenda·Rutas·Cobranza·Más` (se guía por Figma).
3. ~~**Mapa:** ¿MapLibre o Mapbox?~~ ✅ RESUELTO: **MapLibre** (`@maplibre/maplibre-react-native`) — offline packs por región (MBTiles), gratis, sin vendor lock. Integra en fase dev build 🔵.
4. ~~**Import en móvil:** ¿se queda o se saca a web?~~ ✅ RESUELTO: **ambos** — móvil (independiente) + web (admin multiusuario). Un solo import adaptable por tenant/rol (§4.1).
5. ~~**Offline retro-encaje:** ¿en qué punto?~~ ✅ Anclado: el **sync de oficina** (§4.1) es el checkpoint de hidratación de WatermelonDB. Falta definir el mecanismo técnico exacto (schema espejo + orden de carga).
