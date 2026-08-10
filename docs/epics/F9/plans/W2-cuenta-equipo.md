> **ESTADO: EN BORRADOR — ronda 1 (2026-08-10). NO construir hasta PASS.**

# W2 — Cuenta y equipo

## 1. Objetivo

Que la dueña de una cuenta pueda **administrarla sin pedirle nada a nadie**: cambiar los
datos del negocio, invitar a su gente, darle o quitarle rol, y editar su propio perfil. Es lo
primero que hace alguien que acaba de registrarse, y hoy en la web no se puede hacer nada de
eso.

Es además la primera etapa que **estrena lo que W1 dejó construido**: `usePermissions`, el
selector de empresa y el kit de primitivas (`DataTable`, `Modal`, `Toast`) tienen acá su
primer consumidor de verdad.

## 2. Rama

`web/W2-cuenta` (sale de **`main`**, que ya trae W0+W1 mergeadas).

## 3. Pantallas

| Ruta | Permiso | Qué hace |
|---|---|---|
| `/cuenta` | `account:read` (editar: `account:write`) | Datos del negocio: nombre, NIT, país+moneda, zona horaria. Contador de asientos |
| `/equipo` | `user:read` | Miembros: lista, invitar, reenviar, cambiar rol, activar/desactivar, eliminar pendientes |
| `/settings/perfil` | — (propio) | Mi perfil: nombre, apellido, teléfono, foto y QR de cobro |
| `/settings/security/**` | — (propio) | **Ya existe**: sólo se traduce al inglés (§8) |

Decisiones de la dueña (2026-08-10): **Cuenta y Equipo van separadas** (son trabajos
distintos y con permisos distintos: hay roles que ven uno y no el otro) · **el código de
invitación se muestra en pantalla** (§6.3) · **entran Mi perfil y la traducción de Ajustes**.

🔴 **`/cuenta` y `/equipo` son rutas privadas nuevas → entran al matcher de `middleware.ts`**
(regla §3.2 del BUILD-PLAN). W1 no lo necesitó porque reusó `/dashboard` y `/settings`; es el
error más fácil de cometer y el más difícil de notar: la pantalla anda hasta que expira el
access token. `/settings/perfil` ya está cubierta por `/settings/:path*`.

En `lib/nav.ts` se les da vuelta el `built: false` a `team` y `account`.

## 4. Contrato (verificado contra los controllers)

| Endpoint | Permiso | Notas |
|---|---|---|
| `GET /accounts/me` | `account:read` | Devuelve la cuenta **+ `memberCount`** (activos). De ahí sale el contador de asientos |
| `PATCH /accounts/me` | `account:write` | `businessName` (2–160) · `taxId` (≤40) · `countryCode` (`@IsIn(COUNTRIES)`) · `currencyCode` (`@IsIn(CURRENCIES)`) · `timezone` |
| `GET /users` | `user:read` | Miembros del tenant por RLS, ordenados por `joinedAt` |
| `POST /users/invite` | `user:invite` | `{ firstName, lastName, email, roleId }` → miembro **+ `invitationCode`** |
| `POST /users/:id/invite/resend` | `user:invite` | Código nuevo; **invalida el anterior**. Sólo si sigue `PENDING` |
| `PATCH /users/:id` | `user:write` | Sólo `{ roleId?, isActive? }`. **El correo y el nombre de otro no se editan** |
| `DELETE /users/:id` | `user:write` | 204. **Sólo borra PENDIENTES** (§6.1) |
| `GET /roles` | `role:read` | Devuelve **sólo los 3 roles del móvil**, por nivel. El recorte lo hace el servidor: la web pinta lo que venga |
| `GET`/`PATCH /users/me/profile` | — (propio) | `firstName` · `lastName` · `phone` · `photoUrl` · `paymentQrUrl` |
| `POST /uploads` | — | `multipart/form-data`, campo `file`. Devuelve el nombre; se sirve por `GET /uploads/:name` |

**No hay logo de la cuenta.** `AuthAccountOption.logoUrl` existe en el tipo de `shared` pero
`UpdateAccountDto` no lo acepta: no hay dónde guardarlo. No se dibuja (regla §3.7).

### 4.1 Nuevo en el BFF

| Handler | Qué proxea |
|---|---|
| `PATCH /api/account/me` | `PATCH /accounts/me` |
| `PATCH /api/account/profile` | `PATCH /users/me/profile` |
| `POST /api/account/upload` | `POST /uploads` (pasa el `FormData` tal cual) |
| `POST /api/users` | `POST /users/invite` |
| `POST /api/users/[id]/resend` | `POST /users/:id/invite/resend` |
| `PATCH` · `DELETE /api/users/[id]` | `PATCH` / `DELETE /users/:id` |

