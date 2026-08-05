# CUENTA · S4 — Registro público (self-signup)

> Slice independiente: no depende de S2 ni de S3. Consume la fundación de
> [00-fundacion.md](./00-fundacion.md) y aterriza en las pantallas de [S1](./S1-cuenta-perfil.md).
> Índice y decisiones del módulo: [README.md](./README.md).

## 1. Objetivo

Que un cobrador independiente se dé de alta **solo, desde el teléfono, sin que nadie le cargue nada por
SQL**. Hoy la pantalla de login no tiene por dónde crear una cuenta: el único camino al producto es
`seed.ts` o un `INSERT` a mano (README §3.2 · 8). Este slice cierra ese agujero.

Alcance: `POST /api/accounts` público + `app/(auth)/registro.tsx` + el enlace desde el login.

## 2. Rama

`f10/cuenta-s4` (sale de `f10/cuenta-s1`, que todavía no está en `main`).

## 3. Build

🟢 — Expo Go. **Cero dependencias nuevas** en móvil y API.

## 4. Respuestas a las preguntas abiertas del README

| # | Pregunta | Respuesta (confirmada 2026-07-31) |
|---|---|---|
| **Q2** | ¿La verificación de email bloquea el primer uso? | **No bloquea.** Y ver S4-D4: en S4 tampoco se manda nada. |
| **Q3** | ¿El registro pide país/moneda? | **No — mínimo.** Email, nombre, apellido, contraseña y nombre del negocio. |

## 5. Pantallas

**Sin Figma** (el módulo no tiene diseño). Parity con `app/(auth)/login.tsx`: mismo header navy con la
marca, mismo cuerpo redondeado superpuesto, mismos `Field`/`Button`/`ErrorBanner`.

| Pantalla | Ruta | Qué tiene |
|---|---|---|
| Crear cuenta | `app/(auth)/registro.tsx` | Nombre del negocio · nombre · apellido · email · contraseña (+ `PasswordChecklist`) · botón · enlace "Ya tengo cuenta" |

**Entrada:** un `TextLink` **"Crear una cuenta"** en `login.tsx`, debajo de "¿Olvidaste tu contraseña?"
(`login.tsx:88`). Es el mismo componente que ya está ahí; no se inventa un botón nuevo.

## 6. Contrato

### Nuevo — API

`POST /api/accounts` · **público** (sin `JwtAuthGuard`) · `@RateLimit({ limit: 3, windowSec: 3600, by: 'ip' })`

```
body → { businessName, firstName, lastName, email, password }
201  → { data: { accountId, email }, meta, error: null }
409  → email ya registrado (código AUTH_EMAIL_TAKEN)
```

Crea en **una sola transacción**: `Account` + `User` + `Profile` + `UserAccount`.

| Entidad | Valores que se fijan | Por qué |
|---|---|---|
| `Account` | `accountType: INDEPENDENT` · `status: TRIAL` · `planCode: STARTER` · `maxUsers: 5` · `countryCode: 'BO'` · `currencyCode: 'BOB'` | Q3: mínimo. Los defaults se cambian después en `cuenta/datos.tsx`, que **ya funciona** (S1) |
| `User` | `status: ACTIVE` · `requiresPasswordChange: false` | ⚠️ **hay que pisar los dos defaults del schema** — ver S4-D6 |
| `Profile` | `firstName`, `lastName` | — |
| `UserAccount` | `isOwner: true` · `isDefault: true` · `isActive: true` · rol `ACCOUNT_ADMIN` | El `roleId` se busca por `name` en `roles` (tabla global, sin RLS) |

**El endpoint no emite tokens** — ver S4-D1.

### Ya existe — se reusa tal cual

| Capacidad | Dónde |
|---|---|
| Guards opt-in por endpoint (un endpoint público simplemente los omite) | `auth.controller.ts` — **no hace falta un `@Public`** |
| Rate limiting | `common/decorators/rate-limit.decorator.ts` — ya lo usan login y forgot-password |
| Hash de contraseña | `bcrypt` + `KOBRAX.BCRYPT_WORK_FACTOR` (el mismo que usa `auth.service`) |
| Política de contraseña | `checkPassword` / `isPasswordValid` de `@kobrax/shared` |
| Toda la máquina de login (MFA, empresa, tokens) | `POST /auth/login` → `goToStep()` (S4-D1) |

## 7. Decisiones del slice

### S4-D1. El registro **no emite tokens**: el móvil hace login normal justo después
El endpoint devuelve 201 y listo. La pantalla llama a `authService.login(email, password)` con lo que ya
tiene en el formulario y pasa el resultado por `goToStep()`, igual que `login.tsx:39`.

