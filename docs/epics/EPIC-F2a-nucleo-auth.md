# EPIC F2a — Núcleo de Autenticación + Multi-tenant + Bootstrap API

**ID:** EPIC-F2a · **Estado:** 📋 Listo para iniciar · **Owner:** API + Security (+ Shared, Web, Mobile, Testing)
**Depende de:** F1 (DB + RLS) · **Requisitos:** CU-01, RF-01, RF-03, RNF-01, RNF-04
**Design:** [design-system.md](../design-system.md) (vinculante)

> **División F2:** F2a = núcleo para **autenticar y mantener sesión segura** (desbloquea F3).
> [F2b](./EPIC-F2b-gestion-cuenta.md) = gestión de cuenta (reset, sesiones UI, MFA setup, biometría, offline).

## 0. Estado de ejecución
**Slice 1 (cimiento) ✅** — verificado:
- Migraciones `add_auth_tables` (refresh_tokens, mfa_backup_codes, ALTER user_sessions) + RLS (30 tablas / 24 policies).
- `@kobrax/shared`: design tokens, `passwordPolicy`, tipos de auth (`PreAuthPayload`, `LoginResult`…).
- API NestJS booteable: config (zod fail-fast), PrismaService (kobrax_app/RLS), Redis, common
  (`TransformInterceptor`, `GlobalExceptionFilter`, request-id, ValidationPipe, helmet, CORS), `/health`.
- Tareas hechas: **1, 3, 5, 14, 16, 17** + parte de 15.

**Decisiones de ejecución (reproducibilidad):**
- **Puerto API = 4010** (el 4000 lo ocupa wslrelay/Docker en este equipo). En `.env`/`.env.example`.
- **`@kobrax/shared` y `@kobrax/database` se compilan a CommonJS** (`"type":"commonjs"`) para que NestJS
  (CJS) los pueda `require`; los bundlers de web/mobile también consumen CJS sin problema.
- `enableShutdownHooks()` solo fuera de win32 (en Windows detached lanza `kill ENOSYS`).

**Slice 2 (auth core) ✅** — verificado end-to-end:
- `CryptoService` (AES-256-GCM, IV por registro). Login bcrypt wf12 + lockout (5→15min) + timing guard.
- Emisión JWT (access 15m + refresh rotatorio como JWT firmado con accountId). Sesiones + `refresh_tokens`.
- Refresh: rotación + **detección de reuso** (revoca familia) + ventana de gracia 10s. Logout + denylist Redis.
- RBAC: permisos resueltos por rol (admin=22, collector=8). Multi-tenant: lookup cross-tenant vía
  función **SECURITY DEFINER** `auth_memberships()` (acotada); todas las escrituras vía `withTenant` (RLS).
- Tareas hechas: **4, 6, 9, 10** + DTOs login/refresh/logout (parte de 15).

**Decisiones/hallazgos del Slice 2:**
- **Refresh token = JWT firmado** (lleva `accountId`) → permite fijar el contexto RLS antes del lookup en DB.
- **`auth_memberships()` SECURITY DEFINER**: el login necesita leer membresías cross-tenant antes de tener
  contexto; la función (owner=postgres) bypassa RLS solo para ese lookup acotado (`prisma/rls/002_auth_functions.sql`).
- **🐛 Bug corregido:** la revocación de familia en el reuso se hacía dentro de `withTenant` y luego se
  lanzaba el error → Prisma hacía **rollback** y la revocación se perdía (el token reutilizado seguía válido).
  Fix: confirmar la transacción (patrón por retorno) y lanzar el error **fuera**.
- Login permite tenants `ACTIVE` y `TRIAL` (solo bloquea SUSPENDED/CANCELLED/INACTIVE, según CU-01).
- Seed: tenant DEMO ahora `ACTIVE`. Login/refresh con `@HttpCode(200)`; `lockedUntil` propagado en `error.details`.

