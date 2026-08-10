> **ESTADO: EN BORRADOR — ronda 1 (2026-08-10). NO construir hasta PASS.**

# W1 — Shell del panel

## 1. Objetivo

Dar al panel su **casa**: el layout autenticado que van a habitar los nueve módulos que
siguen. Hoy `/dashboard` es un saludo suelto y `/settings` tiene su propia barra: los dos
quedan adentro del mismo shell, con navegación por permisos, cambio de empresa y el kit de
primitivas con el que se dibuja todo lo demás.

W1 **no agrega ningún dominio**. No hay clientes, ni casos, ni plata. Si al terminar la
etapa el panel muestra un dato de negocio nuevo, W1 se fue de alcance.

## 2. Rama

`web/W1-shell` (sale de `web/f9-auth`).

⚠️ **W0 sigue abierta** (tareas 7–9, bloqueadas por las credenciales de Google). W1 no la
espera: no comparte archivos con el camino de Google. Antes de abrir la rama hay que
**comitear los dos arreglos sueltos de W0** que hoy están sin commit: el `resolve.symlinks`
de `next.config.mjs` y el QR de `/login/mfa-setup`.

## 3. Diseño

**No hay mockup del panel** (el único PNG del diseño es el del login). Decisión de la
dueña: se arma con los tokens `k-*` ya definidos, en la misma línea que la piel de auth, y
se ajusta contra la validación visual.

Anatomía, en tres piezas:

```
┌────────────┬──────────────────────────────────────────────┐
│            │  topbar: breadcrumb · empresa ▾ · idioma ·   │
│  sidebar   │          usuario ▾                           │
│  navy      ├──────────────────────────────────────────────┤
│  240px     │                                              │
│            │  PageHeader (título + acciones)              │
│  logo      │                                              │
│  nav       │  contenido del módulo                        │
│            │                                              │
└────────────┴──────────────────────────────────────────────┘
```

- **Sidebar** `bg-k-navy`, 240 px. Ítem activo con barra `k-soft-periw` a la izquierda y
  fondo `white/10`.
- **Topbar** blanca, 64 px, borde inferior `k-border`: breadcrumb a la izquierda; a la
  derecha selector de empresa, `LocaleSwitch` (ya existe) y menú de usuario (perfil,
  seguridad, cerrar sesión).
- **Contenido** sobre `bg-k-bg`, ancho máximo 1440, padding 24/32.

Contraste: sobre el navy del sidebar el acento va en `k-soft-periw` (4.51:1), **no** en
`k-purple` (2.70:1). Es la misma trampa que ya pagó el panel de marca del login.

### 3.1 Responsive — escritorio, tablet y celular

El panel es de oficina, pero se supervisa desde donde sea: una supervisora abriendo el panel
en la tablet o en el teléfono es un caso real, no un extra. **El shell nace responsive**, no
se le agrega después.

| Ancho | Sidebar | Topbar | Contenido |
|---|---|---|---|
| ≥ 1280 · escritorio | fijo, 240 px, expandido | completa | padding 32, máx. 1440 |
| 1024–1279 · laptop / tablet apaisada | fijo, colapsado a 64 px (sólo íconos + `title`) | completa | padding 24 |
| 768–1023 · tablet vertical | **fuera del flujo** — cajón con overlay | **hamburguesa** a la izquierda; el breadcrumb se recorta a la hoja actual | padding 20 |
| < 768 · celular | ídem cajón | hamburguesa + logo; empresa e idioma **se mudan al menú de usuario** | padding 16, una columna |

**El cajón es un `<dialog>`, el mismo de `Modal` (§7).** `showModal()` regala foco atrapado,
Esc y backdrop; escribir un cajón a mano sería reescribir las tres cosas peor. Se cierra
además al elegir un ítem — si no, en el teléfono navegás y te queda el menú tapando la
pantalla a la que fuiste.

Reglas que no se negocian en chico:
- **Toque ≥ 44 px** en ítems del menú, hamburguesa y los dos menús de la topbar.
- La hamburguesa lleva `aria-expanded` y `aria-controls`; es un `<button>`, no un ícono con
  `onClick`.
- **Nada de scroll horizontal en la página.** Lo que no entra scrollea adentro de su caja
  (§7, `DataTable`).
- El colapso y el cajón respetan `prefers-reduced-motion`.

