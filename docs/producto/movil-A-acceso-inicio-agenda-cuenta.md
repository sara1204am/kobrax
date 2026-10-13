# App móvil del cobrador — Parte A: acceso, inicio, agenda, notificaciones, pendientes y cuenta

> Documentación funcional pantalla por pantalla de `apps/mobile` (Expo Router). Basada en el código real
> (rama `docs/movil-alineacion-web`, `app.json` versión **1.1.0**). `docs/epics/F10` se usó solo como apoyo; las
> contradicciones se señalan en «Discrepancias con otros documentos».
> Leyenda de estado: ✅ implementado y coherente · 🟡 implementado con salvedad · 📝 solo diseño / no alcanzable.

## Índice

0. [Convenciones](#0-convenciones)
1. [Arranque y enrutado post-login](#1-arranque-y-enrutado-post-login)
2. Grupo `(auth)`
   - [Login](#login--authlogin) · [MFA (reto)](#mfa-reto--authmfa) · [Activar MFA](#activar-mfa--authmfa-setup) ·
     [Elegir empresa](#elegir-empresa--authselect-account) · [Recuperar contraseña](#recuperar-contraseña--authforgot-password) ·
     [Desbloqueo](#desbloqueo-biométrico--authunlock) · [Activar biometría](#activar-biometría--authbiometric-setup) ·
     [Invitación](#tengo-una-invitación--authinvitacion) · [Registro](#crear-una-cuenta--authregistro)
3. Grupo `(app)`: [Cambio de contraseña](#cambio-de-contraseña--appforce-password-change) · [Sin conexión](#modo-sin-conexión--appoffline)
4. [Shell de tabs y qué se ve según permisos](#4-shell-de-tabs-y-permisos)
5. [Inicio](#inicio--tabsindex) y [definición de KPIs](#51-kpis-del-inicio-definiciones-exactas)
6. Agenda: [Agenda diaria](#agenda-diaria--tabsagenda) · [Detalle de gestión](#detalle-de-gestión--agendaid) ·
   [Registrar gestión / posponer](#registrar-gestión-y-posponer--hoja-dentro-de-agendaid) ·
   [Nueva / editar gestión](#nueva--editar-gestión--agendacrear) · [Avisos locales](#avisos-locales-de-la-agenda) ·
   [Conflictos offline](#conflictos-offline-de-la-agenda)
7. [Notificaciones](#notificaciones--notificaciones) · [Sin subir (cola offline)](#sin-subir-cola-offline--pendientes)
8. [Más](#más--tabsmas) · Cuenta: [Mi cuenta](#mi-cuenta--cuenta) · [Mi perfil](#mi-perfil--cuentaperfil) ·
   [Datos de la cuenta](#datos-de-la-cuenta--cuentadatos) · [Miembros](#miembros--cuentamiembros) ·
   [Detalle de miembro](#detalle-de-miembro--cuentamiembroid) · [Invitar](#invitar--cuentainvitar)
9. [Discrepancias con otros documentos](#9-discrepancias-con-otros-documentos) · [Lo no verificado](#10-no-verificado)

---

## 0. Convenciones

### 0.1 Almacenamiento seguro (`src/session.ts`, `src/auth-draft.ts`, `src/biometric.ts`)
- **Tokens y sesión** en `expo-secure-store` (nunca AsyncStorage). Claves: `k_access`, `k_refresh`,
  `k_session_valid_until`, `k_user_id`.
- **Flags de biometría** en SecureStore: `k_biometric_enabled`, `k_biometric_prompt_shown`.
- **Borradores de acceso** en SecureStore con caducidad de **10 min** (`DRAFT_TTL_MS`): el correo tecleado en el login y
  el paso «Revisa tu correo» de recuperar contraseña (`k_draft_login_email`, `k_draft_forgot`). **Nunca** se guarda la contraseña.
- **Borrador de ruta** por usuario: `kobrax.route.draft.<userId>` (se borra al cambiar de persona o al cerrar sesión).
- **Id de instalación** para push: `push.installationId` (sobrevive al cierre de sesión).
- **Datos del negocio y cola** en SQLite (`src/db.ts`, `kobrax.db`): tabla `cache` (descartable), `queue` (lo que no subió) y
  `meta`. `SCHEMA_VERSION = 3`: un cambio de esquema borra **caché y cola** (decisión dev-only del F4/08).
- **Fotos pendientes** se copian a `documentDirectory/queue-photos/` (no a la caché del sistema); tope total de
  **150 MB** (`PENDING_PHOTOS_MAX_BYTES`).
- **Cierre de sesión** (`clearSession`, común a los 4 finales de sesión: botón, refresh rechazado, «usar contraseña» del
  desbloqueo y cambio de contraseña): cancela avisos locales de agenda, borra borradores de ruta, tokens, userId y **toda la
  caché** de datos del tenant. **La cola NO se borra** (puede contener un pago): queda con su dueño (`userId`).
- Segunda barrera: al entrar, si el `userId`/`accountId` del `me` nuevo difiere del guardado, se vacía la caché.

### 0.2 Biometría
- Solo **desbloquea el token local**; nunca autentica contra la API ni sustituye al login (`biometric.ts`).
- Se ofrece **una sola vez** tras el login si hay hardware **y** huella/rostro enrolado y no está activada
  (`shouldOfferBiometricSetup`). Se confirma con un prompt real antes de activar.
- El prompt del SO permite el PIN/patrón del dispositivo como respaldo (`disableDeviceFallback: false`).
- Con biometría activa, el arranque va a `/(auth)/unlock`; sin ella, directo a `routeAfterAuth`.
- Re-bloqueo al volver de segundo plano: si estuvo fuera **≥ 60 s** (`LOCK_GRACE_MS`) y la biometría está activa, vuelve
  al splash (→ unlock). La gracia evita rebotar por la cámara, el diálogo de permisos o saltar a WhatsApp.

### 0.3 Ventana offline de sesión
- `validUntil = ahora + min(7 d, 8 h)` = **8 h de inactividad** (`INACTIVITY_MS`). Se renueva en `saveSession` (login/refresh)
  y en `touchSession` (cada `GET /auth/me` exitoso).
- Mientras `ahora < validUntil` el teléfono entra **sin red** usando el último `me` guardado (cache `session/me`); no se
  vuelve a validar el token (un solo reloj). Vencida la ventana: login (no hay acceso offline).
- Sin red y con ventana vigente, la app **abre el shell con datos locales** (no la pantalla `offline`): esa pantalla solo
  aparece si no hay `me` local guardado (teléfono nuevo / sesión sin identidad).
- Timeout de red: **15 s** por llamada (`apiFetch`), **60 s** para subidas multipart. Un `timeout` es «resultado desconocido»
  (el servidor pudo procesarlo); es seguro reintentar porque toda escritura repetible lleva un id puesto por el teléfono
  (`nuevoId()`) o una `Idempotency-Key`.

### 0.4 Versión mínima de app (corte 426)
- Toda llamada lleva `x-app-version` (de `app.json`, hoy 1.1.0) y `x-client-type: mobile`.
- La API (`AppVersionGuard`) responde **426 `APP_001`** si existe `MIN_APP_VERSION` en el entorno **y** el header es menor.
  Apagado por defecto. Exentas las rutas `/auth/*` y `/health` (la app vieja aún puede renovar o cerrar sesión).
- La app muestra una pantalla a pantalla completa (`UpgradeGate`, montada en el layout raíz): «Hay que actualizar Kobrax»,
  versión instalada, y cuántas acciones esperan («Tu trabajo está a salvo»). Botón «Ya actualicé · reintentar» solo la cierra
  y vuelve a probar. La cola **no descarta nada** por un 426 (`isPermanentRejection` lo excluye) y el drenaje se detiene.
- Además hay una tolerancia por versión para cerrar rutas sin motivo (`ROUTE_CLOSE_REASON_MIN_APP_VERSION = 1.1.0`, API).

### 0.5 Conectividad, banner y cola
- `useNetStore` (Zustand + NetInfo): `isConnected` es optimista hasta el primer evento y solo pasa a «sin conexión» si
  `isConnected === false` o `isInternetReachable === false`.
- `OfflineIndicator` (montado en el **layout raíz**, también visible en ficha de deudor y resultado de parada): rojo
  «Sin conexión · N pendientes de sync» sin red; ámbar «Subiendo · N pendientes» con red y cola; oculto si no hay nada.
  Con cola, tocarlo abre `/pendientes`.
- Motor de sync (`sync/sync.service.ts`), arranca al montar `(tabs)`: drena al abrir, al reconectar (flanco de subida) y
  **cada 60 s con red**. Techo automático: **3 intentos** por ítem; después espera «Reintentar ahora». Sin red corta el
  drenaje (no cuenta intento). 426/401 detienen el drenaje sin descartar.
- Hidratación «de oficina» (`sync/hydrate.ts`, no bloqueante, al entrar al shell): baja cartera, mora, rutas, agenda de
  hoy + **7 días** (`AGENDA_AHEAD_DAYS`), vencidos (100), avisos, detalle de hasta **60** gestiones pendientes
  (`MAX_AGENDA_DETAILS`), notificaciones, pagos de hoy, categorías de mora, ruta activa con paradas, 6 catálogos
  (medios de pago, bancos, categoría especial, motivos de cancelar/reagendar, plantillas de WhatsApp) y fichas +
  contexto + mora de hasta **150** clientes (`MAX_FICHAS`).
- Lectura con respaldo (`sync/cached.ts`): con red guarda; **solo** un fallo de red cae al respaldo (un 4xx/5xx llega a la
  pantalla tal cual). Las listas se guardan por consulta (scope) y las fichas por entidad.

### 0.6 Política de contraseña (`packages/shared/.../password-policy.ts`)
Mínimo 8 caracteres, al menos una mayúscula, un número y un símbolo. La UI la muestra como checklist en tiempo real
(`PasswordChecklist`); el servidor la revalida.

---

## 1. Arranque y enrutado post-login

### Splash / bootstrap — `/` (`app/index.tsx`)
- **Propósito:** decidir el destino al abrir la app según la sesión guardada.
- **Quién accede:** todos; no requiere sesión.
- **Qué muestra:** marca «KOBRAX» sobre fondo navy y un indicador de carga.
- **Acciones:** ninguna (automático). Orden: (1) sin sesión o ventana vencida → `/(auth)/login`; (2) biometría activa →
  `/(auth)/unlock`; (3) en otro caso → `routeAfterAuth()`.
- **Comportamiento offline:** disponible; solo lee SecureStore.
- **Datos:** SecureStore (`getSession`, `isBiometricEnabled`).
- **Navegación:** → login / unlock / `routeAfterAuth`.
- **Estado:** ✅

### `routeAfterAuth` — `src/post-login.ts` (punto único tras autenticarse)
Orden de prioridad (llama `GET /auth/me`):
1. `unauthenticated` (refresh rechazado) → `/(auth)/login`.
2. `offline` sin identidad local → `/(app)/offline`. (Con ventana vigente y `me` guardado, `me()` responde con el local y
   **no** pasa por aquí.)
3. `requiresPasswordChange` → `/(app)/force-password-change`.
4. (en segundo plano) registra el push FCM del teléfono (solo Android).
5. Si hay hardware biométrico enrolado y nunca se ofreció → `/(auth)/biometric-setup`.
6. Si el tenant pidió el import del día (`shouldOfferImport`, falla cerrado) → `/import` (saltable).
7. `/(tabs)` y, si la app se abrió tocando un aviso, se navega a su destino pendiente (`consumePendingTarget`).

`goToStep(step)` (`route-step.ts`) traduce el paso que devuelve la API: `done` → `routeAfterAuth`; `mfa` → `/(auth)/mfa`;
`mfa_setup` → `/(auth)/mfa-setup`; `select_account` → `/(auth)/select-account`.

---

## 2. Grupo `(auth)` — acceso sin sesión

Estado de flujo (pre-auth token, lista de empresas): **solo en memoria** (`auth-service.ts`, vigencia del token 5 min según
comentario del código). Si Android mata la app a mitad del flujo MFA/selección de empresa, el flujo se pierde y hay que
volver a iniciar sesión («Sesión de login expirada»).

### Login — `/(auth)/login`
- **Propósito:** iniciar sesión con correo y contraseña.
- **Quién accede:** cualquiera sin sesión (destino del splash cuando no hay sesión o venció la ventana). El botón
  biométrico solo aparece si hay sesión local vigente **y** biometría activa.
- **Qué muestra:** cabecera «Kobrax · Gestión de cobranzas en campo», título «Inicia sesión», pastilla «¡Bienvenido de vuelta!»,
  campos Correo y Contraseña, enlaces, tarjeta promocional estática («Rutas optimizadas», «Cobro en campo», «Gestión de
  clientes», «Reportes en tiempo real») y, **solo si `API_BASE` es https**, la pastilla «🔒 Acceso cifrado».
- **Acciones:**
  - *Iniciar sesión* (o «Ir» en el teclado): valida en cliente (correo requerido y formato `x@y.z`; contraseña requerida)
    sin llamar a la API. Luego `POST /auth/login`. Errores por campo (`details.fields`) se pintan bajo el campo; el resto
    como banner. Éxito → `goToStep(step)`; borra el borrador del correo.
  - El correo se guarda como borrador (10 min) para sobrevivir a que Android recree la app; si hay un borrador de
    «Revisa tu correo» con envío hecho, el login reabre `forgot-password`.
  - «¿Olvidaste tu contraseña?» → `/(auth)/forgot-password`; «Crear una cuenta» → `/(auth)/registro`; «Tengo una invitación»
    → `/(auth)/invitacion`; «Face ID / <método>» (si aplica) → `/(auth)/unlock`.
  - Autocompletado de gestor de contraseñas (usuario/contraseña).
- **Comportamiento offline:** **solo online** (sin red el login devuelve error de red genérico «Sin conexión»; no hay login
  offline con credenciales). Lo único que funciona sin red desde aquí es el desbloqueo biométrico (→ unlock) con sesión vigente.
- **Datos:** `POST /auth/login`.
- **Navegación:** desde splash, desde logout, cambio de contraseña, desbloqueo («Usar contraseña»); a MFA / selección de
  empresa / `routeAfterAuth`.
- **Estado:** ✅

### MFA (reto) — `/(auth)/mfa`
- **Propósito:** pedir el segundo factor tras un login válido de un usuario con MFA activo.
- **Quién accede:** quien vino del login con `step = mfa` (necesita el pre-auth token en memoria).
- **Qué muestra:** «Ingresa tu código», campo OTP de 6 dígitos; alternativa «Usar un código de respaldo» (campo libre
  `xxxxx-xxxxx`).
- **Acciones:** «Verificar» (habilitado con 6 dígitos; con respaldo, ≥ 6 caracteres) → `POST /auth/mfa/challenge`. Error:
  banner y se limpia el código. Éxito → `goToStep`.
- **Comportamiento offline:** solo online.
- **Datos:** `POST /auth/mfa/challenge` `{preAuthToken, code}`.
- **Navegación:** de login/registro/invitación; a `routeAfterAuth` o selección de empresa.
- **Estado:** ✅ (no verificado: límite de intentos del servidor).

### Activar MFA — `/(auth)/mfa-setup`
- **Propósito:** enrolar el segundo factor (TOTP). Dos modos: durante el login (rol que lo exige) o con sesión (`?authed=1`,
  desde el aviso del Inicio).
- **Quién accede:** (a) login con `step = mfa_setup` (el rol lo exige); (b) usuario con sesión que toca la fila «Protegé tu
  cuenta» del Inicio (`!me.mfaEnabled`).
- **Qué muestra:** título «Activa MFA», botón «? Ayuda» (hoja con explicación y pasos para instalar Authy / Google /
  Microsoft Authenticator; aclara que los códigos funcionan sin internet), QR dibujado en el dispositivo, la clave en texto
  (tocar para copiar), campo OTP de 6 dígitos. Tras verificar: «Guarda tus códigos» (lista de códigos de respaldo, de un
  solo uso).
- **Acciones:** «Activar y continuar» (6 dígitos y clave cargada). Modo login: `POST /auth/mfa/setup/start` al abrir,
  `/auth/mfa/setup/verify` al confirmar; **«Lo hago después»** (botón ghost) → `POST /auth/mfa/setup/skip` y entra sin MFA
  (decisión de producto: postergable indefinidamente; el Inicio lo recuerda). Modo con sesión: `POST /auth/mfa/enroll` y
  `/auth/mfa/verify`; botón «Volver», sin postergar. «Ya los guardé, continuar» → `goToStep` (login) o `/(tabs)` (sesión).
- **Comportamiento offline:** solo online (necesita la API para el secreto y la verificación).
- **Datos:** endpoints listados arriba.
- **Navegación:** desde login/registro/Inicio; a `routeAfterAuth` o tabs.
- **Estado:** ✅

### Elegir empresa — `/(auth)/select-account`
- **Propósito:** elegir el tenant cuando el usuario pertenece a varios.
- **Quién accede:** login con `step = select_account`.
- **Qué muestra:** lista de empresas (`name` + `role`) tomadas del resultado del login (memoria).
- **Acciones:** tocar una empresa → `POST /auth/select-account` `{preAuthToken, accountId}`; guarda sesión y `goToStep('done')`.
  Mientras sube, el resto se atenúa y se deshabilita.
- **Comportamiento offline:** solo online.
- **Datos:** `POST /auth/select-account`.
- **Navegación:** de login/MFA; a `routeAfterAuth`.
- **Estado:** ✅ (lista vacía si el proceso se recreó: ver nota arriba).

### Recuperar contraseña — `/(auth)/forgot-password`
- **Propósito:** pedir el enlace de restablecimiento por correo.
- **Quién accede:** cualquiera sin sesión.
- **Qué muestra:** paso 1: campo Correo; paso 2 «Revisa tu correo»: texto con correo enmascarado (`j***@banco.com`) y botón
  de reenvío con cuenta regresiva.
- **Acciones:** «Enviar enlace» (correo no vacío; se normaliza a minúsculas) → `POST /auth/forgot-password`. La API responde
  200 siempre (anti-enumeración). «Reenviar enlace» solo cuando termina la cuenta regresiva de **30 s**
  (`RESEND_SECONDS`, calculada contra la hora absoluta del envío; sobrevive a segundo plano). 429 → «Demasiados intentos.
  Espera una hora antes de reintentar.» Sin red → «Sin conexión. Revisa tu red…». «Volver a iniciar sesión» borra el borrador.
- **Comportamiento offline:** solo online (mensaje explícito).
- **Datos:** `POST /auth/forgot-password`.
- **Navegación:** desde login; vuelve a login. El enlace del correo **abre la página web `reset-password`**
  (`apps/web/src/app/(auth)/reset-password`); **no existe pantalla móvil de restablecimiento** ni deep link a ella
  (el texto «Ábrelo en este dispositivo» se refiere al navegador).
- **Estado:** 🟡 (flujo completo solo con el navegador).

### Desbloqueo biométrico — `/(auth)/unlock`
- **Propósito:** reabrir la sesión local con huella/rostro.
- **Quién accede:** splash/re-bloqueo cuando hay sesión vigente y biometría activa; o el botón del login.
- **Qué muestra:** 🔐 «Desbloquea Kobrax», «Usa tu <huella digital | Face ID | iris | biometría>…», aviso «La biometría solo
  desbloquea este dispositivo; nunca sustituye tu contraseña».
- **Acciones:** lanza el prompt solo al abrir; «Desbloquear» lo repite (falla → «No pudimos verificar tu identidad…»).
  Éxito → `routeAfterAuth` (revalida con `GET /auth/me`; si no hay red entra con el `me` local). **«Usar contraseña»**:
  `clearSession()` + `clearBiometric()` → login (borra tokens y caché; la cola queda).
- **Comportamiento offline:** disponible (el prompt es local; `routeAfterAuth` degrada al `me` guardado).
- **Datos:** SecureStore + `GET /auth/me`.
- **Navegación:** de splash/login/re-bloqueo; a `routeAfterAuth` o login.
- **Estado:** ✅

### Activar biometría — `/(auth)/biometric-setup`
- **Propósito:** ofrecer **una sola vez** activar el desbloqueo biométrico.
- **Quién accede:** solo vía `routeAfterAuth` cuando `shouldOfferBiometricSetup` (hardware enrolado, no activada, oferta no
  mostrada).
- **Qué muestra:** 👆 «Activa <método>» con explicación («solo se usa en este dispositivo»).
- **Acciones:** «Activar <método>» → prompt de confirmación; si pasa: `setBiometricEnabled(true)` + marca «oferta mostrada»
  + `/(tabs)`. Falla → «No se pudo verificar…». «Ahora no» → marca mostrada + `/(tabs)` (no vuelve a ofrecerse).
- **Comportamiento offline:** disponible (todo local).
- **Datos:** SecureStore.
- **Navegación:** de `routeAfterAuth`; a `/(tabs)`.
- **Estado:** ✅ (no hay en el código un ajuste posterior para activarla si se pulsó «Ahora no»; no verificado en Más/Cuenta:
  no existe).

### Tengo una invitación — `/(auth)/invitacion`
- **Propósito:** aceptar la invitación de un administrador al equipo y fijar contraseña.
- **Quién accede:** sin sesión; por enlace `kobrax://invitacion?c=<código>` (esquema `kobrax`) o escribiendo el código desde el
  login.
- **Qué muestra:** paso 1 (si no vino por enlace): campo «Código» (`K7F29-QX3TM`, guiones y mayúsculas no importan).
  Paso 2: «Hola, <nombre>», «Te sumaron al equipo de <negocio>», correo de la invitación, campo Contraseña +
  checklist de la política.
- **Acciones:** «Continuar» (código ≥ 8 caracteres) → `GET /auth/invitation/:code`. «Entrar» (contraseña válida) →
  `POST /auth/invitation/accept {code, password}` y luego **login normal** con esa contraseña → `goToStep`. Si la cuenta
  quedó activa pero el login falla, lo dice (el código es de un solo uso). «Volver a iniciar sesión».
- **Comportamiento offline:** solo online («Para aceptar la invitación necesitás internet.»).
- **Datos:** `GET /auth/invitation/:code`, `POST /auth/invitation/accept` (públicos, `publicCall`).
- **Navegación:** de login o deep link; a MFA / `routeAfterAuth`.
- **Estado:** ✅

### Crear una cuenta — `/(auth)/registro`
- **Propósito:** autoregistro de un negocio nuevo (crea el tenant) y entrada inmediata.
- **Quién accede:** sin sesión, desde «Crear una cuenta» en el login.
- **Qué muestra:** 3 pasos. (1) Elegir plan: tarjetas **Free** (gratis para siempre), **Professional** y **Business**
  (con `TRIAL_DAYS` días de prueba; precios y topes de miembros/créditos/fotos tomados de `PLANS`); Enterprise no se ofrece
  («se cotiza»). (2) Formulario: Nombre del negocio, Nombre, Apellido, Correo, Contraseña + checklist; chip «Plan X ·
  Cambiar». (3) Confirmación «¡Cuenta creada!» con correo, negocio y plan; para planes pagos, aviso de que al terminar la
  prueba la cuenta sigue en Free sin bloquear ni perder datos.
- **Acciones:** «Crear cuenta» valida en cliente (negocio 2–160 caracteres, nombre y apellido obligatorios, correo válido,
  contraseña según política) → `POST /accounts` `{…, planCode}`; luego `authService.login()` automático. Si la cuenta se
  creó pero el login falla: mensaje y botón «Ir a iniciar sesión» (reintentar el alta sería 409). «Continuar» →
  `goToStep` (un administrador cae típicamente en MFA obligatorio). País y moneda **no** se piden: arrancan en el default y
  se cambian en Cuenta → Datos.
- **Comportamiento offline:** solo online («Para crear la cuenta necesitás internet.»).
- **Datos:** `POST /accounts` (público), `POST /auth/login`.
- **Navegación:** de login; a MFA/`routeAfterAuth`.
- **Estado:** ✅ (un plan pago **no se cobra** en la app: nace en prueba).

---

## 3. Grupo `(app)` — fuera de tabs

### Cambio de contraseña — `/(app)/force-password-change`
- **Propósito:** cambiar la contraseña, de forma **obligatoria** cuando el backend lo exige.
- **Quién accede:** `routeAfterAuth` cuando `me.requiresPasswordChange`. Existe la variante voluntaria
  `?voluntary=1` (permite «Cancelar»), pero **ningún menú del móvil enlaza a ella** (búsqueda en `app/` y `src/`).
- **Qué muestra:** «Actualiza tu contraseña» (o «Cambiar contraseña» en voluntario), campos Contraseña actual, Nueva
  (con checklist) y Confirmar; aviso «Las contraseñas no coinciden».
- **Acciones:** «Actualizar contraseña» (habilitado con actual no vacía, nueva válida y confirmación igual) →
  `POST /auth/change-password` `{currentPassword, newPassword}`. Éxito: `clearSession()` (el backend revoca todas las
  sesiones), mensaje «Contraseña actualizada… Inicia sesión de nuevo» y a login a los 1,6 s.
- **Comportamiento offline:** solo online («Sin conexión. Revisa tu red…»).
- **Datos:** `POST /auth/change-password`.
- **Navegación:** de `routeAfterAuth`; a login.
- **Estado:** 🟡 (voluntario sin punto de entrada).

### Modo sin conexión — `/(app)/offline`
- **Propósito:** pantalla de contingencia cuando no hay red **y** no hay identidad local utilizable.
- **Quién accede:** `routeAfterAuth` con `me()` offline sin `me` local (caso típico: teléfono nuevo o caché borrada). Si la
  ventana de 8 h venció, redirige a login.
- **Qué muestra:** aviso «Sin conexión a internet» con el tiempo restante de la sesión offline («2h 15min»), texto «Puedes
  seguir trabajando; tus cambios se sincronizarán al recuperar la señal».
- **Acciones:** «Reintentar conexión» (re-ejecuta `routeAfterAuth`); «Cerrar sesión» (`clearSession` + `clearBiometric` → login).
- **Comportamiento offline:** es la pantalla del estado offline; no ofrece acciones de trabajo.
- **Datos:** SecureStore.
- **Navegación:** de `routeAfterAuth`; a tabs (al reconectar) o login.
- **Estado:** 🟡 (el texto «puedes seguir trabajando» no ofrece cómo; en la práctica el trabajo offline ocurre en las tabs).

---

## 4. Shell de tabs y permisos

### Layout de tabs — `/(tabs)` (`app/(tabs)/_layout.tsx`)
- **Propósito:** contenedor de campo con 5 pestañas: **Inicio** (`index`), **Agenda** (`agenda`), **Rutas** (`rutas`),
  **Cobranza** (`cobranza`), **Más** (`mas`). Iconos Ionicons; activo navy.
- **Quién accede:** sesión válida (llegada vía `routeAfterAuth`).
- **Qué se ve según permisos:** **nada.** Las 5 pestañas se muestran **siempre**, para todos los roles; el layout no consulta
  `permissions`. El gating por capacidad ocurre dentro de pantallas concretas (verificado con `permissions.includes`):
  - `cuenta/index`: `account:read` (muestra «Mi negocio») y `account:write` (aviso de solo lectura);
  - `cuenta/datos`: `account:write` habilita edición;
  - `cuenta/miembros`: `user:invite` muestra «Invitar a alguien»;
  - `cuenta/miembro/[id]`: `user:write` + no ser uno mismo + rol del móvil (`ACCOUNT_ADMIN`, `SUPERVISOR`, `COLLECTOR`);
  - `mora/[creditId]`: `assignment:write` (fuera de esta parte).
  Lo demás (Más → Importación, Cobranza) lo valida el servidor con 403. El comentario de `mas.tsx` («gating por rol en F3»)
  describe algo **no implementado**.
- **Efectos al montarse:** (1) suscribe conectividad; (2) `refreshTenantToday()` (`GET /agenda/summary` → día civil de la
  empresa); (3) `me()` → `startSync(userId)` y luego `hydrate(userId)` sin esperarla (si falla, en silencio).
- **Estado:** ✅

---

## 5. Inicio

### Inicio — `/(tabs)/index`
- **Propósito:** responder «cómo voy / qué es urgente / dónde tengo que ir» al empezar la jornada.
- **Quién accede:** sesión válida, cualquier rol (sin gating).
- **Qué muestra:**
  - Cabecera «Inicio» con 🔔 (con contador `🔔 N` si hay no leídas; siempre lleva al buzón).
  - «Hola, <nombre>» (nombre del perfil o, si no hay, el correo) y «Tu jornada de hoy».
  - **Bloque navy «PROGRESO DEL DÍA»**: porcentaje, barra y 3 tarjetas **PENDIENTES / VENCIDOS / COBRADO HOY** (definiciones en 5.1).
  - **Banda naranja** «🕐 N gestión(es) en los próximos 30 min» (solo si N > 0; lleva a la Agenda).
  - **Fila «Protegé tu cuenta · Activá la verificación en dos pasos»** (solo si `!me.mfaEnabled`; → `mfa-setup?authed=1`).
  - **«AGENDA DE HOY»** con «Ver toda ›»: hasta **3** tarjetas de gestión (nombre, tipo, hora, estado, acento rojo si vencida).
    Vacío: «No tenés gestiones agendadas para hoy.» (día sin gestiones) o «¡Listo! Cerraste todas las de hoy.»
  - **«RUTA DE HOY»**: «Ruta en curso · X de Y paradas» con badge «En curso» / «Completa»; o «Sin ruta activa · Armá tu
    recorrido del día» (badge «Pendiente»). Ambas → pestaña Rutas.
- **Acciones:** pull-to-refresh; tocar tarjeta de agenda → detalle; PENDIENTES y VENCIDOS → Agenda; COBRADO HOY no navega.
  Se recarga cada vez que la pantalla recupera el foco.
- **Comportamiento offline:** **disponible**, con los datos de la última hidratación/consulta: agenda (`cachedList`),
  vencidos (total guardado en `list.meta`), pagos del día (caché), ruta (caché) y moneda (de la cartera local). El
  «cobrado hoy» **suma lo cobrado sin señal que sigue en la cola**. El contador de no leídas (`unreadCount`) **no** tiene
  respaldo local: sin red muestra 🔔 sin número. Cada dato que falla degrada solo (no bloquea). Si no hay `me` local
  utilizable la pantalla se queda en el indicador de carga (no redirige).
- **Datos:** `GET /auth/me`; `GET /agenda?date=<hoy>`; `GET /agenda/overdue?limit=1` (solo `meta.total`);
  `GET /routes?collectorId&status=IN_PROGRESS` + `GET /routes/:id`; `GET /notifications?unread=true&limit=1`;
  `GET /payments?from=<hoy>&to=<hoy>T23:59:59.999Z&limit=100`; moneda vía `GET /mora` (límite de sondeo) o cartera local;
  cola local (`pendingActions`). Además programa avisos locales con la lista de hoy (parcial).
- **Navegación:** desde `routeAfterAuth`/tabs; a Agenda, detalle de gestión, Rutas, Notificaciones, MFA.
- **Estado:** ✅

### 5.1 KPIs del Inicio — definiciones exactas
Se calculan **en el dispositivo** (decisión cerrada, `src/home.ts`): son contadores intradía y el teléfono tiene el dato más
fresco hasta sincronizar. «Hoy» = día civil **de la empresa** (`todayISO`, ver 6.0), no UTC.

| KPI | Definición | Fuente |
|---|---|---|
| **Progreso del día (%)** | `round(resueltas / total × 100)` sobre las gestiones agendadas **para hoy** (`GET /agenda?date=hoy`). `0` si el día no tiene gestiones. | `dayProgress` |
| *resueltas* | gestiones de hoy con `status ≠ SCHEDULED` (ejecutadas, **canceladas** y **reagendadas** cuentan como resueltas, para que el progreso pueda llegar a 100 %). | `partitionDay` (shared) |
| **PENDIENTES** | gestiones de hoy con `status = SCHEDULED` (no incluye vencidas de días anteriores). | `partitionDay.pending` |
| **VENCIDOS** | `meta.total` de `GET /agenda/overdue` (gestiones `SCHEDULED` con fecha < hoy, de todo el backlog, no solo las 100 que baja la lista). Rojo si > 0. Offline: total guardado de la última consulta; si se resolvió algo sin señal, el total baja en 1 (`patchAgendaItemLocal`). | `listOverdue(1)` |
| **COBRADO HOY** | suma de `amount` de los pagos de hoy con `registeredBy = yo` (`GET /payments` devuelve los de todo el tenant, se filtra en cliente; techo 100/día) **+** pagos aún en la cola local (acciones `payment` y el `payment` embebido en una `visit`) cuya `paymentDate` (o, si falta, la hora de encolado) cae en el día local de hoy. Con ruta o sin ruta. `—` si no hay datos del servidor ni cola. Formato con la moneda del tenant y los decimales de la cuenta. | `queuedCollectedToday` |
| **Banda «próximos 30 min»** | gestiones `SCHEDULED` de **hora fija** con `scheduledTime` entre ahora y ahora + 30 min (las de franja no cuentan). | `dueSoon` |
| **Agenda de hoy (lista)** | las `SCHEDULED` de hoy: primero hora fija ordenadas por hora, luego franja; máximo 3. | `upNext` |
| **Ruta de hoy** | la ruta del cobrador en estado `IN_PROGRESS` (a lo sumo una); progreso = paradas `VISITED` o `SKIPPED` / total de paradas. «Completa» si hechas ≥ total y total > 0. | `routeProgress` (shared) |

---

## 6. Agenda

### 6.0 Notas comunes
- **«Hoy»** (`tenant-day.ts`): el día civil que dice el servidor en `GET /agenda/summary`; sin red avanza con el reloj del
  teléfono corrido por la diferencia conocida; sin haber hablado nunca con el servidor, el día **local** del teléfono (nunca UTC).
- **Tipos** (`AGENDA_TYPE_META`): Llamada 📞, Visita 📍, WhatsApp 💬, Recordatorio 🔔, Promesa de pago 🤝.
  **Estados**: Agendada, Completada, Cancelada, Reagendada (y «Vencida» = Agendada con fecha pasada).
- **Resultados** por tipo (`AGENDA_OUTCOMES_BY_TYPE`): Llamada y WhatsApp → Contactado / Sin respuesta / Número equivocado;
  Visita → Contactado / No se encontró / Dirección equivocada; Promesa → Confirmó pago / No pagó; Recordatorio → Realizado.
- Una gestión siempre cuelga de un **crédito** (y de su cliente); no existe «caso».

### Agenda diaria — `/(tabs)/agenda`
- **Propósito:** ver y gestionar lo agendado por día, con lo vencido arriba.
- **Quién accede:** sesión válida, cualquier rol.
- **Qué muestra:** cabecera navy con título, botón «Hoy», selector de mes (calendario nativo) y **tira horizontal de ±180
  días**; secciones **Vencidos** (arriba), **Pendientes** y **Completados** (esta incluye canceladas y reagendadas, distintas
  por su etiqueta). Vencidos: muestra 2 y «Ver más (N)» / «Ver menos»; si el día elegido ya muestra la misma gestión
  pendiente, no se duplica en Vencidos. Cada fila: nombre del cliente, tipo, hora, estado, «Asignada por <nombre>» si la
  creó otra persona, y **acciones rápidas** (ver abajo). Vacíos: «Sin pendientes»; pantalla «Sin conexión — Tu agenda
  aparecerá cuando vuelva la red.» o «No se pudo cargar».
- **Acciones:** tocar un día; «Hoy»; calendario; pull-to-refresh; tocar fila → `/agenda/[id]`; **FAB «+»** → `/agenda/crear`.
  **Acciones rápidas por fila** (solo gestiones pendientes, y solo si el detalle ya está en el teléfono): Llamada → «📞 Llamar»
  (`tel:`); WhatsApp → «💬 WhatsApp» (`wa.me` con el mensaje de la gestión); Visita → «🧭 Navegar» (mapa de Kobrax
  `/cliente/mapa`); Recordatorio y Promesa → ninguna. No registran nada. Si el teléfono no tiene app → alerta «No se pudo abrir».
- **Comportamiento offline:** **disponible** con lo hidratado: hoy y los 7 días siguientes, vencidos (100) y los días ya
  consultados antes. Un día nunca consultado ni hidratado muestra «Sin conexión». Un bache de red en un refresco **no borra**
  lo ya cargado. Lo resuelto sin señal se ve ya en listas y contadores (ver 6.6).
- **Datos:** `GET /agenda?date=`, `GET /agenda/overdue?limit=100`; caché `agenda` (scope = día / `overdue:limit=N`) y
  `agenda.detail`; identidad por `authService.me()`.
- **Navegación:** desde Inicio, notificaciones, avisos locales/push; a detalle y a crear.
- **Estado:** ✅

### Detalle de gestión — `/agenda/[id]`
- **Propósito:** ver qué hay que hacer, con quién, cuánto debe y el historial; y ejecutar o corregir la gestión.
- **Quién accede:** sesión válida; el servidor limita al alcance del usuario (404/403 si no es suyo). Editar y eliminar solo
  si `item.createdBy === userId`; reagendar y cancelar, el responsable.
- **Qué muestra:** pill «<Estado> · <Tipo>» (rojo si vencida), tarjeta de gestión (tipo, «Hoy, 11:30» / «Hoy, Mañana» si es
  franja; líneas propias del tipo: mensaje de WhatsApp, descripción del recordatorio, «Promete pagar <monto> / El <fecha> /
  medio · banco»), «Asignada por», **resultado** registrado (con nota y «Registrada por») y observaciones. Tarjeta del
  cliente: nombre, CI, zona y **DEUDA TOTAL** (saldo del crédito). Botones **WhatsApp** (solo gestión WhatsApp con
  teléfono), **Llamar** (si hay teléfono) y **Navegar** (si hay dirección; abre `/cliente/mapa`). **Historial de
  gestiones**: «Gestión Actual» + gestiones previas del crédito con fecha, estado, motivo y «viene del <fecha>».
- **Acciones:**
  - Pie **«Registrar gestión»** (solo si está pendiente): abre la hoja de registro. Si la visita **la lleva una ruta**
    (`detail.route`), el botón es **«Registrar en la ruta»** y navega a `/rutas/resultado` (registrarla aquí crearía una
    segunda actividad; el servidor lo rechaza con AGENDA_014).
  - Menú **«⋯ Opciones»** (solo pendiente): **Editar** (creador) → `/agenda/crear?id=`; **Reagendar** (nueva fecha ≥ hoy +
    hora si es de hora fija, o se mantiene la franja; **motivo obligatorio** del catálogo `RESCHEDULE_REASON`) → crea la
    nueva y deja esta como Reagendada; **Cancelar gestión** (motivo del catálogo `CANCEL_REASON`) → queda visible como
    Cancelada; **Eliminar** (creador; confirmación nativa; «Para dejar constancia de que no se hizo, cancelala»).
- **Comportamiento offline:**
  - *Ver*: disponible si el detalle se hidrató (hasta 60 pendientes por prioridad hoy → vencidas → futuras) o se abrió
    antes; si no, «Sin conexión — El detalle aparecerá cuando vuelva la red.»
  - *Registrar / posponer*: **encolado** (`agenda.complete`, `agenda.postpone`) y reflejado ya en listas/contadores.
  - *Cancelar / reagendar*: **encolado** (`agenda.cancel`, `agenda.reschedule`); se sale de la pantalla como con red
    (al reagendar offline se vuelve atrás, la gestión nueva aún no existe). Requiere que los catálogos de motivos estén
    cargados (se hidratan; si no, falla con alerta).
  - *Editar*: **solo online** (PATCH no se encola: «Sin conexión — los cambios se guardan cuando vuelva la señal. Reintentá.»).
  - *Eliminar*: **solo online** (alerta «No se pudo»).
  - Llamar / WhatsApp / Navegar: usan datos ya en memoria; no dependen de la red (WhatsApp sí necesita datos del teléfono
    para enviar).
- **Datos:** `GET /agenda/:id` (caché `agenda.detail`), `POST /agenda/:id/complete|postpone|cancel|reschedule`,
  `DELETE /agenda/:id`, `GET /catalogs/CANCEL_REASON|RESCHEDULE_REASON`.
- **Navegación:** de Agenda, Inicio, notificaciones, avisos; a `crear?id`, `rutas/resultado`, `cliente/mapa`; tras
  cancelar/eliminar vuelve atrás; tras reagendar con red abre la nueva (`router.replace`).
- **Estado:** ✅

### Registrar gestión y posponer — hoja dentro de `/agenda/[id]` (`src/agenda-register.tsx`)
- **Propósito:** cerrar la gestión con un resultado, o correr su hora.
- **Quién accede:** quien abre el detalle de una gestión pendiente sin ruta asociada.
- **Qué muestra:** (WhatsApp) bloque «Mensaje» con chips de plantillas (`WHATSAPP_TEMPLATE`, variables `{{cliente}}`,
  `{{saldo}}`, `{{negocio}}` resueltas con datos locales), cuadro de texto editable y «Enviar por WhatsApp»; «Resultado»
  (chips según tipo, ver 6.0); «Nota (opcional)»; «Posponer para luego»: **+15 min, +30 min, +1 h**.
- **Acciones:**
  - «Registrar gestión»: habilitado con un resultado elegido → `POST /agenda/:id/complete {outcome, notes}`; el ítem pasa a
    Completada. Sin red: se encola y el ítem se marca Completada localmente.
  - Posponer (chip): calcula la **hora absoluta** de destino al tocar (`postponeTarget`): base = hora fija, o inicio de la
    franja (mañana 08:00, tarde 13:00, noche 18:00), o 09:00; si la gestión es de hoy y ya venció, se pospone **desde
    ahora**. **No cambia de día:** si el destino llega a 24:00 se bloquea con «No se puede posponer más allá de las 23:59.
    Usa «Reagendar»…». El ítem sigue pendiente, pasa a hora fija y su aviso local se reprograma. Se manda `toTime` además de
    `minutes` (idempotente al reintentar).
  - «Enviar por WhatsApp» (deshabilitado sin teléfono o sin texto): abre `wa.me` con el mensaje; **no registra** la
    gestión (hay que registrar el resultado aparte).
- **Comportamiento offline:** **encolado** (registrar, posponer); plantillas y catálogos desde caché; el nombre del negocio
  sale de la copia local de la cuenta.
- **Datos:** `POST /agenda/:id/complete`, `POST /agenda/:id/postpone`, `GET /accounts/me` (cacheado) y catálogo de plantillas.
- **Navegación:** hoja modal; al terminar se cierra y el detalle refleja el ítem devuelto (o el local).
- **Estado:** ✅

### Nueva / editar gestión — `/agenda/crear`
- **Propósito:** agendar una gestión sobre un crédito de un cliente (o editar una pendiente con `?id=`).
- **Quién accede:** sesión válida; el servidor valida alcance sobre el cliente/crédito. Editar: solo el creador (403 si no).
- **Qué muestra:** tipo (5 chips), Cliente (buscador por nombre o CI, con búsqueda local sin red), Crédito (selector solo si
  el cliente tiene ≥ 2; con 1 queda elegido), campos propios del tipo y Programación.
  - **Llamada:** Teléfono (obligatorio). **WhatsApp:** Teléfono + Mensaje inicial (obligatorio, ≤ 1000).
  - **Visita:** Dirección (obligatoria). Si la dirección **no tiene punto en el mapa**: aviso y «Marcar la ubicación en el
    mapa» (pin o «Usar mi ubicación actual»); mientras no tenga punto el guardado está bloqueado.
  - **Recordatorio:** Descripción (obligatoria, ≤ 500).
  - **Promesa de pago:** Monto prometido (>0), «El cliente pagará el» (fecha ≥ hoy), Medio de pago (catálogo); **Banco**
    obligatorio si el medio tiene `requiresBank`; muestra de solo lectura Capital, Cuota en mora y Saldo.
  - **Notas (opcional)**; **Programación**: fecha (≥ hoy), alternar «Hora fija» (HH:mm, obligatoria) / «Lapso (AM/PM)»
    (Mañana / Tarde / Noche).
- **Acciones:** «Guardar gestión» / «Guardar cambios» (habilitado cuando cliente + crédito + programación + detalles del tipo
  son válidos y, si aplica, banco y punto de mapa). «Agregar teléfono» (tipo Teléfono/WhatsApp, número, etiqueta) y
  «Agregar dirección» (tipo Domicilio/Trabajo/Familiar/Otro, dirección, zona, referencia, pin opcional) **sin salir del
  formulario**; al guardar quedan elegidos. En edición: el cliente y la **fecha no se cambian** («Para moverla de día, usá
  Reagendar»); el PATCH solo manda tipo, modo/hora, observaciones y detalles.
- **Comportamiento offline:**
  - *Alta*: **encolada** (`agenda.create`) con id fijado al abrir la pantalla (el doble toque o un timeout no duplican).
  - *Teléfono / dirección nuevos*: **encolados** (`client.contact` / `client.location`, op `add`) con id provisional
    `local:<uuid>`; el agendado que los cita va a la cola, que traduce el id al subir (espera si el teléfono/dirección aún no
    subió). Antes de crear, la cola busca el mismo número/dirección en el servidor para no duplicar.
  - *Marcar ubicación de una dirección existente*: **solo online** («Necesitas señal… el punto tiene que quedar guardado
    para la ruta»).
  - *Edición*: **solo online**.
  - Buscar cliente y abrir su contexto funcionan offline solo para clientes hidratados (hasta 150).
- **Datos:** `GET /clients` (búsqueda), `GET /agenda/clients/:id/context`, `POST /agenda`, `PATCH /agenda/:id`,
  `POST /agenda/clients/:id/contacts`, `POST|PATCH /agenda/clients/:id/locations[/:locId]`, catálogos `PAYMENT_METHOD`,
  `BANK`.
- **Navegación:** desde el FAB de Agenda o el menú «Editar»; al guardar vuelve atrás (Agenda/detalle refrescan al enfocar).
- **Estado:** ✅

### Avisos locales de la agenda
(`src/agenda-reminders.ts`, `src/agenda-notifications.ts`)
- **Qué son:** notificaciones **locales** programadas en el teléfono; funcionan con la app cerrada y sin señal sobre lo ya
  descargado. No son push remoto.
- **Reglas:** gestión de **hora fija** → aviso **15 min antes** («Llamada con Ana», «En 15 min · 15:30»); gestión de **franja**
  → aviso al **inicio** de la franja (08:00, 13:00, 18:00) con «Tienes esta gestión por la mañana/tarde/noche»; solo
  pendientes y solo futuras; **tope 50** a la vez (iOS admite 64). Un aviso por gestión con id `agenda:<id>` (reprogramar lo
  reemplaza). Las horas son «de pared» del teléfono.
- **Cuándo se (re)programan:** al hidratar (lista completa: cancela los que ya no corresponden), al cargar el Inicio
  (lista de hoy, parcial) y al posponer. Se cancelan al resolver/cancelar/reagendar y al cerrar sesión.
- **Permiso:** se pide **una sola vez** por instalación; si se niega, la app sigue sin avisos. Canal Android «Agenda»
  (importancia alta).
- **Al tocarlos:** abre `/agenda/<id>`; con la app cerrada se guarda como destino pendiente y se abre tras desbloquear.
- **Push remoto (FCM, Android):** además, `push.service.ts` registra el token (`POST /notifications/devices`) tras el login
  y lo revoca al cerrar sesión (mejor esfuerzo). Tipos: ruta asignada/cambio solicitado/decidido, gestión asignada/cambiada,
  promesa por vencer; se descarta el aviso cuyo `uid` no sea el usuario de la sesión. Destinos: `/agenda/:id`, `/mora/:id`,
  `/(tabs)/rutas`. Sin Firebase configurado en el build, simplemente no hay push.
- **Estado:** ✅ (local) / 🟡 (push depende de la configuración Firebase del build; no verificado).

### Conflictos offline de la agenda
(`src/sync/agenda-conflicts.ts`, `src/sync/queue.ts`, `src/sync/agenda-optimistic.ts`)
- **Modelo:** no hay fusión ni «última escritura gana». Lo hecho sin señal se **intenta** al sincronizar; si la gestión cambió
  mientras tanto, **el servidor rechaza y la acción del teléfono no se aplica**. Gana siempre el estado del servidor.
- **Vista optimista:** al resolver sin señal, `patchAgendaItemLocal` aplica el cambio sobre las copias locales (lista del día,
  hoy, vencidas y detalle), baja en 1 el total de vencidas y cancela/reprograma el aviso. Es solo un puente: la próxima
  lectura con red lo reemplaza por lo real.
- **Rechazos** (la cola los marca «Rechazado», no reintenta solos, y la hoja de pendientes los explica):
  - **409** → «Esta gestión cambió mientras no tenías señal: otra persona la registró, la canceló o la reagendó… no se aplicó.
    Revisa cómo quedó en la Agenda.»
  - **404** → «ya no está disponible para ti: la eliminaron o se la pasaron a otra persona».
  - **403** → «No tienes permiso para este cambio… solo ella puede editarla o eliminarla».
  - **422** (posponer inválido: otra hora/día pasado) → mensaje del servidor + «Lo que hiciste acá no se aplicó».
  - Otros 4xx (salvo 408/429/426): rechazo permanente con el mensaje del servidor. 5xx/408/429: pasajero, se reintenta.
- **Idempotencia:** completar una gestión ya ejecutada devuelve la misma gestión; cancelar/reagendar solo se aceptan sobre
  `SCHEDULED`, así que un reintento tras timeout no duplica nada. Posponer viaja con hora absoluta (`toTime`).
- **Salida del cobrador:** en `/pendientes`, «Descartar» (con confirmación) o corregir a mano en la Agenda.
- **Estado:** ✅

---

## 7. Notificaciones y pendientes

### Notificaciones — `/notificaciones`
- **Propósito:** buzón de avisos del cobrador (solo las propias: scope `own`).
- **Quién accede:** sesión válida; desde la 🔔 del Inicio.
- **Qué muestra:** pestañas **Sin leer (N)** / **Todas**; filas con ícono por tipo (💵 pago registrado, 🗺️ ruta asignada,
  🤝 promesa por vencer, 📌 gestión asignada, 🔁 gestión cambiada, ⏰ gestión vencida, ✋ cambio de ruta solicitado, ✅ cambio
  decidido, 🚫 ruta cancelada, 🔔 sistema), título, cuerpo, hora (hoy) o fecha, y punto morado si no está leída. Hasta **50**
  por consulta. Vacíos: «Sin notificaciones nuevas» / «Todavía no hay notificaciones».
- **Acciones:** tocar una fila la marca leída (optimista) y navega: con `agendaItemId` → `/agenda/<id>`; `AGENDA_OVERDUE` →
  pestaña Agenda; con `clientId` → `/cliente/<id>`; otras no navegan. «Marcar todas» (si hay sin leer). Pull-to-refresh.
- **Comportamiento offline:** **lectura disponible** con la última consulta guardada (la hidratación baja «todas»);
  si nunca se cargó, «Sin conexión — aparecen cuando vuelva la red». **Marcar leída es solo online**: el cambio local es
  optimista pero la llamada **no se encola**; si falla, al recargar vuelve a verse sin leer. «Marcar todas» exige respuesta OK.
- **Datos:** `GET /notifications?unread=&limit=50` (caché `notification`), `POST /notifications/:id/read`,
  `POST /notifications/read-all`.
- **Navegación:** del Inicio y de pushes; a gestión, agenda o cliente.
- **Estado:** ✅ (los tipos de ruta F4/12 tienen ícono pero no navegan: no hay `routeId` en esta pantalla; los pushes sí
  llevan a Rutas).

### Sin subir (cola offline) — `/pendientes`
- **Propósito:** auditar lo hecho sin señal que aún no llegó al servidor.
- **Quién accede:** sesión con `userId` local; se llega tocando el banner del `OfflineIndicator` (o desde el resumen de ruta).
- **Qué muestra:** texto «Esto ya quedó guardado en el teléfono y se sube solo…»; consumo de fotos («N fotos esperan señal ·
  X MB de 150 MB»); lista **en orden de inserción (FIFO)** con nombre de la acción, hora/fecha, último error y badge de
  estado: **En espera** (0 intentos), **N intento(s)** (ámbar), **Rechazado** (99 = permanente), **No soportado**.
  Vacío: «No hay nada pendiente — Todo lo que registraste ya está en el servidor.»
  Tipos que pueden aparecer: Visita registrada, Pago cobrado, Gestión agendada/ejecutada/pospuesta/cancelada/reagendada,
  Estado de la jornada, Cliente nuevo, Préstamo nuevo/marcado en mora/puesto al día, Gestión registrada, Nota del crédito,
  Foto de la visita, Foto que no se pudo adjuntar, Datos/Teléfono/Dirección del cliente.
- **Acciones:** **«Reintentar ahora»** (deshabilitado sin red; `drain(force)` ignora el techo de 3 intentos) con resumen
  («N subieron; M siguen sin poder subir», «Sigue sin haber señal», «Tu sesión venció…», «Hay que actualizar la app…»).
  **«Descartar»** solo para Rechazado/No soportado, con confirmación («no se va a subir y se borra del teléfono. No se puede
  deshacer»); borra también sus fotos y la fila provisional de cliente/préstamo. Pull-to-refresh.
- **Comportamiento offline:** disponible (lee la cola local). Es lo único que borra trabajo sin subir.
- **Datos:** SQLite `queue`; reintento llama a los mismos services que las pantallas.
- **Navegación:** del banner / resumen de ruta; vuelve atrás.
- **Estado:** ✅
- **Reglas del motor** (ver 0.5): visitas compuestas viajan como una acción; lo que falla *después* de registrada la visita
  (foto, cobro, promesa) se **re-encola como ítem propio**; una foto borrada por el sistema genera un aviso «Foto que no se
  pudo adjuntar» (un cobro sale igual, sin comprobante, y deja aviso). Una fila de una versión más nueva queda «No
  soportada». Los ítems son independientes: uno que falla no traba a los demás.

---

## 8. Más y Cuenta

### Más — `/(tabs)/mas`
- **Propósito:** menú de overflow: cartera, importación, cuenta y cierre de sesión.
- **Quién accede:** cualquier rol con sesión (sin gating en el cliente).
- **Qué muestra:** sección **Clientes**: «Ver cartera» (→ pestaña Cobranza) e «Importación» (desplegable: «Importar datos»
  → `/import?from=menu`; «Reglas de importación» → `/ajustes/importacion`). Sección **Cuenta**: «Mi cuenta» (→ `/cuenta`) y
  «Cerrar sesión».
- **Acciones:** **Cerrar sesión**: revoca el push (≤ 3 s), `POST /auth/logout` con el refresh token, `clearSession()`
  (tokens + caché + avisos locales + borradores de ruta), `clearBiometric()`, y va a login. Sin red, el cierre local
  igual se completa (la revocación en servidor es mejor esfuerzo; **no verificado** si el refresh token queda vivo en el servidor).
  La **cola no se borra**.
- **Comportamiento offline:** navegación disponible; logout funciona localmente.
- **Datos:** `POST /auth/logout`, `DELETE /notifications/devices/:installationId`.
- **Navegación:** a Cobranza, Importación, Cuenta, login.
- **Estado:** 🟡 (sin gating por rol; no hay entrada a «cambiar contraseña» ni a «activar biometría»).

### Mi cuenta — `/cuenta`
- **Propósito:** hub de autoservicio: perfil, datos del negocio y equipo.
- **Quién accede:** sesión válida. «Mi perfil» para todos; la sección «Mi negocio» solo con permiso `account:read`.
- **Qué muestra:** «Mi perfil» (nombre · rol); si `account:read`: «Datos de la cuenta» (negocio · moneda) y «Miembros»
  (`usos de tope`, p. ej. «2 de 5», o «N miembros» sin tope); si falta `account:write`, leyenda «Tu rol no permite editar los
  datos del negocio».
- **Acciones:** navegar; se recarga al enfocar.
- **Comportamiento offline:** la cuenta se lee con respaldo local; sin red y sin copia: banner «Sin conexión. Los datos de la
  cuenta se leen en línea.»
- **Datos:** `GET /auth/me`, `GET /accounts/me` (solo con `account:read`).
- **Navegación:** de Más; a perfil, datos, miembros.
- **Estado:** ✅

### Mi perfil — `/cuenta/perfil`
- **Propósito:** editar los datos propios.
- **Quién accede:** cualquier usuario (sin gating, a propósito: el endpoint tampoco exige `user:write`).
- **Qué muestra:** foto (o iniciales), Nombre, Apellido, Teléfono, **Mi QR de cobro** (imagen del QR del banco para mostrar
  al deudor), y en «Sesión»: correo y rol (solo lectura).
- **Acciones:** tocar foto o QR → cámara/galería (compresión y tope de pendientes aplican) y subida inmediata; «Quitar» QR;
  «Guardar» (solo con cambios, nombre y apellido obligatorios, teléfono con forma `^[\d+][\d\s-]{4,}$` si se escribe) →
  `PATCH /users/me/profile` con **solo lo que cambió**.
- **Comportamiento offline:** **solo online** (lectura y guardado; botón «Sin conexión»; subida de foto/QR falla con
  «Sin conexión: … no se subió»).
- **Datos:** `GET|PATCH /users/me/profile`, subida de imagen (`uploads.service`), `GET /auth/me`.
- **Navegación:** de Mi cuenta.
- **Estado:** ✅

### Datos de la cuenta — `/cuenta/datos`
- **Propósito:** ver/editar nombre del negocio, NIT y país+moneda.
- **Quién accede:** requiere `account:read` (la entrada solo se muestra con ese permiso); edita con `account:write`.
- **Qué muestra:** Nombre del negocio, NIT/RUC (opcional), País y moneda (un solo selector: Bolivia, Colombia, México, Perú,
  Argentina, Estados Unidos con su moneda), Zona horaria (solo lectura: «Se configura desde la web»). Sin permiso de edición:
  «Tu rol permite ver estos datos, no editarlos».
- **Acciones:** «Guardar» (solo con cambios; nombre 2–160 caracteres, NIT ≤ 40, país válido) →
  `PATCH /accounts/me` con **solo los campos cambiados** (la API rechaza campos extra con 400).
- **Comportamiento offline:** **solo online** para guardar (botón «Sin conexión»); la lectura usa el respaldo local.
- **Datos:** `GET|PATCH /accounts/me`.
- **Navegación:** de Mi cuenta.
- **Estado:** ✅

### Miembros — `/cuenta/miembros`
- **Propósito:** ver el equipo y su uso del plan.
- **Quién accede:** pantalla alcanzable con `account:read`; el botón de invitar requiere `user:invite`.
- **Qué muestra:** «Tu equipo · N de M» (o «· N» sin tope), una fila por miembro (nombre, rol y «Dueño»), con badge
  **Pendiente** o **Inactivo** solo cuando no es el estado normal. Si se llegó al tope: «Llegaste al tope de tu plan…».
  Vacío: «Todavía no hay nadie».
- **Acciones:** tocar fila → detalle; **«Invitar a alguien»** (deshabilitado con «Tu plan permite M» si está lleno).
- **Comportamiento offline:** **solo online** («Sin conexión. El equipo se administra en línea.»).
- **Datos:** `GET /users`, `GET /accounts/me`, `GET /auth/me`.
- **Navegación:** de Mi cuenta; a detalle e invitar.
- **Estado:** ✅

### Detalle de miembro — `/cuenta/miembro/[id]`
- **Propósito:** cambiar el rol, activar/desactivar o gestionar la invitación de un miembro.
- **Quién accede:** quien llegue desde Miembros. Editar requiere `user:write`, **no** ser uno mismo y que el rol sea
  del móvil (`ACCOUNT_ADMIN`, `SUPERVISOR`, `COLLECTOR`); un rol web (Gerente, Auditor, Visor) se muestra y no se toca
  («Este rol se administra desde la web»). Las guardas duras (no dejar la cuenta sin administrador) las pone el servidor.
- **Qué muestra:** badges (Pendiente de aceptar / Inactivo / Dueño), correo, Rol (selector), y según estado: si pendiente,
  bloque «Todavía no aceptó»; si activo/editable, «Acceso».
- **Acciones:** cambiar rol (hoja con rol + explicación en criollo) → `PATCH /users/:id {roleId}`; **Desactivar /
  Reactivar** → `PATCH {isActive}` (el desactivado no entra ni cobra y libera un lugar del plan; sus gestiones y pagos
  quedan); **Reenviar invitación** → `POST /users/:id/invite/resend` (genera código nuevo, el anterior deja de servir,
  vence en 7 días; se muestra con «Compartir por WhatsApp»); **Cancelar la invitación** (`DELETE /users/:id`, con
  confirmación; libera el asiento y el correo).
- **Comportamiento offline:** solo online.
- **Datos:** `GET /users`, `GET /roles`, `GET /auth/me`, endpoints citados.
- **Navegación:** de Miembros; vuelve atrás al cancelar la invitación.
- **Estado:** ✅

### Invitar — `/cuenta/invitar`
- **Propósito:** sumar un miembro al equipo por correo.
- **Quién accede:** botón de Miembros con `user:invite` (la ruta en sí no se oculta en cliente; el servidor valida).
- **Qué muestra:** Nombre, Apellido, Correo, «¿Qué va a hacer?» (rol: hasta 3 opciones que decide el servidor en `GET /roles`:
  Cobra en campo / Supervisa cobradores y reparte cartera / Administra la cuenta, el equipo y los datos del negocio).
  Tras enviar: «Invitación enviada», el **código** (monospace) y «Compartir por WhatsApp» (mensaje con
  `kobrax://invitacion?c=<código>` y la instrucción de «Tengo una invitación»).
- **Acciones:** «Enviar invitación» (nombre y apellido obligatorios, correo válido, rol elegido; en minúsculas) →
  `POST /users/invite`. El código «sirve una sola vez y vence en 7 días».
- **Comportamiento offline:** **solo online** (botón «Sin conexión»).
- **Datos:** `GET /roles`, `POST /users/invite`.
- **Navegación:** de Miembros; vuelve atrás.
- **Estado:** ✅

---

## 9. Discrepancias con otros documentos

| Documento | Dice | Código |
|---|---|---|
| `docs/epics/F10/ui-screen-map.md` (filas Home 42:3069/42:3247, §8.1) | El Home lee `GET /cases?assigneeId` y tiene KPI «en mora». | No existe «caso» (F4/08). El Inicio usa agenda + vencidas + pagos + ruta, y los KPIs son **PENDIENTES / VENCIDOS / COBRADO HOY** más progreso %. No hay KPI «en mora». |
| `apps/mobile/CLAUDE.md` (SyncService) | «Cada 30 s», «3 intentos con backoff exponencial», «Conflictos: last-write-wins con timestamp». | Cada **60 s** con red (`CICLO_MS`), 3 intentos **sin backoff propio** (reintento atado a eventos), y los conflictos de agenda se **rechazan** (no hay last-write-wins). |
| `apps/mobile/CLAUDE.md` (Seguridad) | «PIN de respaldo si biometría no disponible». | No hay PIN propio de Kobrax: el prompt del SO acepta el PIN del dispositivo como respaldo; sin biometría enrolada no se ofrece la función. |
| `apps/mobile/CLAUDE.md` (Estructura `mas.tsx`) | «gating por rol en F3». | `mas.tsx` no tiene gating; solo `cuenta/*` y la ficha de mora consultan `permissions`. |
| Comentario en `mas.tsx` | «logout limpia SecureStore completo (incl. flags biométricos)». | `clearSession` borra 4 claves + caché; `clearBiometric` los flags. No borra `push.installationId` ni (si quedan) los borradores de acceso (caducan a los 10 min). |
| Comentario en `agenda-notifications.ts` | «No existe todavía un servicio de push remoto». | Existe `push.service.ts` (FCM, Android) y el handler de push en el layout raíz; los avisos locales y el push conviven. |
| Texto de `forgot-password` | «Ábrelo en este dispositivo para continuar». | No hay pantalla móvil de restablecimiento; el enlace abre la página web `reset-password`. |

## 10. No verificado

- Vigencia exacta del pre-auth token (5 min) y límites de intentos de login/MFA: son del servidor, no del móvil.
- Si, tras `logout` sin red, el refresh token queda activo en el servidor.
- Qué hace el flujo cuando la ventana de 8 h vence con la app abierta en segundo plano (el código re-bloquea al volver a
  primer plano; no se verificó si se borra la caché en ese camino: solo se redirige a login, los tokens y la caché quedan
  hasta que se cierre sesión o entre otra persona).
- Pantallas fuera de alcance de esta parte (Rutas, Cobranza, Cliente, Mora, Importación) y los permisos exactos de cada rol
  (lista de `permissions` por rol viene de la API; aquí solo se citan los strings usados por el código).
- Funcionamiento real de push (FCM) y del esquema `kobrax://` en iOS/Expo Go; SSL pinning (`plugins/with-ssl-pinning`,
  requiere dev build y pins configurados, no verificado en `app.json`).
- Comportamiento en iOS: varias partes (push, `geo:`) están pensadas para Android; el push solo se registra en Android.
