# EPIC F2b — Gestión de Cuenta, MFA Avanzado y Experiencia

**ID:** EPIC-F2b · **Estado:** ✅ Backend + Web + Mobile + Tests (historias 1-4, 7-18) · Solo remates menores (8 gating web, 5 auditoría, 6 GeoIP, 15 pins SSL reales) · **Owner:** Security + Web + Mobile (+ Shared, Testing)
**Depende de:** **F2a** (núcleo de auth) · **Requisitos:** CU-01, RNF-01, RNF-05
**Design:** [design-system.md](../design-system.md) (vinculante)

> Segunda mitad de F2. Construye la **experiencia de gestión de la propia cuenta** sobre
> el núcleo de [F2a](./EPIC-F2a-nucleo-auth.md). No bloquea a F3 (que solo necesita F2a).

## 0. Estado de ejecución
**Backend (historias 1-4) ✅** — verificado end-to-end con curl:
- **Recuperar contraseña**: `forgot-password` (token 30 min, hash SHA-256 en `password_reset_tokens`,
  **anti-enumeration** — 200 idéntico exista o no; token logueado en dev hasta tener email en F8) +
  `reset-password` (valida `passwordPolicy` server-side, **un solo uso**, AUTH_005/AUTH_008, **revoca todas las sesiones**).
- **`change-password`** (Bearer): verifica actual + policy + **revoca todas las sesiones** (re-login forzado).
- **Sesiones**: `GET /auth/sessions` (cross-tenant vía SECURITY DEFINER `auth_user_sessions`, marca `isCurrent`),
  `DELETE /auth/sessions/:id`, `DELETE /auth/sessions` (todas menos la actual) → revoca DB + **denylist Redis (instantáneo)**.
- **MFA avanzado**: `mfa/disable` (re-auth password|código), `mfa/backup-codes/regenerate` (invalida los previos),
  y **MFA obligatorio** para `ACCOUNT_ADMIN`/`SUPER_ADMIN`: login sin MFA → `step:'mfa_setup'` + `mfa/setup/start`
  y `mfa/setup/verify` (enroll gated por pre-auth `purpose:'mfa_enroll'` que **completa el login**).
- **Adelantado de F2a Slice 4**: `JwtAuthGuard` + `@CurrentUser` (verifica access + **lee denylist Redis**) —
  todos los endpoints Bearer de F2b lo usan; reemplazó el puente temporal `userIdFromBearer` del controller.

**Decisiones/diferidos del backend F2b:**
- **Historia 5 (rate-limit `forgot-password` 3/h + auditoría) DIFERIDA**: depende del throttler y del `AuditInterceptor`
  que son F2a Slice 4 (tasks 12-13). Se añade cuando exista esa infra.
- `password_reset_tokens` y la función `auth_user_sessions` son **globales/SECURITY DEFINER** (mismo patrón que
  `auth_memberships`); migración `20260616180000_add_password_reset_tokens` + `prisma/rls/003_session_functions.sql`.
- Nuevos códigos de error: `AUTH_005` (token reset), `AUTH_008` (password débil), `AUTH_009` (MFA obligatorio).
- Tipos shared: `LoginStep` += `'mfa_setup'`, `PreAuthPurpose` += `'mfa_enroll'`, nuevo `SessionInfo`.

**Web (historias 7-10) ✅** — sobre el Web BFF de F2a Slice 5, verificado con curl+cookies:
- **Recuperar contraseña**: `/forgot-password` (200 genérico) + `/reset-password` (token de la URL + checklist de
  política `checkPassword` de shared en vivo + confirmación). Handlers BFF `/api/auth/{forgot,reset}-password`.
- **Cambio de contraseña** (`/settings/security/password`): verifica actual + policy; el backend revoca todas las
  sesiones → el BFF **limpia las cookies** y la UI fuerza re-login.
