# Panel web Kobrax — Parte A: acceso, shell, dashboard, equipo, cuenta, exportar y ajustes personales

> Documentación funcional pantalla por pantalla de `apps/web` (Next.js 14, App Router).
> Fuente de verdad: el código (`page.tsx`, componentes, `lib/`, route handlers `src/app/api`, `middleware.ts`) y, para permisos y reglas, los controllers/services de `apps/api`. Lo que no se pudo comprobar se marca «no verificado».
> Rutas relativas a `apps/web/src/` salvo que se indique otra cosa.

## Índice de pantallas

**Acceso (grupo `(auth)`)**
1. [Iniciar sesión — `/login`](#iniciar-sesión--login)
2. [Verificación en dos pasos — `/login/mfa`](#verificación-en-dos-pasos--loginmfa)
3. [Configurar verificación en dos pasos — `/login/mfa-setup`](#configurar-verificación-en-dos-pasos--loginmfa-setup)
4. [Elegir empresa — `/login/select-account`](#elegir-empresa--loginselect-account)
5. [Crear cuenta — `/registro`](#crear-cuenta--registro) (incluye elegir plan, `plan-picker.tsx`)
6. [Aceptar invitación — `/invitacion`](#aceptar-invitación--invitacion)
7. [Recuperar contraseña — `/forgot-password`](#recuperar-contraseña--forgot-password)
8. [Nueva contraseña — `/reset-password`](#nueva-contraseña--reset-password)

**Panel (grupo `(panel)`)**
9. [Shell del panel (menú lateral, topbar, campana, empresa, idioma, vigilante de sesión, recordatorio MFA)](#shell-del-panel)
10. [Dashboard — `/dashboard`](#dashboard--dashboard)
11. [Equipo — `/equipo`](#equipo--equipo)
12. [Cuenta — `/cuenta`](#cuenta--cuenta)
13. [Exportar — `/exportar`](#exportar--exportar)
14. [Mi perfil — `/settings/perfil`](#mi-perfil--settingsperfil)
15. [Seguridad — `/settings/security`](#seguridad--settingssecurity)
16. [Sesiones activas — `/settings/security/sessions`](#sesiones-activas--settingssecuritysessions)

**Transversal**
17. [Middleware (protección de rutas y refresh silencioso)](#middleware--middlewarets)
18. [Hallazgos y discrepancias](#hallazgos-y-discrepancias)
19. [No verificado](#no-verificado)

---

## Convenciones transversales

### BFF y cookies
- El navegador **nunca ve los tokens**. Todas las pantallas hablan con *route handlers* del propio Next (`src/app/api/**`), que llaman a la API NestJS (`KOBRAX_API_URL`, por defecto `http://127.0.0.1:4010/api`) con `Authorization: Bearer` y `x-client-type: web` (`lib/bff.ts`, función `apiCall`).
- Las pantallas de servidor (`page.tsx`) también llaman a la API directamente con `apiCall(..., { auth: true })`; las interacciones de cliente usan `postJson`/`sendJson` (`lib/client.ts`) hacia `/api/...`.
- Cookies (todas `httpOnly`, `SameSite=Strict`, `secure` en producción, `path=/`):

| Cookie | Contenido | Vida |
|---|---|---|
| `k_access` | JWT de acceso | 15 min |
| `k_refresh` | refresh token (rotativo) | 7 días |
| `k_preauth` | token intermedio entre pasos de login (MFA, elección de empresa) | 5 min |
| `k_locale` | idioma `es`/`en` (**no** httpOnly, `SameSite=Lax`, 1 año; la escribe el navegador, `components/locale-switch.tsx`) | 1 año |

- **CSRF:** todo handler que muta exige `sameOrigin` (el `Origin` debe coincidir con el `Host`); si no, `403 CSRF` (`lib/bff.ts`). Los PATCH/DELETE genéricos pasan por `proxyMutation` (`lib/proxy.ts`), que acepta cualquier 2xx y trata 204 como éxito.
- **Sobre de respuesta de la API:** `{ data, meta, error }`. Los handlers devuelven `data` directo o `{ error: { code, message } }` con el status original.
- **API caída:** `apiCall` devuelve `status: 0` / `API_UNREACHABLE` en vez de lanzar; el layout del panel muestra «No pudimos conectar con el servidor» en lugar de redirigir a `/login` (`app/(panel)/layout.tsx`).
- **Control de sesión entre pestañas (W-LOG-54):** cada `sendJson` manda `x-k-session` con la sesión con que se cargó la pestaña; si la cookie ya es de otra sesión, el BFF contesta `409 SESSION_CHANGED` sin llamar a la API (`lib/bff.ts: sessionMismatch`). Detalle en [Shell](#shell-del-panel).

### i18n es/en
- `next-intl` **sin prefijo en la URL**: el idioma sale de la cookie `k_locale` (`i18n/request.ts`); valor inválido cae a `es`. Diccionarios `messages/es.json` y `messages/en.json`.
- El selector (`LocaleSwitch`) aparece en: columna de cada pantalla de auth (arriba a la derecha), topbar del panel (desde ancho `md`; en móvil dentro del menú de usuario) y «Mi perfil → Preferencias». Cambiar idioma **recarga la página** completa.
- Aviso de producto en «Mi perfil»: el idioma «solo cambia lo que ves tú. La app del cobrador está en español».
- Los textos de este documento citan el diccionario `es`. Parte de los mensajes de error viene tal cual de la API y está en español (algunos con voseo: «Podés…», «Pedí que te la reenvíen»), sin pasar por i18n.

### Permisos en UI vs API
- La UI **oculta** (menú, botones) pero **no autoriza**: la API valida siempre con `@Roles(Permission.X)` + `RolesGuard` (`lib/nav.ts` lo dice explícitamente: «ocultar no es autorizar»).
- El layout del panel pide `/auth/me` una sola vez, y desde ahí los permisos bajan por `PermissionsProvider`/`usePermissions().can('x:y')` (`components/permissions.tsx`). Ninguna pantalla vuelve a pedir `/auth/me` (salvo el dashboard, que la repite para decidir su acceso).
- Matriz relevante de roles → permisos (`packages/shared/src/constants/permissions.ts`):

| Rol | `report:read` | `report:export` | `account:read` | `account:write` | `user:read` | `user:write`/`user:invite`/`role:read` | `agenda:read` |
|---|---|---|---|---|---|---|---|
| SUPER_ADMIN, ACCOUNT_ADMIN | sí | sí | sí | sí | sí | sí | sí |
| MANAGER | sí | sí | sí | no | sí | no | sí |
| SUPERVISOR | sí | no | no | no | no | no | sí |
| COLLECTOR | **no** | no | no | no | no | no | sí |
| AUDITOR | sí | sí | no | no | no | no | no |
| VIEWER | sí | no | no | no | no | no | no |

- Roles con web: el sidebar es el mismo componente para todos; lo que cambia es `visibleNav(permissions)`.
- Roles que se pueden **asignar desde la web** (invitar/cambiar rol): sólo `MOBILE_ROLES` = ACCOUNT_ADMIN, SUPERVISOR, COLLECTOR (`packages/shared/src/constants/roles.ts`; regla de servidor en `users.service.ts`, error `USER_ROLE_NOT_ALLOWED`). MANAGER, AUDITOR y VIEWER no se pueden asignar desde la UI.

### Política de contraseña (compartida web/API)
`packages/shared/src/validation/password-policy.ts`: mínimo 8 caracteres, al menos una mayúscula, un número y un símbolo. La UI muestra un checklist vivo (`components/password-checklist.tsx`) y deshabilita el botón hasta que todas pasen; la API valida igual (`WEAK_PASSWORD`).

### Rate limits de la API relevantes
`POST /auth/login` 5/min por email+IP; `POST /auth/mfa/challenge` 5/min por IP; `POST /auth/refresh` 30/min por IP; `POST /auth/forgot-password` 3/hora por email; `GET /auth/invitation/:code` 10/min por IP; `POST /auth/invitation/accept` 10/hora por IP; `POST /accounts` (registro) 10/hora por IP (`auth.controller.ts`, `accounts.controller.ts`). Bloqueo de cuenta: 5 intentos fallidos → 15 min (`kobrax.constants.ts`: `MAX_FAILED_LOGINS`, `ACCOUNT_LOCK_MINUTES`).

---

## Acceso (grupo `(auth)`)

Todas las pantallas usan `components/auth-shell.tsx`: panel de marca a la izquierda (logo KOBRAX, chip «Plataforma segura — Conexión y datos cifrados», titular «Cobranza en campo, resultados en tiempo real», 4 features: rutas, clientes, reportes, seguridad), tarjeta con el paso a la derecha y barra de confianza al pie (TLS 1.3, cifrado en BD, acceso auditado, aislamiento por empresa). Selector de idioma arriba a la derecha de la tarjeta. Es server component. En pantallas angostas el panel de marca se reduce a una franja.

### Iniciar sesión — `/login`
- **Propósito:** autenticar con correo y contraseña y encaminar al siguiente paso del flujo (MFA, alta de MFA, elección de empresa o panel).
- **Quién accede:** público. Con una sesión **válida** el middleware redirige a `/dashboard` (`middleware.ts: guestOnly`, comprueba contra `GET /auth/me` y, si hay refresh, intenta renovar).
- **Qué muestra:** eyebrow «Bienvenido de vuelta», título «Inicia sesión», subtítulo «Accede a tu panel de cobranzas»; campos Correo y Contraseña (con botón mostrar/ocultar); enlace «¿Olvidaste tu contraseña?»; pie con «¿No tienes cuenta? Crear una cuenta» (→ `/registro`) y «¿Tienes una invitación? Únete a tu equipo» (→ `/invitacion`). **No hay login con Google** (comentario en código: pendiente de credenciales de Google Cloud).
- **Acciones:** formulario `noValidate`.
  - `email` (obligatorio): forma `algo@algo.algo` sin espacios, máx. 254 (`lib/login-validation.ts`; espejo de `LoginDto`).
  - `password` (obligatorio): máx. 128.
  - Errores por campo bajo el input (validación local o `details` del servidor vía `fieldErrors`); error general en banner («No se pudo iniciar sesión» o el mensaje de la API, p. ej. «Credenciales inválidas», «Cuenta bloqueada temporalmente por intentos fallidos»).
  - Botón «Iniciar sesión» con estado de carga.
- **Datos que consume:** `POST /api/auth/login` (BFF) → `POST /auth/login` de la API. El BFF, tras aceptar la API, revoca la sesión previa si el navegador traía cookies de otra (`revokePreviousSession`) y setea cookies o `k_preauth` según el paso.
- **Navegación:** según `step` (`lib/client.ts: routeByStep`): `done` → `/dashboard` (y emite evento de login a otras pestañas); `mfa` → `/login/mfa`; `mfa_setup` → `/login/mfa-setup`; `select_account` → guarda las cuentas en `sessionStorage['k_accounts']` y va a `/login/select-account`.
- **Reglas de negocio (API `auth.service.ts: login`):** usuario inexistente o no `ACTIVE` → «Credenciales inválidas» (con hash ficticio para igualar tiempos). Si el usuario tiene MFA → paso `mfa`. Si **no** tiene MFA y alguna de sus membresías activas es `ACCOUNT_ADMIN` o `SUPER_ADMIN` → paso `mfa_setup` (obligatorio de ofrecer; ver nota en esa pantalla). Si tiene 1 membresía activa → sesión; si varias → `select_account`. Sin empresa activa → error `noActiveTenant`. Las membresías de cuentas `SUSPENDED`/`CANCELLED`/`INACTIVE` no cuentan.
- **Estados especiales:** botón en carga; error de red → «No se pudo iniciar sesión» (`sendJson` devuelve `status: 0` sin lanzar).
- **Estado:** ✅ implementado (🟡 sin Google OAuth, que el epic F9 prometía; ver [hallazgos](#hallazgos-y-discrepancias)).

### Verificación en dos pasos — `/login/mfa`
- **Propósito:** pedir el segundo factor (TOTP o código de respaldo) a quien tiene MFA activo.
- **Quién accede:** quien acaba de superar la contraseña (necesita cookie `k_preauth`, 5 min). Sin ella el BFF responde `401 AUTH_003 «Sesión de login expirada»`. La ruta **no** está en el matcher del middleware (no redirige si ya hay sesión).
- **Qué muestra:** título «Verificación en dos pasos», subtítulo «Ingresa el código de tu aplicación de autenticación»; entrada OTP de 6 dígitos con foco automático; enlace «Usar un código de respaldo» que cambia a un campo de texto (placeholder `xxxxx-xxxxx`) y «Volver al código del authenticator».
- **Acciones:**
  - «Verificar» (deshabilitado hasta 6 dígitos; en modo respaldo, hasta ≥ 6 caracteres). Ante error: banner «Código inválido» (o el mensaje de la API), se limpia el código y el campo hace *shake*.
  - El BFF exige `code` (400 `VALIDATION` «Código requerido» si falta).
- **Datos que consume:** `POST /api/auth/mfa/challenge` → `POST /auth/mfa/challenge` (`preAuthToken` + `code`; límite 5/min/IP). La API valida primero TOTP y luego código de respaldo de un solo uso (`mfa.service.ts`).
- **Navegación:** mismo `routeByStep` que login (→ `/dashboard` o `/login/select-account`).
- **Estados especiales:** `k_preauth` vencido → error y hay que volver a `/login` (no hay enlace de vuelta en la pantalla). Rate limit → error de la API.
- **Estado:** ✅ implementado.

### Configurar verificación en dos pasos — `/login/mfa-setup`
- **Propósito:** enrolar el authenticator (QR + clave manual) durante el login, y entregar 8 códigos de respaldo.
- **Quién accede:** quien llegó con `step: mfa_setup` (cookie `k_preauth` con propósito `mfa_enroll`): usuarios sin MFA con rol ACCOUNT_ADMIN/SUPER_ADMIN en alguna empresa activa.
- **Qué muestra:**
  - Paso 1: título «Configura la verificación en dos pasos», subtítulo «Tu rol requiere MFA…»; QR de 200 px (generado en el navegador con `qrcode`), «Clave manual» (se muestra aunque el QR falle), instrucción «Luego ingresa el código de 6 dígitos…», OTP.
  - Paso 2 (tras verificar): «Guarda tus códigos de respaldo» con los 8 códigos en grilla, botón «Descargar códigos» (`kobrax-backup-codes.txt`) y «Ya los guardé, continuar».
- **Acciones:**
  - Al entrar llama automáticamente `action: start` (una sola vez; repetirlo invalidaría el QR ya escaneado).
  - «Activar y continuar» (deshabilitado hasta 6 dígitos y secreto cargado) → `action: verify`.
  - «Lo hago después» (sólo si **no** hay sesión abierta) → `action: skip`: entra sin activar MFA; el panel lo recordará con el [recordatorio](#shell-del-panel). Sin límite de veces (decisión de producto 2026-07-31, comentario en `mfa-reminder.tsx`).
  - Si la pantalla detecta sesión abierta (`GET /api/auth/me` ok), en vez de «Lo hago después» muestra «Volver» → `/settings/security`.
- **Datos que consume:** `POST /api/auth/mfa/setup` con `action` ∈ `start|verify|skip` → `POST /auth/mfa/setup/start|verify|skip` (la API valida `code` con `/^\d{6}$/`).
- **Navegación:** tras códigos de respaldo y `skip` → `routeByStep` (`/dashboard` o `/login/select-account`).
- **Estados especiales:** error de arranque «No se pudo iniciar la configuración»; código inválido «Código inválido» y se vacía el OTP; `skip` fallido «No se pudo continuar sin activar la verificación».
- **Nota de coherencia:** el texto dice «Tu rol requiere MFA», pero existe «Lo hago después», así que en la práctica es obligatorio **ofrecerlo**, no exigirlo.
- **Estado:** ✅ implementado.

### Elegir empresa — `/login/select-account`
- **Propósito:** cuando la persona tiene acceso a varias empresas, elegir con cuál operar.
- **Quién accede:** quien llegó con `step: select_account` (cookie `k_preauth` + `sessionStorage['k_accounts']`). Sin `k_accounts` o JSON roto → `router.replace('/login')`.
- **Qué muestra:** título «Elige tu empresa», subtítulo «Tienes acceso a varias empresas. Selecciona con cuál operar.»; una fila-botón por empresa con nombre y rol (el código de rol tal cual, p. ej. `ACCOUNT_ADMIN`, sin traducir) y flecha; «Cargando empresas…» si la lista aún está vacía.
- **Acciones:** clic en una empresa → `POST /api/auth/select-account { accountId }` (400 «Empresa requerida» si falta); mientras tanto la fila muestra «···» y todas se deshabilitan. Error → banner «No se pudo seleccionar la empresa» o el mensaje de la API.
- **Datos que consume:** `POST /api/auth/select-account` → `POST /auth/select-account`; en éxito el BFF setea `k_access`/`k_refresh`.
- **Navegación:** → `/dashboard` (`replace`), limpia `k_accounts`.
- **Estados especiales:** `k_preauth` vencido → error de API; no hay botón «volver».
- **Estado:** ✅ implementado.

### Crear cuenta — `/registro`
- **Propósito:** auto-alta de una empresa (tenant) con su primer administrador y plan.
- **Quién accede:** público; con sesión válida el middleware redirige a `/dashboard`.
- **Qué muestra (3 vistas en una sola ruta):**
  1. **Elegir plan** (`plan-picker.tsx`, columna ancha): tres tarjetas de `SIGNUP_PLANS` (FREE, PROFESSIONAL, BUSINESS) con insignia («Gratis para siempre» o «30 días de prueba»), nombre, precio (Free «Gratis»; Professional «$12 por miembro al mes»; Business «$99 + $10 por miembro al mes»), 4 límites (miembros, créditos, fotos por mes, retención de fotos; «Sin límite» si `null`), línea de soporte y botón «Empezar con este». Debajo, aviso de Enterprise «se arma a medida… Escríbenos» (**sin enlace ni correo**, comentario `ponytail` lo reconoce) y «Ya tengo cuenta» → `/login`.
  2. **Formulario** (eyebrow «Empieza a cobrar con Kobrax», título «Crear una cuenta»): barra con «Plan X» y «Cambiar» (vuelve a la vista 1 sin perder lo escrito); campos y checklist de contraseña.
  3. **Cuenta creada** («¡Cuenta creada!»): resumen (correo, negocio, plan), aviso de prueba si el plan no es Free («Estás probando {plan} por 30 días. Al terminar, tu cuenta sigue funcionando en el plan Free: no se bloquea nada y no pierdes tus datos»), botón «Continuar».
- **Acciones / campos** (formulario **sin** `noValidate`: usa validación nativa del navegador):

| Campo | Tipo | Obligatorio | Validación |
|---|---|---|---|
| Nombre del negocio | texto | sí | 2–160 (UI y API) |
| Nombre | texto | sí | máx. 80 |
| Apellido | texto | sí | máx. 80 |
| Correo | email | sí | se envía en minúsculas y recortado; máx. 254 (API) |
| Contraseña | password con ver/ocultar | sí | política de contraseña; botón «Crear cuenta» deshabilitado hasta que pasen las 4 reglas |

  - Flujo: `POST /api/auth/registro` y, si va bien, **login automático** con `POST /api/auth/login`. Si el alta funcionó y el login no, se muestra «Tu cuenta se creó, pero no pudimos iniciar sesión: …» y el botón se reemplaza por «Ir a iniciar sesión».
  - El país y la moneda **no** se piden: la cuenta nace con los valores por defecto (`DEFAULT_COUNTRY`/`DEFAULT_CURRENCY`) y se configuran después en `/cuenta` («El país y la moneda los configuras después»).
- **Datos que consume:** `POST /api/auth/registro` → `POST /accounts` (BFF exige `businessName, firstName, lastName, email, password`, 400 «Faltan datos»); `POST /api/auth/login`.
- **Reglas de negocio (API `accounts.service.ts: create`):** plan por defecto FREE; planes de pago nacen con `status: TRIAL` y `trialEndsAt = hoy + 30 días` (un job diario los baja a FREE al vencer); el usuario es `ACTIVE`, `isOwner`, rol `ACCOUNT_ADMIN`; se siembran las categorías de mora A 1–30, B 31–60, C 61+. Correo ya registrado → error `emailTaken`.
- **Navegación:** «Continuar» → `routeByStep`: para un ACCOUNT_ADMIN nuevo el login devuelve `mfa_setup` → `/login/mfa-setup` («Antes te ofrecemos proteger la cuenta con un segundo paso de seguridad»).
- **Estados especiales:** carga en el botón; error en banner («No se pudo crear la cuenta» o mensaje de la API); límite 10 altas/hora por IP.
- **Estado:** ✅ implementado.

### Aceptar invitación — `/invitacion`
- **Propósito:** que un miembro invitado canjee su código, defina su contraseña y entre.
- **Quién accede:** público; con sesión válida el middleware redirige a `/dashboard`.
- **Qué muestra:**
  1. **Código:** título «Únete a tu equipo», campo «Código de invitación» (monoespaciado, placeholder `XXXXXXXX`, 8–24 caracteres) y botón «Continuar» (deshabilitado con < 8); enlace «Volver a iniciar sesión».
  2. **Contraseña:** saludo («Hola, {nombre}» si hay), título «Te uniste a {negocio}» (o «tu equipo»), subtítulo «Elige una contraseña para {correo} y entra.»; campos Contraseña y Confirmar contraseña con checklist; mensaje «Las contraseñas no coinciden.»
- **Acciones:**
  - Si la URL trae `?c=<código>` (≥ 8) se consulta solo al cargar.
  - «Continuar» → consulta la invitación; error «Ese código no sirve o ya se usó» (o mensaje de la API: «La invitación no es válida o ya venció. Pedí que te la reenvíen.»).
  - «Entrar a Kobrax» (deshabilitado hasta que la contraseña cumpla la política y coincida) → acepta y hace login automático. Si el login falla: «Tu contraseña quedó guardada, pero no pudimos iniciar sesión: …» y botón «Ir a iniciar sesión».
- **Datos que consume:** `GET /api/auth/invitacion/{code}` → `GET /auth/invitation/{code}` (devuelve `email`, `firstName`, `businessName`); `POST /api/auth/invitacion {code,password}` → `POST /auth/invitation/accept`; luego `POST /api/auth/login`.
- **Reglas:** el código vence a los 7 días y es de un solo uso (`users.service.ts: INVITE_TTL_MS`, texto del correo). Reenviar una invitación genera un código nuevo e invalida el anterior.
- **Navegación:** → `routeByStep` (si el rol invitado es ACCOUNT_ADMIN, el login lo manda a `mfa_setup`).
- **Estados especiales:** carga, errores en banner.
- **Nota:** el correo de invitación que envía la API contiene un enlace `kobrax://invitacion?c=…` (deep link **móvil**) y el código; no hay enlace web. El código puede escribirse aquí a mano (`mail.service.ts: invitationBody`).
- **Estado:** ✅ implementado.

### Recuperar contraseña — `/forgot-password`
- **Propósito:** pedir el enlace de restablecimiento.
- **Quién accede:** público; con sesión válida redirige a `/dashboard`.
- **Qué muestra:** título «Recuperar contraseña», subtítulo «Te enviaremos un enlace para restablecerla.»; campo Correo; botón «Enviar enlace» (deshabilitado si está vacío); enlace «Volver a iniciar sesión». Tras enviar: «Revisa tu correo — Si la dirección existe, te enviamos un enlace para restablecer tu contraseña.» con enlace de vuelta.
- **Acciones:** `email` (obligatorio, `type=email`, sin validación propia; la API valida formato y máx. 254). El BFF **siempre** contesta `{ ok: true }` aunque la API falle o el correo no exista (anti-enumeración).
- **Datos que consume:** `POST /api/auth/forgot-password` → `POST /auth/forgot-password` (3/hora por correo).
- **Navegación:** desde `/login`; vuelve a `/login`.
- **Estados especiales:** carga en el botón.
- **Nota importante:** el correo de recuperación que genera la API incluye **sólo** el enlace `kobrax://reset?token=…` (móvil) y vence en 30 minutos (`mail.service.ts: passwordResetBody`; el comentario dice que no hay respaldo web «todavía»). La pantalla web `/reset-password` existe pero ningún correo la enlaza.
- **Estado:** 🟡 parcial (la pantalla funciona; el correo sólo lleva el enlace de la app móvil).

### Nueva contraseña — `/reset-password`
- **Propósito:** fijar una contraseña nueva con el token de recuperación.
- **Quién accede:** público y **excluido** del redirect «sólo invitados» (el enlace debe seguir funcionando con sesión abierta; no está en el matcher).
- **Qué muestra:** título «Nueva contraseña», subtítulo «Elige una contraseña segura.»; campos Nueva contraseña y Confirmar contraseña con checklist; «Las contraseñas no coinciden.»; si la URL no trae `?token=` → banner «Falta el token de recuperación en el enlace». Éxito: «Contraseña actualizada — Ya puedes iniciar sesión con tu nueva contraseña.» y redirección automática a `/login` a los 1,5 s.
- **Acciones:** «Restablecer contraseña» deshabilitado hasta tener token, política cumplida y coincidencia. Error → «No se pudo restablecer la contraseña» o mensaje de la API («Token de recuperación inválido o expirado»).
- **Datos que consume:** `POST /api/auth/reset-password {token,newPassword}` → `POST /auth/reset-password` (el BFF exige ambos, 400 «Token y contraseña requeridos»).
- **Navegación:** desde un enlace con `?token=`; a `/login`.
- **Estado:** ✅ implementado (ver nota de `/forgot-password` sobre cómo llega el token).

---

## Panel (grupo `(panel)`)

### Shell del panel
Archivos: `app/(panel)/layout.tsx`, `components/panel-shell.tsx`, `lib/nav.ts`, `components/session-watcher.tsx`, `lib/session-sync.ts`, `components/mfa-reminder.tsx`, `components/permissions.tsx`, `lib/notifications.ts`, `app/(panel)/loading.tsx`, `app/(panel)/error.tsx`.

- **Propósito:** marco común de todo lo que vive detrás del login: navegación, identidad, cambio de empresa, avisos y control de sesión.
- **Quién accede:** cualquier sesión válida. El layout llama en paralelo `GET /auth/me` y `GET /auth/accounts`; si `me.status !== 200` → `redirect('/login')`; si la API no contesta (`status 0`) → pantalla «No pudimos conectar con el servidor. Vuelve a intentarlo en un momento. Si sigue así, avísale a tu administrador.»
- **Qué muestra:**
  - **Sidebar** (navy; fijo en `lg`, colapsado a íconos de 1024 a 1279 px y con etiquetas desde `xl`; en tablet/celular es un cajón `<dialog>` abierto por el botón hamburguesa). Logo, lista de menú, identidad (foto o iniciales, nombre, rol en mayúsculas sin traducir) y botón rojo «Cerrar sesión».
  - **Menú** (`lib/nav.ts`, filtrado con `visibleNav(permissions)`: **sin permiso no se dibuja ni en gris**):

| Ítem | Ruta | Permiso requerido |
|---|---|---|
| Inicio | `/dashboard` | ninguno |
| Cartera | `/cartera` | `client:read` |
| Import | `/import` | `client:import` |
| Mora | `/mora` | `collection:read` |
| Agenda | `/agenda` | `agenda:read` |
| Rutas | `/rutas` | `route:read` |
| Pagos | `/pagos` | `payment:read` |
| Equipo | `/equipo` | `user:read` |
| Cuenta | `/cuenta` | `account:read` |
| Exportar | `/exportar` | `report:export` |
| Mi perfil | `/settings/perfil` | ninguno |
| Seguridad (`hidden`: no se dibuja; sólo migas) | `/settings/security` | ninguno |

  - Todos los ítems tienen `built: true`; el mecanismo de ítem apagado con chip «Pronto» existe pero hoy no se usa.
  - **Contador en «Agenda»:** vencidas + pendientes de hoy (`GET /agenda/summary`, sólo con `agenda:read`); chip rojo si hay vencidas, gris si no; «99+» como tope.
  - **Topbar:** migas de pan (`crumbsFor`: ítem del menú + segmentos de la ruta; los UUID se omiten), selector de empresa, selector de idioma, campana de notificaciones. En celular, empresa e idioma van dentro de un desplegable con ícono de cuenta.
  - **Selector de empresa:** aparece si hay más de una empresa **o** si la activa no figura en la lista (caso empresa suspendida; si falta muestra «Empresa no disponible» en tono de aviso). Lista con nombre y rol, con ✓ en la activa.
  - **Campana:** lista las últimas 20 notificaciones propias (`GET /api/notifications` → `/notifications?limit=20`), se refresca cada 60 s y al volver a la pestaña (sólo si está visible). Contador rojo (máx. «9+»), «Marcar todas como leídas», estado vacío «No hay notificaciones», error «No se pudieron cargar las notificaciones». Cada aviso lleva a: ruta (`/rutas/{id}`) → gestión (`/agenda/{id}`) → resumen de vencidas (`/agenda`) → crédito (`/mora/{id}`); sin destino sólo se marca leído (`lib/notifications.ts`).
- **Acciones:**
  - Cambiar empresa: `POST /api/auth/switch-account {accountId}` → `POST /auth/switch-account`; la API emite tokens nuevos y **revoca la sesión actual**; el cliente emite evento `switch` y recarga la página completa. Error: «No se pudo cambiar de empresa. Intenta de nuevo.»
  - Cerrar sesión: `POST /api/auth/logout` (revoca el refresh en la API, limpia las 3 cookies), emite evento `logout` y va a `/login`.
  - Marcar leída(s): `POST /api/notifications/{id}/read` y `POST /api/notifications/read-all`.
  - Cambiar idioma (ver convenciones).
- **Vigilante de sesión (`SessionWatcher`, W-LOG-54):** envía la sesión cargada con cada pedido y escucha eventos `login`/`logout`/`switch` de otras pestañas (`BroadcastChannel` `kobrax-auth` con respaldo por `localStorage`). Logout en otra pestaña → `/login` inmediato. Otro usuario/empresa/sesión → recarga con aviso «Tu sesión cambió en otra pestaña. Recargamos la página.» (botón «Entendido»). Al recuperar el foco (mín. 2 s entre chequeos) revalida con `GET /api/auth/me`; 401 → `/login`. Un `409 SESSION_CHANGED` (la pestaña intentó guardar con la sesión vieja) muestra «Tu sesión cambió en otra pestaña. Recarga la página para continuar.» con botón «Recargar».
- **Recordatorio MFA (`MfaReminder`):** banner ámbar «Pendiente — Protege tu cuenta — Activa la verificación en dos pasos. — Activar» que lleva a `/settings/security`. **No está en el shell**: lo monta sólo el dashboard cuando `me.mfaEnabled === false` (ver [Dashboard](#dashboard--dashboard)).
- **Datos que consume:** `GET /auth/me`, `GET /auth/accounts`, `GET /agenda/summary`, `GET /notifications?limit=20`, `POST /notifications/:id/read`, `POST /notifications/read-all`, `POST /auth/switch-account`, `POST /auth/logout`.
- **Navegación:** `/` redirige a `/dashboard` (`app/page.tsx`). Foto del perfil con `onError` → iniciales.
- **Estados especiales:** `loading.tsx` (esqueletos), `error.tsx` del panel («Reintentar»), error raíz «Algo salió mal» (`app/error.tsx`, textos en español fijos, sin i18n). Si `/agenda/summary` falla, el menú sale sin número.
- **Estado:** ✅ implementado.

### Dashboard — `/dashboard`
Archivos: `app/(panel)/dashboard/page.tsx`, `components/dashboard/*`, `lib/dashboard.ts`, `lib/widget-registry.ts`, `lib/dashboard-save.ts`.

- **Propósito:** tablero de gestión de la cartera (saldo, mora, recaudo, agenda, campo) con filtros y tableros guardados editables.
- **Quién accede:** necesita **`report:read`** (ACCOUNT_ADMIN, MANAGER, SUPERVISOR, AUDITOR, VIEWER). Sin él: si tiene `agenda:read` (cobrador) → `redirect('/agenda')`; si no → estado vacío «Dashboard — Tu rol no ve el tablero de gestión.» Los endpoints de analítica y tableros exigen `report:read` en la API (`analytics.controller.ts`, `dashboards.controller.ts`). Es la pantalla de aterrizaje de login, selector de empresa y `/`.
- **Qué muestra:**
  - Título = nombre del tablero actual (por defecto «Vista general») y subtítulo «Cómo viene la cartera, el trabajo y la plata.»
  - Recordatorio MFA si `mfaEnabled === false`.
  - **Barra de filtros** (en la URL): Período, Desde, Hasta, Cobrador, Fuente, Prioridad, «Limpiar filtros», y a la derecha la barra de tablero (selector, Editar…).
  - **Aviso de fuentes mezcladas (D7):** si no hay fuente elegida y existen créditos de una fuente externa (PSF) con operaciones: «Incluye N operaciones PSF con saldo y mora reportados al corte del dd/mm… No son números de hoy: elegí una fuente para verlas por separado.» (variante con rango de cortes).
  - **Grilla de 12 columnas** (filas de 64 px, márgenes de 16) con los widgets del tablero.
- **Filtros** (`components/dashboard/dashboard-filters.tsx`, `lib/dashboard.ts`):

| Filtro | Control | Valores / regla |
|---|---|---|
| Período | select de atajos | Hoy, Ayer, Últimos 7 días (por defecto, contando hoy), Últimos 30 días, Este mes, Mes anterior; «Personalizado» aparece sólo si el rango no coincide con un atajo |
| Desde / Hasta | `input[type=date]` | `from ≤ to` (min/max cruzados); si llegan al revés se invierten; formato inválido cae al período por defecto |
| Cobrador | multiselección (checkboxes) | sólo se dibuja si hay más de 1 miembro en `/users`; ids no-UUID se descartan; viaja como `collectorId=u1,u2` |
| Fuente | select | Todas / Kobrax / PSF; sólo se dibuja si el resumen trae > 1 fuente o ya hay una elegida |
| Prioridad | multiselección | Baja, Media, Alta, Crítica (prioridad del episodio de mora abierto) |

  - «Hoy» es el **día civil de la empresa** (viene de `/agenda/summary`, no del servidor).
  - `branchId` se acepta en la URL (UUID) pero **no hay control** para elegirlo.
  - «Limpiar filtros» aparece si hay `collectorId`, `priority`, `from` o `source`, y navega a `/dashboard` sin parámetros (también deja el modo edición y el tablero elegido).
  - Los 6 endpoints de analítica reciben exactamente los mismos filtros; un valor inválido rompería los seis, por eso se sanean antes de enviar.
- **Widgets** (catálogo `lib/widget-registry.ts`; renderizado en `widget-renderer.tsx`):

| Widget (tipo → `config.metric`) | Qué muestra | Fuente API |
|---|---|---|
| **Indicadores** (`kpi` · `strip`) | Tira de 4 tarjetas: Saldo total cartera, Cartera en mora (con «x % de la cartera»), Créditos en mora, Recaudado (con sparkline de la tendencia). Cada una con variación «↑/↓ n %» vs período anterior o «sin comparar» (los saldos no tienen histórico: `previous: null`); tooltip con desglose por fuente si hay > 1 | `/analytics/summary`, `/analytics/collection-trend` |
| **KPI individual** (`kpi` · `outstanding\|overdue\|overdueRate\|creditsInArrears\|collected`; `activeCases` es alias de `creditsInArrears`) | Un número grande, etiqueta, variación y desglose por fuente | `/analytics/summary` |
| **Agenda de hoy** (`calendar` · `agendaToday`) | Contadores Vencidas y Pendientes hoy; accesos rápidos por tipo (Visitas, Llamadas, Recordatorios, Promesas, WhatsApp → `/agenda?tipo=`); hasta 4 gestiones con hora, tipo, cliente y estado (→ `/agenda/{id}`); «+ N actividades más»; con `agenda:assign` una tabla «Carga del equipo» (→ `/agenda?gestor=`); enlace «Ver agenda →»; vacío «No tienes nada pendiente para hoy.» / «Nada más para hoy: revisa las vencidas.»; sin acceso «No tienes acceso a la agenda.» | `/agenda/summary` |
| **Cartera por días de mora** (`donut_chart` · `aging`) | Dona de saldo por tramo (1–30, 31–90, 91–180, 181–360, 361–450, > 450 días) con total al centro y leyenda; vacío «No hay cartera en mora en este filtro.» | `/analytics/portfolio-aging` |
| **Mora por rango de días** (`bar_chart` · `agingBars`) | Barras de cantidad de créditos por tramo | `/analytics/portfolio-aging` |
| **Agenda del período** (`donut_chart` · `agenda`) | Dona de gestiones por tipo con % | `/analytics/agenda-summary` |
| **Indicadores de gestión** (`list` · `indicators`) | Visitas realizadas, Llamadas realizadas, Gestiones ejecutadas, Promesas de pago, Pagos registrados, con valor y variación | `/analytics/agenda-summary` |
| **Cartera por cobrador** (`table` · `collectors`) | Columnas Cobrador (→ `/mora?assigneeId=`), En mora, Saldo, En mora (monto), % mora (rojo ≥ 40, ámbar ≥ 25), Recaudado; primeras 8 filas y «Ver los N cobradores →» (`/mora`); vacío «No hay préstamos en mora en este filtro.»; sin nombre «Sin nombre» | `/analytics/collector-performance` + `/users` |
| **Mapa de visitas** (`map` · `visits`) | Mapa con paradas del **último día del período con paradas** (no todo el período): pin verde visitada / gris pendiente; globo con cliente, monto, cobrador y estado; resumen «N visitadas · N pendientes · paradas del dd/mm»; vacío «No hay paradas con ubicación para el {día}.» | `/analytics/visit-map` |
| **Evolución de cartera y recaudación** (`line_chart` · `trend`) | Dos series (Saldo de cartera y Recaudado) con el último valor; aclaración de que el saldo se reconstruye con lo cobrado después y no incluye desembolsos; nota de saldo externo; vacío «El período es muy corto para dibujar una tendencia.» | `/analytics/collection-trend` |
| **Embudo, Medidor, Histograma, Texto / Nota** (`funnel`, `gauge`, `histogram`, `text`) | Sólo una caja con «Este widget todavía no tiene datos detrás.» | — (`source: null`) |

  - Cada widget muestra su propio error (mensaje de la API) o vacío sin tumbar la página.
  - **Tablero por defecto:** si la cuenta no tiene ningún tablero guardado se usan 9 widgets del código (`DEFAULT_WIDGETS`): tira de indicadores, agenda de hoy, dona de mora, barras, dona de agenda, indicadores de gestión, cobradores, mapa y tendencia. No se siembra en base: pasa a ser fila al primer guardado. La condición es «¿hay tablero?», no «¿tiene widgets?» (borrar el último widget no resucita el tablero por defecto).
- **Tableros guardados** (compartidos por toda la empresa):
  - Selector de tablero (sólo si hay > 1), con ★ en el predeterminado; se elige con `?view=<id>`. Orden: predeterminado y luego por nombre. Sin `view`: el predeterminado, o el primero.
  - Quien tiene `report:read` ve **todos** los tableros de la cuenta.
- **Modo edición** (`?edit=1`, botón «Editar»/«Listo»): arrastrar por la cabecera del widget y redimensionar (autoguardado con 600 ms de espera tras soltar, `PATCH /dashboards/:id`); en cada widget aparecen «⧉» (duplicar widget) y «×» (quitar widget); barra con «Renombrar», «Añadir widget», «Duplicar» (tablero) y «Eliminar» (tablero). Tamaños mínimos por tipo (p. ej. KPI 2×2, línea 4×4).
  - **Añadir widget:** modal «Buscar widgets» con el catálogo (12 tipos, tamaño por defecto `w×h`, «· sin datos aún» para los 4 sin fuente). El widget nuevo entra al final con `config: {}`.
  - **Renombrar:** modal con «Nombre del tablero» (1–80, obligatorio).
  - **Duplicar tablero:** crea «{nombre} (copia)», no predeterminado, a nombre del usuario.
  - **Eliminar tablero:** `window.confirm` «¿Eliminar «{nombre}»? Deja de estar disponible para toda la empresa.»; borrado lógico.
  - Primer guardado sin tablero: crea uno llamado «Vista general» con `isDefault: true`.
- **Reglas de negocio de tableros (API `dashboards.service.ts`):** sólo puede modificar o borrar quien lo creó **o** quien tiene `account:write`; marcar predeterminado sólo con `account:write` (o si todavía no hay predeterminado); nombre 1–80, descripción ≤ 240, hasta 60 widgets por tablero, widget `x` 0–11, `w` 1–12, `h` 1–20; un cambio de widgets reemplaza el layout entero conservando los ids que ya eran del tablero. Errores: «Sólo quien creó el tablero puede modificarlo» (`AUTH_002`), «Tablero no encontrado». Todo queda en auditoría.
- **Datos que consume:** `GET /analytics/summary`, `/portfolio-aging`, `/collector-performance`, `/agenda-summary`, `/visit-map`, `/collection-trend` (ventana máxima 366 días; comparación contra el período anterior de igual duración); `GET /dashboards`; `GET /auth/me`; `GET /users`; `GET /agenda/summary`. Escritura vía BFF: `POST /api/dashboards`, `PATCH|DELETE /api/dashboards/{id}`, `POST /api/dashboards/{id}/duplicate`. Todo se pide en paralelo.
- **Navegación:** desde `/`, login, selector de empresa, «Inicio» y migas. Sale a `/agenda`, `/agenda/{id}`, `/mora?assigneeId=`, `/mora`, `/settings/security` (recordatorio MFA).
- **Estados especiales:**
  - Sin `report:read`: redirect a agenda o vacío (arriba).
  - Roles sin `user:read` (SUPERVISOR, AUDITOR, VIEWER): `/users` devuelve 403 y se usa `[]`: **no aparece el filtro Cobrador** y la tabla de cobradores muestra «Sin nombre» (inferido del código: `team.body.data ?? []`).
  - Roles sin `agenda:read` (AUDITOR, VIEWER): el widget «Agenda de hoy» dice «No tienes acceso a la agenda.»
  - Cada widget con error muestra el mensaje de la API; el resumen sin datos muestra «No se pudieron traer los indicadores.»
  - Guardado fallido: «No se pudo guardar el tablero.» (toast o banner del modal).
  - Los widgets no tienen panel de configuración: no se puede cambiar métrica, título ni filtros por widget (el campo `title` se guarda pero no hay UI para editarlo).
  - Duplicar el mismo widget dos veces genera dos widgets con el mismo `id` (`{id}-copia`); efecto no verificado.
- **Estado:** 🟡 parcial: ✅ widgets de datos, filtros, tableros guardados y edición; 📝 placeholder para Embudo, Medidor, Histograma y Texto/Nota; sin filtro de sucursal ni configuración por widget.

### Equipo — `/equipo`
Archivos: `app/(panel)/equipo/{page,members-table,invite-button,invitation-code}.tsx`, `lib/team.ts`.

- **Propósito:** ver quién trabaja en la cuenta, invitar y administrar miembros.
- **Quién accede:** ítem del menú con `user:read` (ACCOUNT_ADMIN, MANAGER, SUPER_ADMIN). La página no comprueba permisos: depende de `GET /users` (`@Roles(user:read)`); si falla → vacío «No tienes acceso al equipo» + mensaje de la API. Las acciones dependen de: invitar `user:invite`, cambiar rol/desactivar/reactivar/cancelar invitación `user:write`, cargar la lista de roles `role:read`. En la práctica sólo ACCOUNT_ADMIN/SUPER_ADMIN tienen las tres; MANAGER ve la lista de sólo lectura y sin botón de invitar (ni selector de rol, porque `/roles` devuelve vacío por falta de `role:read`).
- **Qué muestra:**
  - Encabezado «Equipo — Quién trabaja en tu cuenta y qué puede hacer.» con insignia «{usados} de {máx} miembros» (sólo si el plan tiene tope; en ámbar si ≥ 80 %, con punto).
  - Si el tope está lleno: banner «Tu plan {plan} llegó a su tope de N miembros. {Siguiente plan} incluye M.» + enlace «Ver tu plan» → `/cuenta`.
  - Tabla (`DataTable`, `tableId="equipo"`) con columnas **Miembro** (nombre y correo; ordenable), **Rol** (ordenable; selector editable o texto), **Estado** (Activo / Pendiente / Inactivo) y **Acciones**; búsqueda por nombre o correo; filtros Rol y Estado; paginación (25/50/100) y menú de columnas.
  - Vacíos: «Todavía no hay nadie más — Invita a tu equipo por correo y aparecerán acá.»; sin resultados: «Nadie coincide con esa búsqueda».
- **Acciones:**
  - **Invitar a alguien** (botón; oculto sin `user:invite` o sin roles; con tope lleno queda deshabilitado con el texto «Llegaste al tope de tu plan»): modal «Invitar al equipo» con Nombre (obligatorio, máx. 80), Apellido (obligatorio, máx. 80), Correo (obligatorio, email; se envía en minúsculas) y Rol («¿Qué va a hacer?», obligatorio; sólo Administrador, Supervisor, Cobrador). Éxito: «Invitación creada» con el **código de invitación** (copiable) y el texto «Le enviamos un correo a {correo}. Este es su código…» más enlace a `/invitacion`. Errores: «No se pudo invitar» o el de la API (correo ya registrado, tope del plan).
  - **Cambiar rol** (selector en la fila; sólo si no es uno mismo, `user:write` y el rol actual es ACCOUNT_ADMIN/SUPERVISOR/COLLECTOR): `PATCH /api/users/{id} {roleId}`; toast «Rol actualizado».
  - **Desactivar** (activos no pendientes): confirmación «Desactivar a {nombre} — No va a poder entrar, pero su historial de cobranzas y pagos se conserva…». Si tiene trabajo pendiente (gestiones agendadas, créditos a su cargo, rutas planificadas o en curso) la API responde `USER_HAS_PENDING_WORK` y la UI abre «Pasar el trabajo de {nombre}» con un selector de cobrador/supervisor activo; «Pasar y desactivar» reenvía con `reassignToUserId`. Los créditos se reasignan, las gestiones agendadas pasan al destino, las rutas se mueven o se cancelan si el destino ya tiene ruta ese día, y se revocan asignaciones temporales/de apoyo.
  - **Reactivar** (inactivos): confirma; vuelve con su contraseña y rol; exige cupo en el plan.
  - **Reenviar** (pendientes, `user:invite`): genera un código **nuevo** e invalida el anterior (modal «Invitación reenviada — El código anterior dejó de servir. Comparte este.»).
  - **Cancelar invitación** (pendientes, `user:write`): elimina por completo al usuario pendiente y libera el cupo; confirmación.
  - No hay acciones sobre uno mismo (la API devuelve `USER_CANNOT_EDIT_SELF`); el último ACCOUNT_ADMIN activo no se puede desactivar ni degradar (`USER_LAST_ADMIN`).
- **Datos que consume:** `GET /users`, `GET /roles` (sólo roles asignables), `GET /accounts/me` (cupos), `GET /auth/me`; BFF: `POST /api/users` → `POST /users/invite`; `PATCH|DELETE /api/users/{id}`; `POST /api/users/{id}/resend` → `POST /users/:id/invite/resend`.
- **Navegación:** menú «Equipo»; banner de tope → `/cuenta`; código de invitación → `/invitacion`.
- **Estados especiales:** búsqueda, filtros, orden y paginación se aplican **en memoria** sobre la lista completa en el servidor (`lib/team.ts: teamView`) y viven en la URL; «Estado» y «Rol» como filtros. Las preferencias de tabla (columnas, tamaño de página) por usuario se guardan en `localStorage` sólo si se pasa `userId` al `DataTable`, y `equipo/page.tsx` **no lo pasa** (inferido: `MembersTable` recibe `userId` indefinido), por lo que no se persisten.
- **Estado:** ✅ implementado.

### Cuenta — `/cuenta`
Archivos: `app/(panel)/cuenta/{page,plan-card,business-form,arrear-categories,whatsapp-templates}.tsx`.

- **Propósito:** ver el plan y el consumo, y configurar los datos del negocio, la parte financiera, las categorías de mora y las plantillas de WhatsApp.
- **Quién accede:** menú con `account:read` (ACCOUNT_ADMIN, MANAGER, SUPER_ADMIN). Si `GET /accounts/me` falla → «No tienes acceso a los datos de la cuenta». **Edición** con `account:write` (sólo ACCOUNT_ADMIN/SUPER_ADMIN): los campos de «Datos del negocio» y «Configuración financiera» se muestran deshabilitados y no hay botón de guardar para el resto; categorías de mora con `account:write`; plantillas con `catalog:write`.
- **Qué muestra:** encabezado «Cuenta» con insignia de estado (Activa, En prueba, Suspendida, Inactiva, Cancelada) y 4 secciones:
  1. **Tu plan:** nombre, precio y 5 medidores con barra (Miembros del equipo, Créditos activos, Clientes, Fotos por mes, Gestiones por mes: «{usado} de {tope}» o sólo el número si «Sin límite»); barra verde-azul, ámbar a ≥ 80 %, roja al tope; aviso «Fotos y gestiones se reinician el 1 de {mes}» (según zona horaria de la cuenta); aviso si la cuenta tiene un ajuste a medida de miembros; «Qué incluye» (retención de fotos y soporte); invitación a subir de plan («{plan} incluye N miembros y M créditos activos. El cambio de plan lo hacemos nosotros: escríbenos y queda activo el mismo día»). **No hay botón de cambio de plan ni de pago.**
  2. **Datos del negocio:** Nombre del negocio, NIT, Zona horaria, y un puente «Tu foto, tu teléfono y tu QR de cobro… viven en Mi perfil».
  3. **Configuración financiera:** País y moneda, Decimales de los montos, Cómo se cuenta la mora.
  4. **Categorías de mora** y 5. **Plantillas de WhatsApp** (sólo se dibujan si sus GET responden 200).
- **Acciones / campos:**

| Campo | Tipo | Obligatorio | Validación / regla |
|---|---|---|---|
| Nombre del negocio | texto | sí | 2–160 |
| NIT | texto | no | 1–40 (vacío = sin cambio de valor) |
| Zona horaria | select | no | zonas `America/*`; «Según el país» = `null` (cae a la zona del país); botón «Usar la de este equipo» (zona del navegador) |
| País y moneda | select único | sí | un solo campo que fija país + moneda acoplados (6 países, `COUNTRY_CURRENCIES`) |
| Decimales de los montos | select | sí | 2, 1 o 0, con ejemplo «Bs 1.250,50» |
| Cómo se cuenta la mora | select | sí | «Desde la cuota impaga más antigua» / «Desde el primer atraso, hasta quedar al día (como los bancos)»; sólo para créditos nuevos (se puede cambiar por crédito) |

  - «Guardar cambios» (deshabilitado sin cambios; envía sólo el diff, `PATCH /api/account/me`); toast «Datos guardados» o banner «No se pudieron guardar los datos».
  - **Categorías de mora:** tabla editable Código (máx. 16), Nombre (máx. 60), Desde (días), Hasta (días; vacío = «Sin límite»), Color (texto libre, p. ej. `#E67E22`, máx. 32), «×» para quitar, «+ Agregar categoría» (hasta 26; la nueva arranca en el día siguiente al último «hasta»). Validación viva en banner rojo: al menos una; código obligatorio y único; «desde» entero ≥ 1; «hasta» ≥ «desde»; la primera empieza en el día 1; sin huecos ni solapes; sólo la última puede ser sin límite. «Guardar categorías» → `PUT /api/arrear-categories`; «Sólo un administrador puede cambiar estos rangos.» sin permiso. Aclaración: la categoría de un crédito no se guarda, se calcula con estos rangos.
  - **Plantillas de WhatsApp:** lista con nombre y mensaje; «+ Agregar plantilla», «Editar», «Quitar» (confirmación «¿Quitar «{nombre}»?»). Modal con Nombre (máx. 60, obligatorio) y Mensaje (textarea, obligatorio); variables `{{cliente}}`, `{{saldo}}`, `{{negocio}}`. Sin plantillas: vacío «Todavía no hay plantillas» y 3 ejemplos (Recordatorio amable, Pago vencido, Último aviso) que abren el modal precargado. El código de la plantilla se genera `tpl-<timestamp base36>`.
- **Datos que consume:** `GET /accounts/me`, `GET /catalogs/WHATSAPP_TEMPLATE` (`catalog:read`), `GET /arrear-categories` (`collection:read`); BFF: `PATCH /api/account/me` → `PATCH /accounts/me`; `PUT /api/arrear-categories`; `POST /api/catalogs/WHATSAPP_TEMPLATE`, `PATCH|DELETE /api/catalogs/WHATSAPP_TEMPLATE/{id}`.
- **Navegación:** menú; desde `/equipo` (tope) y hacia `/settings/perfil`.
- **Estados especiales:** límites del plan sólo informativos (barras); sin acceso → vacío; secciones 4 y 5 se omiten silenciosamente si su GET falla; modo lectura para MANAGER.
- **Estado:** ✅ implementado (🟡 gestión de plan: sólo lectura, el cambio se hace por contacto).

### Exportar — `/exportar`
- **Propósito:** descargar datos de la cuenta en CSV y un backup completo.
- **Quién accede:** menú con `report:export` (ACCOUNT_ADMIN, MANAGER, AUDITOR, SUPER_ADMIN). La página **no comprueba** el permiso; sin él la descarga responde error JSON de la API (`@Roles(report:export)` en `exports.controller.ts`).
- **Qué muestra:** «Exportar — Bajá los datos de tu cuenta: la cartera en CSV, o todo junto como backup.» Sección «Cartera» con 4 tarjetas-enlace: **Clientes** (`clientes.csv`: id, nombre, tipo, documento, contacto principal, estado, segmento, saldo total, días de mora máx., créditos, creado el), **Ubicaciones** (`ubicaciones.csv`: id, cliente, tipo, dirección, zona, latitud, longitud, riesgo), **Mora** (`mora.csv`: un crédito en mora por fila, mismas columnas que la exportación de la Central de Mora salvo «Promesa vigente»; de la cuenta entera, sin alcance por agencia), **Agenda** (`agenda.csv`: id, cliente, tipo, estado, fecha, hora, asignado, observaciones). Sección «Backup» con «Descargar backup».
- **Acciones:** cada tarjeta es un `<a href="/api/exports/{tipo}">`: la descarga es nativa del navegador. Tipos permitidos en el BFF: `clients|locations|mora|agenda|backup`, otro → 404. El backup (`backup-cuenta.json.gz`, JSON comprimido) incluye clientes con contactos/ubicaciones/relaciones/garantías/adjuntos, créditos, gestiones, episodios de mora, pagos y agenda, con datos sensibles descifrados; **no** incluye rutas, catálogos ni dashboards.
- **Datos que consume:** `GET /api/exports/{tipo}` → `GET /exports/{tipo}` (streaming, `Content-Disposition` reenviado). Cada exportación registra una entrada de auditoría `EXPORT`.
- **Navegación:** menú «Exportar».
- **Estados especiales:** no hay indicador de carga ni de error en la página (si falla, el navegador muestra el JSON de error); no hay filtros por fecha ni formato Excel.
- **Estado:** ✅ implementado (🟡 sin retroalimentación de errores).

### Mi perfil — `/settings/perfil`
Archivos: `app/(panel)/settings/perfil/{page,profile-form,qr-viewer}.tsx`, `components/security-options.tsx`.

- **Propósito:** datos personales (nombre, teléfono, foto, QR de cobro), idioma y acceso a las opciones de seguridad.
- **Quién accede:** cualquier sesión (permiso `null` en `NAV`). Si `GET /users/me/profile` falla → «No pudimos cargar tu perfil».
- **Qué muestra:** título «Mi perfil — Cómo te ve tu equipo y cómo te cobran los deudores.» con insignia del rol; formulario; sección «Preferencias» (selector de idioma); sección «Seguridad» con las 3 opciones (Contraseña, Verificación en dos pasos con insignia Activa/Sin activar y pista cuando está apagada, Sesiones activas).
- **Acciones / campos:**

| Campo | Tipo | Obligatorio | Validación |
|---|---|---|---|
| Nombre | texto | sí | máx. 80 |
| Apellido | texto | sí | máx. 80 |
| Teléfono | `tel` | no | patrón `[\d+][\d\s-]{4,}` (≥ 5 dígitos; puede empezar con `+`, espacios y guiones); API 5–32; vacío lo quita |
| Foto | archivo imagen | no | sube a `/api/account/upload`; vista previa 64 px; «Quitar» |
| QR de cobro | archivo imagen | no | igual; «Ver en grande» abre pantalla completa «Escanea para pagar» (sólo para el QR ya guardado) |

  - El correo no es editable («Tu correo de acceso es {correo}. Para cambiarlo, escríbenos.»).
  - «Guardar cambios» (deshabilitado sin cambios, envía el diff) → toast «Perfil actualizado» / banner «No se pudo guardar el perfil». Un mismo PATCH: un teléfono inválido rechaza también nombre y foto.
  - Subida: «Subiendo…»; error «No se pudo subir el archivo».
  - «Contraseña» y «Verificación en dos pasos» abren **modales** (ver [Seguridad](#seguridad--settingssecurity)); «Sesiones activas» navega.
- **Datos que consume:** `GET /users/me/profile`, `GET /auth/me`; BFF: `PATCH /api/account/profile` → `PATCH /users/me/profile`; `POST /api/account/upload` → `POST /uploads` (devuelve `url`, `hash`, `size`, `mimeType`). Límites de tamaño/tipo del upload: no verificado.
- **Navegación:** menú «Mi perfil»; desde `/cuenta` («viven en Mi perfil»); a `/settings/security/sessions`.
- **Estados especiales:** foto rota → se oculta; cada archivo se deshabilita mientras sube.
- **Estado:** ✅ implementado.

### Seguridad — `/settings/security`
- **Propósito:** hub de seguridad personal: cambiar contraseña, gestionar MFA, ver sesiones.
- **Quién accede:** cualquier sesión. No aparece en el menú (`hidden`); se llega desde «Mi perfil → Seguridad» o desde el recordatorio MFA del dashboard. Título «Seguridad».
- **Qué muestra:** `SecurityOptions` sin el estado de MFA (a diferencia de «Mi perfil», aquí **no** se pasa `mfaEnabled`, así que no hay insignia Activa/Sin activar ni pista).
- **Acciones (modales):**
  - **Cambiar contraseña:** Contraseña actual (obligatoria), Nueva contraseña (política), Confirmar (debe coincidir). «Actualizar contraseña» → `POST /api/account/change-password`. Éxito: «Contraseña actualizada — Por seguridad cerramos todas tus sesiones. Inicia sesión de nuevo…» y redirección a `/login` a los 1,8 s (el BFF limpia cookies; la API revoca todas las sesiones).
  - **Verificación en dos pasos (`MfaManager`):** consulta `GET /api/auth/me` para el estado. Desactivada: «Activar MFA» → QR + clave manual + OTP → «Verificar y activar» → muestra 8 códigos de respaldo (descargables en `kobrax-backup-codes.txt`). Activa: «MFA está activo en tu cuenta», «Regenerar códigos de respaldo» (invalida los anteriores) y «Desactivar» (pide contraseña). Errores: «No se pudo iniciar el enrolamiento», «Código inválido», «No se pudieron regenerar los códigos», «No se pudo desactivar MFA».
  - **Sesiones activas:** enlace a la pantalla siguiente.
  - Al cerrar un modal se hace `router.refresh()`.
- **Datos que consume:** `POST /api/account/change-password` → `POST /auth/change-password`; `POST /api/account/mfa` con `action` ∈ `enroll|verify|disable|regenerate` → `POST /auth/mfa/enroll|verify|disable|backup-codes/regenerate`; `GET /api/auth/me`.
- **Navegación:** → `/settings/security/sessions`; desde `/login/mfa-setup` («Volver») cuando hay sesión.
- **Estados especiales:** `loading` mientras consulta MFA; 401 en `me` → `/login`.
- **Estado:** ✅ implementado.

### Sesiones activas — `/settings/security/sessions`
- **Propósito:** revisar dónde está abierta la cuenta y cerrar sesiones de otros dispositivos.
- **Quién accede:** cualquier sesión. Es página de cliente (`'use client'`); 401 en la carga → `window.location.href = '/login'`.
- **Qué muestra:** enlace «← Seguridad», título «Sesiones activas» y una tarjeta por sesión: tipo de dispositivo (o «Dispositivo») · nombre de la empresa, insignia «Esta sesión» en la actual, y debajo SO · IP · último acceso (formateado con el idioma activo).
- **Acciones:** «Cerrar» por sesión (excepto la actual; muestra «···» mientras procesa) → `DELETE /api/account/sessions/{id}`; «Cerrar todas las demás sesiones» (si hay otras) → `DELETE /api/account/sessions`. Tras cada acción recarga la lista. No hay confirmación ni manejo de error en el cierre (sólo recarga).
- **Datos que consume:** `GET /api/account/sessions` → `GET /auth/sessions`; `DELETE /auth/sessions/:id`; `DELETE /auth/sessions`.
- **Navegación:** desde «Mi perfil»/«Seguridad»; migas `Seguridad / Sesiones activas`.
- **Estados especiales:** «Cargando…»; error «No se pudieron cargar las sesiones». Lista vacía: no hay texto específico (no verificado más allá de que siempre hay al menos la sesión actual).
- **Estado:** ✅ implementado.

---

## Middleware — `middleware.ts`

- **Propósito:** proteger rutas privadas y renovar la sesión sin que el usuario lo note.
- **Rutas «sólo invitados»** (`/login`, `/registro`, `/forgot-password`, `/invitacion`): con sesión válida redirige a `/dashboard`. Comprueba `GET /auth/me`; si no responde 200 y hay `k_refresh`, intenta `POST /auth/refresh`: si sale bien reescribe cookies y redirige; si la API rechaza (401/403) borra cookies y muestra el formulario; si la API no contesta muestra el formulario sin tocar la sesión. `/login/mfa*`, `/login/select-account` y `/reset-password` **no** están en el matcher.
- **Rutas privadas** (matcher): `/dashboard`, `/settings`, `/cuenta`, `/equipo`, `/cartera`, `/import`, `/mora`, `/agenda`, `/rutas`, `/pagos`, `/exportar` (+ subrutas) y los handlers `/api/auth/me`, `/api/auth/switch-account`, `/api/exports`, `/api/notifications`, `/api/account`, `/api/users`, `/api/clients`, `/api/routes`, `/api/credits`, `/api/imports`, `/api/assignments`, `/api/arrear-categories`, `/api/mora`, `/api/agenda`, `/api/dashboards`, `/api/payments`, `/api/payment-requests`, `/api/uploads`.
- **Lógica:** con `k_access` presente pasa. Sin él (expiró a los 15 min) y con `k_refresh` → `POST /auth/refresh`; si ok, reescribe las cookies **en la respuesta y en la petición actual** (para que el handler de ese mismo request ya vea el token). Sin sesión: a páginas → redirect a `/login`; a handlers `/api/*` → `401 {error:{code:'AUTH_003', message:'Sesión expirada'}}` (JSON, no HTML).
- **Cuándo borra cookies:** sólo si la API rechazó el refresh con 401/403. Un fallo de red no destruye la sesión (evita cerrar la sesión por un parpadeo o por un `<img>` ajeno gracias a `SameSite=Strict`).
- **Refresh en la API:** rotación en cada uso con ventana de gracia de 10 s ante carreras; reutilización fuera de ventana revoca toda la familia y la sesión (`auth.service.ts: refresh`).
- **Estado:** ✅ implementado (ver hallazgo sobre `/api/catalogs`).

---

## Hallazgos y discrepancias

1. **`/api/catalogs/**` no está en el matcher del middleware** (`middleware.ts`), aunque el propio comentario exige incluir los handlers del BFF autenticados. Consecuencia: con la pestaña de `/cuenta` abierta > 15 min, las plantillas de WhatsApp no pasan por el refresh silencioso del middleware (el layout/otras llamadas sí lo refrescan al navegar). Verificado en el matcher; impacto práctico no probado.
2. **Correo de «Recuperar contraseña» sólo trae enlace móvil** (`kobrax://reset?token=…`, `mail.service.ts: passwordResetBody`), mientras que la web tiene `/reset-password`. El correo de invitación también es sólo `kobrax://invitacion…` + código. Un usuario web sólo puede restablecer contraseña si arma la URL `?token=` a mano o usa la app.
3. **Epic F9 vs. código:** `docs/epics/EPIC-F9-panel-web.md` (líneas 27, 94) promete login con Google «construido completo en W0»; el login web **no lo tiene** (comentario en `login/page.tsx`: bloqueado por credenciales).
4. **`/login/mfa-setup` con sesión abierta:** la pantalla ofrece «Volver» si ya hay sesión, pero su acción `start` necesita `k_preauth` (se borra al completar el login), así que entrar por URL manual falla con «Sesión de login expirada». Ningún enlace del panel apunta ahí (el panel usa el modal `MfaManager`).
5. **Texto vs. comportamiento MFA:** «Tu rol requiere MFA» pero se puede saltar con «Lo hago después» sin límite; el recordatorio sólo aparece en el dashboard.
6. **Equipo:** preferencias de tabla (columnas/tamaño de página) no se persisten porque la página no pasa `userId` al `DataTable`.
7. **Dashboard sin filtro de sucursal ni configuración por widget**, pese a que la API acepta `branchId` y `config.metric` decide el dato; los widgets añadidos con «Añadir widget» entran con `config: {}` y se pintan con la métrica por defecto de su tipo (p. ej. un «KPI» nuevo siempre muestra Saldo total cartera).
8. **Textos con voseo y sin i18n** en mensajes de error de la API (`Podés`, `Pedí`) frente al tuteo del resto de la UI; el rol del sidebar y de «Elegir empresa» se muestra como código técnico (`ACCOUNT_ADMIN`).
9. **Exportar** no verifica permiso ni muestra errores de descarga en la página.
10. **Roles sin `user:read`** (SUPERVISOR, AUDITOR, VIEWER) ven el dashboard sin filtro Cobrador y con nombres «Sin nombre» en la tabla de cobradores.

## No verificado

- Tamaño/tipo máximo permitido en `POST /uploads` (foto y QR de perfil).
- TTL exacto del `preAuthToken` en la API (la cookie `k_preauth` dura 5 min).
- Contenido del contrato `EPIC-F9`/`docs/epics-web/login` en detalle: sólo se contrastó la mención de Google.
- Textos del diccionario `en.json` (se documentó el `es`; paridad de claves cubierta por `i18n/messages.test.ts`, no revisada).
- Efecto de duplicar dos veces el mismo widget (ids `…-copia` repetidos) y de añadir dos widgets del mismo tipo en la misma fila final (`nuevo-{tipo}-{y}`).
- Comportamiento visual del mapa de visitas (`components/route-map.tsx`) y de los gráficos (`components/dashboard/charts.tsx`), sólo leídos a nivel de datos.
- Qué devuelve exactamente `GET /agenda/summary` para el bloque «Carga del equipo» según alcance de datos (`data:scope:*`).
- Lista de vacíos en «Sesiones activas» y límites de sesiones simultáneas.
