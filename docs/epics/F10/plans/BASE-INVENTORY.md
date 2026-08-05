# F10 · Inventario de Base Reusable (ledger anti-duplicación)

> **Índice vivo de lo que YA existe y DEBE reusarse.** Lo lee el skill `/f10-etapa` en su
> auditoría de reuso (Paso B) antes de proponer cualquier artefacto nuevo, y lo **actualiza** al
> cerrar cada etapa. **Regla de oro:** si algo se usa en ≥2 lugares, vive acá y se importa —
> nunca se copia ni se re-implementa. El código es la verdad; este índice es el atajo + la intención.
>
> Al agregar una fila: `artefacto → path → qué hace → creado en P#`. Si encontrás un near-duplicado, se **consolida**, no se suma.

---

## Shared — `packages/shared` (dominio, fuente única)
> **Regla:** tipos/enums/constantes/utils de dominio se importan de acá. **Nunca** redefinir `CaseStatus`, montos, hashes, transiciones ni tokens en el móvil.

| Artefacto | Path | Qué provee |
|---|---|---|
| Enums de dominio | `src/enums/*` | `CaseStatus`, `CasePriority`, `CaseActivityType`, `VisitOutcome`, `EvidenceType`, `NotificationType`, `PaymentRequestStatus`, `RouteStatus`, `Role`, `Permission` |
| Transiciones de caso | `src/constants/case-transitions.ts` | `CASE_TRANSITIONS` — validar transición permitida (P2/P3) |
| Permisos | `src/constants/permissions.ts` | scopes RBAC (ej. `clients.import`) para el gating de P10 |
| Constantes | `src/constants/kobrax.constants.ts` | límites/valores compartidos |
| Tokens de diseño (FUENTE) | `src/design/tokens.ts` | los colores/tipografía que `theme.ts` espeja — parity check en P0 |
| DTOs de respuesta | `src/dtos/{response,error,pagination}.dto.ts` | forma `{ data, meta, error }` + paginación |
| Utils | `src/utils/{currency,date,hash,tokenize}.utils.ts` | formateo de moneda/fecha, SHA-256 (P8), tokenización PII |
| Validación | `src/validation/password-policy.ts` | `checkPassword` (ya usado por `PasswordChecklist`) |
| Tipos | `src/types/{auth,realtime}.types.ts` | contrato auth + eventos WS (P9) |

## Mobile UI — `apps/mobile/src`
| Artefacto | Path | Qué hace | P |
|---|---|---|---|
| Tokens móvil | `theme.ts` | `COLORS`, `HERO_GRADIENT`, `TYPE`, `SPACING`, `RADIUS` (espejo de shared/design) | base |
| UI auth | `components.tsx` | `Button` (primary/ghost), `Field` (+toggle), `ErrorBanner`, `Hero`, `Card`, `SecurityFooter`, `TextLink`, `PasswordChecklist` | base |
| **Fundación de campo** | `ui.tsx` | `Header`, `StatusBadge` (+`BadgeTone`), `ListRow`, `EmptyState`, `BottomSheet`, `OfflineIndicator` (banner Reanimated, informativo) | Slice 0 / P0 |
| OTP | `otp-input.tsx` | `OtpInput` (MFA) | base |

## Mobile data/servicios — `apps/mobile/src`
| Artefacto | Path | Qué hace | P |
|---|---|---|---|
| Cliente HTTP | `api.ts` | `apiFetch<T>`, `ApiResult<T>` — base URL con `/api`, header `x-client-type`, status 0 = sin red | base |
| **Cliente HTTP autenticado** | `api-client.ts` | `authedFetch<T>` (Bearer desde SecureStore + refresh 401→retry) + `refreshSession`. **Base de todos los `*.service.ts` de P1–P5**; `authService` lo reusa | P0 |
| **Store conectividad** | `store/net.ts` | `useNetStore` (Zustand: `isConnected`/`pendingCount`) + `subscribeConnectivity` (NetInfo). Fuente única de red | P0 |
| Servicio auth | `auth-service.ts` | `authService` (me/login/logout/refresh/…), tipo `Me` | base |
| Sesión | `session.ts` | `getSession`, `isSessionValid`, `touchSession` (ventana 8h/7d) | base |
| Biometría | `biometric.ts` | enable/clear/shouldOffer/isEnabled | base |
| Ruteo post-login | `post-login.ts` | `routeAfterAuth` (único punto de decisión tras auth) | base |
| Ruteo por step | `route-step.ts` | `routeByStep` (login → paso) | base |

## Mobile navegación — `apps/mobile/app`
| Grupo | Path | Contenido |
|---|---|---|
| Auth | `(auth)/` | login, mfa, mfa-setup, select-account, forgot-password, unlock, biometric-setup |
| Fuera de tabs | `(app)/` | offline, force-password-change |
| **Shell de campo** | `(tabs)/` | `Tabs` nativo (5 tabs) + index/agenda/rutas/cobranza/mas |