Se verifica en **1440, 1280, 1024, 768 y 390** (§11). Los tres primeros son los del diseño;
768 es una tablet vertical y 390 un teléfono de verdad.

## 4. Rutas y estructura

Las URLs **no cambian**. Se usa un *route group* — `src/app/(panel)/` — que agrupa sin
aparecer en la URL:

```
src/app/(panel)/
├── layout.tsx              # el shell (server component)
├── dashboard/page.tsx      # se mueve tal cual desde src/app/dashboard/
└── settings/               # se mueve tal cual desde src/app/settings/
    └── …                   # su layout propio se BORRA: lo reemplaza el shell
```

Consecuencia buena: **el matcher de `middleware.ts` no se toca** (`/dashboard/:path*` y
`/settings/:path*` siguen siendo las URLs reales). La regla §3.2 del BUILD-PLAN sigue viva
para los módulos que vienen: cada ruta nueva entra al matcher, y un route group no exime de
eso.

### 4.1 Qué muestra `/dashboard` hasta W8

Aterrizaje con el saludo y accesos a lo que ya existe. **W8 lo reemplaza entero** por el
dashboard de KPIs; hasta entonces no se pintan tarjetas de métricas vacías. → confirmar §13.

## 5. Contrato

### 5.1 Ya se consume (no cambia)
`GET /auth/me` → `{ userId, email, profile, accountId, role, permissions, mfaEnabled,
requiresPasswordChange }`. Es la fuente de la identidad y de los permisos del shell.

### 5.2 Nuevo en la API

| Endpoint | Guard | Cuerpo | Devuelve |
|---|---|---|---|
| `GET /auth/accounts` | `JwtAuthGuard` | — | `AuthAccountOption[]` — `{ id, name, role, status }` |
| `POST /auth/switch-account` | `JwtAuthGuard` | `{ accountId }` | `AuthTokens` (mismo par que el login) |

**Por qué hace falta un endpoint nuevo y no alcanza con lo que hay.** `POST
/auth/select-account` exige un `preAuthToken` de propósito `select_account`, que vive 5
minutos y sólo existe *entre* pasos del login. Una vez adentro no hay con qué cambiar de
empresa: hoy la única forma es cerrar sesión y volver a entrar.

Las dos reusan lo que ya está escrito en `auth.service.ts`:
- `activeMemberships(userId)` (hoy privado → pasa a poder llamarse desde los dos métodos
  nuevos). Ya filtra tenants `SUSPENDED` / `CANCELLED` / `INACTIVE`: **CU-01 sigue valiendo
  para el cambio en caliente, no sólo para el login.**
  ⚠️ Se apoya en la función `auth_memberships(userId)`, que es **`SECURITY DEFINER`** — por
  eso puede ver tenants distintos al activo. Consultar `accounts` con Prisma a secas devuelve
  sólo el tenant actual: la RLS lo corta y la lista sale con un único elemento.
- `issueTokens(userId, accountId, roleId, meta)` — el rol y los permisos se re-derivan de la
  membresía destino. Nunca se copian los del token viejo.
- `accountNotAllowed()` para una empresa donde no hay membresía activa. Mismo error que
  `selectAccount`, sin distinguir «no existe» de «no sos miembro».

**La lista no marca cuál es la activa** y no hace falta un campo `current`: el layout ya trae
`me.accountId` de `/auth/me`. Es el mismo `AuthAccountOption` que ya devuelve el selector del
login — cero tipos nuevos.

**La sesión anterior se revoca.** Al cambiar de empresa se emite un par nuevo y se invalida
el refresh token de la sesión actual (`sessionId` viene en el `@CurrentUser()`). Si no, queda
vivo un refresh token que devuelve tokens de la empresa vieja: un cambio de empresa que no
cierra la puerta de atrás no es un cambio de empresa.

**El MFA no se vuelve a pedir**: ya se verificó en este login. Cambiar de empresa no es un
factor de autenticación nuevo, es re-alcance de la misma sesión.

### 5.3 Nuevo en el BFF

| Handler | Qué hace |
|---|---|
| `POST /api/auth/switch-account` | Valida `sameOrigin`, llama a la API y **re-setea las cookies** con `setAuthCookies` |

**Un solo handler, no dos.** La lista de empresas la pide el `layout.tsx`, que es server
component, con `apiCall('/auth/accounts', { auth: true })`. Un route handler ahí sería un
salto de servidor a sí mismo.

