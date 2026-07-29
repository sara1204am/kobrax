# CUENTA · S0 — Fundación backend

> Slice **sin pantalla**. Deja en la API lo que S1 (datos de cuenta + perfil) y S2 (miembros) consumen.
> Índice y decisiones del módulo: [README.md](./README.md).

## 1. Objetivo

Que el tenant y sus miembros sean **legibles y editables por API**. Hoy no existe ningún controller de
`accounts`, `users` ni `roles`: una cuenta sólo se puede tocar por `seed.ts` o SQL a mano.

**Deliberadamente fuera de S0** (viven en S2, ver README §4): invitaciones, envío de correo, y las env
`RESEND_API_KEY`/`MAIL_FROM`. S1 no las necesita y arrastrarlas acá bloquearía el arranque por una decisión
de proveedor sin tomar (Q1).

## 2. Rama

`f10/cuenta-fundacion`

## 3. Build

🟢 — backend puro. No toca nativo, no toca `app.json`, no requiere rebuild del dev build.

## 4. Pantallas

**No aplica: slice sin UI.** El ítem "node-id de Figma" del gate se sustituye por el contrato de §5, que es
lo que S1 va a pintar. (El módulo entero no tiene diseño Figma — README, encabezado.)

## 5. Contrato

### `GET /api/accounts/me` — `ACCOUNT_READ`
Devuelve el tenant de la sesión. `accounts` **tiene RLS** con policy `tenant_self`
(`USING (id = app_current_account())`), así que `withTenant` ya lo acota solo.

```
{ id, businessName, taxId, accountType, status, planCode, countryCode, currencyCode,
  timezone, maxUsers, memberCount }
```

`memberCount` = `user_accounts` activos del tenant. Es lo que S1 pinta como "3 de 5 miembros" y lo que hace
visible el límite **antes** de que S2 lo choque.

### `PATCH /api/accounts/me` — `ACCOUNT_WRITE`
Acepta **sólo**: `businessName`, `taxId`, `countryCode`, `currencyCode`, `timezone`.

**Rechaza por omisión del DTO** (no son configuración del producto): `planCode`, `maxUsers`, `accountType`,
`status`. `maxUsers` se sigue tocando en DB — README §7. **No** se agregan al DTO "por si acaso".

⚠️ El `ValidationPipe` global es `{ whitelist: true, forbidNonWhitelisted: true, transform: true }`
(`main.ts`): un campo no declarado **no se ignora, hace fallar el request con 400**. O sea que el DTO no es
sólo documentación — es la guarda, y alcanza sola. Consecuencia para S1: el formulario tiene que mandar
**exactamente** los 5 campos aceptados; reenviar el objeto completo que devolvió el `GET` es un 400.

`currencyCode` se valida contra `SUPPORTED_CURRENCIES` de shared (las 6 monedas reales), no contra un
`@IsString()`. `countryCode` sale del mismo mapa (ver §7).

### `GET /api/users` — `USER_READ`
Miembros del tenant.

```
[{ userId, email, firstName, lastName, phone, photoUrl, roleId, roleName,
   isOwner, isActive, userStatus, lastLoginAt }]
```

🔴 **La trampa de este slice, y es de seguridad.** `users`, `profiles` y `roles` son **tablas globales sin
RLS** — así lo dice `prisma/rls/001_enable_rls.sql:71-74` y lo repite `auth.service.ts:251`. Un
`tx.user.findMany()` dentro de `withTenant` **devuelve los usuarios de todos los tenants**: la RLS no lo
frena porque esa tabla no tiene policy.

→ La consulta **arranca siempre en `user_accounts`** (que sí tiene RLS) e incluye `user`/`role` desde ahí:

```ts
tx.userAccount.findMany({
  // sin where de tenant: lo pone la RLS. `user_accounts` NO tiene deletedAt
  // (schema.prisma:264-286) — la baja de un miembro es isActive:false, no soft-delete.
  include: { user: { include: { profile: true } }, role: true },
  orderBy: { joinedAt: 'asc' },
})
```

Devuelve **activos e inactivos**: la pantalla de miembros necesita ver al desactivado para poder
reactivarlo. El filtro es de UI, no de query.

### `PATCH /api/users/:id` — `USER_WRITE`
`:id` es el **`userId`**, no el id de `user_accounts`. Acepta `roleId` e `isActive`. Escribe **sólo sobre
`user_accounts`** — la membresía es del tenant; el `User` global no se toca nunca desde acá.