**Slice 3 (MFA + pre-auth + select-account) ✅** — verificado end-to-end:
- **TOTP RFC-6238** (`totp.ts`, solo `node:crypto`, HMAC-SHA1 + base32, ventana ±1). Sin deps externas.
- **`MfaService`**: enroll (secret cifrado AES-256-GCM, **no** activa MFA), verify (TOTP → activa + emite 8
  backup codes hasheados SHA-256 en `mfa_backup_codes`), challenge (TOTP o backup code **de un solo uso**, CAS atómico).
- **Pre-auth token** en `TokenService`: `signPreAuth`/`verifyPreAuth` (5 min, `type:'pre_auth'`, `purpose` mfa|select_account).
  `signAccess` ahora marca `type:'access'` y `verifyAccess` lo exige → pre-auth y access **no son intercambiables**.
- **Login = máquina de estados** (`AuthService`): password → (MFA si `mfa_enabled`) → (select_account si ≥2 tenants) → tokens.
  Endpoints `POST /auth/mfa/challenge`, `POST /auth/select-account`, `POST /auth/mfa/enroll|verify` (Bearer).
- MFA **opcional** (obligatoriedad = F2b). Seed: tenant `DEMO2` + `multi@kobrax.demo` (2 empresas) para probar select-account.
- Tareas hechas: **7, 8** + DTOs mfa-challenge/mfa-verify/select-account (parte de 15).

**Decisiones/hallazgos del Slice 3:**
- TOTP propio en vez de otplib/speakeasy (regla "zero deps pesadas"); compatible con Google Authenticator/Authy.
- enroll/verify por ahora extraen identidad del **Bearer en el controller** (`TokenService.verifyAccess`) —
  puente temporal hasta el `JwtAuthGuard` con denylist (Slice 4); la verificación de firma ya aplica.
- `mfa_backup_codes` y `users` son **globales (sin RLS)** → acceso Prisma directo sin `withTenant`.
- Errores: `AUTH_006` (MFA inválido, 401), `AUTH_007` (no pertenece a la empresa / tenant inactivo, 403).

**Slice 4 (guards + rate limit + /auth/me) 🔶 core ✅** — verificado con curl:
- **Guards**: `JwtAuthGuard` (access + **denylist Redis**) + `@CurrentUser` (ya de F2b), `RolesGuard`
  (`@Roles(...permisos)`, exige todos) y `TenantGuard` (exige `accountId`; ownership de recurso llega en F3).
  Todos exportados por `AuthModule` para los módulos de recursos de F3.
- **Rate limiting** (`common/guards/rate-limit.guard.ts`, ventana fija Redis, **global APP_GUARD**): global 100/min·IP +
  `@RateLimit` por endpoint → login 5/min·email+IP, mfa/challenge 5/min·IP, refresh 30/min·IP, forgot-password 3/h·email
  (esto último **cierra la historia 5 de F2b**). Exime `/health`. Responde **429 RATE_LIMITED** con `retryAfterSeconds`.
- **`GET /auth/me`** (Bearer) → `{ userId, email, profile, accountId, role, permissions }`.
- Tareas hechas: **11, 13** (rate limit) + parte de 5 (`GET /auth/me`).

**Diferido de Slice 4 (con justificación):**
- **Task 2 `TenantContextInterceptor`**: fijar `SET LOCAL app.current_account_id` a nivel request necesita una
  transacción que abarque todo el request (o un Prisma client extension + AsyncLocalStorage). Hoy el contexto RLS
  se fija por operación con `withTenant`, suficiente para auth. Se implementa con los endpoints de recursos de **F3**.
- **Task 12 `AuditInterceptor`**: `audit_logs` tiene `account_id` NOT NULL + RLS; los eventos sin cuenta (LOGIN_FAILED,
  forgot-password) no encajan sin decidir el modelo de auditoría cross-tenant. Se aborda junto a F3/F12.

