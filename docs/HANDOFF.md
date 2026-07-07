# HANDOFF — dónde retomar

> ## 🔵 RETOMAR ACÁ (sesión 2026-07-03): F10 App Mobile — planificación cerrada, listo para código
> **Las 5 decisiones de plan quedaron TODAS resueltas.** Docs vivos: `docs/epics/EPIC-F10-app-mobile.md` + `docs/epics/F10/ui-screen-map.md`. Figma "Kobrax movil" fileKey `daLWsKQGC4Sd1NacU9fmrP`.
>
> | # | Decisión | Resuelto |
> |---|---|---|
> | 1 | KPIs Home | **Calcular en cliente** (contadores intradía de acciones offline; server iría atrasado) |
> | 2 | Tabs | **`Inicio · Agenda · Rutas · Cobranza · Más`** (Figma node `42:3069`, 5 tabs) |
> | 3 | Mapa | **MapLibre** (`@maplibre/maplibre-react-native`, offline packs, gratis, dev build) |
> | 4 | Import | **Móvil + web**, gated por capacidad/rol (independiente=móvil, admin=web) |
> | 5 | Offline retro-encaje | Anclado al **sync de oficina** (checkpoint de hidratación de WatermelonDB) |
>
> **Modelo offline "oficina→campo":** en oficina con wifi se importa/sincroniza datos del día + se baja el pack de mapa de la región; luego se sale a cobrar (ciudad con señal / pueblo con mapa ya cargado / zonas sin señal 100% offline). **Regla multi-tenant (principio #1):** UNA app; capacidades por **capacidad/rol (RBAC), nunca por `tenantType`**. F3 diferido → construir con capacidad encendida, guard al final.
>
> **PRÓXIMO PASO = Paso 1 (F10 Slice 0, Expo Go, sin nativo, CERO claves):** fundación `components/ui/` sobre tokens (`TabBar`/`Header`/`BottomSheet`/`StatusBadge`/`ListRow`) + Reanimated 3 + expo-haptics + FlashList, y navegador `(tabs)` con los 5 tabs reusando `routeAfterAuth`. Validar UNA pantalla núcleo en Android de gama baja antes de escalar (§3.3). Claves recién después: API arriba (Paso 2 datos), tiles MapTiler-free/OSM (mapas), FCM/Expo push (Slice 5), pins SPKI (Slice 6). La app Expo no corre headless → verificar con `type-check` + `jest` + `expo export`; validación visual la hace la usuaria (emulador).
>
> _Estado mobile hoy: solo auth/sesión. Sin tabs, cero features de campo. Backend F4–F8 ✅ cubre los endpoints (se consumen)._

---

_Última sesión previa: **F8 (Realtime + Notificaciones)** ✅ base — `RealtimeGateway` Socket.io (ns `/events`, handshake por access token + denylist, rooms `tenant`/`user`/`supervisors` derivadas server-side), traductor de eventos de dominio (reusa `EventBusService`) → notificación persistida (siempre) + WS, REST `/notifications` (scope own), `collector.location` throttled → `last_known_*` + broadcast a supervisores, canales push/SMS/email (stubs), job `PROMISE_DUE`. Contrato en `@kobrax/shared` (`types/realtime.ts`). 160 tests (23 nuevos); type-check + build + arranque verificados. **Backbone backend completo: F4✅ F5🚧(base) F6✅ F7✅ F8✅.** Panel web mínimo `/panel/*` ✅._

## Estado del proyecto
| Fase | Estado |
|------|--------|
| F0 — Fundación (monorepo + Pilar 1+2) | ✅ |
| F1 — Núcleo de datos + infra (4 pilares, RLS, seed) | ✅ |
| F2a Slice 1 — Bootstrap API (config, Prisma/RLS, Redis, common, /health) | ✅ |
| F2a Slice 2 — Auth core (login, refresh rotatorio+reuso, logout, lockout, RBAC) | ✅ |
| F2a Slice 3 — MFA (TOTP) + pre-auth token + select-account (máquina de estados) | ✅ |
| F2b backend — reset/change password, sesiones, MFA disable/regenerate + obligatoriedad | ✅ |
| F2a Slice 4 core — guards Jwt/Roles/Tenant + denylist + rate limit Redis + `GET /auth/me` | ✅ |
| F2a Slice 5 — **Web BFF** (Next.js 14, cookies httpOnly, login→mfa→setup→selector→dashboard) | ✅ |
| F2a Slice 6 — **Mobile** (Expo SDK 51, SecureStore + sesión offline, splash→login→mfa→setup→selector→home) | ✅ |
| F2b Web — recuperar/cambiar contraseña, setup MFA (QR+backup), sesiones (settings) | ✅ |
| F2b Mobile (11-15) — recuperar/cambiar contraseña, biometría, login offline, endurecimiento | ✅ |
| F2b Tests (16-18) — backend (47), web Vitest+RTL+MSW (22), mobile jest-expo+RNTL (23) | ✅ |
| **F2 completo.** Planificación F3-F8 redactada; F4 (Core Financiero) adelantado, dividido en fases | ✅ |
| **F4 Fase 1** — interceptores (TenantContext ALS + Audit + tokenize), 62 tests | ✅ |
| **F4 Fase 0** — cifrado PII (CryptoModule @Global + BlindIndex) + migración + seed cifrado, 67 tests | ✅ |
| **F4 Fase 2** — módulo clientes CU-02 (CRUD+PII+reveal+dedup+RLS A/B), 74 tests, e2e ok | ✅ |
| **F4 Fase 3** — créditos (cronograma French/Flat + mora idempotente + labels), 88 tests, e2e ok | ✅ |
| **F4 Fase 5** — importación clientes MVP (CSV/JSON, reconciliación, idempotente), 102 tests, e2e ok | ✅ |
| **F5 base** — casos: CRUD + estados v1 + generación + asignación + CASE_001/002/DUP, 115 tests, e2e ok | 🚧 (subset de v2 Fase 1) |
| **F6 base** — rutas (generación ordenada) + campo (visita GPS + evidencia SHA-256 inmutable), 126 tests, e2e ok | ✅ |
| **F7 base** — pagos: ledger inmutable + aplicación a la deuda + idempotencia + QR conciliado, 137 tests, e2e ok | ✅ |
| **F8 base** — realtime (gateway Socket.io + rooms aisladas) + notificaciones (traductor+persistencia+REST) + collector.location + PROMISE_DUE, 160 tests | ✅ |
| **Panel web mínimo** `/panel/{clients,credits,cases}` (revisión visual, adelanto F9) | ✅ |
| **Siguiente:** **F9 (Panel Web)** o **F10 (App Mobile)** — ambos consumen el canal WS `/events` de F8 · o cerrar delta F5 v2 · o F3 (RBAC/identidad, diferido) · o refinamiento | ⏭️ |

> **Diferido (con F3):** `TenantContextInterceptor` (necesita request-transaction/Prisma extension + endpoints de recursos)
> y `AuditInterceptor` (`audit_logs` es RLS + NOT NULL `account_id`; eventos sin cuenta no encajan aún).
> El backend de auth (F2a + F2b) está **funcionalmente completo y verificado**; lo que falta de F2 es **frontend** (web/mobile) + tests.

Detalle vivo en [`docs/epics/EPIC-F2a-nucleo-auth.md`](./epics/EPIC-F2a-nucleo-auth.md) §0.

## Tests
- **Backend** — harness **`node:test` + tsx**. Correr: `pnpm --filter @kobrax/api test` → **47 tests** verdes.
  - 21 de lógica pura (TOTP RFC-6238, `TokenService` access/pre-auth/refresh, `passwordPolicy`, `CryptoService` AES-256-GCM).
  - +26 service-level F2b (`password.service`, `session.service`, `auth.service` enforcement+lockout, `mfa.service`) con fakes de Prisma/Redis.
  - Specs en `apps/api/src/**/*.spec.ts`; helper `auth-test-utils.ts`. Excluidos de `nest build` (tsconfig.build) y del type-check (tsconfig.json).
- **Web** — **Vitest + RTL + MSW**. Correr: `pnpm --filter @kobrax/web test` → **22 tests** (`vitest run`).
  - Componentes: forgot/reset/sessions (MSW mockea el BFF). Unit: `routeByStep`, BFF `stepResponse/apiError`, `password-checklist`.
  - Config: `vitest.config.ts` (jsdom, alias `@`), `vitest.setup.ts` (jest-dom + MSW server + shim de URL relativa), `src/test/msw-server.ts`.
- **Mobile** — **jest-expo + RNTL**. Correr: `pnpm --filter @kobrax/mobile test` → **23 tests** (`jest`).
  - Lógica: `biometric`, `session` (ventana offline/touch), `auth-service` (`me` offline/ok + forgot + change). Screen: `forgot-password` (RNTL).
  - Config: `jest.config.js` con `transformIgnorePatterns` para **pnpm `.pnpm`** (si no, RN Flow rompe). Screens con timers → `jest.useFakeTimers()`.
- Los test files se **excluyen del type-check/build** en las tres apps (se chequean en runtime por su runner), patrón del seed.
- **Falta (a futuro):** integración `/auth/*` con testcontainers + `rls.spec` (F2a Slice 7); cobertura formal ≥80%.

## Cómo levantar el entorno mañana
```powershell
cd D:\kobrax\app-kobrax\kobrax
docker compose up -d                      # Postgres (host :5434) + Redis (:6379)
# (si hiciera falta) pnpm install ; pnpm --filter @kobrax/database db:generate
pnpm --filter @kobrax/api build
# arrancar API (queda en background; matar node de nodejs para detener):
cd apps\api ; node dist/main.js           # http://localhost:4010/api
```
- **Puerto API = 4010** (el 4000 lo ocupa wslrelay/Docker en este equipo).
- **F8 (realtime):** canal Socket.io en `ws://localhost:4010/events` (handshake `auth.token = <accessToken>`). El job `PROMISE_DUE` necesita la función SECURITY DEFINER — aplicar una vez (idempotente; ya aplicada en esta DB):
  `Get-Content packages/database/prisma/rls/004_notification_functions.sql -Raw | docker exec -i kobrax-postgres psql -U postgres -d kobrax`
  (el job es resiliente: si falta la función, loguea WARN y se omite, no rompe el boot).
- **Postgres del contenedor = host :5434** (5432/5433 ocupados por PG nativos).
- Health: `GET http://127.0.0.1:4010/api/health` → `{db:up, redis:up}`.

### Web (panel) — `apps/web`, puerto :3000
```powershell
pnpm --filter @kobrax/web dev          # http://localhost:3000  (usar DEV en local)
```
- BFF propio (sin next-auth): cookies httpOnly `k_access`/`k_refresh`/`k_preauth`. Lee la API vía `KOBRAX_API_URL` (`.env`, default :4010/api).
- ⚠ **Usar `next dev` en local**: en `next start` (prod) las cookies llevan `Secure` y no viajan sobre http → /me da 401. En prod real (https) es correcto.
- Login directo (`done`): `supervisor@`/`collector@`. Admins (`owner@`/`multi@`) → pantalla de setup MFA (enforcement F2b).
- Pantallas auth: `/login`, `/login/mfa`, `/login/mfa-setup`, `/login/select-account`, `/dashboard` (protegido por `middleware.ts` con refresh silencioso).
- **Gestión de cuenta (F2b):** `/forgot-password`, `/reset-password?token=`, y `/settings/security/{password,mfa,sessions}` (protegido). Handlers BFF en `/api/account/*`.
- **Panel de cartera (revisión visual, adelanto de F9):** `/panel/{clients,credits,cases}` (lista + detalle), server components que llaman a la API vía `apiCall` (cookie→Bearer); protegido en `middleware.ts`. Solo lectura: clientes (doc tokenizado + Revelar PII), créditos (cronograma + mora), casos (bitácora). **Entrar:** `manager@kobrax.demo`/`Kobrax123!` → botón «Cartera» en el dashboard. Es un panel mínimo de revisión; la versión completa es F9.
- ⚠ Con `node-linker=hoisted`, `next` está en el node_modules **raíz** → arrancar con `pnpm --filter @kobrax/web dev` (NO `node node_modules/next/...`).
- ⚠ El repo fija **`pnpm.overrides` react/react-dom = 18.2.0** (alineado con RN 0.74) para evitar el mismatch react/react-dom que rompe el build de Next bajo hoisted. No subir esa versión sin alinear mobile.

### Mobile (cobrador) — `apps/mobile`, Expo SDK 51
```powershell
pnpm --filter @kobrax/mobile start     # Expo Go / emulador  (type-check: pnpm --filter @kobrax/mobile type-check)
```
- **Sin BFF**: llama la API directo y guarda tokens en **SecureStore**. Modelo offline: `sessionValidUntil = min(7d, now+8h)`.
- API base vía `EXPO_PUBLIC_API_URL` (`apps/mobile/.env`). **Emulador Android usa `http://10.0.2.2:4010/api`**; dispositivo físico = IP de la PC en la LAN.
- Pantallas auth: `index` (splash), `(auth)/login|mfa|mfa-setup|select-account`. App: `(app)/home`. No corre en este entorno headless; se valida con `type-check` + `expo export` (bundle Metro).
- **Gestión de cuenta (F2b Mobile):** `(auth)/forgot-password` (email enmascarado + countdown), `(auth)/biometric-setup` + `(auth)/unlock` (biometría, `expo-local-authentication`), `(app)/force-password-change` (forzado/voluntario), `(app)/offline` (modo sin conexión). Navegación post-login centralizada en `src/post-login.ts` (`routeAfterAuth`: offline → cambio forzado → oferta biométrica → home).
- **Biometría** solo desbloquea el token local (no autentica contra API). **Endurecimiento:** timeout 8h vía `touchSession` + re-bloqueo en `_layout` al volver a primer plano. **SSL pinning:** `plugins/with-ssl-pinning.js` (Android NSC + iOS NSPinnedDomains) — NO-OP sin pins; requiere **dev build/prebuild** y pins SPKI reales en `app.json` (no Expo Go).
- ⚠ **pnpm**: el repo usa **`.npmrc` con `node-linker=hoisted`** (requerido por Expo/Metro para resolver deps transitivas). No quitarlo.

## Credenciales demo (todos `Kobrax123!`)
Tenant DEMO: `owner@kobrax.demo` (ACCOUNT_ADMIN) · `supervisor@kobrax.demo` (SUPERVISOR) · `collector@kobrax.demo` (COLLECTOR) · `manager@kobrax.demo` (MANAGER, sin MFA, con `client:write`+`client:pii:read` — útil para operar clientes/cartera).
Multi-tenant: `multi@kobrax.demo` → DEMO (SUPERVISOR, default) + DEMO2 (ACCOUNT_ADMIN).
> **⚠ F2b enforcement:** los roles críticos (ACCOUNT_ADMIN/SUPER_ADMIN) ahora **exigen MFA**. `owner@` y `multi@`
> al hacer login devuelven `step:'mfa_setup'` (no `done`) → hay que completar `mfa/setup/start`+`mfa/setup/verify`.
> Para login directo `step:'done'` usa `supervisor@` o `collector@` (sin MFA). MFA sigue **opcional** para no-críticos.

## Endpoints auth disponibles (Slice 3 + backend F2b — todos verificados con curl)
**Login / pasos:** `POST /auth/login` → `step: done | mfa | mfa_setup | select_account`.
`POST /auth/mfa/challenge {preAuthToken, code}` · `POST /auth/select-account {preAuthToken, accountId}` (403 AUTH_007).
`POST /auth/mfa/setup/start {preAuthToken}` · `POST /auth/mfa/setup/verify {preAuthToken, code}` (enroll obligatorio que completa login).
**MFA (Bearer):** `mfa/enroll` → `{otpauthUrl, secret}` · `mfa/verify {code}` → `{enabled, backupCodes[8]}` ·
`mfa/disable {password|code}` (204) · `mfa/backup-codes/regenerate` → `{backupCodes}`.
**Contraseña:** `forgot-password {email}` (200 siempre) · `reset-password {token, newPassword}` (AUTH_005/008, revoca sesiones) ·
`change-password {currentPassword, newPassword}` (Bearer, revoca sesiones).
**Sesiones (Bearer):** `GET /auth/sessions` (isCurrent) · `DELETE /auth/sessions/:id` (204) · `DELETE /auth/sessions` (todas menos actual).
**Identidad (Bearer):** `GET /auth/me` → `{ userId, email, profile, accountId, role, permissions }`.
`POST /auth/refresh` · `POST /auth/logout`.
**Rate limit (429 RATE_LIMITED):** global 100/min·IP + login 5/min·email+IP · mfa/challenge 5/min·IP · refresh 30/min·IP · forgot-password 3/h·email. Exime `/health`.
**Guards listos para F3:** `JwtAuthGuard`, `RolesGuard` (`@Roles('perm')`), `TenantGuard`, `@CurrentUser()` — exportados por `AuthModule`.
> TOTP en pruebas: `node -e "console.log(require('./dist/modules/auth/totp.js').totpNow('<secret>'))"` desde `apps/api`.
> En dev, el token de `forgot-password` se loguea (WARN `[PasswordService] [DEV] Reset token para ...`).

## Qué falta de F2 (F2a + F2b funcionalmente completos: backend + Web + Mobile + Tests ✅)
1. **Remates menores F2b (no bloquean):** gating de cambio forzado en **web** (historia 8, flag ya en `/auth/me`) +
   auditoría de eventos F2b (historia 5, con el `AuditInterceptor` de F2a S4) + GeoIP sesión (historia 6, diferible).
2. **SSL pinning mobile (historia 15):** inyectar pins SPKI reales en `app.json` y validar con dev build/prebuild
   cuando exista el endpoint productivo (plugin ya cableado, hoy NO-OP).
3. **Tests a futuro:** integración `/auth/*` con testcontainers + `rls.spec` (F2a Slice 7); cobertura formal ≥80%.
4. **Diferidos a F3:** `TenantContextInterceptor` + `AuditInterceptor` (ver §0 del EPIC-F2a para el porqué).

## Decisiones técnicas a respetar (de Slices 1-2)
- `@kobrax/shared` y `@kobrax/database` compilan a **CommonJS** (consumo NestJS).
- **Refresh token = JWT firmado** que lleva `accountId` (fija contexto RLS antes del lookup).
- Lookup cross-tenant de membresías = función **SECURITY DEFINER** `auth_memberships()`.
- En transacciones `withTenant`: **confirmar antes de lanzar** errores (un `throw` hace rollback).
- `APP_ENCRYPTION_KEY` ya seteada en `.env` (32 bytes hex) — la usa `CryptoService`/MFA.

## Prompt para empezar mañana
> **F2 completo: backend (F2a 1-4 + F2b) + Web (F2a S5 + F2b) + Mobile (F2a S6 + F2b 11-15) + Tests (16-18: api 47, web 22, mobile 23, todos verdes). Levanta el entorno (docker + API con `cd apps/api; node dist/main.js`; web `pnpm --filter @kobrax/web dev`; tests con `pnpm --filter @kobrax/{api,web,mobile} test`), verifica /health, y arranca **F3 (recursos del negocio: clients/credits/cases)** sobre los guards ya listos (JwtAuthGuard/RolesGuard/TenantGuard/@CurrentUser), implementando de paso los diferidos `TenantContextInterceptor` + `AuditInterceptor`. Alternativa: remates menores F2b (gating forzado web historia 8, auditoría historia 5, pins SSL reales historia 15). NB infra: `.npmrc` node-linker=hoisted + `pnpm.overrides` react/react-dom 18.2.0 (no tocar); tests excluidos del type-check/build; jest-expo necesita transformIgnorePatterns sobre `.pnpm`.**
