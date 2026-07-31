# CUENTA · S2 — Miembros e invitación (incluye S3, aceptar la invitación)

> Consume la fundación de [00-fundacion.md](./00-fundacion.md) y cuelga del hub de
> [S1](./S1-cuenta-perfil.md). Índice y decisiones del módulo: [README.md](./README.md).
>
> **S2 y S3 van en el mismo slice y en la misma rama.** El README ya los daba "pegados": hasta que
> exista la pantalla de aceptar, una invitación enviada no se puede aceptar y el DoD de S2 no se puede
> verificar. Partirlos en dos ramas sería mergear una función que no se puede probar.

## 1. Objetivo

Que el dueño de la cuenta **arme su equipo desde el teléfono**: ver quiénes son, invitar por correo hasta
el techo del plan, cambiarle el rol a uno, activarlo o desactivarlo — y que el invitado **entre solo**,
sin que nadie le cargue una contraseña por SQL.

Cierra además un agujero histórico que no es de este módulo: **el proyecto no envía correo**.
`POST /auth/forgot-password` genera el token y no lo manda a ningún lado desde siempre
(`password.service.ts:52` — `TODO(F8)`). El `mail.service` que necesita la invitación lo arregla en la
misma pasada, porque es el mismo agujero y no dos.

## 2. Rama

`f10/cuenta-s2` (sale de `f10/cuenta-s4`, que todavía no está en `main`).

## 3. Build

🟢 — Expo Go. **Cero dependencias nuevas en el móvil.** Una en la API: `nodemailer` (D1 del README, Q1).

## 4. Respuestas a las preguntas abiertas

| # | Pregunta | Respuesta (confirmada 2026-07-31) |
|---|---|---|
| **Q1** | Proveedor de correo | **SMTP de Gmail** con contraseña de aplicación → entra `nodemailer` |
| **S2-Q1** | ¿Cómo entra el invitado desde el correo? | **Las dos: link `kobrax://` + código de respaldo escrito abajo.** Ver S2-D3 |
| **S2-Q2** | ¿Hay credenciales SMTP para el smoke? | **Sí**, las carga la usuaria en el `.env` de la raíz |

## 5. Pantallas

**Sin Figma.** Parity con lo ya construido: `Header` + `ListRow` + `SectionLabel` de `ui.tsx`, mismo
esqueleto que `cuenta/index.tsx` y `cuenta/datos.tsx`, que ya están validados en el teléfono.

| Pantalla | Ruta | Qué tiene |
|---|---|---|
| Miembros | `app/cuenta/miembros.tsx` | Contador "3 de 5" · lista de miembros (nombre · rol · badge de estado) · botón "Invitar" |
| Detalle del miembro | `app/cuenta/miembro/[id].tsx` | Datos · selector de rol · activar/desactivar · "Reenviar invitación" y "Eliminar" **sólo si está pendiente** |
| Invitar | `app/cuenta/invitar.tsx` | Nombre · apellido · correo · rol · botón "Enviar invitación" |
| **Aceptar invitación (S3)** | `app/(auth)/invitacion.tsx` | Código (o el que trajo el link) · contraseña + `PasswordChecklist` · entra de una |

**Entradas:**
- La fila **"Miembros"** de `cuenta/index.tsx:68` ya existe con `onPress={undefined}` y el subtítulo
  "próximamente" (S1-R4). Se le cablea la ruta y se le saca el texto. **No se agrega una fila nueva.**
- Un `TextLink` **"Tengo una invitación"** en `login.tsx`, al lado del de "Crear una cuenta" que dejó S4.
- El deep link `kobrax://invitacion?c=<código>` cae **solo** en `app/(auth)/invitacion.tsx`: expo-router
  mapea la ruta por archivo y el grupo `(auth)` es transparente en la URL. `scheme: "kobrax"` ya está en
  `app.json`. **Cero configuración de linking.**

## 6. Contrato

### Nuevo — API

