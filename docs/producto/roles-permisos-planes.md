# Roles, permisos, planes y acceso

**Alcance:** quién puede entrar a Kobrax, con qué rol, qué ve y qué puede hacer, qué incluye cada plan y cómo se abre, se mantiene y se cierra una sesión.
**Fecha de verificación:** 2026-10-09, contra el árbol de trabajo (incluye cambios sin commitear en `apps/api`, `apps/mobile` y `packages/`).
**Convención:** verificado = confirmado leyendo código, con cita; **«no verificado»** = no se pudo confirmar; **«no existe»** = se buscó y no hay implementación.

Fuentes principales: `packages/shared/src/enums/permission.enum.ts`, `packages/shared/src/constants/{permissions,roles,plans,kobrax.constants}.ts`, `packages/shared/src/validation/password-policy.ts`, `apps/api/src/modules/{auth,users,accounts}`, `apps/api/src/common/{plan,guards}`, `apps/api/src/database/prisma.service.ts`, `apps/api/src/modules/mora/mora-query.ts`, `packages/database/prisma/{schema.prisma,seed.ts,rls/}`, `apps/web/src/{lib/nav.ts,components/permissions.tsx,middleware.ts}`, `apps/mobile/{app,src}`.

---

## 1. Tipos de cuenta (tenant)

### Qué existe en el modelo

| Concepto | Dónde | Qué es |
|---|---|---|
| `Account` | `schema.prisma`, modelo `Account` (`accounts`) | El tenant. Lleva `accountType`, `status`, `planCode`, `limitsOverride`, país, moneda, zona horaria, `settings` (jsonb). |
| `AccountType` | enum, `schema.prisma:27` | `FINANCIAL_INSTITUTION`, `COLLECTION_AGENCY`, `RETAIL_CREDIT`, `INDEPENDENT`. |
| `AccountStatus` | enum, `schema.prisma:34` | `ACTIVE`, `TRIAL`, `SUSPENDED`, `INACTIVE`, `CANCELLED`. |
| `Branch` | modelo `Branch` (`branches`) | Sucursal/agencia: nombre, código, ciudad, `managerUserId`, `active`. |
| `UserAccount` | modelo `UserAccount` (`user_accounts`) | Membresía usuario ↔ cuenta ↔ rol ↔ sucursal (`branchId`), con `isOwner`, `isDefault`, `isActive`. Un usuario puede tener varias (multi-cuenta). |

### Cómo cambia (y cómo no) la experiencia según el tipo

- **Hoy el tipo de cuenta no cambia nada.** El único valor que el producto escribe es `INDEPENDENT`: el registro público crea siempre `accountType: 'INDEPENDENT'` (`accounts.service.ts`, `create`). No hay endpoint que lo modifique (`UpdateAccountDto` lo excluye a propósito, `dto/account.dto.ts`) y ninguna regla de web, móvil o API ramifica por `accountType` (solo se serializa en `accounts.serializer.ts`). Los otros tres valores existen en el enum pero **ningún flujo los asigna**.
- **Lo que sí cambia la experiencia es el rol** (sección 2) **y el plan** (sección 6). El móvil lo dice expresamente: «el gating es por capacidad, nunca por tipo de cuenta ni por plan» (`apps/mobile/app/cuenta/index.tsx`).
- **«Cobrador independiente»** en la práctica = una cuenta `INDEPENDENT` con un único `ACCOUNT_ADMIN` (`isOwner`) que opera él mismo. El registro lo crea con rol `ACCOUNT_ADMIN`, que además tiene permisos de campo (`route:execute`, `payment:write`, etc.), por eso puede trabajar sin invitar a nadie.
- **Sucursales:** el modelo existe, pero **no hay API para crearlas ni para asignar una sucursal a un miembro** (en `apps/api/src` solo hay lecturas `branch.findMany`; `UpdateMemberDto` solo acepta `roleId`, `isActive`, `reassignToUserId`). Solo el seed demo crea sucursales (`CEN`, `ALT`). Consecuencia directa para el alcance del supervisor (3.3).
- **Estado de la cuenta y login:** el login excluye membresías en cuentas `SUSPENDED`, `CANCELLED` o `INACTIVE`; `ACTIVE` y `TRIAL` entran (`auth.service.ts`, `activeMemberships`). La suspensión manual se hace por CLI (`account:suspend`, `plan-cli.ts`).

---

## 2. Roles base

Siete roles de sistema (`RoleType`, `packages/shared/src/enums/role.enum.ts`), globales (tabla `roles`, sin RLS, `isSystem=true`), con nivel definido en `seed.ts`. **No hay roles personalizados**: no existe endpoint para crearlos ni editarlos (`RolesController` solo tiene `GET /roles`).