Guardas (R3 del README), las tres en la misma transacción que el update:
- `userId === self` → rechaza. Nadie se auto-desactiva ni se auto-degrada.
- dejar el tenant con **cero `ACCOUNT_ADMIN` activos** → rechaza.
- `roleId` que no esté en `MOBILE_ROLES` → rechaza. El móvil no puede asignar `MANAGER`/`AUDITOR`/`VIEWER`
  aunque mande el id a mano (D2 es una regla de servidor, no una de UI).

### `GET /api/users/me/profile` · `PATCH /api/users/me/profile`
**Sin `@Roles`** — sólo `JwtAuthGuard`. Es el propio perfil; exigir un permiso para editarse el teléfono
dejaría al `COLLECTOR` sin poder hacerlo. `PATCH` acepta `firstName`, `lastName`, `phone`, `photoUrl`.
Escribe en `profiles` filtrando por el `userId` **del token**, nunca por uno del body.

### `GET /api/roles` — `ROLE_READ`
Los **tres** de D2 (`COLLECTOR`, `SUPERVISOR`, `ACCOUNT_ADMIN`) con su `id` real, ordenados por `level` desc.
El selector del móvil necesita ids porque `UserAccount.roleId` es una FK, no un enum.

### Permisos nuevos
`ACCOUNT_READ = 'account:read'` · `ACCOUNT_WRITE = 'account:write'`. Editar el tenant no tiene hoy ningún
permiso con esa semántica (`USER_WRITE` no lo es). Tres archivos: `permission.enum.ts`, `permissions.ts`
(`ROLE_PERMISSIONS` — sólo `ACCOUNT_ADMIN` los recibe; `MANAGER` lee), y el catálogo de `seed.ts:67`.

### RLS
`client_import_runs` **falta** en el array de `prisma/rls/001_enable_rls.sql:25` y tiene `account_id`
(`schema.prisma:395`). Fuga preexistente, no la causa este módulo; se agrega la línea acá porque es la
primera vez que el módulo toca ese archivo. Verificable con `prisma/rls/verify_isolation.sql`.

### Tablas
Ninguna nueva. Lee/escribe `accounts`, `user_accounts`, `profiles`; lee `users`, `roles`.

## 6. Auditoría de reuso

| Capacidad | Decisión | Path |
|---|---|---|
| Forma del módulo (controller delgado → service → serializer → errors → dto) | **REUSAR patrón** | `modules/catalogs/*` — es el módulo más chico y limpio de la API; `accounts` y `users` lo calcan |
| Scoping por tenant | **REUSAR** | `PrismaService.withTenant(this.tenant.accountId, fn)` + `TenantContextService` |
| Stack de guards | **REUSAR** | `@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)` + `@Roles(Permission.X)` |
| Audit de mutaciones | **REUSAR** | `AuditService.record({ entity, entityId, action, before?, after? })` |
| Envelope de respuesta | **REUSAR** | `ResponseDto.ok` / `.paginated` de shared |
| Errores de dominio | **REUSAR patrón** | `catalogs.errors.ts` — factory por error devolviendo la excepción Nest con `{ code, message }` (ej. `CATALOG_NOT_FOUND`), **no** el `MODULO_00N` que lista `apps/api/CLAUDE.md`. Manda el código real |
| Nombre del miembro | **NO se toca `auth`** | `auth.service.me` ya devuelve `profile: { firstName, lastName, photoUrl } \| null` **anidado** (`auth.service.ts:258-270`): no arma ninguna cadena, así que **no hay nada que extraer ni que unificar**. El serializer de users devuelve los campos sueltos igual que `me`, y el móvil compone. `ponytail:` no se refactoriza auth para nada |
| Monedas y países | **REUSAR** | `SUPPORTED_CURRENCIES` de shared — ya trae `locale` (`es-BO`…), de donde sale el país |
| Roles y sus permisos base | **REUSAR** | `RoleType` + `ROLE_PERMISSIONS` de shared. **No se redefine ningún rol** |
| `MOBILE_ROLES` + `ROLE_LABEL` | **NUEVO en `packages/shared`** | los 3 roles de D2 + etiqueta es-LatAm. Va en shared porque lo usan **API** (filtro de `GET /roles` y guarda de `PATCH /users/:id`) **y móvil** (selector). Redefinirlo en el móvil es anti-patrón explícito del skill |
| `modules/accounts/*` · `modules/users/*` | **NUEVO** | no existe ningún controller de cuenta ni de usuarios. Dos módulos Nest calcados de `catalogs` |

**Cero dependencias nuevas.** Cero migraciones de schema (`account_invitations` es de S2).

## 7. Artefactos nuevos