| Endpoint | Guard | Qué hace |
|---|---|---|
| `POST /api/users/invite` | `USER_INVITE` | Crea el miembro en estado pendiente + token + manda el correo |
| `POST /api/users/:id/invite/resend` | `USER_INVITE` | Token nuevo (invalida el anterior) + correo. Sólo si está pendiente |
| `DELETE /api/users/:id` | `USER_WRITE` | Cancela la invitación. **Sólo si está pendiente** (S2-D5) |
| `GET /api/auth/invitation/:code` | **público**, `@RateLimit` | Pinta la pantalla: `{ email, firstName, businessName }` |
| `POST /api/auth/invitation/:code/accept` | **público**, `@RateLimit` | Fija la contraseña y activa al usuario |

```
POST /users/invite  → { firstName, lastName, email, roleId }
201 → el miembro serializado (mismo shape que GET /users)
409 → el correo ya está registrado          422 → se llegó al techo de maxUsers
```

`GET /users`, `PATCH /users/:id` (rol · `isActive`) y `GET /roles` **ya existen desde S0** y no se tocan:
la lista, el cambio de rol, el activar/desactivar y sus guardas (no editarse a sí mismo, no dejar el
tenant sin administrador) ya están construidos y testeados (`users.service.ts:48`).

### Ya existe — se reusa tal cual

| Capacidad | Dónde |
|---|---|
| Lista de miembros con `userStatus` ya serializado | `users.serializer.ts:27` → el badge "Pendiente" sale **sin backend nuevo** |
| Cambio de rol / activar / desactivar + sus dos guardas | `users.service.ts:48` (S0) |
| Roles del móvil y su validación de servidor | `MOBILE_ROLES` / `isMobileRole` / `ROLE_LABEL` de `@kobrax/shared` |
| Token de un solo uso: hash SHA-256, expiración, consumo | `PasswordResetToken` + `password.service.ts` (S2-D2) |
| Política de contraseña | `isPasswordValid` / `checkPassword` de `@kobrax/shared` |
| Guards opt-in por endpoint (público = omitirlos) | `auth.controller.ts` |
| Rate limiting | `@RateLimit` (`common/decorators/rate-limit.decorator.ts`) |
| Audit de las mutaciones | `AuditService.record()` — acá **sí** hay contexto de request en todo lo autenticado |
| Login posterior a aceptar, con MFA y empresa | `authService.login()` + `goToStep()` (igual que S4-D1) |

## 7. Decisiones del slice

### S2-D1. `mail.service.ts`: un archivo, un transport, un `sendMail`
`common/mail/mail.service.ts` con `nodemailer`. Sin cola, sin reintentos, sin motor de plantillas: dos
funciones que arman un `string` (invitación y reset) y un `transporter` de Gmail. Env nuevas y
**opcionales** en `env.validation.ts`: `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`.

**Sin credenciales configuradas, loguea el correo en vez de enviarlo** — es exactamente lo que ya hace
`forgot-password` en dev (`password.service.ts:50`), así que el módulo entero se puede construir y probar
sin tocar el `.env`, y los tests no mandan correo nunca.

**Root cause, no síntoma:** `PasswordService.forgotPassword` pasa a usar el mismo servicio en la misma
tarea. Arreglar sólo la invitación dejaría el reset de contraseña roto, que es como está hoy.

`ponytail:` techo conocido y aceptado — Gmail limita ~500 envíos/día y puede marcar spam. Cuando moleste
se cambia el transport, que es el único lugar del código que sabe cómo se envía. **No se construye una
cola ni un reintento**: si el envío falla, el miembro queda creado en estado pendiente y la pantalla
ofrece "Reenviar" (README R5).

### S2-D2. **No hay tabla `account_invitations`.** El invitado es un `User` pendiente + un token de los que ya existen
El README (§3.2 · 5) preveía una tabla nueva con su migración y su policy RLS. No hace falta, y evitarla
borra la mitad del slice:

`POST /users/invite` crea, en una transacción, lo mismo que crea el registro público de S4 —
`User` (**`status: PENDING`**) + `Profile` + `UserAccount` con el rol elegido — y un `PasswordResetToken`
con vida de 7 días. Aceptar la invitación es fijar la contraseña, poner `status: ACTIVE` y consumir el
token.

Lo que sale gratis por no inventar una tabla:

