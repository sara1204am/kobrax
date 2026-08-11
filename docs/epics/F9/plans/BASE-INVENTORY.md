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
| Etiquetas de estado | `ui.tsx` → `ROUTE_STATUS_LABEL`, `STOP_STATUS_META`, `AGENDA_STATUS_LABEL`, `AGENDA_TYPE_META` | Estado → etiqueta + tono | ❌ **NO se promueven** (decidido en W1) |

> **Por qué las etiquetas de estado no van a `shared`** (W1, 2026-08-10): son **texto en
> español** y el panel es bilingüe — subirlas rompería la versión en inglés, y convertirlas a
> códigos rompería los tests del móvil que §3.9 manda no tocar. Es el mismo razonamiento que
> dejó `validateSignup` en el móvil (ver `W0-identidad.md §5-ter`). Un estado→etiqueta es
> presentación; el estado ya vive en `shared` como enum y cada plataforma lo rotula.
> Lo que **sí** es regla y sí se promueve es el agrupamiento de `categoryOf` (`NOT_FOUND` +
> `WRONG_ADDRESS` → «Inubicables»), y viaja en W6 **como códigos, no como rótulos**.

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
_pendiente de construcción (falta Google, tareas 7–9)_

### W1 — Shell del panel

| Artefacto | Qué es |
|---|---|
| `app/(panel)/layout.tsx` | El shell. *Route group*: agrupa **sin** aparecer en la URL, así que `/dashboard` y `/settings/**` no cambiaron y el matcher del middleware sigue igual. Única puerta de la identidad: `/auth/me` + `/auth/accounts` en un `Promise.all` y de ahí baja como props |
| `app/(panel)/loading.tsx` · `error.tsx` | Carga y error por segmento, con el mecanismo nativo de Next |
| `app/(panel)/settings/layout.tsx` | Cinco líneas: sólo el ancho de lectura. El anterior (barra navy propia) se borró |
| `components/panel-shell.tsx` | Sidebar + cajón + topbar + desplegables + selector de empresa. El menú se escribe una vez y se coloca dos |
| `components/panel-ui.tsx` | `PageHeader` · `Badge` · `Skeleton` · `EmptyState`. **Sin `'use client'`**: no viajan al navegador |
| `components/modal.tsx` | `Modal` sobre `<dialog>` nativo |
| `components/toast.tsx` | `ToastProvider` + `useToast()`. Montado una sola vez, en el layout del panel |
| `components/data-table.tsx` | `DataTable` con orden y página **en la URL** (`searchParams`), no en estado interno |
| `components/permissions.tsx` | `PermissionsProvider` + `usePermissions()` — siembra lo que el layout ya trajo |
| `lib/nav.ts` | `NAV` · `visibleNav()` · `crumbsFor()`. **Encender un módulo = cambiar su `built: false`** |
| `app/api/auth/switch-account/route.ts` | Handler del cambio de empresa (re-setea las dos cookies) |
| **API** `GET /auth/accounts` · `POST /auth/switch-account` | Listar y cambiar de empresa con Bearer. El cambio **revoca la sesión anterior** |

Mensajes nuevos: namespace `panel` en `es.json`/`en.json` (nav, migas, empresa, vacíos, tabla).
**Ajustes sigue en español duro** — se traduce en W2, que es donde se re-encuadra ese módulo.

⚠️ `vitest.setup.ts` le pone a jsdom un doble de `showModal()`/`close()`: jsdom trae
`HTMLDialogElement` **sin sus métodos**, y cualquier componente con un `<dialog>` revienta al
montar. Es un agujero del entorno de test, no del código.

### W2 — Cuenta y equipo

| Artefacto | Qué es |
|---|---|
| `app/(panel)/cuenta/**` | Datos del negocio + contador de asientos. Guarda **sólo lo que cambió** |
| `app/(panel)/equipo/**` | Miembros, invitación con código a la vista, rol, activar/desactivar, cancelar |
| `app/(panel)/settings/perfil/**` | Mi perfil, con foto y QR de cobro |
| `lib/team.ts` | `memberActions()` — **la única que decide qué ofrece cada fila** |
| `app/api/account/{me,profile,upload}` · `app/api/users/**` · `app/api/uploads/[name]` | Los handlers del BFF de W2 |
| `lib/bff.ts` → `bearerHeaders()` | Los headers sueltos para lo que **no es JSON**: subir (FormData con su boundary) y descargar (binario) |
| `lib/client.ts` → `sendJson()` | `postJson` con verbo. W2 necesitaba `PATCH` y `DELETE`; las 18 llamadas viejas no se tocaron |

**Promovido a `shared` en W2** (regla §3.9):

| Qué | Dónde quedó |
|---|---|
| `diffAccount` · `diffProfile` · `hasChanges` | `utils/patch.ts` — la API corre con `forbidNonWhitelisted`; y **vaciar el QR viaja como `null`**, no como `''` |
| `AccountInfo` · `AccountPatch` · `MyProfile` · `ProfilePatch` · `AccountForm` · `ProfileForm` | `types/account.types.ts` |
| `Member` · `InvitedMember` · `AssignableRole` · `MeInfo` | `types/user.types.ts` |
| `memberName()` · `memberStatus()` | `utils/member.ts` — el nombre visible tiene **una** regla (con el correo de respaldo); el estado viaja como **código**, no como rótulo |
| `COUNTRY_CURRENCIES` | `constants/countries.ts` — **sin el nombre del país**: sería una cadena en un idioma. La web los rotula con `Intl.DisplayNames` |

