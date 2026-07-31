# Módulo CUENTA (Manage Account móvil) — índice

> **ESTADO: EN BORRADOR — ronda 1 (2026-07-29). NO construir hasta PASS de `/f10-validar-plan`.**
>
> **Sin Figma.** No hay diseño para estas pantallas: se construyen **calcando el lenguaje visual ya
> construido** (tokens de `src/theme.ts`, componentes de `src/ui.tsx`, esqueleto de las pantallas de
> Agenda/Cartera). Igual que el módulo Cartera — el gate sustituye el ítem "node-id" por **parity visual**.
> **Enfoque:** un plan por pantalla, cada uno un slice vertical funcional (backend que necesita + pantalla
> + tests). Se construye, verifica y valida uno antes del siguiente.
> **Build: 🟢** — todo corre en **Expo Go**. No cruza la frontera del dev build.

---

## 1. Objetivo

Que un **cobrador independiente** pueda vivir enteramente en el móvil, y que un **equipo de 2 a 5
cobradores** pueda arrancar sin abrir la web: crear su cuenta, configurar país/moneda, gestionar su perfil,
invitar a su equipo hasta el límite del plan, asignar el rol básico de cada miembro, activarlo o
desactivarlo, y repartirle cartera.

**Lo que NO es:** un panel de administración. Sucursales, jerarquías, roles avanzados (`MANAGER`,
`AUDITOR`, `VIEWER`), overrides de permisos, reportes, auditoría consultable e integraciones **son web** y
quedan explícitamente fuera (ver D2 y §7).

---

## 2. Decisiones (2026-07-29, confirmadas con la usuaria)

### D1. El alta de miembro es **por invitación por email** — no contraseña temporal
Confirmado. Implicación dura y hoy inexistente: **el proyecto no tiene ninguna infraestructura de correo.**
`POST /auth/forgot-password` genera el token y **nada lo envía** (grep de `nodemailer|sendgrid|resend|smtp`
en toda la API: cero resultados). Este módulo tiene que construirla.

**Proveedor (Q1, respondida 2026-07-31): SMTP de Gmail.** Corrige el supuesto original de este plan, que
era Resend por HTTP.

`ponytail:` **una dependencia, y es inevitable.** SMTP es un protocolo sobre socket, no un `POST`: con
Gmail el `fetch` nativo no alcanza y entra **`nodemailer`** (la librería SMTP de Node, sin transitivas
pesadas). Sigue siendo un `mail.service.ts` chico: un transport + un `sendMail`. Env nuevas:
`SMTP_USER`, `SMTP_PASS` (**contraseña de aplicación de Google, no la del correo**), `MAIL_FROM`.
Techo conocido y aceptado: Gmail limita ~500 envíos/día y puede marcar spam si el volumen crece — cuando
eso moleste se cambia el transport, que es el único lugar que lo sabe. Sin reintentos ni cola: si el envío
falla, la invitación queda creada y la lista muestra "Reenviar".

**Root cause, no síntoma:** `forgot-password` es el otro llamador del mismo agujero. El `mail.service` se
construye una vez y **los dos** lo usan. Arreglar sólo la invitación dejaría el reset de contraseña roto.

### D2. Los roles que el móvil ofrece son **tres**, no siete
`RoleType` tiene 7 valores (`packages/shared/src/enums/role.enum.ts`). El selector del móvil expone sólo:

| Rol | Para qué | Ya seedeado |
|---|---|---|
| `COLLECTOR` | cobra en campo | ✅ |
| `SUPERVISOR` | supervisa cobradores, asigna, no administra la cuenta | ✅ |
| `ACCOUNT_ADMIN` | dueño / administrador | ✅ |

`MANAGER`, `AUDITOR`, `VIEWER` y `SUPER_ADMIN` **no se muestran**. Si un miembro ya los tiene (asignado
desde la web), el móvil los pinta en modo lectura con el texto "Se administra desde la web" y **no deja
cambiarlos** — nunca los pisa silenciosamente. Esa es la frontera progresiva móvil→web hecha código.

### D3. `maxUsers` deja de ser una columna muerta — es **la única guarda de plan**
`Account.maxUsers` existe (`schema.prisma:82`, default **5**, que coincide exacto con el techo del segmento)
y hoy **no se lee en ningún archivo**. La invitación cuenta `UserAccount` activos del tenant y rechaza al
llegar al límite. **No entra `PlanCode`, no entran feature flags, no entra una matriz de capacidades por
plan.** Un número, una comparación. `planCode` sigue muerto a propósito hasta que haya dos clientes pagando
distinto.