| Rol | Etiqueta (`ROLE_LABEL`) | Nivel | Qué es en la práctica | Quién lo asigna hoy |
|---|---|:-:|---|---|
| `SUPER_ADMIN` | Super administrador | 100 | Acceso total del lado de Kobrax (comentario del enum: «solo Kobrax»). Tiene los 36 permisos. | No se asigna por API ni por UI; el seed demo no lo asigna a nadie. Uso real: **no verificado**. |
| `ACCOUNT_ADMIN` | Administrador | 90 | Dueño/administrador del tenant: datos de la cuenta, equipo, importación (incl. modo REPLACE), pagos, rutas, mora y también operación de campo (`route:execute`). 35 permisos (todos menos `audit:read`). | El **registro público** lo da al creador de la cuenta (`isOwner`). Luego otro `ACCOUNT_ADMIN` puede invitar o cambiar a alguien a este rol. |
| `MANAGER` | Gerente | 70 | Gerencia: ve toda la empresa (`data:scope:all`), aprueba solicitudes de pago, planifica y asigna rutas, importa, exporta, reasigna cartera; **no** administra equipo ni cuenta (solo lectura). | **Nadie por la API**: invitar y cambiar rol solo aceptan los roles de `MOBILE_ROLES`. Solo seed/base de datos. |
| `SUPERVISOR` | Supervisor | 50 | Supervisa cobradores: planifica rutas, asigna agenda y cartera, importa y reparte; su alcance es «su agencia + lo suyo». No aprueba pagos ni edita clientes/créditos. | `ACCOUNT_ADMIN` (invitar / cambiar rol), desde móvil o web. |
| `COLLECTOR` | Cobrador | 30 | Cobra en campo: su agenda, su cartera asignada, sus rutas; registra pagos y gestiones, da de alta clientes/créditos y los importa. Sin alcance amplio de datos. | `ACCOUNT_ADMIN`. |
| `AUDITOR` | Auditor | 20 | Solo lectura con PII revelable, reportes y exportación; único rol con `audit:read` (hoy sin endpoint, ver 3.4). Ve toda la empresa. | **Nadie por la API** (como `MANAGER`). Solo seed/base. |
| `VIEWER` | Consulta | 10 | Consulta gerencial: lee mora, pagos, rutas, clientes y reportes de toda la empresa; no escribe. | **Nadie por la API**. Solo seed/base. |

**Regla de servidor que limita la asignación** (`packages/shared/src/constants/roles.ts`, `users.service.ts`): `POST /users/invite` y `PATCH /users/:id` rechazan (`roleNotAllowed`) cualquier `roleId` fuera de `MOBILE_ROLES = [ACCOUNT_ADMIN, SUPERVISOR, COLLECTOR]`, y `GET /roles` solo devuelve esos tres. El comentario del código dice que `MANAGER`, `AUDITOR` y `VIEWER` «se administran desde la web», pero **la web tampoco tiene cómo asignarlos** (consume el mismo `GET /roles`). Un miembro que ya tiene uno de esos roles se muestra y el móvil no lo edita (`app/cuenta/miembro/[id].tsx`, `rolDeLaWeb`).

**Reglas de protección del equipo** (`users.service.ts`, `updateMember`):
- No se puede editar a uno mismo (`cannotEditSelf`).
- No se puede quitar o desactivar al **último** `ACCOUNT_ADMIN` activo (`lastAdmin`); cuentan solo los de `user.status = ACTIVE`.
- No se desactiva a quien tiene trabajo a su nombre (agenda pendiente, créditos a cargo, rutas armadas o en curso) sin indicar destinatario (`reassignToUserId`); con destinatario, todo se traspasa en la misma transacción y queda auditado.
- Reactivar a un desactivado vuelve a pasar por el tope de usuarios del plan.
- Cancelar una invitación (`DELETE /users/:id`) borra al pendiente; a un miembro activo solo se lo desactiva.

---

## 3. Permisos

### 3.1 Matriz permiso × rol

Fuente: `ROLE_PERMISSIONS` (`packages/shared/src/constants/permissions.ts`), la **fuente única**: `seed.ts` puebla `role_permissions` desde ahí y de `role_permissions` salen los `permissions` del JWT (`PermissionsService.forRole`). `SUPER_ADMIN` = todos; `ACCOUNT_ADMIN` = todos menos `audit:read`. Total: 36 permisos (enum `Permission`).