- **Setup MFA** (`/settings/security/mfa`): enroll → **QR** (lib `qrcode`, render local, sin enviar el secreto a terceros) +
  clave manual → verificar (OTP) → backup codes descargables; además **regenerar** y **desactivar** (con contraseña).
- **Sesiones** (`/settings/security/sessions`): lista (device/OS/IP/último acceso, marca la actual) + cerrar una / todas.
- Handlers BFF `/api/account/{change-password,mfa,sessions,sessions/[id]}` (auth por cookie). `/settings` protegido en `middleware.ts`.
- Backend: se añadió `mfaEnabled` y `requiresPasswordChange` a `GET /auth/me` (la UI de MFA los necesita).

**Decisiones/hallazgos del Web F2b:**
- **Infra pnpm (importante):** el monorepo quedó con `node-linker=hoisted` (por Expo/Mobile). Eso cruzó versiones de
  React (web resolvía `react@18.2.0` + `react-dom@18.3.1` → `useContext null` en build). Fix: **`pnpm.overrides` a
  react/react-dom `18.2.0`** (alineado con RN 0.74) en el `package.json` raíz + reinstalación limpia. Re-verificado api/web/mobile.
- **Historia 8 (forzado)**: el cambio voluntario está hecho; el *gating* de `requires_password_change` (redirigir a cambio
  forzado) queda como remate menor (el flag ya se expone en `/auth/me`).
- **Servir web en local**: con hoisted, `next` está en el node_modules raíz → arrancar con `pnpm --filter @kobrax/web dev` (no `node node_modules/next/...`).

**Mobile (historias 11-15) ✅** — sobre el cliente Expo de F2a Slice 6, verificado con `type-check` + `expo export` (bundle Metro, 864 módulos):
- **Recuperar contraseña** (`(auth)/forgot-password`): correo → `/auth/forgot-password` (200 genérico). Estado de éxito con **email enmascarado** (`j***@banco.com`) + **countdown de reenvío** (30s). El reset se completa por el enlace web (mismo token de la API).
- **Cambio de contraseña** (`(app)/force-password-change`): actual + nueva + checklist de política `checkPassword` de shared en vivo. Por defecto **forzado** (sin escape); `?voluntary=1` permite cancelar. El backend revoca todas las sesiones → `authService.changePassword` **limpia la sesión local** y fuerza re-login. **Gating**: `routeAfterAuth` redirige aquí si `me.requiresPasswordChange`.
- **Biometría** (`src/biometric.ts` con `expo-local-authentication`): `(auth)/biometric-setup` (oferta única tras login, gated por `shouldOfferBiometricSetup`) + `(auth)/unlock` (desbloqueo al abrir si está activada). **Solo desbloquea el token local**, nunca autentica contra la API; el fallback siempre es re-login con contraseña.
- **Login offline** (`(app)/offline`): banner amarillo + countdown de `sessionValidUntil`; `me()` distingue **fallo de red (offline)** de **auth (login)**. Ventana vencida sin red → exige reconexión. "Reintentar conexión" reusa `routeAfterAuth`.
- **Endurecimiento**: timeout de inactividad 8h vía `touchSession` (se extiende con actividad) + **re-bloqueo al volver a primer plano** (AppState en `_layout`, re-evalúa por el splash si hay biometría o venció la ventana). **SSL pinning**: config plugin `plugins/with-ssl-pinning.js` (Android network-security-config + iOS NSPinnedDomains) — **NO-OP seguro sin pins**; requiere dev build/prebuild + pins SPKI reales (no aplica en Expo Go).
- Navegación centralizada en `src/post-login.ts` (`routeAfterAuth`): orden offline → cambio forzado → oferta biométrica → home. `goToStep('done')` y el splash la reutilizan.

