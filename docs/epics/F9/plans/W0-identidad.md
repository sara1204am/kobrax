> **ESTADO: EN BORRADOR — ronda 1 (2026-08-07). NO construir hasta PASS.**

# W0 — Identidad

## 1. Objetivo

Dejar toda la puerta de entrada del panel web con la piel del diseño nuevo y sin puntos muertos:
login split-screen, **entrar con Google de verdad**, **idioma es/en**, y las dos puertas que hoy
sólo existen en el móvil (registro público e ingreso por invitación).

El **flujo** de autenticación no cambia: la máquina de estados (`mfa` → `mfa_setup` →
`select_account` → `done`) es del backend y ya funciona. W0 le cambia la cara y le suma un
primer factor.

## 2. Rama

`web/W0-identidad` (sale de `web/f9-auth`, que ya trae la limpieza del CRUD genérico).

## 3. Diseño base

`docs/epics-web/login/13d05d8a-f376-4a0d-b197-703410af362b.png` — split-screen 50/50:

- **Izquierda (navy, `bg-k-hero`):** logo + KOBRAX · chip «Plataforma segura» · titular
  «Cobranza en campo, resultados en **tiempo real**» (las dos últimas palabras en `k-purple`) ·
  bajada · 4 features con ícono en cuadro redondeado (Rutas optimizadas · Gestión de clientes ·
  Reportes en tiempo real · Seguro y confiable) · mockup del panel.
- **Derecha (blanco):** selector de idioma arriba a la derecha · card con «Bienvenido de vuelta» /
  «Inicia sesión» · correo · contraseña con ojo · olvidaste · botón primario con flecha ·
  separador «O continúa con» · **Google** · «¿No tienes cuenta? Crear una cuenta» ·
  «¿Tienes una invitación? Únete a tu equipo».
- **Pie:** barra con 4 sellos de confianza.

**Cambios sobre el diseño (decididos el 2026-08-07, ver BUILD-PLAN §6):**
- ❌ Microsoft y Apple salen. Queda **sólo Google**.
- ❌ La fila de stats («+35% · 2.500+ · 99,9%») sale: son afirmaciones sobre el negocio, no sobre
  el software. Quedan la marca, el titular y las 4 features.
- ✅ El selector de idioma se pinta **porque va a tener qué ofrecer** (es/en reales).

⚠️ Falta definir: **qué imagen va en el mockup del centro**. El diseño muestra un panel que
todavía no existe (es W1/W8). Opciones a resolver en la ronda: ilustración abstracta, captura real
cuando exista, o sacarlo. → **pendiente de confirmar**.

## 4. Pantallas

| Ruta | Estado hoy | Qué hace W0 |
|---|---|---|
| `/login` | existe (card centrada `max-w-md`) | Rediseño split-screen + Google + links a registro e invitación |
| `/login/mfa` | existe | Nueva piel (mismo `AuthShell`), sin tocar el flujo |
| `/login/mfa-setup` | existe | Nueva piel |
| `/login/select-account` | existe | Nueva piel |
| `/forgot-password` | existe | Nueva piel |
| `/reset-password` | existe | Nueva piel |
| `/registro` | **no existe** | NUEVA — `POST /accounts` (registro público) |
| `/invitacion` | **no existe** | NUEVA — `GET /auth/invitation/:code` + `POST /auth/invitation/accept` |

**Fuera de W0:** `/settings/security/**` mantiene su piel actual. Vive detrás del panel, así que
se re-encuadra en W1 junto con el shell — no en la puerta.

## 5. Contrato

### 5.1 Lo que ya se consume (no cambia)
`POST /auth/login` · `POST /auth/mfa/challenge` · `POST /auth/mfa/setup/{start,verify,skip}` ·
`POST /auth/select-account` · `POST /auth/forgot-password` · `POST /auth/reset-password`

### 5.2 Nuevo en la API
| Endpoint | Cuerpo | Devuelve |
|---|---|---|
| `POST /auth/google` | `{ idToken, nonce }` | `LoginResult` — **el mismo tipo que `/auth/login`** |

### 5.3 Nuevo en el BFF (`src/app/api/**`)
| Handler | Qué hace |
|---|---|
| `GET /api/auth/google/start` | Genera `state` + `nonce`, los guarda en cookie, 302 a Google |
| `GET /api/auth/google/callback` | Valida `state`, canjea el `code` por el `id_token`, se lo pasa a `POST /auth/google`, y enruta con `stepResponse()` |
| `POST /api/auth/registro` | Proxy de `POST /accounts` |
| `GET /api/auth/invitacion/[code]` | Proxy de `GET /auth/invitation/:code` |
| `POST /api/auth/invitacion` | Proxy de `POST /auth/invitation/accept` |

### 5.4 Contratos ya verificados contra los DTO
```
POST /accounts                → { businessName, firstName, lastName, email, password }
POST /auth/invitation/accept  → { code (8-24), password }
GET  /auth/invitation/:code   → datos de la invitación para pintarla antes de aceptar
```