**Slice 5 (Web BFF) ✅** — scaffolding completo + verificado con curl contra la API:
- **Next.js 14 (App Router)** scaffold: tailwind con tokens Kobrax, Inter/JetBrains Mono, design-system aplicado
  (hero gradiente+wave, btn navy h48, inputs 1.5px, OTP 44×52 mono, banner `role=alert`, footer TLS).
- **BFF propio (sin next-auth, decisión §8)**: route handlers `/api/auth/{login,mfa/challenge,mfa/setup,select-account,logout,me}`
  que proxyean a la API y guardan **access/refresh/pre-auth en cookies httpOnly** (`SameSite=Strict`, `Secure` en prod).
  El navegador **nunca ve los tokens**. CSRF: verificación de `Origin` en rutas mutantes + SameSite.
- **`middleware.ts`**: protege `/dashboard` y hace **refresh silencioso** (cookie access maxAge 15m expira → pide par nuevo con el refresh → re-setea cookies; sin refresh válido → /login).
- **Pantallas**: `/login`, `/login/mfa` (TOTP + toggle backup code), `/login/mfa-setup` (enforcement: clave manual + verificación + backup codes descargables), `/login/select-account`, y `/dashboard` (server component hidratado de `/auth/me` + logout).
- Tareas hechas: **18, 19, 20, 21** + 22 parcial (middleware ✅; Zustand no usado — estado server-side vía `/auth/me` + sessionStorage solo para la lista de empresas, no sensible).

**Verificado (curl con cookies contra :3000→:4010):** login `done`+cookies httpOnly · `/auth/me` round-trip · logout limpia+401 ·
owner `mfa_setup`→start→verify(TOTP)→`done`+backupCodes+sesión→login `mfa` · multi `mfa_setup` (enforcement intercepta antes del selector) · bad creds 401 AUTH_001.
> ⚠ Cookies `Secure` en prod (`next start`) no viajan sobre http local → para verificar local usar `next dev`. En prod (https) es correcto.

**Slice 6 (Mobile) ✅** — scaffolding completo + verificado con bundle de Metro:
- **Expo SDK 51 (Expo Router)** scaffold: tema tipado desde tokens Kobrax, design-system mobile aplicado
  (hero `LinearGradient`, btn h52, OTP 44×52, banner `role=alert`). Estilos con StyleSheet (NativeWind diferible).
- **Sin BFF (a diferencia de web)**: el mobile llama la API directo y guarda tokens en **SecureStore** (hardware-backed,
  nunca AsyncStorage). **Modelo de sesión offline (§9)**: `sessionValidUntil = min(refresh 7d, now+8h inactividad)`;
  acceso offline mientras `now < sessionValidUntil` (la biometría que lo desbloquea = F2b). Refresh silencioso + logout.
- **Pantallas (expo-router)**: `index` (splash/bootstrap decide home/login por sesión), `(auth)/login`, `/mfa` (TOTP+backup),
  `/mfa-setup` (enforcement: clave manual + verificación + backup codes), `/select-account`, `(app)/home` (hidrata `/auth/me` + logout).
- Tareas hechas: **23, 24, 25, 26**.

**Decisiones/hallazgos del Slice 6:**
- **pnpm + Metro**: el store aislado de pnpm rompe la resolución de deps transitivas de Expo (peers de expo-router,
  `@babel/runtime`…). Fix oficial de Expo → **`.npmrc` raíz con `node-linker=hoisted`**. Aplicado + reinstalado;
  re-verificado que **api (type-check + 21 tests) y web (type-check) siguen verdes** y la API bootea (`/health` ok).
- **Verificación:** una app Expo no corre en este entorno headless. Se validó con `tsc --noEmit` (verde) **y un bundle
  real de Metro** (`expo export -p android` → 824 módulos, bundle Hermes 2.07 MB) → todas las rutas/imports resuelven.

**Siguiente:** cerrar interceptores diferidos (con F3); Slice 7 (Tests service-level + integración); F2b Web/Mobile (historias 7-15).