### D4. El registro (self-signup) es **público y crea todo el tenant en una transacción**
Confirmado. `POST /api/accounts` sin autenticación crea, atómicamente: `Account` (status `TRIAL`, plan
`STARTER`, `maxUsers: 5`) + `User` + `Profile` + `UserAccount` con `isOwner: true` y rol `ACCOUNT_ADMIN`.
Es el camino más riesgoso del módulo (endpoint público, escritura, sin sesión) → §6 lista sus guardas.

`ponytail:` **la verificación de email no bloquea el arranque.** El usuario entra y opera; se le manda el
correo de verificación y un banner recuerda verificar. Bloquear el primer uso es la forma más rápida de
perder al independiente que se registró parado en la calle. Techo: cuentas sin verificar acumulándose →
si aparece abuso real, se corta por `status TRIAL` + expiración, no por un muro en el registro.

### D5. La cartera se reparte **por lote, desde el detalle del miembro**
Confirmado. Pantalla "Cartera de <miembro>": lista de clientes con multi-selección y asignación en bloque.
Necesita **un endpoint bulk nuevo** — `POST /api/cases/:id/assign` existe pero es de a uno, y repartir 200
clientes con 200 requests no es aceptable en campo.

`POST /api/cases/assign-bulk` recibe `{ collectorId, clientIds[] }` y reusa **la misma
`cases.service.assign`** por dentro (una transacción, misma validación, mismo audit). No es lógica nueva de
asignación: es un `for` del lado correcto de la red.

### D6. Nada ramifica por `accountType` ni por `planCode`
Regla heredada de Cartera D4 y del anti-patrón del skill: el gating es **por capacidad** (`can(permission)`
sobre `permissions` que `GET /auth/me` ya devuelve). El independiente y la empresa de 5 corren **exactamente
el mismo código**; lo único que cambia es cuántas filas devuelve `GET /users` y qué permisos trae el JWT.
Para el independiente, "miembros" es una lista de uno — y está bien así, no se le esconde la pantalla.

---

## 3. Contrato real (auditado contra el código, 2026-07-29)

### Ya existe — se reusa tal cual
| Capacidad | Dónde |
|---|---|
| Identidad, rol y permisos de la sesión | `GET /api/auth/me` → `{ id, email, firstName, lastName, accountId, role, permissions }` (`auth.service.ts:236`) |
| Modelo de membresía completo (rol, sucursal, dueño, activo) | `UserAccount` — `roleId`, `branchId`, `isOwner`, `isActive` (`schema.prisma:264`) **ya tiene todo lo que el módulo necesita** |
| Datos personales separados de credenciales | `Profile` — `firstName`, `lastName`, `phone`, `photoUrl`, `documentNumber` (`schema.prisma:172`) |
| Datos del tenant | `Account` — `businessName`, `taxId`, `countryCode`, `currencyCode`, `timezone`, `maxUsers` (`schema.prisma:74`) |
| Permisos de usuario/rol **ya en el enum y ya seedeados** | `USER_READ`, `USER_WRITE`, `USER_INVITE`, `ROLE_READ`, `ROLE_WRITE` (`permission.enum.ts:48-53`, `seed.ts:94-98`). `ACCOUNT_ADMIN` los tiene todos (`seed.ts:105`) |
| Forzar cambio de contraseña en el primer login | `User.requiresPasswordChange` (default `true`) + `app/(app)/force-password-change.tsx` — **el flujo de aceptar invitación aterriza acá sin código nuevo** |
| Endpoints públicos | Los guards son **opt-in por endpoint** (`@UseGuards(JwtAuthGuard)` en `auth.controller.ts`). Un endpoint público simplemente lo omite — **no hace falta un `@Public`** |
| Rate limiting sobre endpoints sensibles | `@RateLimit({ limit, windowSec, by })` (`common/decorators/rate-limit.decorator.ts`) — ya lo usan login y forgot-password |
| Subida de archivos + hash | `POST /api/uploads` (foto de perfil) |
| Asignación de un caso | `POST /api/cases/:id/assign` (`AssignCaseDto` = `collectorId?` \| `auto?`) |
| Multi-tenant + RLS + audit + `{data,meta,error}` | `PrismaService.withTenant` · `AuditService` · `ResponseDto` |
| Monedas de LatAm | `SUPPORTED_CURRENCIES` en `packages/shared` (BOB/COP/MXN/PEN/ARS/USD) — **es también el catálogo de países**, ver §5 |