## 6. Cómo funciona el login con Google

### 6.1 La forma elegida: authorization code a través del BFF

```
navegador ──► GET /api/auth/google/start        (BFF: state+nonce en cookie, 302)
          ──► accounts.google.com               (el usuario elige su cuenta)
          ──► GET /api/auth/google/callback     (BFF: valida state)
   BFF    ──► oauth2.googleapis.com/token       (canje del code CON client_secret)
   BFF    ──► POST /auth/google  {idToken}      (API: verifica y decide)
   API    ──► LoginResult                       (mfa / mfa_setup / select_account / done)
```

**Por qué así y no con el botón de Google Identity Services:** el botón de Google mete un script
de terceros en la página de login (rompe la CSP que el epic exige) y obliga a publicar el
`client_id` con `NEXT_PUBLIC_`, contra la regla de que el navegador no sabe nada del backend. El
canje por servidor no necesita ni script ni variable pública, y funciona sin JavaScript.

### 6.2 Las cuatro reglas del primer factor

1. **Google entra, no da de alta.** Si el correo verificado no corresponde a un usuario `ACTIVE`,
   se devuelve **el mismo error genérico que una contraseña mal puesta** — si dijera «esa cuenta
   no existe», el login se convertiría en un verificador de correos de la empresa. Crear cuenta
   sigue siendo `/registro` con contraseña.
2. **El MFA se sigue pidiendo.** Google verifica *quién sos*; el segundo factor sigue siendo el
   segundo factor. Esto **sale gratis** si el camino de Google reusa la cola del login por
   contraseña (§6.3): saltearlo sería escribir código de más para quedar menos seguro.
3. **La API verifica el `id_token` ella misma** — firma contra el JWKS de Google, `aud` = nuestro
   client_id, `iss`, `exp`, `nonce` y `email_verified: true`. `POST /auth/google` es un endpoint
   público: cualquiera puede mandarle un token inventado. No alcanza con que el BFF ya lo haya
   recibido por un canal confiable.
4. **Se matchea por correo verificado, sin columna nueva.** Un `google_sub` sería más robusto ante
   un correo reasignado en Workspace, pero el flujo de recuperación de contraseña **ya confía en
   ese mismo correo**: la columna no cerraría ningún agujero que hoy esté cerrado. Se agrega el
   día que haya un motivo.

### 6.3 El refactor que lo hace posible (API)

`auth.service.ts:66` — hoy `login()` hace: buscar usuario → chequear bloqueo/estado → comparar
contraseña → **y después una cola compartida**: resetear contador, `lastLoginAt`, paso MFA,
membresías activas, `mfa_setup` para roles críticos, `proceedFromMemberships`.

Esa cola (líneas 88–110) se extrae a un privado `completeLogin(user, meta)` y **los dos caminos la
llaman**. Google reemplaza sólo el primer factor. Sin esto habría dos máquinas de estados que se
desincronizan a la primera regla nueva.

### 6.4 Dependencia nueva
`google-auth-library` en la API, sólo para `verifyIdToken`. Es el único punto donde no se
hand-rollea: verificar una firma contra un JWKS que rota (fetch + caché + RS256) es una frontera
de seguridad, no un ahorro de líneas. El canje del `code` en el BFF es `fetch` nativo, sin dep.

### 6.5 ⚠️ La trampa de la cookie
Las cookies del BFF son `sameSite: 'strict'`. La cookie que guarda `state`/`nonce` **no puede
serlo**: la vuelta desde `accounts.google.com` es una navegación cross-site y una cookie `strict`
no viaja → el `state` llega vacío y todo login con Google falla. Va `sameSite: 'lax'`, httpOnly,
10 minutos de vida.

### 6.6 🔴 Bloqueante
Hacen falta credenciales reales de Google Cloud Console (proyecto → OAuth 2.0 Client ID, tipo
«Web application», con `http://localhost:3000/api/auth/google/callback` en los URI autorizados):

```
GOOGLE_CLIENT_ID       # web (BFF) y api (validar el aud)
GOOGLE_CLIENT_SECRET   # sólo web (BFF), nunca al navegador
GOOGLE_REDIRECT_URI    # sólo web
```

**Nada de esto lleva `NEXT_PUBLIC_`.** Sin las credenciales, el resto de W0 avanza igual: el
rediseño, el i18n, el registro y la invitación no dependen de Google.

## 7. i18n (es/en)

- **`next-intl` sin ruteo por idioma**: el idioma vive en una cookie, no en la URL. Prefijos
  `/es` y `/en` obligarían a tocar todas las rutas y el matcher del middleware — mucho ruido para
  dos idiomas.
- Mensajes en `src/messages/es.json` y `en.json`. `es` es el default.
- El selector del diseño escribe la cookie y refresca.
- Alcance de traducción en W0: **sólo las pantallas de W0**. Lo que traduzca cada módulo se
  traduce en su etapa; si se intenta todo de una, se traduce texto que va a cambiar.

