# F9 · BASE-INVENTORY — qué existe ya en el panel web

> Ledger anti-duplicación. **Se lee ANTES de proponer un artefacto nuevo** y se actualiza al
> cerrar cada etapa. El código manda sobre este índice: si no coinciden, gana el código y se
> corrige el índice.
>
> Equivalente web de `docs/epics/F10/plans/BASE-INVENTORY.md`.

**Corte:** 2026-08-07 · rama `web/f9-auth`

---

## 1. Lo que hay (y no se reconstruye)

### Capa BFF — `src/lib/bff.ts`
| Artefacto | Qué hace |
|---|---|
| `API_BASE` | `KOBRAX_API_URL` (default `http://127.0.0.1:4010/api`). **Server-side, nunca al navegador.** |
| `apiCall<T>(path, {auth})` | Habla con la API. `auth: true` adjunta el Bearer desde la cookie. Manda `x-client-type: web`. |
| `COOKIE` | `k_access` (15 min) · `k_refresh` (7 días) · `k_preauth` (5 min). |
| `setAuthCookies` / `setPreAuthCookie` / `clearAuthCookies` | Único lugar que escribe cookies de sesión. |
| `sameOrigin(req)` | Guarda CSRF. **Todo handler que muta la valida.** |
| `ApiEnvelope<T>` | El `{data, error, meta}` tipado, con `meta.total/page/limit/pages`. |

⚠️ Las cookies son `sameSite: 'strict'`. Para el ida-y-vuelta de Google hace falta una cookie
aparte con `sameSite: 'lax'` — una `strict` **no viaja** en la navegación de vuelta desde
`accounts.google.com` y el `state` llegaría vacío. Es la trampa número uno de W0.

### Flujo de login — `src/lib/auth-flow.ts` · `src/lib/client.ts`
| Artefacto | Qué hace |
|---|---|
| `stepResponse(LoginResult)` | Traduce el resultado del backend: `done` setea cookies; el resto guarda el pre-auth y devuelve el paso. |
| `apiError(status, body)` | Propaga code/message del backend con su status. |
| `postJson<T>(url, body)` | El POST del lado del navegador. |
| `routeByStep(router, step, accounts)` | Navega al paso que toca (`mfa` / `mfa_setup` / `select_account` / `done`). |

`LoginStep` y `LoginResult` viven en `packages/shared/src/types/auth.types.ts`. **La máquina de
estados del login es del backend**; el front sólo la enruta.

### Middleware — `src/middleware.ts`
Refresh silencioso: access vencido + refresh vivo → pide un par nuevo y re-setea cookies.
Matcher actual: `/dashboard/:path*`, `/settings/:path*`.
⚠️ **Toda ruta privada nueva tiene que sumarse al matcher.**

### Route handlers BFF ya escritos — `src/app/api/**`
`auth/login` · `auth/logout` · `auth/me` · `auth/refresh` (en middleware) · `auth/mfa/challenge` ·
`auth/mfa/setup` · `auth/select-account` · `auth/forgot-password` · `auth/reset-password` ·
`account/change-password` · `account/mfa` · `account/sessions` · `account/sessions/[id]`.

### Pantallas ya escritas — `src/app/(auth)/**` y `src/app/settings/**`
`login` · `login/mfa` · `login/mfa-setup` · `login/select-account` · `forgot-password` ·
`reset-password` · `settings/security` (contraseña · sesiones activas · MFA).
**W0 les cambia la piel, no el flujo.**

### Componentes — `src/components/`
| Artefacto | Qué es | Nota |
|---|---|---|
| `ui.tsx` | `Button` (primary/ghost, h48, spinner) · `Input` (icono, error, focus periwinkle) · `Field` (label 11px uppercase) · `ErrorBanner` (`role="alert"`) · `SecurityFooter` | **Punto de partida de toda primitiva nueva.** Mirar acá antes de escribir. |
| `auth-shell.tsx` | Contenedor de auth: hero con gradiente + wave + card centrada `max-w-md` | **W0 lo reemplaza** por el split-screen del diseño. |
| `otp-input.tsx` | Input de 6 dígitos para MFA | Se conserva. |
| `password-checklist.tsx` | Requisitos de contraseña en vivo | Se conserva. |

### Tokens — `apps/web/tailwind.config.ts`
Colores `k-*`, `font-sans: Inter`, `font-mono: JetBrains Mono`, `bg-k-hero` (gradiente
160° navy→slate→periwinkle), `shadow-k-card`, `shadow-k-focus`, `shadow-k-focus-error`.
Fuente única: `packages/shared/src/design/tokens.ts`. **No se tocan al rediseñar.**