### No existe — lo construye [00-fundacion.md](./00-fundacion.md)
1. **Módulo `accounts`** — no hay controller de cuenta. `GET /api/accounts/me` · `PATCH /api/accounts/me`.
2. **Módulo `users`** — no hay controller de usuarios. `GET /api/users` (miembros del tenant) ·
   `PATCH /api/users/:id` (rol · `isActive`) · `GET /api/users/me/profile` · `PATCH /api/users/me/profile`.
3. **`GET /api/roles`** — el selector de rol necesita los ids reales (`UserAccount.roleId` es una FK, no un
   enum). Devuelve sólo los tres de D2.
4. **Permisos `ACCOUNT_READ` / `ACCOUNT_WRITE`** — no existen en el enum. Editar el tenant no tiene hoy
   ningún permiso con la semántica correcta (`USER_WRITE` no es eso). Se agregan a `permission.enum.ts`,
   a `ROLE_PERMISSIONS` (sólo `ACCOUNT_ADMIN`) y al catálogo del `seed.ts`.
5. **Tabla `account_invitations`** — `accountId`, `email`, `roleId`, `tokenHash`, `expiresAt`, `acceptedAt`,
   `invitedBy`, timestamps. Con su política RLS.
6. **`mail.service.ts`** — el agujero de D1. Lo usan la invitación, la verificación de registro **y
   `forgot-password`** (que hoy no envía nada).
7. **Endpoints de invitación** — `POST /api/users/invite` (autenticado, `USER_INVITE`, guarda `maxUsers`) ·
   `GET /api/invitations/:token` (público, devuelve email + nombre de la cuenta para pintar la pantalla) ·
   `POST /api/invitations/:token/accept` (público, crea `User` + `Profile` + `UserAccount`).
8. **`POST /api/accounts`** — registro público (D4).
9. **`POST /api/cases/assign-bulk`** — D5.
10. 🔴 **Fuga de tenant preexistente:** `client_import_runs` tiene `account_id` pero **falta en el array de
    `prisma/rls/001_enable_rls.sql:25`**. No lo causa este módulo, pero la fundación toca ese archivo para
    sumar `account_invitations` → se arregla en la misma pasada. Una línea.
11. **Env nuevas** — `RESEND_API_KEY`, `MAIL_FROM` en `config/env.validation.ts` (zod, fail-fast). `APP_URL`
    ya existe y es la base del link de invitación.

---

## 4. Slices (orden de construcción)

| # | Pantalla | Ruta móvil | Backend que necesita (§3.2) | Costo | Preguntas abiertas |
|---|---|---|---|---|---|
| **S0** | Fundación backend (sin pantalla) | — | 1 · 2 · 3 · 4 · 10 | 🟠 medio | **ninguna** |
| **S1** | Hub + datos de la cuenta + mi perfil | `app/cuenta/index.tsx` · `datos.tsx` · `perfil.tsx` | — (consume S0) | 🟢 bajo | **ninguna** |
| **S2** | Miembros: lista · invitar · rol · activar/desactivar | `app/cuenta/miembros.tsx` · `miembro/[id].tsx` · `invitar.tsx` | 5 · 6 · 7 · 11 | 🔴 alto | Q1 |
| **S3** | Aceptar invitación (deep link) | `app/(auth)/invitacion.tsx` | — (consume S2) | 🟢 bajo | — |
| **S4** | Registro (self-signup) | `app/(auth)/registro.tsx` | 8 | 🟠 medio | Q2 · Q3 |
| **S5** | Cartera del miembro (asignación por lote) | `app/cuenta/miembro/[id]/cartera.tsx` | 9 | 🟠 medio | Q4 |

**Racional del orden:** leer antes de escribir. **S0 y S1 no tienen ninguna decisión abierta** y no dependen
del correo → se pueden construir hoy, y S1 valida la parity visual antes de invertir en lo caro. Toda la
infraestructura de correo y de invitaciones (§3.2 · 5, 6, 7, 11) vive en **S2**, no en la fundación: S1 no la
necesita y meterla antes bloquearía el arranque por una decisión de proveedor que todavía no está tomada.
S3 cierra el circuito de S2 — **hasta que S3 exista, una invitación enviada no se puede aceptar**, así que
van pegadas. S4 y S5 son independientes entre sí y de S3: se pueden intercambiar o diferir sin romper nada.

**Entrada en la app:** la sección **Cuenta** de `app/(tabs)/mas.tsx` ya existe (`mas.tsx:61`) con la fila
"Perfil y seguridad" cuyo `onPress` es **`() => {}`** — un placeholder muerto. S1 la cablea; no se agrega
una entrada nueva al menú.

---

## 5. Auditoría de reuso — móvil