## 1. Objetivo de negocio
Que cualquier actor (Owner, Admin, Supervisor, Collector, Auditor, Viewer) pueda
**autenticarse de forma segura** desde web o mobile, elegir su empresa, y que toda
petición quede acotada a su tenant por RLS. Es la puerta de entrada de la plataforma.

## 2. Alcance
### Incluye
- Bootstrap NestJS + config validada + Prisma runtime (`APP_DATABASE_URL`) + contexto RLS por request.
- `CryptoService` (AES-256-GCM) — **se construye aquí** porque `mfa_secret` lo necesita (F4 lo reutiliza).
- Login → (MFA si aplica) → (selección de empresa si aplica) → tokens. Refresh rotatorio, logout, `/auth/me`.
- MFA TOTP **opcional** (enroll + verify + challenge en login + backup codes). *Obligatoriedad → F2b.*
- RBAC: guards `Jwt`/`Roles`/`Tenant` + revocación instantánea por sesión (Redis denylist).
- Borde: helmet, CORS allowlist, rate limiting (login/mfa/refresh).
- Migraciones: `refresh_tokens` (nueva), `mfa_backup_codes` (nueva), **ALTER** `user_sessions`.
- Web: arquitectura **BFF** + pantallas login / MFA challenge / selector de empresa.
- Mobile: splash/bootstrap + login + MFA challenge + selector + almacenamiento seguro de tokens.

### No incluye → F2b
- Reset de contraseña, gestión de sesiones (UI + endpoints list/revoke), setup MFA (UI), **MFA obligatorio**,
  biometría, login offline, cambio de contraseña forzado.
### No incluye → otras fases
- CRUD usuarios/roles/tenants → F3 · SSO/Azure AD → F12 · onboarding SaaS → F3.

## 3. Reconciliación de inconsistencias (decisiones firmes)
| # | Inconsistencia detectada | Decisión |
|---|--------------------------|----------|
| B1 | `user_session` "nueva" pero `user_sessions` **ya existe** (F0) | **ALTER** additivo, no CREATE. Nombre `user_sessions` (modelo `UserSession`). |
| B2 | `mfa_secret` cifrado exige crypto, planificado en F4 | `CryptoService` se crea en **F2a**; F4 lo reutiliza. |
| B3 | Backup codes "en DB" sin tabla | tabla **`mfa_backup_codes`** (F2a). |
| B4 | Tokens intermedios sin definir + orden filtra tenants | **Pre-auth token** firmado single-purpose + `POST /auth/select-account`. Orden: password→MFA→selección→tokens. |
| B5 | Race en rotación de refresh | **ventana de gracia 10s** + update atómico por `token_hash`. |
| B6 | Política de contraseña solo en front | validador en **`@kobrax/shared`**, aplicado server-side. |
| B7 | Rate-limit incompleto | añadido en `mfa/challenge` y `refresh`. |
| X1 | Tokens de diseño triplicados | única fuente `shared/design/tokens.ts` (ver design-system.md). |
| X3 | Revocación tarda hasta 15 min | `JwtAuthGuard` consulta **denylist de `sessionId` en Redis**. |

## 4. Flujo de autenticación (máquina de estados)
```
POST /auth/login {email,password}
  ├─ locked/suspended/tenant inactivo → 401/423 (mensaje genérico)
  ├─ password inválida → incrementa failed_login_attempts → 401
  └─ OK →
       ├─ mfa_enabled?  → { step:'mfa', preAuthToken }            (purpose:'mfa')
       └─ no MFA → [paso empresa]

POST /auth/mfa/challenge {preAuthToken, code}   (TOTP o backup code)
  └─ OK → [paso empresa]

[paso empresa]
  ├─ ≥2 user_accounts activos → { step:'select_account', preAuthToken, accounts:[…] }
  └─ 1 cuenta → emite tokens finales

POST /auth/select-account {preAuthToken, accountId}
  └─ valida pertenencia + tenant activo → emite tokens finales { accessToken, refreshToken }
```
> La lista de empresas **nunca** se devuelve antes de validar password+MFA (no filtra membresía).