### 5.4 ⚠️ Trampas conocidas
- **El `layout.tsx` corre en cada navegación del panel**: son dos llamadas a la API por
  render (`/auth/me` + `/auth/accounts`). Se envuelven en un solo `Promise.all`. Si aparece
  latencia, la respuesta es cachear, no partir el layout.
- **Al cambiar de empresa hay que refrescar del servidor**, no navegar en el cliente: los
  datos del shell (rol, permisos, menú) los pintó el servidor con el token viejo.
  `router.refresh()` después de que el handler devuelva 200.
- **`/settings/layout.tsx` se borra.** Si se deja, quedan dos barras superiores apiladas.
- El `LocaleSwitch` **ya existe** y ya escribe la cookie: se mueve a la topbar, no se
  reescribe.

## 5-bis. Reglas del móvil: qué promueve W1 a `shared`

**Ninguna, y el motivo importa** (§3.9 del BUILD-PLAN exige justificarlo).

El `BASE-INVENTORY §1-bis.2` anotaba para W1 los mapas de etiquetas del móvil
(`ROUTE_STATUS_LABEL`, `STOP_STATUS_META`, `AGENDA_STATUS_LABEL`, `AGENDA_TYPE_META`). No se
promueven, por dos razones:

1. **Son texto en español, y el panel es bilingüe.** Es exactamente lo que ya pasó con
   `validateSignup` en W0 (§5-ter): subir cadenas en español a `shared` rompe el panel en
   inglés, y cambiarlas a códigos rompería los tests del móvil que §3.9 manda no tocar. Un
   estado→etiqueta es presentación; el estado ya vive en `shared` como enum.
2. **W1 no tiene quién las use.** Agenda es W5 y rutas es W6. Promoverlas acá es mover
   código a `shared` para que no lo importe nadie durante dos etapas.

Cada módulo traduce sus estados con claves de i18n en su etapa. Lo que **sí** es regla y sí
se promueve —el agrupamiento de `NOT_FOUND` + `WRONG_ADDRESS` en «Inubicables» de
`categoryOf`— viaja en W6 como códigos, no como rótulos.

**Se actualiza `BASE-INVENTORY §1-bis.2`** con esta decisión para que la próxima etapa no la
vuelva a discutir.

## 6. Navegación y permisos

### 6.1 Los ítems

| Ítem | Ruta | Permiso | Existe |
|---|---|---|---|
| Inicio | `/dashboard` | — | ✅ W1 |
| Cartera | `/cartera` | `client:read` | W3 |
| Import | `/import` | `client:import` | W4 |
| Casos | `/casos` | `case:read` | W5 |
| Agenda | `/agenda` | `agenda:read` | W5 |
| Rutas | `/rutas` | `route:read` | W6 |
| Pagos | `/pagos` | `payment:read` | W7 |
| Equipo | `/equipo` | `user:read` | W2 |
| Cuenta | `/cuenta` | `account:read` | W2 |
| Seguridad | `/settings/security` | — (propia) | ✅ ya existe |

🔴 **El menú se filtra por permiso, nunca por `tenantType`** (§3.3). Un cobrador
independiente y un banco ven el mismo menú si tienen los mismos permisos; lo que cambia es
lo que su rol puede hacer, no de qué tamaño es su empresa.

**Dos filtros distintos, no uno:**
- **Sin permiso → no se dibuja.** Un cobrador no ve «Equipo» ni en gris. Que un ítem esté
  apagado ya cuenta algo sobre el producto; que aparezca uno que nunca vas a poder abrir
  cuenta algo sobre *tu* cuenta, y eso no se filtra.
- **Con permiso pero sin módulo → gris.** Ítem deshabilitado, chip «Pronto»,
  `aria-disabled="true"`, **no es un enlace** (no hay `href`, no hay 404 posible).

### 6.2 La excepción a «no pintar lo que no existe»

La regla §3.7 del BUILD-PLAN dice que si algo no tiene respaldo, no se dibuja. El menú en
gris es una **excepción explícita, decidida por la dueña el 2026-08-10**: el sidebar hace de
mapa del producto para un equipo interno que ya sabe que se está construyendo.

Los límites que la mantienen honesta: no se puede hacer clic, dice «Pronto» con todas las
letras, y no promete fecha. El día que un módulo entra, se le saca el gris y se le pone el
`href`: un renglón de diff.

### 6.3 `usePermissions()`