## Pendiente de crear (se llena a medida que cada P lo produzca)
> Cuando una etapa cree algo reusable (un `apiClient` con refresh, un store Zustand, un `useCases`, `CaseCard`, `AmountInput`, `sync.service`, `evidence.service`…) **se agrega acá con su path y su P**. Antes de crear cualquiera de estos, revisar si otro P ya lo dejó.

- ✅ P0 pobló: `api-client.ts` (`authedFetch`), `store/net.ts` (`useNetStore`), `OfflineIndicator`. Deps instaladas: NetInfo, Zustand, Reanimated, expo-haptics, FlashList.
- ✅ **Rutas FUNDACION** pobló `src/maps/`: `tiles.ts` (fuente de tiles + conversión `[lng,lat]`↔`{lat,lng}`), `MapCanvas` (pines + polyline), `MapPicker` (elegir 1 punto — ya lo usan `agenda/crear` y el alta de cliente/garantes), `MiniMapCard` (mapa estático), `offline-packs.service`. **MapLibre es la única lib de mapas**; `react-native-maps` se eliminó. `routes.service.ts` sumó `generate/create/updateStatus/updateStop` + `resolveStopCoords` + `routeProgress`.
- ✅ **Rutas S1** pobló: en `ui.tsx` → `ROUTE_STATUS_LABEL` y `STOP_STATUS_META` (los mapas estado→etiqueta/tono de ruta y parada, que S3/S4/S6 vuelven a pintar); en `agenda-form.ts` → `todayISO()`; y `RouteStopItem` sumó `clientName`/`address`. **Backend:** `clients.serializer.ts` exporta `clientDisplayName()` (regla única de nombre visible — `cases` ya la consume; quedan por converger `clientLabel()` del import y `displayName()` de agenda) y `safeDecrypt()`; `GET /routes/:id` incluye al cliente y **audita `route/PII_REVEAL`** (la dirección viaja en claro, como en agenda).
  - ⚠ `generate` y `updateStatus` ahora resuelven el scope **en el service** (puerta `ROUTE_READ` en el controller): con `ROUTE_ASSIGN`/`ROUTE_WRITE` sobre cualquier ruta; con `ROUTE_EXECUTE`, sólo la propia. Antes el cobrador no podía generar ni arrancar su ruta.
- ✅ **Import** pobló: `src/import.service.ts` (contrato + derivados puros + flags del gate + memoria del archivo de muestra), `src/file-picker.ts` (`pickImportFile`, aparte porque `expo-document-picker` toca nativo al importarse y está en el camino del login), y en `src/api.ts` → **`postMultipart` + `uploadFailure`**, que comparten las DOS subidas de la app (import y evidencia fotográfica): techo de espera de 60 s y la distinción entre "no hay red" y "el archivo no se puede abrir". Backend: `modules/imports/` con **tres motores por FORMA de archivo** (`rows` CSV · `pdf-rows` tabla en PDF · `pdf-blocks` bloques etiquetados), `field-catalog.ts` (`num()` con separadores mezclados, `splitName`, `splitPhones`) e `import-config.ts` (invariantes + `detectFileShape`).
  - ⚠ **No hay parsers por banco** (C12). Sumar un formato = configurarlo desde Ajustes, no escribir código.
  - ⚠ Excel **no se lee**: la dep `xlsx` nunca se instaló y `rows.parser` sólo hace CSV.
- ✅ **Rutas S4** pobló: en `ui.tsx` → **`StopCard`** (la tarjeta de la parada seleccionada: nombre,
  dirección, los dos recuadros de mora y las acciones; **S5 la reusa** bajo el sheet). En `shared` →
  **`TIME_SLOT_HOURS` + `slotOfTime()`**, la frontera horaria de cada franja: la usan **los dos lados**
  (la API agrupa las gestiones de hora fija, el móvil deriva el rango del chip con `timeSlotRange()`
  de `agenda-form.ts`, pegado a `TIME_SLOT_LABEL`). En la API → **`recommendedSlot()`**
  (`modules/agenda/recommended-slot.ts`), la regla pura de «hora recomendada», y **`contactHint`** en
  la respuesta de `clientContext`. `serializeStop` sumó `overdueAmount`/`currency`/`daysPastDue`.
  - ⚠ **Los garantes NO son una entidad**: `GUARANTOR` es un valor de **`LocationType`**, así que ya
    viven en `client_locations` con lat/lng y `clientContext` los devuelve. Para "garantes de X" se
    filtra `locations` por tipo — *no* buscar una tabla de garantes ni escribir un endpoint.
  - ⚠ **`MiniMapCard` ya tenía `tone: 'primary' | 'nearby'`**: se construyó en la fundación de rutas
    justo para el mini-mapa de garantes. Reusarlo, no hacer un mapa chico nuevo.
  - ⚠ La ficha `app/cliente/[id].tsx` acepta **`?routeId=&stopId=`**: con eso pinta lo de RT-5 (chip de
    hora recomendada + garantes). Abierta desde cartera es la misma ficha de siempre.
  - ⚠ **La mora de la parada es la del crédito de SU caso**, no la suma del deudor (un cliente puede
    tener varios créditos). Si algún día se quiere el total, es otro campo, no este.