### Tokens
- **Access JWT** (15 min): `{ sub, accountId, roleId, permissions[], sessionId, iat, exp }`.
- **Refresh** (7 d, rotatorio): opaco; en DB solo su **hash SHA-256**; ligado a `family_id` + `session_id`.
- **Pre-auth token** (5 min, single-purpose): `{ sub, purpose:'mfa'|'select_account', mfaVerified?, iat, exp }`.
  Sin `permissions` ni `accountId`. **No** es tabla; es un JWT efímero (cookie temporal web / memoria mobile).

## 5. Contratos API (F2a)
```
POST /auth/login            → 200 {step, preAuthToken?|accessToken?, refreshToken?, accounts?}
                              401 AUTH_001 · 423 AUTH_002 (locked + locked_until)
POST /auth/mfa/challenge     → 200 {step|tokens} · 401 AUTH_006 (código inválido, N intentos)
POST /auth/select-account    → 200 {accessToken, refreshToken} · 403 AUTH_007 (no pertenece/ tenant inactivo)
POST /auth/refresh           → 200 {accessToken, refreshToken} · 401 AUTH_003 · 401 AUTH_004 REUSE_DETECTED
POST /auth/logout            → 204 (revoca refresh + sesión actual; añade sessionId a denylist)
POST /auth/mfa/enroll        → 200 {otpauthUrl, secret}        (Bearer)
POST /auth/mfa/verify        → 200 {enabled:true, backupCodes[]} (Bearer; activa MFA)
GET  /auth/me                → 200 {userId, email, profile, accountId, role, permissions}
GET  /health                 → 200 {db, redis}   ·  GET /health/live → 200 (liveness)
```
Toda respuesta envuelta en `{ data, meta, error }` (contrato `@kobrax/shared`).

## 6. Modelo de datos
### `refresh_tokens` (NUEVA)
`id, account_id, user_id, token_hash(SHA-256), family_id, session_id→user_sessions, expires_at, revoked_at?, replaced_by?, created_at`. Append-only. RLS por `account_id`.

### `user_sessions` (ALTER — ya existe de F0)
Existentes: `id, user_id, account_id, ip_address, device_info, login_at, logout_at, is_active`.
**Añadir:** `device_name, device_type(web|mobile|api), os, city?, country?, last_seen_at, expires_at, revoked_at?`.
> `last_seen_at` se actualiza **throttled** (máx 1×/5 min) para no escribir en cada request.
> "Activa" = `revoked_at IS NULL AND now() < expires_at`.

### `mfa_backup_codes` (NUEVA — usuario global, sin account_id)
`id, user_id, code_hash(SHA-256), used_at?, created_at`. 8 por usuario; un solo uso.