El `layout.tsx` ya trae `permissions` de `/auth/me`; las siembra en un
`PermissionsProvider` (contexto de cliente) y `usePermissions()` devuelve `{ can(p) }` sobre
un `Set`. Cero llamadas extra a la API.

🔴 **Ocultar ≠ autorizar** (§3.4). `can()` es cosmética: la API valida siempre. El test que
lo prueba no es de UI — es el de la API que devuelve 403 aunque el botón no exista.

## 7. Kit de UI (las 7)

Decisión de la dueña: se construyen **las siete en W1**, aunque tres nazcan sin consumidor.

| Primitiva | Dónde | Cómo |
|---|---|---|
| `PageHeader` | `components/panel-ui.tsx` | Título + subtítulo + slot de acciones |
| `EmptyState` | `panel-ui.tsx` | Ícono + texto + acción opcional |
| `Skeleton` | `panel-ui.tsx` | `animate-pulse` de Tailwind, sin librería |
| `Badge` | `panel-ui.tsx` | Tonos `success` / `warning` / `danger` / `neutral` de los tokens |
| `Modal` | `components/modal.tsx` | **`<dialog>` nativo** + `showModal()`: foco atrapado, Esc y backdrop **gratis**. Nada de recrear un focus trap a mano |
| `Toast` | `components/toast.tsx` | Provider + `useToast()`. Región `aria-live="polite"`, auto-cierre 5 s |
| `DataTable` | `components/data-table.tsx` | Orden/paginación/filtros **por `searchParams` de la URL**, no por estado interno: la vista queda compartible y el back del navegador funciona. Consume el `meta.total/page/limit/pages` que `ApiEnvelope` ya tipa. En pantalla chica **scrollea adentro de su contenedor** (`overflow-x-auto`), nunca la página |

`panel-ui.tsx` **no** lleva `'use client'`: esas cuatro no tienen una sola interacción y así
no viajan al navegador. Las tres interactivas van en archivo propio. `ui.tsx` (Button,
Input, Field, ErrorBanner) no se toca — se importa.

Estados de carga y error: **`loading.tsx` y `error.tsx` de Next por segmento**, que es lo
nativo, no un `<Suspense>` a mano en cada página.

## 8. Auditoría de reuso

| Capacidad | Decisión | Dónde |
|---|---|---|
| Botón, input, campo, banner de error | **REUSAR** | `components/ui.tsx` |
| Selector de idioma | **REUSAR** (se mueve a la topbar) | `components/locale-switch.tsx` |
| Cookies, `apiCall`, `sameOrigin`, `ApiEnvelope` | **REUSAR** | `lib/bff.ts` |
| `setAuthCookies` para el par nuevo | **REUSAR** | `lib/bff.ts` |
| `postJson` | **REUSAR** | `lib/client.ts` |
| Refresh silencioso y matcher | **REUSAR sin tocar** | `middleware.ts` |
| Permisos y roles | **REUSAR** | `@kobrax/shared` — `Permission`, `ROLE_PERMISSIONS` |
| Tokens visuales | **REUSAR — no se tocan** | `tailwind.config.ts` |
| Botón de logout | **REUSAR** | `app/dashboard/logout-button.tsx` → se mueve al menú de usuario |
| Barra de `/settings` | **BORRAR** | `app/settings/layout.tsx` — la reemplaza el shell |
| Shell del panel | **NUEVO** | `app/(panel)/layout.tsx` + `components/sidebar.tsx` · `topbar.tsx` |
| Menú y su filtro | **NUEVO** | `lib/nav.ts` — lista de ítems + `visibleNav(permissions)` puro |
| Permisos en cliente | **NUEVO** | `components/permissions.tsx` (provider + `usePermissions`) |
| Selector de empresa | **NUEVO** | `components/account-switch.tsx` |
| Las 7 primitivas | **NUEVO** | §7 |
| Listar y cambiar empresa | **NUEVO (API)** | `auth.controller.ts` + `auth.service.ts` |

## 9. Tareas (en orden)

- [x] 1. Comitear los dos arreglos sueltos de W0 (`resolve.symlinks`, QR del mfa-setup) y
      abrir `web/W1-shell`.
- [x] 2. **API:** `GET /auth/accounts` + `POST /auth/switch-account` (revocando la sesión
      anterior) + specs: empresa sin membresía → error genérico; tenant `SUSPENDED` → no
      aparece ni se puede saltar a él; los permisos salen de la membresía destino.