| Permiso | SUPER_ADMIN | ACCOUNT_ADMIN | MANAGER | SUPERVISOR | COLLECTOR | AUDITOR | VIEWER |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `collection:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `collection:write` | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| `collection:export` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `payment:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `payment:write` | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| `payment:approve` | ✅ | ✅ | ✅ | — | — | — | — |
| `route:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `route:write` | ✅ | ✅ | ✅ | ✅ | — | — | — |
| `route:assign` | ✅ | ✅ | ✅ | ✅ | — | — | — |
| `route:execute` | ✅ | ✅ | — | — | ✅ | — | — |
| `agenda:read` | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| `agenda:write` | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| `agenda:assign` | ✅ | ✅ | ✅ | ✅ | — | — | — |
| `catalog:read` | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| `catalog:write` | ✅ | ✅ | ✅ | — | — | — | — |
| `client:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `client:write` | ✅ | ✅ | ✅ | — | ✅ | — | — |
| `client:pii:read` | ✅ | ✅ | ✅ | — | — | ✅ | — |
| `client:import` | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| `client:import:replace` | ✅ | ✅ | — | — | — | — | — |
| `credit:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| `credit:write` | ✅ | ✅ | ✅ | — | ✅ | — | — |
| `credit:pii:read` | ✅ | ✅ | ✅ | — | — | ✅ | — |
| `report:read` | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| `report:export` | ✅ | ✅ | ✅ | — | — | ✅ | — |
| `account:read` | ✅ | ✅ | ✅ | — | — | — | — |
| `account:write` | ✅ | ✅ | — | — | — | — | — |
| `user:read` | ✅ | ✅ | ✅ | — | — | — | — |
| `user:write` | ✅ | ✅ | — | — | — | — | — |
| `user:invite` | ✅ | ✅ | — | — | — | — | — |
| `role:read` | ✅ | ✅ | — | — | — | — | — |
| `role:write` | ✅ | ✅ | — | — | — | — | — |
| `audit:read` | ✅ | — | — | — | — | ✅ | — |
| `assignment:write` | ✅ | ✅ | ✅ | ✅ | — | — | — |
| `data:scope:all` | ✅ | ✅ | ✅ | — | — | ✅ | ✅ |
| `data:scope:branch` | ✅ | ✅ | — | ✅ | — | — | — |
| **Total** | 36 | 35 | 27 | 18 | 15 | 12 | 7 |

> Notas: el cobrador **no** tiene `client:pii:read` ni `credit:pii:read`, pero igual ve los datos del cliente en claro (3.4). `VIEWER` no tiene `credit:read` ni `agenda:read`. `MANAGER` y `SUPERVISOR` no tienen `route:execute`: no ejecutan visitas propias (el administrador sí, junto con `route:assign`).

### 3.2 Overrides por usuario

- **El modelo existe, la función no.** La tabla `user_permission_overrides` (`UserPermissionOverride`: `granted` true/false, `reason`, `expiresAt`, `grantedBy`) está en `schema.prisma` y en el script de RLS, pero **ningún código de la API la lee ni la escribe** (búsqueda en `apps/api/src`: sin resultados fuera del schema). El propio servicio lo dice: «Los overrides por usuario se incorporan en el Slice 4 de RBAC» (`permissions.service.ts`).
- Por lo tanto, **los permisos efectivos de un usuario son exactamente los de su rol**, resueltos al emitir/renovar el access token. No hay forma de conceder o negar un permiso suelto desde el producto.
- **Cambio de rol:** los permisos viajan dentro del access token (15 min); el `refresh` los recalcula desde la membresía. El cambio se refleja a más tardar en la siguiente renovación.

### 3.3 Alcance de datos (`data:scope:*`)

Tres niveles conceptuales: **todo** (`data:scope:all`), **mi agencia + lo mío** (`data:scope:branch`) y **lo mío** (ninguno, falla cerrado). Lo verificado sobre **dónde se aplica de verdad por fila**:

| Capa | Estado | Evidencia |
|---|---|---|
| **Aislamiento entre empresas (RLS por `account_id`)** | **Activo** en todas las tablas operativas, con `FORCE`. | `rls/001_enable_rls.sql`; `prisma.service.ts` (`set_config('app.current_account_id', …)`). |
| **Alcance por fila dentro de la empresa, en PostgreSQL (RLS)** | **No activo.** `PrismaService.withTenant` ya fija `app.scope` (`account` si tiene `data:scope:all`, `own` si no; `system` para trabajos de sistema; sin contexto = sin scope), pero `002_scope.sql` solo define helpers (`app_current_scope()`, `app_scope_sees_all()`, `app_current_user()`) y **ninguna policy los usa**. El script lo dice: «F1 sólo define los helpers. Las policies llegan en F2». `PLAN-SEGURIDAD.md §1.1` lo marca como hueco bloqueante. | `rls/002_scope.sql`; las funciones solo aparecen en ese archivo. |
| **Alcance por fila en la aplicación: Mora, Agenda, visitas de campo, rutas, asignaciones** | **Activo.** `moraScopeOf` resuelve `ALL` (con `data:scope:all`) → `BRANCH` (con `data:scope:branch`) → `OWN` (ninguno). `OWN` = créditos donde es responsable (`assigned_manager_id`) o tiene asignación temporal/apoyo vigente. `BRANCH` = lo suyo **más** los créditos **con responsable** cuya `branch_id` es la del supervisor (`user_accounts.branch_id`); un supervisor **sin agencia** ve solo lo suyo. Un crédito sin responsable solo lo ve quien tiene alcance total. Lo usan Mora (lista, ficha, export), Agenda, `field.service` (crear visita), `routes.service` y `assignment.service`. | `mora-query.ts` (`moraAccessConditions`, `moraScopeOf`); usos en `agenda.service.ts`, `field.service.ts`, `routes.service.ts`. |
| **Alcance por fila en Cartera: clientes, créditos, pagos** | **No aplicado.** `GET /clients`, `GET /credits`, `GET /payments` (y detalles) filtran por empresa (RLS) y por los filtros que mande el cliente, **no** por el alcance del usuario: un cobrador con `client:read` / `credit:read` / `payment:read` obtiene los de toda la cuenta. | `clients.service.ts` `list`, `credits.service.ts` `list`, `payments.service.ts` `list`: sin `moraAccessConditions` ni `DATA_SCOPE`. |
| **Quién puede repartir cartera** | `assignment:write` (admin, gerente, supervisor). Sin él no se elige responsable: solo se recibe lo que uno mismo importa o crea. | `assignment.service.ts`, `credits.service.ts`. |
| **Castigar un crédito (write-off)** | Exige `credit:write` **y** `data:scope:all`. | `credits.service.ts` (`writeOffForbidden`). |

**Alcance efectivo por rol en Mora/Agenda/Rutas:**

| Rol | Permiso de alcance | Alcance efectivo |
|---|---|---|
| `SUPER_ADMIN`, `ACCOUNT_ADMIN`, `MANAGER`, `AUDITOR`, `VIEWER` | `data:scope:all` (admin y super tienen además `branch`) | Toda la empresa. |
| `SUPERVISOR` | `data:scope:branch` | Su agencia + lo que tiene a cargo. **Sin sucursal asignada ve solo lo suyo**; como no hay API para asignar sucursal (sección 1), en una cuenta real el supervisor hoy ve solo lo suyo. |
| `COLLECTOR` | ninguno | Solo lo que tiene a cargo (responsable, temporal o apoyo vigente). |

Nota: el reparto de cartera ya está implementado (`assigned_manager_id`, `credit_assignments`, import con asignación), por lo que el bloqueo que describe `PLAN-SEGURIDAD.md §1.1` («no existe reparto») ya no aplica; lo pendiente de ese plan es llevar el alcance a RLS y a Cartera/Pagos.

### 3.4 Permisos con efecto parcial o sin endpoint

| Permiso | Estado verificado |
|---|---|
| `audit:read` | **Ningún endpoint lo exige** (solo aparece en el enum y en la matriz). La bitácora se escribe, pero no hay API de lectura. |
| `role:write` | Ningún endpoint lo exige. |
| `client:pii:read`, `credit:pii:read` | `GET /clients/:id` y el PDF revelan la PII **a cualquiera con `client:read`**, con auditoría `client/PII_REVEAL` (`clients.controller.ts`, comentario explícito; «los permisos finos son F3/P10»). `client:pii:read` solo se exige, junto con `client:import`, para descargar el archivo de una corrida de importación (`portfolio-import.controller.ts`, `runs/:id/file`). `credit:pii:read`: sin uso en API. |
| `client:import:replace` | Se valida en el servicio de importación para el modo REPLACE (`client-import.controller.ts`). |
| `collection:export` | Exigido junto con `collection:read` en `GET /mora/export.csv` y `export.pdf`. |
| `report:export` | Exigido en todo `/exports/*` (CSV de cartera, ubicaciones, mora, agenda y backup). |
| `route:*` | El guard de los endpoints de rutas y visitas exige solo `route:read`; las diferencias entre `route:write`, `route:assign` y `route:execute` se resuelven **dentro del servicio** (`route-access.ts`, `routes.service.ts`, `field.service.ts`). |
| `account:write` | También gobierna las categorías de mora (`PUT /arrear-categories`) y los tableros compartidos (`dashboards.service.ts`). |
| `payment:approve` | Exigido en `POST /payment-requests/:id/confirm`. |

---

## 4. Qué ve cada rol: pantallas web y móvil

> **Regla general:** ocultar no es autorizar. Web y móvil solo deciden qué dibujar; **la API valida el permiso en cada request** (`RolesGuard` + `@Roles`, `auth/guards/roles.guard.ts`) y, donde aplica, el alcance de filas (3.3).

### 4.1 Web (panel Next.js)

El menú sale de `visibleNav(permissions)` (`apps/web/src/lib/nav.ts`): sin el permiso, el ítem **no se dibuja** (ni en gris).

| Pantalla (ruta) | Permiso del menú | SUPER / ADMIN | MANAGER | SUPERVISOR | COLLECTOR | AUDITOR | VIEWER |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Inicio / tablero (`/dashboard`) | ninguno; el contenido pide `report:read` | ✅ | ✅ | ✅ | redirige a `/agenda` | ✅ | ✅ |
| Cartera (`/cartera`) | `client:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Importar (`/import`) | `client:import` | ✅ | ✅ | ✅ | ✅ | — | — |
| Mora (`/mora`) | `collection:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Agenda (`/agenda`) | `agenda:read` | ✅ | ✅ | ✅ | ✅ | — | — |
| Rutas (`/rutas`) | `route:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Pagos (`/pagos`) | `payment:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Equipo (`/equipo`) | `user:read` | ✅ | ✅ (solo lectura) | — | — | — | — |
| Cuenta (`/cuenta`) | `account:read` | ✅ | ✅ (solo lectura) | — | — | — | — |
| Exportar (`/exportar`) | `report:export` | ✅ | ✅ | — | — | ✅ | — |
| Mi perfil / Seguridad / Sesiones (`/settings/*`) | ninguno | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**Acciones dentro de las pantallas** (se ocultan con `can(...)` o `permissions.includes`):

| Acción | Permiso | Dónde |
|---|---|---|
| Nuevo cliente, editar cliente | `client:write` | `cartera/new-client-button.tsx`, `client-card.tsx` |
| Crear/editar crédito, resolver revisión de vínculos | `credit:write` | `credit-card.tsx`, `link-review.tsx` |
| Registrar pago desde ficha/ruta/parada | `payment:write` | `pagos/payment-actions.tsx`, `rutas/[id]` |
| Aprobar solicitud de pago | `payment:approve` | `pagos/solicitudes/[id]/request-view.tsx` |
| Invitar miembro | `user:invite` y que `GET /roles` devuelva roles (`role:read`) | `equipo/invite-button.tsx` |
| Editar/desactivar miembro | `user:write` | `equipo/members-table.tsx` |
| Editar datos de la cuenta y categorías de mora | `account:write` | `cuenta/business-form.tsx`, `arrear-categories.tsx` |
| Plantillas de WhatsApp | `catalog:write` | `cuenta/whatsapp-templates.tsx` |
| Reasignar cartera, vista de supervisión en Mora | `assignment:write` | `mora/page.tsx`, `ficha-gestion.tsx` |
| Gestiones y notas de mora | `collection:write` | `mora/[creditId]` |
| Descargar Mora | `collection:export` | `mora/page.tsx` |
| Castigar crédito | `credit:write` + `data:scope:all` | `ficha-gestion.tsx` |
| Planificar rutas / vista de supervisión | `route:assign` (`/rutas/planificar` redirige a `/rutas` si falta) | `rutas/page.tsx`, `rutas/planificar/page.tsx` |
| Asignar agenda de otros | `agenda:assign` | `agenda/page.tsx`, `agenda/[id]/page.tsx` |
| Recordatorio de activar 2FA | `mfaEnabled === false` (cualquier rol) | `dashboard/page.tsx` |

**Pantallas sin guard de ruta propio:** salvo `/dashboard` y `/rutas/planificar`, las páginas no redirigen por permiso; con la URL directa y sin permiso la API responde 403 y la pantalla muestra «sin acceso» (`noAccess` en cartera, cuenta, equipo, dashboard) o un estado de error. Patrón verificado en esas cuatro; en el resto, **no verificado pantalla por pantalla**.

### 4.2 Móvil (Expo / React Native)

- **Las 5 pestañas son las mismas para todos los roles**: Inicio, Agenda, Rutas, Cobranza, Más (`apps/mobile/app/(tabs)/_layout.tsx`). **No hay ocultamiento de pestañas por rol**; `mas.tsx` anota «gating por rol en F3» como pendiente. Tampoco se encontró restricción de login por rol o canal: cualquier rol puede iniciar sesión en el móvil.
- Lo que sí se condiciona por permiso en el móvil:

| Pantalla / acción | Permiso | Archivo |
|---|---|---|
| «Mi negocio» (Datos de la cuenta, Miembros) | `account:read` (sin él solo queda «Mi perfil») | `app/cuenta/index.tsx` |
| Editar datos del negocio | `account:write` | `app/cuenta/index.tsx`, `datos.tsx` |
| Invitar miembro | `user:invite` | `app/cuenta/miembros.tsx` |
| Editar/desactivar miembro | `user:write`; no sobre uno mismo ni sobre roles de la web (`MANAGER`/`AUDITOR`/`VIEWER`) | `app/cuenta/miembro/[id].tsx` |
| Reasignar crédito en la ficha de mora | `assignment:write` | `app/mora/[creditId].tsx` |

- **Todo lo demás en el móvil lo valida solo la API.** Por ejemplo, un rol sin `agenda:read` (auditor, viewer) ve la pestaña Agenda y recibe 403 al cargarla. Es una brecha de UX, no de seguridad.
- Al invitar o cambiar rol en el móvil solo se ofrecen `ACCOUNT_ADMIN`, `SUPERVISOR` y `COLLECTOR`, con descripción en lenguaje llano (`src/account-form.ts`).

### 4.3 Qué valida solo la API (sin reflejo en pantalla)

- Alcance de filas en Mora/Agenda/Rutas (y su ausencia en Cartera/Pagos).
- Diferencias `route:write` / `route:assign` / `route:execute`.
- Topes del plan: usuarios, créditos, clientes (sección 6).
- `client:import:replace`, `payment:approve`, `report:export`, `collection:export`.
- Versión mínima de la app (426, 5.9) y rate limits (sección 7).

---

## 5. Flujos de acceso

Todo en `apps/api/src/modules/auth` (`auth.controller.ts`, `auth.service.ts`, `password.service.ts`, `mfa.service.ts`, `session.service.ts`, `token.service.ts`).

### 5.1 Registro de cuenta (público)

`POST /accounts`, sin sesión, 10/hora por IP. Datos: razón social, nombre, apellido, email, contraseña y plan opcional (`FREE`, `PROFESSIONAL`, `BUSINESS`; `ENTERPRISE` **no** es elegible: es entrada no confiable y se cotiza).
En una transacción crea: la cuenta (`INDEPENDENT`, país `BO`, moneda `BOB`), el usuario `ACTIVE` sin cambio de contraseña forzado, su membresía como `ACCOUNT_ADMIN` + `isOwner` + `isDefault`, y las categorías de mora por defecto (A 1–30, B 31–60, C 61+). Plan pago ⇒ `status = TRIAL` con `trialEndsAt = hoy + 30 días`; FREE ⇒ `ACTIVE`. **No emite tokens**: el cliente hace `POST /auth/login` a continuación.
Cita: `accounts.controller.ts`, `accounts.service.ts` (`create`), `dto/create-account.dto.ts`.

### 5.2 Invitación de miembros

1. Quien tiene `user:invite` (solo `ACCOUNT_ADMIN`) llama `POST /users/invite` con email, nombre, apellido y rol (solo `MOBILE_ROLES`).
2. Se verifica el tope de usuarios **dentro de la transacción** (`assertRoom('users')`). Un invitado pendiente **ya ocupa un asiento**.
3. Se crea un `User` en `PENDING` (contraseña aleatoria inutilizable) + membresía + un código de un solo uso (10 símbolos Crockford base32, formato `K7F29-QX3TM`) guardado como SHA-256, **vigente 7 días**. No existe tabla de invitaciones: reutiliza `password_reset_tokens`.
4. El código se devuelve en claro **una sola vez** a quien invita y se envía por correo (sin esperarlo; si falla, se loguea y la invitación queda «Pendiente» con **Reenviar**, que invalida el código anterior).
5. El invitado abre `kobrax://invitacion?c=…` o teclea el código: `GET /auth/invitation/:code` (10/min por IP) muestra email, nombre y negocio; `POST /auth/invitation/accept` (10/hora por IP) fija la contraseña (política de la sección 7) y lo activa. **No inicia sesión**: sigue el login normal.
6. Limitación documentada en código: **no se puede invitar a un correo que ya tiene cuenta** en otro tenant (siempre crea un `User` nuevo; error `emailTaken`), aunque el modelo soporte multi-cuenta.

### 5.3 Login (máquina de estados)

`POST /auth/login` (5/min por email+IP):

1. Usuario inexistente → compara contra un hash falso (tiempo constante) y responde `invalidCredentials`.
2. Si `lockedUntil` está en el futuro → `accountLocked`. Si `status ≠ ACTIVE` (p. ej. `PENDING`) → `invalidCredentials`.
3. Contraseña incorrecta → suma intento; **al 5.º fallo bloquea 15 minutos** (`MAX_FAILED_LOGINS = 5`, `ACCOUNT_LOCK_MINUTES = 15`). Éxito → resetea el contador.
4. Si tiene 2FA activo → `step: 'mfa'` (token pre-auth). Si no, y alguna membresía es `ACCOUNT_ADMIN` o `SUPER_ADMIN` → `step: 'mfa_setup'` (5.4).
5. Resuelve cuentas activas: ninguna → `noActiveTenant`; una → tokens; varias → `step: 'select_account'` (5.5).

### 5.4 Segundo factor (TOTP + códigos de respaldo)

- **TOTP RFC-6238**: 6 dígitos, paso de 30 s, tolerancia ±1 paso (`totp.ts`). El secreto se guarda **cifrado** (AES-256-GCM) y no se expone tras el alta.
- **Activar** (`/auth/mfa/enroll` → `/auth/mfa/verify`): al confirmar un código se activa y se emiten **8 códigos de respaldo** (`a1b2c-d3e4f`), guardados como SHA-256, **de un solo uso**, que reemplazan a los anteriores y se muestran en claro una sola vez. Regenerar: `POST /auth/mfa/backup-codes/regenerate`.
- **Desafío en login** (`/auth/mfa/challenge`, 5/min por IP): acepta TOTP o un código de respaldo.
- **Desactivar** (`/auth/mfa/disable`): exige contraseña actual **o** un código vigente; borra secreto y códigos.
- **Obligatorio para `ACCOUNT_ADMIN`/`SUPER_ADMIN`, pero postergable**: el login fuerza el enrolamiento (`mfa/setup/start` + `verify`), y existe `mfa/setup/skip` («Lo hago después») que **completa el login sin activarlo**, sin límite de veces (decisión explícita de la dueña, 2026-07-31, `auth.service.ts`). El recordatorio es un aviso en el Inicio mientras `mfaEnabled` sea falso. Para los demás roles el 2FA es voluntario.

### 5.5 Selección y cambio de cuenta (multi-cuenta)

- En el login: con ≥2 membresías activas se devuelve la lista y un token `select_account`; `POST /auth/select-account` emite los tokens de la elegida. Si ya pasó por 2FA no se vuelve a pedir.
- Ya dentro: `GET /auth/accounts` lista las cuentas; `POST /auth/switch-account` emite un par nuevo **para la otra cuenta y revoca la sesión anterior**; rol y permisos se recalculan desde la membresía destino, se revalida que el usuario siga `ACTIVE` y sin bloqueo, y queda auditado (`SWITCH_ACCOUNT`).
- Existe `isDefault` por membresía; que la pantalla lo use para preseleccionar cuenta es **no verificado** (el API siempre devuelve la lista cuando hay ≥2).

### 5.6 Recuperación y cambio de contraseña

- **Olvidé mi contraseña** `POST /auth/forgot-password` (3/hora por email): responde siempre 200 (anti-enumeración); solo crea el token si el usuario existe y está `ACTIVE`. Token de 32 bytes aleatorios, guardado como SHA-256, **vigente 30 minutos**, un solo uso, enviado por correo.
- **Restablecer** `POST /auth/reset-password`: valida la política, cambia la contraseña, resetea intentos y bloqueo, invalida otros tokens pendientes y **revoca todas las sesiones** del usuario. Rechaza códigos de invitación (comparten tabla).
- **Cambiar** `POST /auth/change-password` (con sesión): exige la contraseña actual, aplica la política y **revoca todas las sesiones, incluida la actual** (`revokeAll(userId)` sin excepción).
- **Cambio forzado** (`requiresPasswordChange`): el móvil redirige a `force-password-change` tras el login (`post-login.ts`). **En la web no se encontró manejo de ese indicador** (sin resultados en `apps/web/src`). El registro público lo deja en falso.

### 5.7 Sesiones, expiración y revocación

| Elemento | Valor | Fuente |
|---|---|---|
| Access token (JWT) | 15 min; lleva `sub`, `accountId`, `roleId`, `permissions`, `sessionId` | `kobrax.constants.ts`, `token.service.ts` |
| Refresh token | 7 días, **rotativo**, solo el hash en DB, con `familyId` | `auth.service.ts` |
| Reuso de refresh | Un refresh ya usado que reaparece pasados **10 s** → se revoca la familia y la sesión (denylist inmediata); dentro de 10 s se trata como carrera legítima (`refreshRetry`) | `auth.service.ts` (`refresh`) |
| Denylist de sesiones | Redis, `revoked_session:<id>`, TTL 7 días; `JwtAuthGuard` la consulta en **cada request** | `session.service.ts`, `jwt-auth.guard.ts` |
| Cookies web | `k_access` (15 min) y `k_refresh` (7 d), `httpOnly`, `SameSite=Strict`, `secure` en producción; el middleware renueva en silencio | `apps/web/src/middleware.ts` |
| Listar / cerrar sesiones | `GET /auth/sessions` (dispositivo, IP, ciudad, última actividad, marca la actual), `DELETE /auth/sessions/:id`, `DELETE /auth/sessions` (todas menos la actual) | `auth.controller.ts`; UI en `/settings/security/sessions` |
| Logout | Revoca refresh + sesión + denylist; idempotente | `auth.service.ts` |

Matices de revocación (lectura de código):
- Desactivar un miembro **no revoca** sus sesiones vivas (`users.service.ts` no invoca `SessionService`); el access token dura hasta 15 min y el `refresh` falla porque comprueba `userAccount.isActive`. Ese `refresh` **no** mira el estado de la cuenta ni `user.status`: si una cuenta suspendida podría seguir renovando tokens es **no verificado en ejecución**.
- El cambio de rol llega al token en la siguiente renovación (≤15 min).

### 5.8 Móvil: biometría y ventana offline

- **Almacenamiento:** tokens solo en SecureStore (nunca AsyncStorage) (`apps/mobile/src/session.ts`).
- **Ventana de inactividad de 8 h:** se guarda `sessionValidUntil = ahora + min(7 d, 8 h)`, que se renueva con cada respuesta online exitosa (`touchSession`). Mientras `ahora < validUntil` la app abre y opera sin red (modo offline, `app/(app)/offline.tsx`); vencida → login. La cola de acciones pendientes se conserva.
- **Biometría** (`biometric.ts`): es **opcional y personal**; se ofrece una sola vez tras un login. **Solo desbloquea el token local**, nunca autentica contra la API ni sustituye al login; si falla, cae a contraseña. Con biometría activa, volver a primer plano tras ≥ **60 s** fuera re-bloquea (`LOCK_GRACE_MS`); si la ventana de 8 h venció, siempre re-bloquea. Una política del tenant que la imponga **no existe** (`PLAN-SEGURIDAD.md §2.2` es propuesta).
- **Cierre de sesión:** cuatro caminos (botón, refresh rechazado, «usar contraseña» en el desbloqueo, cambio de contraseña) pasan por `clearSession`, que borra tokens, recordatorios locales, borrador de ruta y la caché de datos del tenant. **No borra la cola** (puede contener un pago sin entregar).

### 5.9 Versión mínima de la app móvil

- El móvil manda `x-app-version` en cada llamada (`apps/mobile/src/api.ts`).
- `AppVersionGuard` (`common/guards/app-version.guard.ts`) responde **426 `APP_001`** si existe `MIN_APP_VERSION` en el entorno **y** el cliente manda una versión **menor**. Está **apagado por defecto** (sin la variable no actúa); no afecta al panel web ni a clientes sin header; `/auth/*` y `/health` están exentos para poder renovar/cerrar sesión. El móvil muestra una pantalla de actualización (`UpgradeGate`).
- No es una puerta de seguridad: el header lo manda el cliente y se puede omitir.
- Regla funcional aparte: desde la app `1.1.0` el cierre de ruta con paradas sin gestionar exige motivo; versiones menores o sin header se toleran y se marcan en auditoría (`ROUTE_CLOSE_REASON_MIN_APP_VERSION`).

---

## 6. Planes

Catálogo en `packages/shared/src/constants/plans.ts` (`PLANS`), con la advertencia del propio archivo: **es el catálogo, no la guarda**; que un tope figure ahí no significa que algo lo cuente.

### 6.1 Topes y precio por plan

| | FREE | PROFESSIONAL | BUSINESS | ENTERPRISE |
|---|--:|--:|--:|--:|
| Precio base (USD/mes) | 0 | 0 | 99 | 800 |
| Precio por asiento (USD/mes) | 0 | 12 | 10 | 8 |
| `users` (miembros activos) | 1 | 25 | 100 | 500 |
| `credits` (créditos activos) | 20 | 1 000 | 5 000 | 50 000 |
| `clients` (deudores) | 20 | 1 000 | 5 000 | 50 000 |
| `photosPerMonth` | 100 | 5 000 | 25 000 | 250 000 |
| `photoRetentionMonths` | 6 | 24 | 60 | 120 |
| `actionsPerMonth` (visitas/contactos) | 100 | 2 500 | 12 500 | 125 000 |
| Elegible al registrarse | sí | sí (prueba 30 d) | sí (prueba 30 d) | no (a medida) |

- Ningún plan SaaS usa tope `null` (sin límite); `null` queda reservado para «Kobrax Licencia». ENTERPRISE es «a medida»: los números son el piso y el contrato los sube por cuenta.
- **Excepción negociada:** `accounts.limits_override` (JSON) pisa los topes del plan; `effectiveLimits` ignora claves y valores inválidos. Un código de plan desconocido cae a FREE a propósito. `STARTER` es el nombre legado de FREE en la base (`planOf`).
- **Cómo se cambia un plan hoy:** no hay pantalla ni endpoint de producto (`UpdateAccountDto` rechaza `planCode`, `limitsOverride`, `accountType`, `status` con `forbidNonWhitelisted`). Se hace por CLI: `plan:set -- --account <id> --plan <P>` / `--override '{"users":40}'` y `account:suspend` (`plan-cli.ts`, `plan-tools.service.ts`), con auditoría.
- **Cobro:** no existe pasarela de pago (comentarios de `TRIAL_DAYS` y `plan-lifecycle.service.ts`); los precios son del catálogo y nada factura.

### 6.2 Qué hace cumplir el servidor y qué solo avisa

| Tope | Estado | Comportamiento verificado | Dónde |
|---|---|---|---|
| `users` | **Bloquea** | `POST /users/invite` y **reactivar** un miembro (`PATCH` con `isActive:true`) devuelven 422 `PLAN_LIMIT_REACHED` si no cabe uno más. Cuenta membresías `isActive`, **incluidos invitados pendientes**. El conteo corre dentro de la misma transacción que la escritura. | `users.service.ts`, `plan-limits.service.ts` (`usage`) |
| `credits` | **Bloquea** | Crear crédito e importar cartera (con vista previa «te quedan N»). Cuenta créditos `ACTIVE`/`DEFAULTED`/`RESTRUCTURED`, no borrados ni castigados (los pagados liberan lugar). **Excepción `soft`:** las altas que llegan con `id` generado por el cliente (cola offline del móvil) no se frenan, porque ya ocurrieron en la calle. | `credits.service.ts:279`, `portfolio-import.service.ts:476,516` |
| `clients` | **Bloquea** | Crear cliente (misma excepción `soft` por `dto.id`), importación de clientes y de cartera (grupos nuevos). Cuenta clientes no borrados. | `clients.service.ts:150`, `client-import.service.ts:99`, `portfolio-import.service.ts:517` |
| `photosPerMonth` | **Solo avisa** | Se cuenta (`field_evidences` desde el día 1 del mes **en el huso de la cuenta**). Al 80 %: notificación al `ACCOUNT_ADMIN` (una vez por mes y tope); al 100 %: correo **interno** a Kobrax (venta). **Nunca bloquea**: `assertRoom` no acepta topes mensuales. | `plan-usage-alerts.service.ts`, `field.service.ts:419` |
| `actionsPerMonth` | **Solo avisa** | Igual, sobre `field_visits`. | `plan-usage-alerts.service.ts`, `field.service.ts:198` |
| `photoRetentionMonths` | **No se hace cumplir** | Se muestra en la pantalla de plan; no se encontró proceso de retención/archivado ni validación en la API. | — |

Visibilidad: `GET /accounts/me` devuelve topes efectivos y consumo (`usageAll`); web y móvil marcan «cerca» desde el 80 % (`PLAN_WARN_AT`, `usageLevel`) en Equipo y Cuenta.

### 6.3 Ciclo de vida

1. **Alta con plan pago:** cuenta `TRIAL`, `settings.trialEndsAt = +30 días` (`TRIAL_DAYS`). Durante la prueba rigen los topes del plan elegido.
2. **Vencimiento:** el barrido `PlanLifecycleService` corre cada 6 h (`PLAN_LIFECYCLE_INTERVAL_MS`, desde el arranque de la API; idempotente). Una cuenta `TRIAL` con `trialEndsAt` vencido pasa a `planCode = FREE`, `status = ACTIVE`; se audita (`plan:lifecycle`), se notifica a los `ACCOUNT_ADMIN` («Terminó la prueba de …») y se avisa por correo interno a ventas. **No se bloquea ni se borra nada**: lo que exceda el tope queda **congelado** (se puede seguir cobrando, no sumar).
3. **FREE dormida:** 6 meses sin ningún login de los miembros activos → un correo al dueño, una vez por «siesta».
4. **No existe:** el paso a solo lectura a los 9 meses (no hay modo lectura), la caída a FREE por impago (sin pasarela; se hace a mano con `plan:set --plan FREE`) ni el cobro automático.
5. **Suspensión:** manual por CLI; corta el **login** (ver 5.7 sobre sesiones vivas).

---

## 7. Políticas de contraseña y de seguridad visibles al usuario

### Contraseña (`packages/shared/src/validation/password-policy.ts`; misma regla en web, móvil y API)

| Regla | Valor |
|---|---|
| Largo mínimo | 8 caracteres |
| Mayúscula | al menos una |
| Número | al menos uno |
| Símbolo | al menos uno (cualquier carácter no alfanumérico) |
| Largo máximo | 72 **bytes** (límite de bcrypt; `PASSWORD_MAX_BYTES`, validado en el DTO de registro) |
| Hash | bcrypt, work factor 12 |
| Caducidad, historial, lista de contraseñas filtradas | **no existe** (no se encontró) |

La UI muestra un checklist en tiempo real con las cuatro reglas (`checkPassword`). El servidor las valida de nuevo en registro, aceptar invitación, reset y cambio (`weakPassword`).

### Bloqueos y límites de intentos

| Control | Valor | Fuente |
|---|---|---|
| Bloqueo por contraseña errónea | 5 intentos → 15 min | `kobrax.constants.ts`, `auth.service.ts` |
| Login | 5 / min por email+IP | `auth.controller.ts` |
| Desafío 2FA | 5 / min por IP | `auth.controller.ts` |
| Refresh | 30 / min por IP | `auth.controller.ts` |
| Olvidé contraseña | 3 / hora por email | `auth.controller.ts` |
| Ver / aceptar invitación | 10 / min y 10 / hora por IP | `auth.controller.ts` |
| Registro de cuenta | 10 / hora por IP | `accounts.controller.ts` |
| Global | 600 / min por token o IP | `common/guards/rate-limit.guard.ts` |
| Mensajes de error | Genéricos: no revelan si el correo existe ni si el usuario está pendiente; el bloqueo sí informa hasta cuándo | `auth.service.ts`, `password.service.ts` |

### Lo que el usuario ve y puede gestionar

- **Mi perfil → Seguridad** (web `/settings/perfil`, `/settings/security`): activar/desactivar 2FA, regenerar códigos de respaldo, cambiar contraseña, ver y cerrar sesiones (dispositivo, ubicación, última actividad).
- **Recordatorio de 2FA** en el Inicio mientras no esté activo.
- **Avisos de plan:** contadores y cartel «cerca del tope» (80 %) en Equipo/Cuenta; notificaciones de topes mensuales y de fin de prueba al administrador.
- **Datos sensibles:** PII cifrada en reposo (AES-256-GCM) con revelado auditado (`client/PII_REVEAL`); toda mutación queda en la bitácora (quién/cuándo/qué/IP), pero **no hay pantalla ni API para consultarla** (3.4).

---

## 8. Brechas y puntos no verificados

| # | Hallazgo | Estado |
|---|---|---|
| 1 | El alcance por fila no está en RLS (solo helpers en `002_scope.sql`); Cartera (clientes/créditos/pagos) no filtra por alcance: un cobrador ve la cartera de toda la cuenta por esos endpoints. | Verificado; coincide con `PLAN-SEGURIDAD.md §1.1`. |
| 2 | El supervisor depende de `user_accounts.branch_id` y no hay API para crear sucursales ni asignarlas. | Verificado por búsqueda. |
| 3 | `MANAGER`, `AUDITOR`, `VIEWER` no se pueden asignar desde API, web ni móvil. | Verificado. |
| 4 | Overrides por usuario: modelo sin código. | Verificado por búsqueda. |
| 5 | `audit:read` y `role:write` sin endpoint; PII revelada a todo `client:read`. | Verificado. |
| 6 | 2FA del administrador postergable indefinidamente. | Verificado (decisión explícita). |
| 7 | Desactivar miembro o suspender cuenta no revoca sesiones vivas; `refresh` no mira el estado de la cuenta. | Lectura de código; **ejecución no verificada**. |
| 8 | `photoRetentionMonths` no se hace cumplir. | Verificado por búsqueda. |
| 9 | Móvil sin gating de pestañas por rol. | Verificado. |
| 10 | Uso real de `SUPER_ADMIN`; uso de `isDefault` para preseleccionar cuenta; guard por pantalla web no listada; `requiresPasswordChange` en la web (no hay manejo). | **No verificado** / no existe. |
| 11 | `docs/security/PLAN-SEGURIDAD.md` (2026-08-26) está parcialmente desactualizado: cita `CASE_READ` para el cobrador y un `SET LOCAL` concatenado en `prisma.service.ts`; hoy los permisos son `collection:*` y se usa `set_config` con parámetros ligados. | Verificado contra el código actual. |