`ponytail:` es la diferencia entre **cero líneas** de emisión de tokens y duplicar `issueTokens` (que es
privado en `AuthService`), su sesión, su refresh y su rama de MFA. Además hereda gratis toda la máquina de
estados: MFA obligatorio, selección de empresa, `requiresPasswordChange`. **No se extiende
`routeAfterAuth`** — el README lo daba por hecho y no hace falta. Techo conocido: son dos requests en vez
de una; si alguna vez molesta, el endpoint puede devolver los tokens sin cambiar la pantalla.

### S4-D2. La cuenta se crea **dentro de su propio contexto RLS**, con el id generado en la app
`accounts` tiene `FORCE ROW LEVEL SECURITY` y la policy `tenant_self` exige
`WITH CHECK (id = app_current_account())` (`rls/001_enable_rls.sql:61`). La API corre como `kobrax_app`,
que es `NOBYPASSRLS` → **un `INSERT` sin contexto es rechazado por la base**. Es el riesgo central del
slice y tiene solución de una línea:

```ts
const accountId = randomUUID();
await this.prisma.withTenant(accountId, async (tx) => { /* create account con id explícito, luego el resto */ });
```

`user_accounts` cae bajo la misma policy y el mismo contexto. `users`, `profiles` y `roles` son **tablas
globales sin RLS** (`001_enable_rls.sql:74-77`) → se escriben sin ceremonia.

**No se toca el SQL de RLS, no se agrega `BYPASSRLS`, no se abre una excepción.** El endpoint público
sigue siendo tan preso de la RLS como el resto de la API.

### S4-D3. `POST` público y `GET/PATCH` autenticados **conviven en el mismo controller**
`AccountsController` tiene hoy `@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)` **a nivel de clase**
(`accounts.controller.ts:11`). Se bajan los guards a los dos métodos que ya existen y el `@Post()` nuevo
queda sin ellos. Diff: dos líneas movidas.

`ponytail:` un `accounts-public.controller.ts` aparte sería un archivo, un provider más en el módulo y una
segunda ruta `accounts` que confunde al leer. **Un controller por recurso.**

### S4-D4. **No se manda ningún correo, y tampoco se pinta el banner de "verificá tu email"**
Q2 dice que la verificación no bloquea. El README (D4) además preveía un banner recordando verificar —
pero `mail.service` se construye en **S2** y hoy no existe: un banner que pide verificar un mail que
nunca se envió es una mentira en la UI y una pantalla muerta que hay que mantener.

`ponytail:` el banner y el envío entran **juntos, en S2**, o no entran. Techo conocido y aceptado: entre
S4 y S2 hay cuentas con email sin verificar, que es exactamente lo que Q2 eligió.

### S4-D5. El dueño recién registrado **cae en el enrolamiento obligatorio de MFA**, y se deja así
`ACCOUNT_ADMIN` está en `CRITICAL_ROLES` (`auth.service.ts:46`) → el login inmediatamente posterior
devuelve `step: 'mfa_setup'` (`auth.service.ts:104`) y la app aterriza en `app/(auth)/mfa-setup.tsx`, que
**ya existe y funciona**.

Es fricción real justo en el primer minuto del usuario, y se acepta a conciencia: es una regla de
seguridad del producto que ya está tomada, no algo que invente este slice. Cambiarla es una decisión de
seguridad, no una de registro — y no se toca acá.

### S4-D6. Hay que **pisar dos defaults del schema**, y equivocarse rompe el registro en silencio
- `User.status` default es `PENDING` (`schema.prisma:149`) y `login()` corta con
  `status !== 'ACTIVE'` devolviendo **`invalidCredentials`** (`auth.service.ts:77`) → el usuario se
  registra y su propia contraseña le dice "credenciales inválidas". → `status: ACTIVE`.
- `User.requiresPasswordChange` default es `true` (`schema.prisma:146`) y `routeAfterAuth` lo manda a
  `force-password-change` (`post-login.ts:27`) → recién registrado, le piden cambiar la contraseña que
  acaba de elegir. → `requiresPasswordChange: false`.

Ambos van cubiertos por test de API.

### S4-D7. El audit **no pasa por `AuditService`** — se escribe en la misma transacción
`AuditService.record()` toma `accountId`/`userId`/`ip` del `TenantContextService` y, si no hay contexto,
**sale por un `return` silencioso** (`audit.service.ts:35`). Un endpoint público no tiene contexto → llamarlo
desde acá no audita nada y no avisa. Sería un no-negociable roto de la peor forma: en silencio.