### Tests
Vitest + Testing Library + MSW (`vitest.config.ts`, `vitest.setup.ts`, `src/test/msw-server.ts`).
Ya hay specs de `forgot-password`, `reset-password`, `sessions`, `auth-flow`, `client`,
`password-checklist`.

---

## 1-bis. 🔴 Lo que el móvil ya resolvió y la web NO puede reescribir

> **La sección más importante de este documento.** El móvil no sólo consumió la API: dejó las
> **reglas del negocio** escritas como funciones puras. Están en `apps/mobile/src`, o sea en un
> lugar donde la web no las ve. Si cada etapa las reescribe, el escritorio y el teléfono van a
> decir cosas distintas sobre la misma plata.
>
> **La regla (BUILD-PLAN §3.9): se promueven a `packages/shared` y las consumen los dos.**
> Promover = mover el archivo, dejar el móvil importando de ahí, y verificar que **sus tests
> siguen pasando sin tocarlos**. Si un test hay que cambiarlo, se cambió comportamiento.

### 1-bis.1 Lo que ya está en `shared` — se importa, no se re-declara

| Qué | Path | Lo usa |
|---|---|---|
| Enums de dominio | `src/enums/*` | `CaseStatus`, `CasePriority`, `CaseActivityType`, `VisitOutcome`, `EvidenceType`, `NotificationType`, `RouteStatus`, `Role`, `Permission` |
| Transiciones de caso | `src/constants/case-transitions.ts` | `CASE_TRANSITIONS` — W5 valida las transiciones con esto, no con un `switch` propio |
| Permisos RBAC | `src/constants/permissions.ts` | **Fuente única**: el seed la consume. W1 arma `usePermissions()` sobre esto |
| Franjas horarias | `TIME_SLOT_HOURS` + `slotOfTime()` | La frontera de cada franja, que **la API y el móvil ya comparten**. W5 la hereda |
| Validación de gestión / visita | `validateAgendaDetails` · `validateVisitDetails` | W5, W6 |
| Política de contraseña | `src/validation/password-policy.ts` | Ya la usa `password-checklist.tsx` de la web |
| Moneda, fecha, hash, tokenize | `src/utils/*` | W3, W6, W7 |
| Tokens de diseño | `src/design/tokens.ts` | Fuente del `tailwind.config.ts` |

⚠️ **`PAYMENT_METHODS` / `PaymentMethod` de `shared` está podrido** (minúsculas legacy). La API
espera el enum de Prisma en MAYÚSCULA. Ver BUILD-PLAN C7. W7 lo arregla o lo esquiva, pero no lo
usa tal cual.

### 1-bis.2 Reglas que hay que PROMOVER (viven sólo en el móvil hoy)

| Regla | Dónde vive hoy | Qué decide | Promover en |
|---|---|---|---|
| **Cotización de préstamo** | `prestamo-form.ts` → `quoteFor`, `currentInstallment`, `totalBelowCapital`, `canSubmitPrestamo` | Cuota, total, ganancia, y cuándo el alta es válida. **Es plata: dos implementaciones = dos números** | **W3** |
| Alta/edición de cliente | `cliente-form.ts` → `buildClientePayload`, `canSubmitCliente` · `cliente-diff.ts` → `diffCliente` | Qué se manda y qué cambió | W3 |
| Orden de la cartera | `portfolio.ts` → `sortPortfolio`, `PORTFOLIO_SORT_LABEL` | Los 4 criterios; `mora` es el histórico | W3 |
| Búsqueda de clientes | `use-client-search.ts` | Debounce 300 ms, ≥2 caracteres, race-guard por `reqId` | W3 — *evaluar*: es un hook de React, y `shared` hoy no depende de React |
| **Reparto del día** | `agenda-form.ts` → `partitionDay` | `done = status !== SCHEDULED`. **Tiene test de no-regresión**: la pantalla usaba `=== EXECUTED` y un ítem cancelado desaparecía del día | **W5** |
| Formulario de gestión | `agenda-form.ts` → `hydrateForm`, `buildPatch`, `timeSlotRange`, `todayISO`, `MONTHS`, `money` | Alta, edición y PATCH parcial | W5 |
| **Cuenta de la jornada** | `route-summary.ts` → `summarizeDay(route, payments)` | Recaudado, progreso y categorías. **Es la ÚNICA cuenta**: se hizo así porque dos pantallas del mismo día decían cosas distintas | **W6, W8** |
| Categorías del resumen | `route-summary.ts` → `CATEGORY_LABEL`, `CATEGORY_TONE`, `categoryOf` | `NOT_FOUND` + `WRONG_ADDRESS` se agrupan en «Inubicables» sólo acá; el dato fino sigue entero en `field_visits` | W6 |
| Progreso de ruta / ETA | `routes.service.ts` → `routeProgress`, `resolveStopCoords` · `route-eta.ts` | W6 |
| Resultado de visita | `visit-result.ts` → las 6 variantes, `buildDetails`, `canSubmitResult`, `paymentOutcome` | W6 (lectura) |
| **Contrato del import** | `import.service.ts` (21 KB) — derivados puros, flags del gate, memoria del archivo de muestra | W4 |
| KPIs del inicio | `home.ts` | Los contadores intradía. Ojo: en la web el "hoy" es del tenant, no de un cobrador | W8 |
| Etiquetas de estado | `ui.tsx` → `ROUTE_STATUS_LABEL`, `STOP_STATUS_META`, `AGENDA_STATUS_LABEL`, `AGENDA_TYPE_META` | Estado → etiqueta + tono. Van a `shared` como datos; el color lo resuelve cada plataforma | W1 (los mapas) |