- **La lista de miembros no cambia**: `GET /users` ya devuelve al pendiente con `userStatus: 'PENDING'`
  (`users.serializer.ts:27`) → el badge se pinta con el `StatusBadge` que ya está. Con tabla aparte habría
  que mezclar dos fuentes en la lista y en el conteo.
- **El techo de `maxUsers` se cuenta sobre `user_accounts`**, una sola tabla: un asiento reservado por una
  invitación pendiente **está ocupado**, que es la respuesta correcta.
- **Cero migración, cero policy RLS, cero modelo nuevo, cero servicio de tokens nuevo.**
- El pendiente **no puede entrar**: `login()` corta con `status !== 'ACTIVE'` (`auth.service.ts:77`) y el
  `passwordHash` es un centinela contra el que `bcrypt.compare` siempre falla.

Techos conocidos y aceptados:
1. El correo invitado queda tomado por el `@unique` de `users.email`: si esa persona intenta el registro
   público en vez de aceptar, recibe el 409. La salida es el "Reenviar" de la lista, o el **eliminar** de
   S2-D5 si el correo estaba mal escrito.
2. `PasswordResetToken` pasa a servir dos propósitos. Se documenta en el modelo. Si alguna vez hay que
   distinguirlos, es una columna `purpose`, no una tabla — pero hoy las dos ramas hacen literalmente lo
   mismo: probar que sos dueño de ese correo y fijar una contraseña.

### S2-D3. Un solo secreto que sirve **de link y de código escrito a mano**
S2-Q1 pidió las dos formas. **No son dos tokens: es el mismo.** Se genera un código de 10 caracteres en
base32 sin ambigüedades (sin `I`, `L`, `O`, `U`), se guarda **hasheado** con el mismo SHA-256 de
`password.service.ts:27`, y se muestra agrupado `XXXXX-XXXXX`. El correo lleva:

```
  [ Aceptar invitación ]   → kobrax://invitacion?c=K7F29-QX3TM
  o abrí Kobrax y escribí este código:  K7F29-QX3TM
```

`ponytail:` un token largo para el link **más** un código corto para tipear serían dos secretos, dos
columnas y dos caminos de validación para el mismo permiso. Uno solo, que se puede tipear, cubre ambos.
50 bits de entropía, expiración de 7 días, un solo uso y `@RateLimit` en los dos endpoints públicos: la
fuerza bruta no es un camino. Los guiones y el case se normalizan al validar, así que da igual cómo lo
escriban.

**El link es el camino frágil y se sabe:** con Expo Go el esquema es `exp://` y desde Gmail un
`kobrax://` puede no abrir nada. Por eso el código va escrito abajo en el mismo correo y la pantalla se
alcanza también desde el login. Cuando exista un dominio y la web, `APP_URL/invitacion?c=` redirige al
mismo lugar sin tocar la app.

### S2-D4. El que invita pone el nombre; el invitado pone su contraseña
`Profile.firstName` y `lastName` son `NOT NULL` (`schema.prisma:174`), así que alguien tiene que ponerlos.
Los pone quien invita — y la lista de miembros muestra "Juan Pérez · Pendiente" desde el minuto cero en
vez de un correo suelto. El invitado sólo elige contraseña; su nombre y su teléfono los corrige después
en `cuenta/perfil.tsx`, que **ya existe y está validado**.

### S2-D5. Cancelar una invitación es **borrar** al pendiente, no desactivarlo
Un correo mal escrito quema un asiento del plan **y** deja ese correo tomado para siempre por el
`@unique`. Desactivar no lo libera. `DELETE /users/:id` borra `UserAccount` + `Profile` + `User` en una
transacción, y **sólo** si `status === 'PENDING'`; contra un miembro que ya entró devuelve 409 y el camino
sigue siendo desactivarlo (que ya existe desde S0). Un pendiente no tiene datos colgando: nunca escribió
un caso, un pago ni una fila de audit.

### S2-D6. `maxUsers` se cuenta y se inserta **en la misma transacción**
Es la única guarda de plan del producto (README D3) y hoy la columna no se lee en ningún archivo. Contar
antes y crear después, en dos queries sueltas, es una carrera que dos invitaciones simultáneas ganan
(README R4). El conteo va adentro del `withTenant` junto al insert.

