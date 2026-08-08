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