**NO se promovió**: `validateAccount` / `validateProfile` / `validateInvite` (mensajes en
español, espejo del DTO) ni `ROLE_HINT` / `roleOptions()` / `ROLE_LABEL` (copy). Los rótulos
de rol del panel salen de i18n; `ROLE_LABEL` de `shared` se queda para el móvil.

Ajustes (Seguridad) quedó **traducido**: al cerrar W2 el panel entero funciona en es y en en.

### W3 — Cartera

| Artefacto | Qué es |
|---|---|
| `app/(panel)/cartera/**` | Lista · ficha del cliente · alta y edición · ficha del crédito · alta de préstamo |
| `components/search-box.tsx` | La caja de búsqueda. Escribe `?q=` en la URL y vuelve a la página 1. Debounce 300 ms, el número que el móvil calibró |
| `components/client-form.tsx` | El formulario acordeón. Las filas de teléfono y dirección se reusan **tal cual** dentro de cada garante: en el modelo son las mismas tablas, con `relationId` |
| `lib/portfolio.ts` | `rowStatus()` (llama a `portfolioStatus` de `shared`, no reimplementa el semáforo) · `STATUS_TONE` · `matchesText()` |
| `lib/client-ops.ts` | El diff → la secuencia de llamadas. **Borra antes de agregar** |
| `lib/credit-patch.ts` | El `PATCH` del crédito. **Vaciar la cuota NO la borra**: es plata congelada, no un campo opcional |
| `app/api/clients/**` · `app/api/credits/**` | Los handlers del BFF de W3. El `PATCH` del cliente recibe el **diff entero** y aplica las N llamadas del lado del servidor: el navegador hace una sola |
| **API** `GET /clients?view=portfolio&sort=&dir=` | La cartera agregada y ordenada. **El único SQL crudo del panel** |

**Promovido a `shared` en W3** (regla §3.9):

| Qué | Dónde quedó |
|---|---|
| `quoteFor` · `currentInstallment` · `totalBelowCapital` · `canSubmitPrestamo` · `initialPrestamo` · `buildPrestamoPayload` | `utils/loan-form.ts` — **es plata**: la matemática ya estaba en `loan.ts`, faltaba la capa que decide cuál se usa |
| `buildClientePayload` · `canSubmitCliente` · `hydrateCliente` · `contactPayload` · `locationPayload` · `relationPayload` … | `utils/client-form.ts` — WhatsApp es un `ContactType` aparte, las filas vacías se descartan, y `serverId` decide qué se actualiza y qué se crea |
| `diffCliente` · `hasClientChanges` | `utils/client-diff.ts` — se llama distinto que el `hasChanges` de `patch.ts` porque comparten el barril de `utils` |
| `ClientDetail` · `CreditDetail` y sus sub-recursos · `New*Input` · las filas del formulario | `types/client.types.ts` |

**NO se promovió**: `groupPortfolio` y compañía (están escritos sobre `CaseListItem`, otra entrada)
ni `sortPortfolio` (ordena una lista ya traída entera; en la web ordena el servidor).

🔴 **Lo que hay que saber antes de tocar la cartera:**

1. **`nextDueDate` e `installmentAmount` no son columnas.** Viven en `credit.metadata` o salen de
   `credit_installments`, y los resuelve `creditView()` de `shared`. Por eso la lista **no puede
   ordenar por próximo vencimiento** y nunca dice «Por vencer».
2. **La RLS de `clients` y `credits` no está en `migrations/`**, sino en
   `packages/database/prisma/rls/001_enable_rls.sql`, que se aplica aparte con `psql`.
3. **`hasSchedule` miente en el listado de créditos**: el query no incluye las cuotas, así que
   viene `false` para todos. Sólo la ficha puede decirlo.
4. **El estado del cliente es la columna `client_status`**, no `status`.
5. **La lista de clientes siempre viene enmascarada**: `reveal` sólo existe en `GET /clients/:id`,
   y **el formulario de edición tiene que cargarse con `reveal=true`** o guarda la máscara encima
   del dato real.

✅ **La búsqueda (`q`) del `DataTable` se construyó en W3**, con `/clients` como primer consumidor
real, y quedó cableada también en `/equipo` (ahí filtra en memoria). Lo que sigue es el contexto de
esa decisión, tomada en W2:

⏸️ **La búsqueda (`q`) del `DataTable` se construye en W3, no antes** (decisión del 2026-08-10).
`/users` devuelve el equipo entero y son pocas filas por el techo del plan, así que en `/equipo`
el orden se resuelve en memoria y no hace falta filtrar. El primer consumidor real es
`/clients`, que **sí busca del lado del servidor**: recién ahí se conoce la forma del parámetro.
Escribirlo antes es adivinar el contrato — el mismo error que el code-review le marcó al
`DataTable` por haber nacido sin consumidor. Cuando W3 lo construya, se cablea también en
`/equipo`.