### 1-bis.3 Lo que NO se lleva del móvil (y por qué)

| Qué | Por qué no |
|---|---|
| `db.ts` (SQLite) · `sync/*` (`cached`, `queue`, `sync.service`, `hydrate`) · `ids.ts` | **El panel es de oficina y asume conexión** (BUILD-PLAN D4). Todo el aparato offline es del campo. |
| `store/net.ts` + `OfflineIndicator` | Idem. |
| `location.ts` (GPS) · `photo.ts` · captura de evidencia | La evidencia la captura el cobrador. La web la **mira**, no la produce (F9 §3.2). |
| `biometric.ts` · `session-lock` · `post-login` con biometría | Del teléfono. |
| `file-picker.ts` | Es `expo-document-picker`. La web usa `<input type="file">`. |
| Reanimated · expo-haptics · FlashList | Nativas. |
| Packs offline de MapLibre (`offline-packs.service`) | El panel no descarga tiles. |

⚠️ **Los mapas sí se comparten en concepto**: el móvil cerró MapLibre como única librería de
mapas y `src/maps/tiles.ts` fija la fuente de tiles y la conversión `[lng,lat]`↔`{lat,lng}`.
W6/W9 usan **`maplibre-gl`** (la hermana web, mismos tiles), no otra librería.

---

## 2. Lo que NO hay (y el doc viejo decía que sí)

`apps/web/CLAUDE.md` describía un stack que **nunca se instaló**. Las deps reales son cuatro:
`next`, `react`, `react-dom`, `qrcode`, más `@kobrax/shared`.

**No existe**: shadcn/ui · TanStack Query · Zustand · next-auth · Recharts · socket.io-client ·
React Hook Form · Zod (en web) · Playwright · ninguna librería de componentes · ningún store
global · ningún cliente de cache.

Cuando una etapa necesite una de verdad, se instala **de verdad** y se anota acá.

---

## 3. Lo que se borró el 2026-08-07 (no reaparece)

`src/app/panel/**` (clientes / créditos / casos) · `components/panel.tsx` · `components/panel-nav.tsx`.
Estaban escritos contra los CRUD genéricos, antes de que el móvil definiera los dominios reales.
Están en el historial de git.

`/dashboard` quedó como aterrizaje mínimo **a propósito**: es el destino al que apuntan
`app/page.tsx`, `lib/client.ts`, `login/select-account` y `settings/layout`. La ruta tiene que
existir. W1 la convierte en el shell de verdad.

---

## 4. Contratos de la API disponibles (verificado contra los controllers)

| Módulo | Base | Endpoints | Lo consume |
|---|---|---|---|
| auth | `/auth` | 21 | W0 (ya) |
| accounts | `/accounts` | 3 (`POST` = registro público, `GET/PATCH me`) | W0, W2 |
| users | `/users` | 7 | W2 |
| roles | `/roles` | 1 | W2 |
| clients | `/clients` | 16 | W3 |
| credits | `/credits` | 6 | W3 |
| portfolio-import | `/imports/portfolio` | 3 | W4 |
| client-import | `/clients/imports` | 1 | ❌ **no usar** — matchea por carnet y borra al ausente |
| cases | `/cases` | 8 | W5 |
| agenda | `/agenda` | 14 | W5 |
| routes | `/routes` | 10 | W6 |
| field | `/visits` | 2 | W6 |
| payments | `/` (raíz) | 6 | W7 |
| catalogs | `/catalogs` | 4 | W3, W5 |
| notifications | `/notifications` | 3 | W9 |
| uploads | `/uploads` | 2 | W2, W3 |

---

## 5. Artefactos nuevos por etapa

*(se llena al cerrar cada etapa — mismo formato que el inventario del móvil)*

### W0 — Identidad
_pendiente de construcción_