- ✅ **Rutas S5** pobló: **`src/location.ts` → `currentLocation()`**, la ÚNICA puerta al GPS de la app
  (devuelve `accuracy` y distingue `denied` de `unavailable`; el copy del respaldo lo pone la pantalla).
  **Consolidó dos copias inline** que estaban en `agenda/crear.tsx` y `cliente-form-view.tsx` — *no
  escribir una tercera ni volver a importar `expo-location` en una pantalla*. Además:
  `src/field.service.ts` (`createVisit`/`addVisitEvidence`/**`resolveVisitCoords`**), `src/visit-result.ts`
  (las 6 variantes de RT-6, `buildDetails`, `canSubmitResult`, `paymentOutcome`), y en `shared`
  **`validateVisitDetails`** (espejo de `validateAgendaDetails`; el tipo se llama `VisitResultDetails`
  porque `VisitDetails` ya lo usa la visita **agendada**).
  - ⚠ **`POST /visits` ya hacía casi todo**: crea el `FieldVisit` append-only, **marca la parada
    `VISITED`**, escribe el `CaseActivity` y actualiza la ubicación del cobrador — todo en una
    transacción. Antes de tocar rutas o visitas, mirar `field-ops`, que es donde vive (no `visits/`).
    Su DTO usa **`lat`/`lng`**, no `latitude`/`longitude`.
  - ⚠ `field_visits.details` es JSONB y la tabla es **inmutable**: se escribe SOLO en el INSERT.
  - ⚠ **`ALTER TYPE ... ADD VALUE` va en su propia migración** (Postgres no deja usar el valor en la
    misma transacción que lo agrega, y Prisma corre cada migración en una). Por eso S5 tiene dos.
  - ⚠ **Una migración de enum NO siembra filas**: el catálogo `SPECIAL_CATEGORY` quedó vacío en la
    base ya sembrada y hubo que insertarlo aparte. El COLLECTOR tiene `catalog:read` pero **no**
    `catalog:write`, y el owner tiene MFA (su login no devuelve `accessToken` directo).
  - ⚠ El "número de recibo" del mockup **no se implementó**: `payments.receipt_number` es `Int?` del
    sistema, no texto libre. Se usa la foto del comprobante, que sí viaja punta a punta.
- ✅ **Cartera S4** pobló: `src/use-client-search.ts` → **`useClientSearch(query, { enabled })`**, el buscador
  de clientes con debounce (300 ms / ≥2 caracteres / race-guard por `reqId`). Estaba suelto dentro de
  `app/agenda/crear.tsx`; ahora lo usan **agenda y cartera** — *no escribir un tercero*. Y en `src/portfolio.ts`
  → `sortPortfolio()` + `PORTFOLIO_SORT_LABEL` (4 criterios; `mora` es el orden histórico de la lista).
  - ⚠ El menú `Más` ahora tiene sección **Clientes** (ver cartera · nuevo · **importar** · reglas): la fila
    del importador que pedía `plans/import/README.md §6.3` y nunca se había cableado. `/import` acepta
    `?from=menu` → vuelve sin marcar `skip_day`.
  - ⚠ `app/cliente/[id].tsx` ya **no** rompe con un cliente sin préstamos asignados (`AGENDA_002`): degrada a
    `getClient` + vacío con CTA al alta de préstamo. Es el camino que abre la búsqueda global.
- ✅ **Agenda S5+S6** pobló: en `ui.tsx` → **`SelectRow`** (fila "campo → valor elegido", con `disabled`) y
  **`PickerSheet`** (hoja de selección de una opción). Vivían dentro de `app/agenda/crear.tsx`; ahora los
  usan también el modo edición y el menú `⋯` del detalle — *no escribir un tercero*. En `agenda-form.ts` →
  **`hydrateForm(item)`** (ítem del server → estado del reducer del alta, para `crear.tsx?id=`),
  **`buildPatch(inicial, actual)`** (sólo lo que cambió, para el `PATCH`) y **`partitionDay(items)`**.
  - ⚠ **`partitionDay` es la única regla de reparto del día**: `done = status !== SCHEDULED`. La pantalla
    usaba `status === EXECUTED`, así que un ítem **CANCELLED/RESCHEDULED desaparecía del día**. Tiene test
    de no-regresión — cualquier sección nueva del día se reparte con esta función, no con un `===` propio.
  - ⚠ `DELETE /agenda/:id` responde **200 con el ítem**, no 204: `apiMutate` trata el 204 como error.
    Cualquier endpoint de borrado que consuma el móvil tiene que devolver cuerpo.