| Artefacto | Ubicación | Por qué ahí |
|---|---|---|
| `MOBILE_ROLES`, `ROLE_LABEL` | `packages/shared/src/constants/roles.ts` | 2 consumidores (API + móvil) → shared, regla del skill |
| `COUNTRY_BY_CURRENCY` | `packages/shared/src/constants/` — **sólo si S1 lo pide** | `ponytail:` no se crea en S0. `SUPPORTED_CURRENCIES` ya tiene el `locale`; si el selector de S1 se resuelve derivando el país de ahí, esta constante **no existe nunca**. Se decide al construir S1, con la pantalla delante |
| `modules/accounts/` | `apps/api/src/modules/accounts/` | dominio propio |
| `modules/users/` | `apps/api/src/modules/users/` | dominio propio (incluye `/roles`: un controller de 1 endpoint no justifica un módulo aparte) |

## 8. Tareas

1. `packages/shared`: `MOBILE_ROLES` + `ROLE_LABEL`; `ACCOUNT_READ`/`ACCOUNT_WRITE` en `permission.enum.ts`
   y en `ROLE_PERMISSIONS`. Exportar desde `index.ts`.
2. `seed.ts`: los dos permisos al catálogo (`:67`). Correr el seed y verificar que `ACCOUNT_ADMIN` los toma.
3. `prisma/rls/001_enable_rls.sql`: `client_import_runs` al array. Aplicar y correr `verify_isolation.sql`.
4. `modules/accounts/`: module + controller + service + serializer + dto + errors. `GET`/`PATCH /me`.
   `memberCount` en la misma consulta.
5. `modules/users/`: idem. `GET /users` **partiendo de `user_accounts`** (§5, la trampa), `PATCH /users/:id`
   con las 3 guardas, `GET`/`PATCH /users/me/profile`, `GET /roles`.
6. Registrar los 2 módulos en `app.module.ts`.
7. Tests (§10) y verificación.

**`auth` no se toca en este slice.** Ni el service, ni el controller, ni el DTO de `me`.

**Orden:** shared y permisos primero (todo lo demás los importa), RLS antes que cualquier endpoint nuevo,
`accounts` antes que `users` (es la mitad de grande y valida el patrón).

## 9. Reglas de fase

Las del README §8, y dos que este slice estrena:

- 🔴 **Tabla global = la RLS no te cubre.** Toda lectura de `users`/`profiles`/`roles` arranca en
  `user_accounts`. Un `findMany` directo sobre una de esas tres tablas en un service de tenant es un
  hallazgo de revisión, no un detalle de estilo.
- **La membresía se edita en `user_accounts`, nunca en `User`.** `User` es global y compartido entre
  tenants: desactivar a alguien en un tenant no puede tocar su acceso a otro.

## 10. DoD

- Los 7 endpoints responden `{data,meta,error}` y están bajo el stack de guards correcto.
- **Tests que fallan si la lógica se rompe** (no suites por función — las 4 que importan):
  1. `GET /users` de un tenant **no** devuelve miembros de otro (el bug que la RLS no atrapa; el seed ya
     crea `DEMO` y `DEMO2`, y `multi@kobrax.demo` pertenece a los dos → el caso ya está sembrado).
  2. `PATCH /users/:id` sobre uno mismo → rechaza.
  3. `PATCH /users/:id` que dejaría el tenant sin `ACCOUNT_ADMIN` activo → rechaza.
  4. `PATCH /users/:id` con un `roleId` fuera de `MOBILE_ROLES` → rechaza.
- `pnpm --filter @kobrax/api test` verde — **base de esta rama (desde `main`): 343 pass / 94 suites**
  (corredor `node:test`, no jest) + las nuevas. ⚠️ El "361" que se mide parada en `f10/rutas-s3-preview`
  incluye los tests de rutas S3, que `main` no tiene — no es la base de este slice.
  `type-check` verde.
- `verify_isolation.sql` pasa con `client_import_runs` incluida.
- `/code-review` + `/ponytail-review` aplicados.
- **Sin validación visual**: no hay pantalla. La valida S1.

## 11. Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| S0-R1 | **Fuga cross-tenant** por consultar tablas globales sin pasar por `user_accounts` | Regla de fase §9 + el test 1 del DoD, que es exactamente ese caso |
| S0-R2 | Tenant sin administrador por un `PATCH` desafortunado | Las 3 guardas, en la misma transacción que el update |
| S0-R3 | El seed corrido de nuevo pisa datos de la DB de desarrollo | El seed es idempotente (`upsert` en todos lados) — verificado en `seed.ts` |
| S0-R4 | `PATCH /accounts/me` termina exponiendo `planCode`/`maxUsers` "porque ya que estamos" | No están en el DTO, y con `forbidNonWhitelisted: true` mandarlos devuelve **400**. La defensa es el DTO y alcanza sola |