| Capacidad | Decisión | Path |
|---|---|---|
| Red, envelope, refresh 401, offline | **REUSAR** | `src/api-client.ts` (`authedFetch`) — base de todos los services |
| Chrome, filas, vacíos, hojas, badges, secciones | **REUSAR** | `src/ui.tsx` → `Header`, `ListRow`, `EmptyState`, `BottomSheet`, `StatusBadge`, `SectionLabel` |
| **Fila de miembro** (nombre · rol · estado) | **REUSAR sin tocar** | `ListRow` ya acepta `right?: ReactNode` (`ui.tsx:67`) → `right={<StatusBadge …/>}`. **No se escribe un `MemberRow`** |
| Inputs, botones, errores | **REUSAR** | `src/components.tsx` → `Field`, `Button`, `ErrorBanner` |
| **Requisitos de contraseña** (registro + aceptar invitación) | **REUSAR** | `src/components.tsx` → `PasswordChecklist` + `checkPassword` de `packages/shared/src/validation/password-policy.ts`. **Cero validación de contraseña nueva** |
| Selector + hoja de opciones (rol, país, moneda, zona horaria) | **REUSAR** | `PickerSheet` / `SelectRow` (hoy en `app/agenda/crear.tsx`; Cartera ya los marcó para subir a `ui.tsx` — se consume el resultado de esa subida, no se duplica) |
| **Catálogo de monedas y países** | **REUSAR** | `SUPPORTED_CURRENCIES` de shared ya trae `locale` (`es-BO`, `es-CO`…) → el país sale de ahí. **No se instala `i18n-iso-countries` ni se escribe una lista de 200 países** para un producto que opera en 6 |
| Lógica de formulario pura + reducer, testeable sin red | **REUSAR patrón** | `src/cliente-form.ts` + `.test.ts` (el patrón del módulo Cartera) |
| **Buscador de clientes** (asignación por lote, S5) | **REUSAR** | `src/use-client-search.ts` → `useClientSearch` (debounce 300 ms, race-guard). Es el tercer consumidor: agenda, cartera, y ahora esto |
| **Orden de la cartera** (S5) | **REUSAR** | `src/portfolio.ts` → `sortPortfolio` + `PORTFOLIO_SORT_LABEL` |
| Foto de perfil | **REUSAR** | `src/photo.ts` + `POST /api/uploads` (los construyó Cartera) |
| Primer login tras aceptar invitación | **REUSAR** | `app/(app)/force-password-change.tsx` + `src/post-login.ts` (`routeAfterAuth`) |
| Deep link `kobrax://invitacion?token=…` | **REUSAR** | `expo-linking` **ya instalado** + `scheme: "kobrax"` **ya declarado** en `app.json`. Cero config nueva |
| Código de verificación, si S4 lo usa | **REUSAR** | `src/otp-input.tsx` (`OtpInput`, del MFA) |
| Sesión, tokens, biometría | **REUSAR** | `src/session.ts`, `src/api-client.ts`, `src/biometric.ts` |
| Tokens visuales | **REUSAR** | `src/theme.ts` — nada hardcodeado |
| `src/account.service.ts` · `src/users.service.ts` | **NUEVO** | services sobre `authedFetch`, uno por recurso, igual que `clients.service.ts` |
| `src/account-form.ts` | **NUEVO** | reducer + validación puros de los formularios de cuenta/perfil/invitación, testeable sin red (patrón `cliente-form.ts`) |
| **Roles visibles + etiquetas en español** | **NUEVO en `packages/shared`** | `MOBILE_ROLES` (los 3 de D2) + `ROLE_LABEL`. Va en shared, **no en el móvil**: la web va a pintar los mismos nombres. Anti-patrón explícito del skill redefinir un enum del dominio en el móvil |
| `routeAfterAuth` | **EXTENDER** | `src/post-login.ts` — sumar las entradas de registro y de invitación aceptada. **Único punto de decisión post-auth; no se agrega un segundo** |

### API — reuso
| Capacidad | Decisión | Path |
|---|---|---|
| Asignación de caso (validación + audit + transacción) | **REUSAR** | `cases.service.assign` — `assign-bulk` la llama en loop dentro de una transacción, **no reimplementa** |
| Hash de token de un solo uso | **REUSAR patrón** | `PasswordResetToken` (`schema.prisma:353`) ya resuelve token+expiración+consumo. `account_invitations` **copia ese patrón**, no inventa otro |
| Envío de correo | **NUEVO, y compartido** | `common/mail/mail.service.ts` — lo consumen invitación, verificación **y `forgot-password`** |

---

## 6. Riesgos y guardas