## 8. Auditoría de reuso

| Capacidad | Decisión | Dónde |
|---|---|---|
| Botón, input, campo, banner de error | **REUSAR** | `src/components/ui.tsx` |
| Input de 6 dígitos (MFA) | **REUSAR** | `src/components/otp-input.tsx` |
| Requisitos de contraseña en vivo | **REUSAR** | `src/components/password-checklist.tsx` — lo usan reset, registro e invitación |
| Cookies, `apiCall`, `sameOrigin` | **REUSAR** | `src/lib/bff.ts` |
| Enrutado por paso del login | **REUSAR** | `src/lib/auth-flow.ts` · `src/lib/client.ts` |
| Tokens visuales | **REUSAR** | `tailwind.config.ts` — **no se tocan** |
| Contenedor de pantallas de auth | **EXTENDER** | `src/components/auth-shell.tsx` → pasa de card centrada a split-screen. Mismo archivo, mismo nombre: las 6 pantallas que lo usan se re-pieles solas. |
| Botón «Continuar con Google» | **NUEVO** | `ui.tsx` (un `<a>` a `/api/auth/google/start`, variante del `Button` existente) |
| Selector de idioma | **NUEVO** | `src/components/locale-switch.tsx` |
| Panel izquierdo de marca | **NUEVO** | dentro de `auth-shell.tsx` (un solo uso) |
| Barra de sellos del pie | **EXTENDER** | `SecurityFooter` de `ui.tsx` pasa de una línea a la barra de 4 |
| Cola compartida del login | **NUEVO (API)** | `completeLogin()` privado en `auth.service.ts` |
| Verificación del `id_token` | **NUEVO (API)** | `google.service.ts` en `modules/auth/` |

## 9. Tareas (en orden — lo que no depende de Google va primero)

- [ ] 1. `AuthShell` split-screen + panel de marca + barra de sellos. Las 6 pantallas existentes
      quedan con piel nueva sin tocarles el flujo.
- [ ] 2. `/login` con el layout del diseño (ojo en la contraseña, botón con flecha, links).
- [ ] 3. i18n: `next-intl`, `es.json`/`en.json`, `LocaleSwitch`, traducir las pantallas de W0.
- [ ] 4. `/registro` + su handler BFF (`POST /accounts`).
- [ ] 5. `/invitacion` + sus dos handlers BFF.
- [ ] 6. **API:** extraer `completeLogin()` y probar que el login por contraseña no cambió.
- [ ] 7. **API:** `google.service.ts` + `POST /auth/google` + specs.
- [ ] 8. **BFF:** `google/start` y `google/callback` (cookie `lax`, validación de `state`).
- [ ] 9. Botón de Google en `/login` y cableado punta a punta.
- [ ] 10. Sumar las rutas nuevas al matcher de `middleware.ts` — **sólo las privadas**; `/registro`
      e `/invitacion` son públicas y NO van al matcher.

## 10. Reglas de la fase

1. **No pintar lo que no existe** (regla traída del móvil). Si Google no está configurado, el
   botón no se dibuja: nada de un botón que devuelve error de configuración.
2. **La piel no toca el flujo.** Cada pantalla re-pielada tiene que seguir pasando su test actual
   sin modificarlo. Si un test hay que cambiarlo, es que se cambió comportamiento.
3. **Anti-enumeración**: ni el login, ni el registro, ni Google revelan si un correo existe.
4. **Contraste bajo el sol no aplica acá, pero AA sí**: el panel navy con texto blanco y el card
   blanco con `k-text` tienen que dar ≥ 4.5:1. El `k-muted` sólo para labels secundarios.
5. **`prefers-reduced-motion` respetado** en las transiciones del split-screen.

## 11. DoD

- [ ] `pnpm --filter @kobrax/web type-check` · `test` · `build` verdes.
- [ ] `pnpm --filter @kobrax/api type-check` · `test` verdes (523 + los nuevos).
- [ ] Los tests existentes de auth pasan **sin modificarse**.
- [ ] Login por contraseña, MFA, selección de empresa, olvido y reset: funcionan igual que antes.
- [ ] Entrar con Google con un usuario real termina en el panel; con un correo desconocido da el
      error genérico.
- [ ] Un usuario con MFA que entra por Google **igual pasa por el segundo factor**.
- [ ] Cambiar el idioma cambia los textos de las pantallas de W0 y sobrevive al refresh.
- [ ] Registro público e invitación funcionan punta a punta contra la API real.
- [ ] Validación visual de la usuaria en navegador real (1280 y 1440).

## 12. ⏸️ Pendiente de confirmar

- [ ] **Credenciales de Google Cloud** (§6.6) — bloquea sólo las tareas 7–9.
- [ ] **Qué va en el mockup del centro del panel izquierdo** (§3).
- [ ] ¿El titular y las 4 features del diseño quedan tal cual, o se ajusta el copy?
- [ ] ¿La barra de sellos del pie va en todas las pantallas de auth o sólo en `/login`?