### S2-D7. El correo del invitado se manda **después** de commitear la transacción
Si el SMTP tarda o falla adentro del `$transaction`, se cae la creación entera del miembro por algo que
no es la base. Primero se persiste, después se envía; si el envío falla, se loguea y el miembro queda
pendiente con su botón de "Reenviar". Es la misma tolerancia que ya declara README R5.

### S2-D8. Aceptar la invitación **no emite tokens**: el móvil hace login normal justo después
Idéntico a S4-D1, y por lo mismo: hereda gratis MFA obligatorio, selección de empresa y
`requiresPasswordChange`. La pantalla llama a `authService.login()` con el correo que devolvió el `GET` y
la contraseña recién elegida, y pasa por `goToStep()`.

## 8. Auditoría de reuso

| Capacidad | Decisión | Path |
|---|---|---|
| Chrome, filas, badges, secciones, vacíos | **REUSAR** | `src/ui.tsx` → `Header`, `ListRow`, `StatusBadge`, `SectionLabel`, `EmptyState` |
| **Fila de miembro** | **REUSAR sin tocar** | `ListRow` con `right={<StatusBadge/>}`. **No se escribe un `MemberRow`** |
| Selector de rol | **REUSAR** | `SelectRow` + `PickerSheet` — ya subieron a `src/ui.tsx:534` (los usa `cuenta/datos.tsx`) |
| Inputs, botón, error, enlace, checklist de contraseña | **REUSAR** | `src/components.tsx` → `Field`, `Button`, `ErrorBanner`, `TextLink`, `PasswordChecklist` |
| Etiquetas de rol y roles visibles | **REUSAR** | `ROLE_LABEL` / `MOBILE_ROLES` de `@kobrax/shared`. **El servidor manda `roleName` crudo** (regla del review de S0) |
| Login posterior + ruteo por paso | **REUSAR** | `src/auth-service.ts` → `login()` · `src/route-step.ts` → `goToStep()` |
| Red, envelope, 401, offline | **REUSAR** | `src/api-client.ts` (`apiQuery`/`apiMutate`) · `src/api.ts` (`apiFetch`) **para lo público** — la trampa que documentó S4 §12.2 |
| Validación pura del formulario | **EXTENDER** | `src/account-form.ts` → `validateInvite()`. Ya tiene su test; **no un archivo nuevo** |
| Miembros en el service del móvil | **NUEVO** | `src/users.service.ts` — recurso distinto de `account.service.ts`, archivo propio (igual que `clients.service.ts`) |
| Deep link | **REUSAR** | `expo-linking` ya instalado, `scheme: "kobrax"` ya declarado. **Cero config** |
| Tokens visuales | **REUSAR** | `src/theme.ts` |
| Token de un solo uso (hash, expiración, consumo, invalidar pendientes) | **REUSAR** | `PasswordResetToken` + los helpers de `password.service.ts` (S2-D2) |
| Envío de correo | **NUEVO, y compartido** | `common/mail/mail.service.ts` — lo usan la invitación **y `forgot-password`** |

**Una dependencia nueva (`nodemailer`, en la API). Ninguna tabla nueva. Ninguna migración.**

## 9. Tareas

1. **API** — `common/mail/mail.service.ts` + las 3 env opcionales en `env.validation.ts`. Sin credenciales
   → loguea. Test: arma el cuerpo con el código y no explota sin env.
2. **API** — `PasswordService.forgotPassword` pasa a enviar por el service nuevo (S2-D1, root cause).
3. **API** — `UsersService.invite()`: transacción con el conteo de `maxUsers` adentro (S2-D6), las 4
   entidades + el token, audit, y el correo **después** del commit (S2-D7). `resend()` y `remove()`.
4. **API** — `AuthService`/`PasswordService`: `getInvitation(code)` y `acceptInvitation(code, password)`.
   Normalizar guiones y mayúsculas del código.
5. **API** — controllers: 3 métodos en `users.controller.ts` (con `@Roles`), 2 públicos con `@RateLimit`
   en `auth.controller.ts`.
6. **API** — tests: techo de `maxUsers` → 422 · correo duplicado → 409 · el pendiente **no puede loguear**
   · código inválido/expirado/ya usado → error · aceptar deja `ACTIVE` y `requiresPasswordChange: false`
   · `DELETE` contra un miembro activo → 409 · audit en invitar, reenviar y borrar.