La fila va con `tx.auditLog.create()` **dentro del mismo `withTenant(accountId)`** que crea las 4 entidades
(`audit_logs` está en el array RLS de `001_enable_rls.sql:27`, así que el contexto ya es el correcto), con
`userId` = el usuario recién creado, y `ip`/`userAgent` del request como ya los saca
`auth.controller.ts` → `meta(req)`.

`ponytail:` **no se toca `AuditService`** para que acepte un contexto explícito: es un llamador excepcional
(el único sin sesión) y agrandarle la firma al servicio que usan todos los módulos por un caso es la
abstracción especulativa clásica. Techo conocido: si aparece un segundo endpoint público que muta, ahí sí
se le agrega el parámetro. Se cubre con test (tarea 3).

### S4-D8. País y moneda arrancan en **Bolivia / BOB**, no en un selector
Q3 eligió mínimo. `Account.countryCode` y `currencyCode` son `NOT NULL`, así que algo hay que poner: el
mercado inicial. La pantalla de S1 ya deja cambiarlos y es un selector que **ya está construido y
validado en el teléfono** — construir un segundo selector en el registro sería duplicarlo para ahorrarle
al usuario un viaje que va a hacer igual cuando configure su negocio.

## 8. Auditoría de reuso

| Capacidad | Decisión | Path |
|---|---|---|
| Chrome del formulario de auth (header navy, cuerpo redondeado) | **REUSAR patrón** | `app/(auth)/login.tsx` — mismos estilos, misma estructura |
| Inputs, botón, banner de error, enlace | **REUSAR** | `src/components.tsx` → `Field`, `Button`, `ErrorBanner`, `TextLink` |
| **Requisitos de contraseña** | **REUSAR** | `src/components.tsx` → `PasswordChecklist` (ya lo usa `force-password-change.tsx`) + `checkPassword`/`isPasswordValid` de `@kobrax/shared`. **Cero validación de contraseña nueva** |
| Login posterior + ruteo por paso | **REUSAR** | `src/auth-service.ts` → `login()` · `src/route-step.ts` → `goToStep()` (S4-D1) |
| Enrolamiento de MFA del dueño | **REUSAR sin tocar** | `app/(auth)/mfa-setup.tsx` (S4-D5) |
| Red, envelope, errores de la API | **REUSAR** | `src/api-client.ts` |
| Tokens visuales | **REUSAR** | `src/theme.ts` — nada hardcodeado |
| Validación pura del formulario | **EXTENDER** | `src/account-form.ts` (lo creó S1) — se le suma `validateSignup()`. **No un archivo nuevo**: es el mismo dominio y ya tiene su test |
| Registro en el service del móvil | **EXTENDER** | `src/account.service.ts` (lo creó S1) — se le suma `signup()`. Mismo recurso, mismo archivo |
| Creación del tenant | **NUEVO** | `accounts.service.ts` → `create()` + `dto/create-account.dto.ts` |

**Cero dependencias nuevas. Un endpoint nuevo. Ningún archivo nuevo en `src/` del móvil.**

## 9. Tareas

1. **API** — `CreateAccountDto` (`class-validator`: email, longitudes, `isPasswordValid`).
2. **API** — `AccountsService.create()`: `randomUUID()` + `withTenant` + las 4 entidades **y la fila de
   audit** (S4-D7) en una transacción. Bajar los guards de clase a método y sumar el `@Post()` con
   `@RateLimit`.
3. **API** — tests: crea las 4 entidades · email duplicado → 409 · `status ACTIVE` y
   `requiresPasswordChange false` (S4-D6) · el `INSERT` pasa la RLS (S4-D2) · **queda la fila en
   `audit_logs`** (S4-D7) · contraseña débil → 400.
4. **Móvil** — `validateSignup()` en `src/account-form.ts` + su test.
5. **Móvil** — `signup()` en `src/account.service.ts`.
6. **Móvil** — `app/(auth)/registro.tsx` + el `TextLink` en `login.tsx`.
7. Verificación (§11).

**Orden:** la API primero y con el test de RLS temprano — S4-D2 es lo único de este slice que puede
fallar de una forma que no se ve leyendo el código.

## 10. Reglas de fase

Las 3 del epic §3.3 + las del README §8, y las de este slice:

- **Nada de `BYPASSRLS` ni excepciones a la RLS** (S4-D2). Si el `INSERT` no pasa, se arregla el
  contexto, no la policy.
- **El endpoint es público: la validación del DTO es la única frontera de confianza.** Longitudes,
  formato de email y política de contraseña se validan en el servidor, no solo en la pantalla.