**Decisiones/hallazgos del Mobile F2b:**
- `Me` mobile += `mfaEnabled` y `requiresPasswordChange` (alineado con el `/auth/me` del backend F2b).
- `authService.me()` ahora devuelve `MeResult` (`ok | offline | unauthenticated`) en vez de `Me | null`, para soportar el modo offline sin perder la distinción red/auth.
- **SSL pinning**: en Expo managed exige config plugin + dev build (no Expo Go). Se deja el plugin cableado y documentado; los **pins reales del certificado** se inyectan vía `app.json` (`{ domain, pins: ["sha256/…"] }`) cuando exista el endpoint productivo (TODO en el plugin con el comando openssl).

**Testing (historias 16-18) ✅** — tres suites nuevas, todas verdes + type-check/build limpios:
- **Backend (16)** — harness `node:test + tsx` ya existente, +26 tests (total 47). Specs nuevos en `apps/api/src/modules/auth/`:
  `password.service.spec` (forgot anti-enumeration, reset token inválido/expira/políticas + revoca sesiones, change verifica actual + revoca),
  `session.service.spec` (denylist/isRevoked, revokeOne idempotente + tenant correcto, revokeAll excepto la actual),
  `auth.service.spec` (enforcement: rol crítico→`mfa_setup`, MFA activo→`mfa`, no-crítico→`select_account`; lockout al 5º intento + cuenta bloqueada),
  `mfa.service.spec` (disable con re-auth, regenerate exige MFA, backup code de un solo uso). Helper `auth-test-utils.ts` (excluido del build).
- **Web (17)** — **Vitest + RTL + MSW** (setup nuevo: `vitest.config.ts`, `vitest.setup.ts` con shim de URL relativa para MSW, `src/test/msw-server.ts`), 22 tests:
  `forgot-password` y `reset-password` (MSW, checklist en vivo, token de URL, errores del backend), `sessions` (lista + isCurrent + cerrar y refrescar),
  + unit de `routeByStep`, `stepResponse/apiError` (BFF, cookies httpOnly) y `password-checklist`.
- **Mobile (18)** — **jest-expo + RNTL** (setup nuevo: `jest.config.js` con `transformIgnorePatterns` ajustado a **pnpm `.pnpm`**), 23 tests:
  `biometric` (hardware, flags, oferta única, authenticate), `session` (ventana offline 8h, isSessionValid type-guard, touchSession), `auth-service`
  (`me` distingue offline/unauthenticated/ok + refresh-on-401, forgot, change limpia sesión) y render RNTL de `forgot-password` (email enmascarado + error).

**Decisiones/hallazgos del Testing:**
- Los test files se **excluyen de `tsconfig`** (web/mobile) y del `nest build` (api), mismo patrón que los specs previos del backend (se chequean en runtime por el runner).
- **pnpm hoisted:** jest-expo necesitó `transformIgnorePatterns` sobre `node_modules/.pnpm/(?!...)` para transformar los archivos Flow de react-native; MSW necesitó anteponer el origen a las URLs relativas (undici no las resuelve en jsdom).
- Pantallas con timers (countdown de reenvío) requieren **fake timers** en RNTL para que `findBy` estabilice.

**Siguiente (remates menores, no bloquean):** gating forzado en **web** (historia 8), auditoría F2b (historia 5, con `AuditInterceptor` de F2a S4), GeoIP de sesión (historia 6), pins SSL reales (historia 15).

## 1. Objetivo de negocio
Que el usuario administre su seguridad de forma autónoma (recuperar contraseña, ver y
cerrar sesiones, activar MFA, biometría) y que el cobrador pueda **operar offline** —
con la robustez y la confianza de una fintech.

## 2. Alcance
### Incluye
- **Recuperar contraseña** (forgot/reset) + tabla `password_reset_tokens`.
- **Cambio de contraseña forzado** (`requires_password_change`) y voluntario.
- **Gestión de sesiones**: listar / cerrar una / cerrar todas (endpoints + UI).
- **MFA avanzado**: pantalla de setup (QR + verificación + backup codes descargables),
  regenerar backup codes, deshabilitar MFA (con re-auth) y **hacer MFA obligatorio** para
  `ACCOUNT_ADMIN`/`SUPER_ADMIN`.