- [x] 3. `(panel)/layout.tsx` con sidebar + topbar + breadcrumb. Mover `dashboard` y
      `settings` adentro; borrar `settings/layout.tsx`.
- [x] 3-bis. Responsive (§3.1): colapso a íconos, cajón con hamburguesa sobre `<dialog>`, y
      la mudanza de empresa e idioma al menú de usuario en celular.
- [x] 4. `lib/nav.ts` + `visibleNav()` + los dos filtros (§6.1), con su test.
- [x] 5. `PermissionsProvider` + `usePermissions()`, con su test de matriz rol→ítems.
- [x] 6. Selector de empresa: handler BFF + `router.refresh()`. Test del camino de error.
- [x] 7. Las 7 primitivas (§7).
- [x] 8. `loading.tsx` / `error.tsx` del segmento del panel.
- [x] 9. i18n: namespace `panel` en `es.json` / `en.json` (nav, menú de usuario, empresa,
      vacíos y errores). Sin texto suelto en el shell.
- [x] 10. Actualizar `BASE-INVENTORY` (§1-bis.2 y §5) y el estado de la etapa en el
      BUILD-PLAN.

## 10. Reglas de la fase

1. **Ningún dominio nuevo.** Si aparece una tabla de clientes, se fue de alcance.
2. **Ocultar ≠ autorizar.** `can()` es cosmética; la API valida siempre.
3. **El navegador no ve tokens.** El cambio de empresa pasa por el BFF, como todo lo demás.
4. **Nada de librerías de componentes.** Las 7 primitivas son propias, con los tokens. Cero
   deps nuevas en W1.
5. **AA en todo**: foco visible, navegación por teclado en sidebar y menús, `aria-current`
   en el ítem activo, contraste ≥ 4.5:1 sobre el navy.
6. **`prefers-reduced-motion`** respetado en el colapso del sidebar, el cajón y los toasts.
7. **Responsive de entrada** (§3.1). Una pantalla que sólo funciona en 1440 no está
   terminada: el DoD la mide en 768 y en 390.

## 11. DoD

- [ ] `pnpm --filter @kobrax/web type-check` · `test` · `build` verdes.
- [ ] `pnpm --filter @kobrax/api type-check` · `test` verdes (los de hoy + los nuevos).
- [ ] Los tests existentes pasan **sin modificarse**.
- [ ] `/dashboard` y `/settings/security` viven en el mismo shell y no hay dos barras.
- [ ] Un `COLLECTOR` no ve «Equipo» ni «Cuenta»; un `ACCOUNT_ADMIN` sí.
- [ ] `supervisor@kobrax.demo` cambia de empresa desde la topbar, el panel se repinta con el
      rol nuevo, y el refresh token viejo **ya no sirve**.
      ℹ️ El 2026-08-10 se le sumó a ese usuario una membresía en **Kobrax Demo Norte** en la
      base de desarrollo: `multi@` servía para lo mismo, pero ya tiene MFA activo y cada
      prueba pedía un código del authenticator. `supervisor@` entra con contraseña sola.
- [ ] Los ítems en gris no navegan a ningún lado.
- [ ] El shell está entero en es/en y sobrevive al refresh.
- [ ] Recorrido con teclado del sidebar y los dos menús de la topbar.
- [ ] **En 768 y en 390**: la hamburguesa abre el cajón, se cierra con Esc, con toque en el
      overlay y al elegir un ítem; empresa e idioma se alcanzan desde el menú de usuario; y
      **ninguna pantalla del panel scrollea de costado**.
- [ ] Validación visual de la usuaria en navegador real: **1440, 1280, 1024, 768 y 390**.

## 12. Verificación

```powershell
pnpm --filter @kobrax/web type-check
pnpm --filter @kobrax/web test
pnpm --filter @kobrax/web build      # con el dev APAGADO: comparten .next y se pisan
pnpm --filter @kobrax/api type-check
pnpm --filter @kobrax/api test
```

## 13. ⏸️ Pendiente de confirmar

- [ ] Qué muestra `/dashboard` hasta W8 (§4.1): ¿saludo + accesos, o algo más?
- [ ] Los nombres de ruta en español (`/cartera`, `/casos`, `/rutas`, `/equipo`) — quedan
      fijos apenas se pinten en el menú.
- [ ] ¿El sidebar arranca abierto o colapsado, y se recuerda la preferencia?