- **Audit en la creación** — es una mutación, y encima sin sesión. Pero **no vía `AuditService`**, que
  no-opea sin contexto (S4-D7).
- **Sin red no se puede registrar, y la pantalla lo dice.** Misma excepción deliberada a offline-first que
  el resto del módulo (README §8, S1-D5). **No se construye cola de sync** para dar de alta un tenant.
  Corrección sobre la primera versión de este plan: **no se usa `OfflineIndicator`**. Ese banner sólo se
  monta sobre las tabs y `subscribeConnectivity()` se llama en el shell de tabs, así que en el stack de
  auth el store queda en su default optimista (`isConnected: true`) y el banner mentiría. El estado real
  lo da el `status: 0` de `apiFetch` al intentar: el mensaje "Sin conexión" aparece cuando de verdad lo
  está. Suscribir NetInfo en el stack de auth para adelantar el aviso un segundo no vale el cable.
- Gating por capacidad, nunca por `accountType`/`planCode` (README D6). `INDEPENDENT` se guarda porque la
  columna es `NOT NULL`; **nada ramifica por ese valor**.

## 11. DoD

- Desde el login se llega a "Crear una cuenta", se completa y **la app queda adentro** (vía `mfa_setup`,
  S4-D5) sin tocar la base a mano.
- La cuenta nueva ve sus propios datos en `cuenta/datos.tsx` y **no ve nada del tenant DEMO** (RLS).
- Email repetido muestra el mensaje del 409, no un error genérico.
- Contraseña débil: el checklist lo marca antes de enviar, y el servidor también la rechaza.
- `pnpm --filter @kobrax/api test` — **base medida en `f10/cuenta-s1` el 31/07: 357 pass / 99 suites**.
- `pnpm --filter @kobrax/mobile type-check` · `test` — **base medida el 31/07: 176 pass / 20 suites**.
  ⚠️ No confundir con los 361/166 de `f10/rutas-s3-preview` ni con los 343 de `main`.
- `npx expo export --platform android`.
- `/code-review` + `/ponytail-review`.
- **Validación visual de la usuaria** en el teléfono ([[kobrax-mobile-verify-limits]]).

## 12. Cómo quedó (construido 2026-07-31)

Tres cosas salieron distinto de lo planeado, todas hacia menos código:

1. **La pantalla usa `Hero` + `Card`**, el chrome que ya comparten `forgot-password`, `mfa` y
   `force-password-change` — no una copia del `StyleSheet` de 60 líneas de `login.tsx`. §5 decía "parity
   con login"; la parity real de una pantalla secundaria de auth es ésa, y sale gratis.
2. **`signup()` va por `apiFetch`, no por `apiMutate`.** `apiMutate` pasa por `authedFetch`, que sin
   sesión local corta con `unauthenticated` **antes de salir a la red** — exactamente el estado de quien
   se está registrando. La tabla de reuso de §8 decía "api-client" sin distinguir; el primitivo correcto
   es el de `api.ts`.
3. **Tipo propio `SignupResult`** en vez de `MutateResult`: éste incluye `unauthenticated`, un estado
   imposible acá. `tsc` lo cazó al usar `res.message`.

Sin pre-chequeo de email duplicado: el `@unique` de `users.email` es la guarda real (correcta también
con dos registros simultáneos) y el `P2002` se mapea al 409. Un `findUnique` previo habría sido una
carrera con mejor cara.

## 13. Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| S4-R1 | **La RLS rechaza el `INSERT` en `accounts`** — la API es `NOBYPASSRLS` y la policy exige contexto | S4-D2: id generado en la app + `withTenant`. Es la tarea 2 y tiene test propio (tarea 3) justamente porque no se ve leyendo el código |
| S4-R2 | **Endpoint público que escribe** → alta masiva de tenants por un bot | `@RateLimit` por IP (3/hora) + `User.email @unique` + `status: TRIAL`. README R1 |
| S4-R3 | Se olvidan los defaults de `User` → el usuario no puede entrar con su propia contraseña, y el error dice "credenciales inválidas" | S4-D6, con test |
| S4-R4 | Registro exitoso pero el `login()` posterior falla (red que se cae en el medio) | La cuenta **ya está creada**: la pantalla muestra el error y ofrece "Ir a iniciar sesión" en vez de reintentar el alta y chocar con el 409 |
| S4-R5 | El enrolamiento de MFA justo después de registrarse se lee como un bug | S4-D5: es la regla de roles críticos, ya construida. Se documenta, no se parchea acá |