**Las lecturas no llevan handler**: `/accounts/me`, `/users`, `/roles` y `/users/me/profile`
los pide el server component de cada pantalla con `apiCall(..., { auth: true })`. Un handler
para leer sería un salto del servidor a sí mismo.

## 5. Lo que se promueve a `shared` (regla §3.9)

W2 es la primera etapa con promoción real. El móvil dejó esto en `apps/mobile/src/account-form.ts`:

| Se promueve | Por qué |
|---|---|
| `diffFields` · `diffAccount` · `diffProfile` · `hasChanges` | **Es una regla, no un formulario.** La API corre con `forbidNonWhitelisted: true`: mandar el objeto entero es un 400. Y **vaciar el QR viaja como `null`**, no como `''` — el server distingue «borrar» de «no tocar», y `''` no pasa su validación de longitud. Dos implementaciones = la web borrando un QR que el teléfono deja intacto |
| `COUNTRY_OPTIONS` · `findCountry` | **País y moneda son un solo selector** (decisión S1-D1 del móvil), y las 6 combinaciones se derivan de `SUPPORTED_CURRENCIES`, que ya vive en `shared`. Si la web arma su propia lista, un día ofrece un país que el móvil no |

| NO se promueve | Por qué |
|---|---|
| `validateAccount` · `validateProfile` · `validateInvite` | Devuelven **mensajes en español** y el panel es bilingüe; convertirlos a códigos rompería los tests del móvil que §3.9 manda no tocar. Además son el espejo del DTO, no una regla. Mismo caso que `validateSignup` en W0 §5-ter |
| `ROLE_HINT` · `roleOptions()` | Copy en español. `ROLE_LABEL` **ya está en `shared`** y se usa; la explicación de una línea de cada rol va como clave de i18n en cada plataforma |

Promover = mover el archivo, dejar el móvil importando de `shared`, y verificar que **sus
tests pasan sin tocarlos** (`account-form.test.ts`).

## 6. Las reglas del servidor que la pantalla tiene que respetar

Si la UI no las conoce, ofrece botones que la API rechaza. Están todas verificadas en
`users.service.ts`.

### 6.1 Eliminar ≠ desactivar
`DELETE /users/:id` **sólo funciona con un `PENDING`** (nunca aceptó la invitación; no tiene
un caso, un pago ni una gestión colgando). Un miembro que ya trabajó **no se borra**: se
desactiva con `PATCH { isActive: false }`, y así su historial sigue en pie.

→ La fila ofrece **«Eliminar» sólo a los pendientes** y **«Desactivar» a los activos**.

### 6.2 Tres frenos que la API impone y la pantalla anticipa
- **No podés editarte a vos mismo** (`cannotEditSelf`): tu propia fila no ofrece acciones.
- **No se puede dejar la cuenta sin el último administrador activo** (`lastAdmin`): la API lo
  frena; la web muestra su mensaje, no lo re-implementa.
- **Límite de asientos** (`seatLimitReached`): el conteo va **dentro de la transacción**
  porque dos invitaciones simultáneas ganaban la carrera. La pantalla muestra «X de Y
  asientos» con `memberCount` y desactiva «Invitar» al llegar al tope — pero **el freno de
  verdad es el del servidor**.

### 6.3 El código de invitación se muestra
`POST /users/invite` devuelve el `invitationCode` en la respuesta, y el correo se manda
**después del commit y sin esperarlo** (~3,4 s de handshake SMTP contra Gmail). O sea: la
invitación ya existe aunque el correo falle.

→ Después de invitar, la pantalla muestra el código con botón de copiar y el link a
`/invitacion`. Reenviar genera uno nuevo **e invalida el anterior**: hay que decirlo, o
alguien manda dos códigos y el primero ya no sirve.

## 7. Auditoría de reuso

| Capacidad | Decisión | Dónde |
|---|---|---|
| Tabla de miembros | **REUSAR** | `components/data-table.tsx` (W1) — su primer consumidor real |
| Confirmar desactivar / eliminar | **REUSAR** | `components/modal.tsx` |
| «Guardado» / «No se pudo» | **REUSAR** | `useToast()` |
| Estado del miembro (activo/pendiente/inactivo) | **REUSAR** | `Badge` de `panel-ui.tsx` |
| Encabezado y vacíos | **REUSAR** | `PageHeader`, `EmptyState` |
| Esconder acciones sin permiso | **REUSAR** | `usePermissions()` (W1) — su primer consumidor |
| Botón, input, campo, error | **REUSAR** | `components/ui.tsx` |
| Requisitos de contraseña | **REUSAR** | `password-checklist.tsx` |
| `apiCall`, `sameOrigin`, `postJson` | **REUSAR** | `lib/bff.ts` · `lib/client.ts` |
| Etiqueta de rol | **REUSAR** | `ROLE_LABEL` de `@kobrax/shared` |
| Diff de formularios y países | **PROMOVER** | del móvil a `shared` (§5) |
| Selector país+moneda | **NUEVO** | `components/country-select.tsx`, sobre `COUNTRY_OPTIONS` |
| Formularios de cuenta, perfil e invitación | **NUEVO** | las tres pantallas |
| Subida de foto y QR | **NUEVO** | `<input type="file">` nativo + `POST /api/account/upload` |