| # | Riesgo | Guarda |
|---|---|---|
| R1 | **`POST /api/accounts` es público y escribe.** Un bot puede crear tenants en masa | `@RateLimit` por IP (el decorador ya existe) + `User.email @unique` ya rechaza duplicados + `status: TRIAL`. La verificación de email **no** bloquea (D4) |
| R2 | **El link de invitación es una credencial.** Quien lo tenga entra al tenant | Token aleatorio guardado **hasheado** (patrón `PasswordResetToken`), expiración corta, un solo uso (`acceptedAt`), y el `accept` valida que el email coincida |
| R3 | **Un admin se auto-desactiva o se auto-degrada** y el tenant queda sin quién lo administre | El service rechaza si el objetivo es el propio usuario, y rechaza dejar el tenant con cero `ACCOUNT_ADMIN` activos |
| R4 | **`maxUsers` se puede saltar** invitando en paralelo | El conteo y el insert van en la **misma transacción** |
| R5 | **Correo que no llega** (dominio sin verificar, spam) | La invitación queda persistida y la lista muestra "Pendiente" + "Reenviar". El flujo **no depende de que el mail llegue** para ser recuperable |
| R6 | **PII en la lista de miembros** — nombre, email y teléfono del equipo | Son datos del propio tenant, no del deudor: **no aplica** el enmascarado de `clients.serializer.ts`. Sí aplica audit en toda mutación |
| R7 | `client_import_runs` sin RLS (§3.2 · 10) | Se corrige en S0 |

---

## 7. Fuera de alcance (diferido explícito a web)

Sucursales (`Branch` existe y ningún módulo la usa) · jerarquías y `supervisorUserId` · los roles
`MANAGER`/`AUDITOR`/`VIEWER` · `UserPermissionOverride` · `PlanCode` y cualquier matriz de capacidades por
plan · facturación y suscripción · reportes · auditoría consultable (`AuditLog` se escribe y no se lee desde
ninguna UI) · SSO · integraciones · cambio de `maxUsers` desde el producto (hoy se toca en DB).

---

## 8. Reglas de fase

Las 3 del epic §3.3 (sol→contraste · gama baja→perf en UI thread · animación con propósito) + **multi-tenant
por capacidad, nunca por `accountType`/`planCode`** (D6) + **TS estricto sin `any`** + `{data,meta,error}` +
**audit en toda mutación** (alta, cambio de rol, activación, invitación, asignación) + enums y utilidades de
dominio **siempre en `packages/shared`** + **RLS en toda tabla nueva** en la misma migración.

**Excepción a offline-first, y es deliberada:** administrar la cuenta **no** es una acción de campo. Invitar
a un miembro o cambiar un rol **requiere conexión** y las pantallas lo dicen con el `OfflineIndicator` que ya
existe. No se construye cola de sync para esto: se hace en la oficina, con wifi. La regla "nunca bloquear al
cobrador" protege la operación de cobranza, no la administración.

---

## 9. DoD (por slice)

Funcional según el plan del slice · `pnpm --filter @kobrax/mobile type-check` · `test` ·
`npx expo export --platform android` · `pnpm --filter @kobrax/api test` · `/code-review` + `/ponytail-review`
aplicados · **validación visual de la usuaria en emulador/gama baja** (la app no corre headless, ver
[[kobrax-mobile-verify-limits]]) · merge a `main` sólo con todo en verde.

**Rama:** `f10/cuenta-<slice>` (ej. `f10/cuenta-fundacion`).

---

## ⏸️ Pendiente de confirmar — cada una en su slice, ninguna bloquea el arranque

Se contestan **al empezar el slice que las consume**, no antes. S0 y S1 no tienen ninguna.

| # | Pregunta | Bloquea |
|---|---|---|
| ~~Q1~~ | ~~Proveedor de correo~~ → **RESPONDIDA 2026-07-31: SMTP de Gmail.** Ver D1 | ~~S2~~ |
| **Q2** | **Verificación de email en el registro** — D4 la deja **no bloqueante** (el usuario entra y opera, con banner). ¿Se confirma? | S4 |
| **Q3** | **El registro, ¿pide país/moneda?** ¿O es mínimo (email, nombre, contraseña, negocio) y eso se configura después en S1? | S4 |
| **Q4** | **Qué se asigna en el lote** — "cartera" = los **casos** de un cliente. Si tiene 2 créditos con 2 casos, van los dos. ¿Correcto, o se reparte por crédito? | S5 |
| **Q5** | **Recorte de alcance** — ¿entran las 6, o el módulo cierra en S3 y S4/S5 van como tanda aparte? | decidir al terminar S3 |