- **Biometría mobile** completa + endurecimiento (SSL pinning, timeout de inactividad).
- **Login offline mobile** (pantalla + flujo, sobre el modelo de sesión definido en F2a).
### No incluye
- SSO/Azure AD → F12 · gestión de sesiones de **otros** usuarios (admin) → F3 · push/SMS reales → F8.

## 3. Contratos API (F2b)
```
POST /auth/forgot-password   {email}                 → 200 siempre (anti-enumeration)
POST /auth/reset-password    {token, newPassword}     → 200 · 400 AUTH_005 (token inválido/expirado)
POST /auth/change-password   {currentPassword, newPassword} (Bearer) → 200 · 401
GET    /auth/sessions        (Bearer)                 → 200 {sessions:[{id,device,os,city,ip,lastSeen,isCurrent}]}
DELETE /auth/sessions/:id    (Bearer)                 → 204 (revoca + denylist)
DELETE /auth/sessions        (Bearer, todas menos actual) → 204
POST   /auth/mfa/disable     {password|mfaCode} (Bearer)  → 204
POST   /auth/mfa/backup-codes/regenerate (Bearer)    → 200 {backupCodes[]}
```
> `reset-password` y `change-password` validan con `passwordPolicy` de `@kobrax/shared` (server-side).
> Tras `reset`/`change` exitoso → se **revocan todas las sesiones** del usuario (forzar re-login).

## 4. Modelo de datos
### `password_reset_tokens` (NUEVA — usuario global, sin account_id)
`id, user_id, token_hash(SHA-256), expires_at(30min), used_at?, created_at`. Un solo uso; invalidado al usar.

## 5. Historias y tareas
| # | Historia | Agente | Estado |
|---|----------|--------|--------|
| **BACKEND** ||||
| 1 | `forgot-password` (token OTP, email) + `password_reset_tokens` + RLS/global | Security | ✅ |
| 2 | `reset-password` + `change-password` (policy shared) + revocar sesiones | Security | ✅ |
| 3 | Sesiones: `GET /auth/sessions`, `DELETE /:id`, `DELETE` (todas) | Security | ✅ |
| 4 | MFA: `disable`, `backup-codes/regenerate`, **enforcement obligatorio roles críticos** | Security | ✅ |
| 5 | Rate-limit `forgot-password` 3/h·email; auditoría de eventos F2b | Security | ⏳ (difer. a F2a S4) |
| 6 | (opcional) GeoIP para `city/country` de sesión — **diferible** si añade dependencia | API | ⏳ |
| **WEB** ||||
| 7 | Recuperar contraseña (`/forgot-password`, `/reset-password`) | Web | ✅ |
| 8 | Cambio de contraseña forzado (`/force-password-change`) + voluntario (settings) | Web | 🔶 voluntario ✅; gating forzado pendiente (flag ya en `/auth/me`) |
| 9 | Setup MFA (`/settings/security/mfa`): QR → verificar → backup codes (descarga) | Web | ✅ |
| 10 | Sesiones activas (`/settings/security/sessions`) | Web | ✅ |
| **MOBILE** ||||
| 11 | Recuperar contraseña (envía email; reset vía link web o universal link) | Mobile | ✅ |
| 12 | Cambio de contraseña forzado | Mobile | ✅ (forzado + voluntario; gating por `requiresPasswordChange`) |
| 13 | Setup biometría (`biometric-setup`) + desbloqueo biométrico del token | Mobile | ✅ |
| 14 | Login offline (`offline`) sobre `sessionValidUntil` de F2a | Mobile | ✅ |
| 15 | Endurecimiento: **SSL pinning** (config plugin / dev build) + timeout inactividad 8h | Mobile | 🔶 inactividad+re-lock ✅; SSL pinning cableado (NO-OP sin pins; requiere dev build + pins reales) |
| **TESTING** ||||
| 16 | Backend: reset (token único/expira), change (revoca sesiones), sessions revoke, MFA enforce | Testing | ✅ (26 tests; +lockout) |
| 17 | Web: forgot/reset, mfa-setup, sessions (Vitest+RTL+MSW) | Testing | ✅ (22 tests) |
| 18 | Mobile: biometric, offline, forgot (RNTL) | Testing | ✅ (23 tests) |