7. **Móvil** — `src/users.service.ts` + `validateInvite()` en `account-form.ts` + sus tests.
8. **Móvil** — `miembros.tsx`, `miembro/[id].tsx`, `invitar.tsx` + cablear la fila de `cuenta/index.tsx`.
9. **Móvil** — `app/(auth)/invitacion.tsx` (S3) + el `TextLink` en `login.tsx`.
10. Verificación (§11).

**Orden:** la API completa primero, con el test del techo de `maxUsers` temprano (es lo único que puede
fallar de una forma que no se ve leyendo el código). El correo real se prueba al final, con el smoke.

## 10. Reglas de fase

Las 3 del epic §3.3 + las del README §8, y las de este slice:

- **Los dos endpoints públicos son frontera de confianza**: DTO validado, `@RateLimit`, y el código
  **siempre** comparado por su hash — nunca en claro, nunca por `LIKE`.
- **El servidor manda `roleName`, nunca `roleLabel`** (regla del review de S0).
- **Audit en toda mutación**: invitar, reenviar, cambiar rol, activar/desactivar, borrar. Acá sí hay
  contexto de request, así que va por `AuditService` — la excepción de S4-D7 no aplica.
- **Gating por capacidad** (`can('user:invite')`), nunca por `accountType` ni `planCode` (README D6).
- **Administrar la cuenta requiere conexión** y la pantalla lo dice (README §8). **No se construye cola de
  sync** para invitar a un miembro.
- **El correo nunca se manda desde un test.** Sin env, el service loguea.

## 11. DoD

- Desde "Mi cuenta → Miembros" se invita a un correo real, **llega el mail**, y desde otro teléfono (o
  reinstalando) se acepta con el código y la persona **queda adentro** de la cuenta correcta.
- El invitado aparece "Pendiente" en la lista apenas se manda, y pasa a activo al aceptar.
- Al llegar a 5 miembros, invitar al sexto muestra el mensaje del techo, no un error genérico.
- Cambiar el rol de un miembro y desactivarlo funciona; **auto-desactivarse no** (guarda de S0).
- Un correo mal escrito se puede eliminar y volver a invitar al correo correcto.
- `forgot-password` **ahora manda el correo** (el agujero histórico, cerrado).
- `pnpm --filter @kobrax/api test` — base en `f10/cuenta-s4`: **365 pass**.
- `pnpm --filter @kobrax/mobile type-check` · `test` — base en `f10/cuenta-s4`: **180 pass**.
- `npx expo export --platform android`.
- `/code-review` + `/ponytail-review`.
- **Validación visual de la usuaria** en el teléfono ([[kobrax-mobile-verify-limits]]).

## 12. Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| S2-R1 | **El correo no llega** (Gmail lo marca spam, contraseña de aplicación mal cargada) | El miembro queda creado y pendiente; la lista ofrece "Reenviar" y el código se puede dictar por teléfono. El flujo **no depende de que el mail llegue** (README R5) |
| S2-R2 | **El link `kobrax://` no abre** desde Gmail o en Expo Go | S2-D3: el código escrito y la entrada desde el login son el camino principal, no el respaldo |
| S2-R3 | **El código es una credencial**: quien lo tenga entra al tenant | Hasheado en base, 50 bits, 7 días, un solo uso, `@RateLimit` en los dos endpoints públicos |
| S2-R4 | **Dos invitaciones simultáneas se saltan `maxUsers`** | S2-D6: conteo e insert en la misma transacción |
| S2-R5 | **Correo invitado = correo tomado** aunque nunca acepte | S2-D5: el borrado del pendiente lo libera. Techo documentado en S2-D2 |
| S2-R6 | El SMTP cuelga y se lleva puesta la creación del miembro | S2-D7: se envía **después** del commit |
| S2-R7 | Reusar `PasswordResetToken` mezcla dos flujos | Los dos hacen lo mismo (probar el correo + fijar contraseña). Un token de invitación usado en `reset-password` fija la contraseña pero **no activa**: el usuario sigue sin poder entrar hasta aceptar. Se cubre con test |