## 8. i18n

Namespace `account` nuevo (cuenta, equipo, perfil, roles y sus explicaciones) **y la
traducción de `/settings/security/**`**, que hoy es lo único del panel en español duro. Al
terminar W2 el panel tiene que estar entero en los dos idiomas.

## 9. Tareas (en orden)

- [x] 1. Promover a `shared` el diff y los países (§5); dejar el móvil importando de ahí y
      correr **sus** tests sin tocarlos.
- [x] 2. `/cuenta`: datos del negocio + contador de asientos + su handler BFF. El guardado
      manda **sólo lo que cambió**.
- [x] 3. `/equipo`: lista con `DataTable`, estado en `Badge`, y las acciones por fila según
      §6.1 y §6.2.
- [x] 4. Invitar: modal, `POST`, y la pantalla del código con copiar (§6.3). Reenviar avisa
      que el código anterior deja de servir.
- [x] 5. Cambiar rol · activar/desactivar · eliminar pendiente, cada uno con su confirmación
      y su toast.
- [x] 6. `/settings/perfil` + subida de foto y QR. Vaciar el QR manda `null`.
- [x] 7. Sumar `/cuenta` y `/equipo` al matcher de `middleware.ts` y encender sus ítems del
      menú (`built: true`).
- [x] 8. i18n del namespace `account` **y traducción de Seguridad** (§8).
- [x] 9. Actualizar `BASE-INVENTORY` (lo promovido a `shared` + los artefactos de W2) y el
      estado de la etapa en el BUILD-PLAN.

## 10. Reglas de la fase

1. **La UI no re-implementa las reglas del servidor**: las anticipa para no ofrecer lo
   imposible, y cuando la API dice que no, se muestra **su** mensaje.
2. **Ocultar ≠ autorizar.** `usePermissions` esconde; la API sigue validando.
3. **Sólo se manda lo que cambió** (`diffAccount`/`diffProfile`). Guardar sin tocar nada no
   dispara ni una llamada.
4. **Ninguna regla de negocio nueva en `apps/web`**: si aparece, se promueve a `shared`.
5. **Nada de deps nuevas.** La subida es `<input type="file">` + `FormData`, los dos nativos.
6. Responsive de entrada (W1 §3.1): la tabla de miembros scrollea **dentro de su caja**.

## 11. DoD

- [ ] `type-check` · `test` · `build` de la web verdes; `type-check` y **528 tests** de la API.
- [ ] Los tests del móvil pasan **sin modificarse** tras la promoción a `shared`.
- [ ] Cambiar el nombre del negocio se ve reflejado **en el selector de empresa de la topbar**.
- [ ] Invitar muestra el código; el invitado entra por `/invitacion` y queda activo.
- [ ] Reenviar invalida el código anterior (el viejo ya no entra).
- [ ] Un `SUPERVISOR` **no ve** `/equipo` en el menú, y si escribe la URL la API lo rechaza.
- [ ] Tu propia fila no ofrece acciones; el último admin no se puede degradar.
- [ ] Al llegar al tope de asientos, «Invitar» queda deshabilitado y el intento por API falla.
- [ ] El panel entero (incluido Seguridad) funciona en es y en en.
- [ ] Validación visual en 1440, 1280, 1024, 768 y 390.

## 12. Verificación

```powershell
pnpm --filter @kobrax/shared build      # la promoción cambia shared: se recompila primero
pnpm --filter @kobrax/mobile test       # sus tests, SIN tocarlos
pnpm --filter @kobrax/web type-check ; pnpm --filter @kobrax/web test
pnpm --filter @kobrax/web build         # con el dev APAGADO
pnpm --filter @kobrax/api type-check ; pnpm --filter @kobrax/api test
```

## 13. ⏸️ Pendiente de confirmar

- [ ] ¿La zona horaria se elige de una lista o se deduce del país? (`PATCH` acepta cualquier
      string de ≤64; el móvil no la toca).
- [ ] ¿Un miembro desactivado sigue apareciendo en la lista, o se esconde detrás de un filtro?
- [ ] Copy de la explicación de cada rol: el móvil usa «Cobra en campo: su cartera, sus rutas
      y sus pagos» / «Supervisa cobradores y reparte cartera» / «Administra la cuenta, el
      equipo y los datos del negocio». ¿Quedan tal cual en la web?