## 7. Historias y tareas
| # | Historia | Agente | Estado |
|---|----------|--------|--------|
| **BACKEND** ||||
| 1 | Bootstrap NestJS + ConfigModule (zod, fail-fast secretos) | API | ⏳ |
| 2 | PrismaModule runtime + `TenantContextInterceptor` (`$transaction` + `SET LOCAL`) | API+Security | ⏳ |
| 3 | Common: `TransformInterceptor`, `GlobalExceptionFilter`, `ValidationPipe`(whitelist), request-id | API | ⏳ |
| 4 | `CryptoService` AES-256-GCM (IV aleatorio por registro) | Security | ⏳ |
| 5 | Migraciones: `refresh_tokens`, `mfa_backup_codes`, ALTER `user_sessions` (+RLS) | Database | ⏳ |
| 6 | Login + `failed_login_attempts`/lockout 15 min | Security | ⏳ |
| 7 | MFA: enroll/verify + challenge en login + backup codes (hash) | Security | ✅ |
| 8 | Pre-auth token + `POST /auth/select-account` (orden password→MFA→empresa) | Security | ✅ |
| 9 | Refresh rotatorio + detección de reuso + **ventana de gracia 10s** | Security | ⏳ |
| 10 | Logout (revoca refresh + sesión + denylist Redis) | Security | ⏳ |
| 11 | Guards `Jwt`/`Roles`/`Tenant` + **denylist de sessionId (Redis)** | Security | ✅ (`Jwt`+`Roles`+`Tenant`+`@CurrentUser`+denylist; ownership de recurso en F3) |
| 12 | `AuditInterceptor` eventos de auth → `audit_logs` | Security | ⏳ (diferido: `audit_logs` RLS + eventos sin cuenta → con F3/F12) |
| 13 | Borde: helmet, CORS allowlist, throttler (login 5/min, mfa 5/min, refresh, global 100/min) | API | ✅ (helmet/CORS en S1; rate limit Redis en S4) |
| 14 | Health `/health` (DB+Redis) + `/health/live` | API | ⏳ |
| **SHARED** ||||
| 15 | DTOs/tipos: `LoginDto`, `MfaChallengeDto`, `SelectAccountDto`, `AuthTokens`, `JwtPayload`, `PreAuthPayload` | Shared | ⏳ |
| 16 | `passwordPolicy` (validador único web/mobile/API) | Shared | ⏳ |
| 17 | `design/tokens.ts` + `KOBRAX_GRADIENT` (web string / mobile colors[]) | Shared | ⏳ |
| **WEB** ||||
| 18 | **BFF**: route handlers que proxyean a la API y setean cookies httpOnly | Web | ✅ |
| 19 | Pantalla login (`/login`) | Web | ✅ |
| 20 | Pantalla MFA challenge (`/login/mfa`) | Web | ✅ (+ `/login/mfa-setup` para enforcement) |
| 21 | Pantalla selector de empresa (`/login/select-account`) | Web | ✅ |
| 22 | Route protection (`middleware.ts`) + estado UI (Zustand, solo no-sensible) | Web | 🔶 middleware+refresh ✅; estado server-side vía `/auth/me` (sin Zustand aún) |
| **MOBILE** ||||
| 23 | Splash/bootstrap (`app/index.tsx`) | Mobile | ✅ |
| 24 | Pantalla login (`app/(auth)/login.tsx`) | Mobile | ✅ |
| 25 | MFA challenge + selector de empresa | Mobile | ✅ (+ `mfa-setup` enforcement) |
| 26 | `auth.service` + **SecureStore** + modelo de sesión offline | Mobile | 🔶 SecureStore + `sessionValidUntil` ✅; biometría/SSL pinning = F2b |
| **TESTING** ||||
| 27 | Backend unit (login/lockout/rotación/reuso/MFA) ≥90% | Testing | 🔶 harness `node:test`+tsx; 21 tests verdes de lógica pura (TOTP/tokens/policy/crypto); faltan service-level con mocks Prisma |
| 28 | Integración `/auth/*` (testcontainers) + `rls.spec` | Testing | ⏳ |
| 29 | Web `login/mfa/select` (Vitest+RTL+MSW) · Mobile `login/mfa` (RNTL) | Testing | ⏳ |

## 8. Arquitectura Web — **BFF (decisión firme)**
- **No** se usa next-auth. Se usa un **BFF propio** con Route Handlers de Next.js:
  el navegador nunca ve tokens en JS. El BFF guarda **access (httpOnly, ~15m)** y **refresh
  (httpOnly, Strict, Secure, ~7d)** en cookies; RSC y handlers leen la cookie y llaman a la API.
- **CSRF:** `SameSite=Strict` + verificación de `Origin` en rutas mutantes; el refresh solo lo
  dispara el BFF (mismo origen). Opcional double-submit para defensa adicional.
- **Zustand** solo guarda estado **no sensible** (perfil, permisos para *gating* de UI), hidratado de `/auth/me`.

## 9. Mobile — modelo de sesión **offline-aware** (corrige M1)
- En login se guardan en **SecureStore** (con `requireAuthentication`/keychain access control):
  `refreshToken` + `sessionValidUntil = min(refresh.expires_at, now + 8h inactividad)`.