## 6. Pantallas (referencia — specs visuales en design-system.md)
- **Web:** Recuperar contraseña (2 pasos + validación de policy en tiempo real), Cambio forzado,
  Setup MFA (QR + clave manual + verificación + 8 backup codes descargables como PDF), Sesiones activas
  (device/OS/ciudad/IP/último acceso, cerrar una / todas).
- **Mobile:** Recuperar contraseña (email parcial `j***@banco.com` + countdown reenvío), Setup biometría
  (solo si hay hardware; flag `biometric_prompt_shown`), Login offline (banner amarillo, solo si
  `sessionValidUntil` vigente), Cambio forzado.

## 7. Seguridad & Cumplimiento (checklist F2b)
- [ ] Reset: token OTP único, **30 min**, invalidado al usar; rate-limit **3/h por email**; anti-enumeration.
- [ ] `reset`/`change` validan `passwordPolicy` server-side; **revocan todas las sesiones** al cambiar.
- [ ] `requires_password_change=true` → fuerza pantalla de cambio antes de operar.
- [ ] MFA obligatorio para `ACCOUNT_ADMIN`/`SUPER_ADMIN`: sin MFA enrolado → forzar enroll antes de continuar.
- [ ] `disable MFA` requiere re-autenticación (password o código vigente).
- [ ] Backup codes: 8, un solo uso, hasheados; regenerar invalida los anteriores.
- [ ] Sesiones: cerrar añade `sessionId` a la denylist (efecto inmediato, ver F2a X3).
- [ ] Mobile: biometría **solo desbloquea** el token local (no autentica contra API); SSL pinning;
      timeout 8h inactividad → re-auth; logout limpia SecureStore completo.
- [ ] Auditoría F2b: `PASSWORD_RESET_REQUESTED/COMPLETED`, `PASSWORD_CHANGED`, `SESSION_REVOKED`,
      `ALL_SESSIONS_REVOKED`, `MFA_DISABLED`, `MFA_BACKUP_REGENERATED`.

## 8. DoD (F2b)
- [ ] Flujo completo recuperar contraseña (web): email → reset → login, con policy en tiempo real.
- [ ] Cambiar contraseña revoca todas las sesiones (test). `requires_password_change` fuerza el cambio.
- [ ] Sesiones: listar, cerrar una y todas; la cerrada deja de funcionar **al instante**.
- [ ] Setup MFA completo (QR→verificar→backup codes); MFA obligatorio bloquea login de admin sin MFA.
- [ ] Mobile: biometría desbloquea; login offline con `sessionValidUntil` vigente; expira sin red → pide conexión.
- [ ] Cobertura componentes web/mobile ≥ 80%; `lint`+`type-check`+`test` verdes; DoD visual cumplido.

## 9. Riesgos
| Riesgo | Mitigación |
|--------|-----------|
| Reset masivo / abuso | rate-limit 3/h·email + token único 30 min + anti-enumeration |
| Sesión "zombi" tras cambio de clave | revocar todas las sesiones en reset/change |
| Biometría comprometida | solo desbloquea token local; no sustituye auth de API |
| SSL pinning en Expo managed | requiere config plugin / dev build — tarea explícita (#15), no subestimar |
| GeoIP añade dependencia externa | `city/country` diferible (#6); no bloquea el DoD |