- **Acceso offline** permitido mientras `now < sessionValidUntil` **y** pase la biometría —
  **no** depende del access de 15 min (demasiado corto para campo).
- Al recuperar señal → refresh silencioso; si el refresh fue revocado → logout con mensaje.
- (SSL pinning y biometría completa se endurecen en F2b; aquí queda el almacenamiento seguro base.)

## 10. Seguridad & Cumplimiento (checklist F2a)
- [ ] bcrypt wf ≥ 12 · comparación de hash en timing constante · mensajes genéricos (anti-enumeration).
- [ ] Lockout 5 intentos → `locked_until` 15 min; reset en login OK.
- [ ] Login valida `user_status=ACTIVE` + tenant `ACTIVE` (no SUSPENDED/CANCELLED).
- [ ] Access 15 min; refresh rotatorio + reuso→revoca familia + **gracia 10s**; refresh hasheado en DB.
- [ ] `sessionId` en JWT; `JwtAuthGuard` consulta **denylist Redis** (revocación instantánea).
- [ ] Web: tokens en cookie httpOnly (BFF), nunca en JS/localStorage; CSRF mitigado.
- [ ] Mobile: tokens en SecureStore hardware-backed, nunca AsyncStorage.
- [ ] MFA TOTP, `mfa_secret` **cifrado AES-256-GCM** (CryptoService); backup codes hasheados.
- [ ] Contexto RLS por request (`kobrax_app` + `SET LOCAL`); `TenantGuard`; nunca superuser en runtime.
- [ ] Rate limit: login 5/min·email+IP, mfa 5/min, refresh, global 100/min (Redis).
- [ ] `ValidationPipe` whitelist+forbidNonWhitelisted; fail-fast de secretos al boot.
- [ ] Auditoría: `LOGIN_SUCCESS/FAILED`, `MFA_FAILED`, `TOKEN_REFRESH`, `TOKEN_REFRESH_REUSE`(⚠crítico),
      `LOGOUT`, `ACCOUNT_LOCKED`, `MFA_ENABLED`, `ACCOUNT_SELECTED` → `audit_logs` (sin PII innecesaria).

## 11. DoD (F2a)
- [ ] `owner@kobrax.demo` (single-tenant) y un usuario multi-tenant completan login → tokens.
- [ ] Orden password→MFA→selección respetado; `accounts` no se filtra pre-MFA (test).
- [ ] Refresh rota; reuso revoca familia; dos refresh concurrentes no se auto-expulsan (gracia) (test).
- [ ] 5 fallos → bloqueo 15 min (test). Logout + revocación de sesión surten efecto **inmediato** (denylist).
- [ ] `mfa_secret` nunca legible en API/logs; backup code de un solo uso (test).
- [ ] `rls.spec` verde (aislamiento por tenant). `/health` ok.
- [ ] Web: login→(mfa)→(selector)→dashboard. Mobile: splash→login→(mfa)→(selector)→home.
- [ ] Cobertura `auth` ≥ 90%; `lint`+`type-check`+`test` verdes; sin `any`.
- [ ] DoD visual de design-system.md cumplido en las 3 pantallas web y mobile.

## 12. Riesgos
| Riesgo | Mitigación |
|--------|-----------|
| Replay/fuga de token | rotación + reuso + TTL 15m + hash + denylist |
| Enumeración | mensajes genéricos + rate limit + timing constante |
| Bypass de tenant | RLS + TenantGuard |
| Race de refresh (mobile) | ventana de gracia 10s + update atómico |
| Superuser en runtime | `APP_DATABASE_URL` (kobrax_app) + test verificador |
| Conflicto con `user_sessions` de F0 | migración **ALTER** additiva (no CREATE) |

## 13. Habilita
F3 (CRUD usuarios/roles), F2b (gestión de cuenta), F9/F10 (apps).
