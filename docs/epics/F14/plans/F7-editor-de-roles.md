> ESTADO: CERRADO (G7 PASS 2026-11-08; G4 PASS 11/11). D-1…D-9 aprobadas por la usuaria el 2026-11-08, con D-1 en la opción B (un solo recurso `/roles`, principio de unificación Web/Mobile).

# Plan F7 · Editor de roles y permisos

> Resuelve **R-07 (UI/API)** del plan maestro (`ROLES-PERMISOS-PLAN.md` §E «Fase 7» y Anexo 1, vistas A–F). Va después de F6, que dejó creada la sección **Seguridad** (`/seguridad`) y la puerta `requirePermission`. Es la última fase de la orden vigente de la usuaria (F4→F7).

## 1. Objetivo
Que el administrador de una cuenta pueda **ver, comparar y cambiar los permisos de los roles de su propia cuenta** desde la web, con las reglas de seguridad del plan maestro (sin dejarse sin administrador, sin concederse más de lo que tiene, sin tocar lo reservado, con dependencias coherentes), con el efecto inmediato sobre las sesiones de las personas afectadas y con cada cambio auditado dentro de la misma transacción.

## 2. Rama
`f14/p7-editor-roles`, desde `f14/p6-web-nav` (F4, F5 y F6 aún no están en `main`).

## 3. Estado inicial con evidencia (releído 2026-11-08)

| # | Hallazgo | Evidencia | Clase |
|---|---|---|---|
| E1 | `/roles` tiene **un solo endpoint**, `GET /roles` (`role:read`): los roles que quien pregunta puede *ofrecer al invitar o cambiar un rol* (globales, de `tier` inferior, sin reservados), con la forma `{ id, name, level }` (`AssignableRole`, `packages/shared`). **Web y móvil lo consumen igual** (web: `equipo/page.tsx`, `equipo/[userId]/page.tsx`, `invite-dialog.tsx` vía el proxy `app/api/roles/route.ts`; móvil: `users.service.ts:37`, `account-form.ts`) con el mismo tipo compartido; el recorte por nivel lo hace el servidor y ninguna de las dos plataformas lo recalcula. El canal (`x-client-type`) sólo afecta la proyección de datos personales, no a los roles. | `apps/api/src/modules/users/roles.controller.ts:7-15`; `users.service.ts:542-551`; web `equipo/invite-dialog.tsx`; móvil `src/account-form.ts` | VERIFICADO |
| E2 | **No hay ningún camino** (API ni web) para cambiar los permisos de un rol de una cuenta. El único escritor de `account_role_permissions` fuera del alta de cuenta es el *rollout* de plataforma, que además **salta** los roles con `diverged_at` no nulo. | `modules/platform/*` (sin endpoints de roles de empresa); `migrations/20261107030000_f14_f5_platform/migration.sql:102` | VERIFICADO |
| E3 | `AccountRole` ya guarda `version`, `diverged_at`, `template_key`, `tier`, `is_system`; `AccountRolePermission` guarda `source` (`TEMPLATE`/`CUSTOM`), `granted_by`, `granted_at`. **Ningún código de la aplicación escribe `diverged_at` ni `version`**: hoy la divergencia no se registra. | `schema.prisma:411-449`; `grep divergedAt apps/api/src` (sin coincidencias fuera de specs) | VERIFICADO |
| E4 | El catálogo de permisos ya trae `risk` (LOW/MEDIUM/HIGH/CRITICAL), `reserved` (`PLATFORM` / `ADMIN_CORE`) y `requires` (JSON de códigos). `ADMIN_CORE` son exactamente `role:write`, `user:write`, `account:write`, `office:write`. Los permisos de plataforma no están en el enum de empresa. Hay 45 permisos. | `schema.prisma:301-326`; `migrations/20261107010000_f14_f5_account_roles/migration.sql:21-27`; `packages/shared/src/enums/permission.enum.ts` | VERIFICADO |
| E5 | La base ya impide dos permisos `data:scope:*` en un mismo rol de cuenta (trigger/restricción de F5) y `account_role_permissions` tiene RLS por cuenta. | `f5-roles-plataforma.it.ts:94-98`; migración `…010000_f14_f5_account_roles` | VERIFICADO |
| E6 | Las reglas con decisión por fila viven como **políticas** registradas en `POLICIES` (`member.invite`, `member.assignRole`, …). No existe una de roles. `tierOf`/`isReservedRole` ya calculan el nivel de un rol. | `common/authz/policies/index.ts:9-17`; `member-assign-role.policy.ts`; `common/authz/tier.ts:14-21` | VERIFICADO |
| E7 | Subir la versión de autorización de las membresías afectadas ya está resuelto: `AuthzVersionService.bumpInTx(tx, accountId, membershipIds)` dentro de la transacción y `publish(pending)` después del commit; `users.service.ts` lo usa al cambiar rol. | `auth/authz-version.service.ts:112-128`; `users/users.service.ts:282-286` | VERIFICADO |
| E8 | `AuditService.record` **no** participa de la transacción de negocio: abre la suya con `withTenant`, y si falla la traga con un log. El plan maestro exige (N-11) que el cambio de permisos y su auditoría sean atómicos. | `common/audit/audit.service.ts:43-70` | VERIFICADO |
| E9 | La regla «la cuenta nunca queda sin administrador» (`lastAdmin`) existe sólo para cambios de rol/estado de una **persona** (cuenta las otras personas ACCOUNT_ADMIN activas). Editar un rol no puede dejar la cuenta sin admin *mientras `ACCOUNT_ADMIN` no sea editable* y conserve sus permisos `ADMIN_CORE`. | `users/users.service.ts:215-227` | VERIFICADO |
| E10 | La web no tiene pantallas de roles. F6 dejó `/seguridad` (índice, hoy sólo «Accesos de soporte»), el ítem de menú con `role:read` y `requirePermission`. `DataTable`, `Button`, `Badge`, `PageHeader`, `EmptyState`, `NoAccess` y `RetryState` existen. | `apps/web/src/app/(panel)/seguridad/page.tsx`; `components/` | VERIFICADO |
| E11 | Los nombres y descripciones de los permisos sólo están en la base, en español; la web no tiene claves de i18n por permiso. | `packages/database/prisma/seed.ts` (columnas `name`/`description`); `apps/web/src/messages/*.json` (sin `permissions.*`) | VERIFICADO |
| E12 | `role:write` es permiso de escritura **sensible** en las sesiones de soporte: sólo entra al token con consentimiento del administrador y con `SUPPORT_WRITE_ENABLED`. | `packages/shared/src/constants/platform.ts:SUPPORT_SENSITIVE_PERMISSIONS` | VERIFICADO |
| E13 | El índice de auditoría para el historial ya existe: `(account_id, entity, entity_id)`. No hace falta migración. | `schema.prisma:677`; `migrations/20260616022844_init_pillars_1_to_4/migration.sql:616` | VERIFICADO |

## 4. Alcance / fuera de alcance

**Dentro**
- **Extensión del recurso `/roles`** (módulo `roles`, que absorbe el controlador y `listRoles` hoy en `users`), con permiso `role:read` para leer y `role:write` para escribir:
  - `GET /roles?assignable=false` — roles de la cuenta con origen (plantilla / personalizado), si **difiere** de la plantilla, personas, alcance de datos, cantidad de permisos y última modificación (sin el parámetro, el comportamiento actual intacto).
  - `GET /roles/permissions` — catálogo de permisos agrupado por módulo (código, acción, alcance, riesgo, reservado, dependencias).
  - `GET /roles/:key` — detalle: permisos concedidos, diferencia contra la plantilla (añadidos / quitados) y personas.
  - `PUT /roles/:key/permissions` — reemplaza el conjunto de permisos (con `expectedVersion` y motivo).
  - `POST /roles/:key/restore-template` — vuelve a los permisos de la plantilla (con motivo).
  - `GET /roles/:key/history` — historial paginado desde la auditoría.
  - `GET /roles/compare?a=&b=` — comparación de dos roles.
- **Política `role.editPermissions`** (en `POLICIES`) con las reglas de la sección 5 / D-3.
- **Auditoría atómica** (`AuditService.recordInTx`) y **renovación inmediata** de las sesiones de las personas del rol (`bumpInTx` + `publish`).
- **Registro de la divergencia** (`diverged_at`, `version`) al editar y al restaurar.
- **Web** (vistas A–F del Anexo 1): `/seguridad/roles` (A), `/seguridad/roles/[key]` (B), `/seguridad/roles/[key]/editar` (C), `/seguridad/roles/comparar` (D), historial (E, pestaña de B y vista propia) y el modal de confirmación (F); la tarjeta «Roles y permisos» en el índice de Seguridad; textos es/en de cada permiso.
- Pruebas unitarias, de integración y de componentes (sección 10); snapshot de puertas regenerado.

**Fuera**
- **Crear y borrar roles** (H-9: operación de plataforma en una fase posterior). Sin `POST /roles` ni `DELETE /roles/:key`.
- **Editar `ACCOUNT_ADMIN`** (inmutable, ADR/H-13) y cambiar `tier`, `key` o `template_key` de cualquier rol.
- Editar las **plantillas globales** y el *rollout* (siguen siendo de plataforma, F5).
- Cambiar el rol de **una persona** (ya lo hace Equipo, F2).
- **Móvil** (F8): sigue sin tocarse; recibe los permisos nuevos en su próximo refresco (`AUTHZ_STALE`) igual que hoy.
- Permisos por persona (los *overrides* se retiraron en F5, H-4).
- Rediseño visual / personalización de la interfaz (F15).

## 5. Dependencias
F1 (versiones de autorización), F3 (políticas), F5 (roles por cuenta, atributos del catálogo), F6 (sección Seguridad, `requirePermission`). H-3, H-4, H-9, H-11, H-13 aprobadas (2026-11-04). El plan maestro, Anexo 1, es el diseño de las vistas.

### Decisiones de la fase (todas APROBADAS por la usuaria, 2026-11-08)
| ID | Decisión | Estado |
|---|---|---|
| D-1 | **Opción B: un solo recurso `/roles`** (como decía el plan maestro). `GET /roles` sin parámetros **no cambia** (roles asignables, `{ id, name, level }`); las filas pasan a ser un superconjunto aditivo (campos opcionales `key`, `source`, `diverged`, `members`, `permissions`, `scopeKind`, `version`, `updatedAt`) y un filtro `?assignable=false` (por omisión `true`) devuelve todos los roles de la cuenta para el administrador. Las operaciones nuevas cuelgan del mismo recurso: `GET /roles/permissions`, `GET /roles/compare`, `GET /roles/:key`, `PUT /roles/:key/permissions`, `POST /roles/:key/restore-template`, `GET /roles/:key/history`. Un solo `RolesService` (que absorbe `listRoles`) y un solo controlador `roles`; no hay `/account-roles`. La diferencia web/móvil NO se modela en la API: el editor es sólo-web por decisión de producto, pero los endpoints no distinguen plataforma (se gobiernan por permisos). Análisis en §5b. | **APROBADA** (2026-11-08) |
| D-2 | La divergencia se **calcula** comparando con la plantilla (fuente de verdad para la pantalla) y además se **registra** en `diverged_at` al primer cambio efectivo; `restore-template` la limpia. Así el *rollout* de plataforma sigue saltando los roles tocados (E2). | **APROBADA** (2026-11-08) |
| D-3 | **Reglas de la política `role.editPermissions`:** (a) actor con `role:write`; (b) el rol destino no es `ACCOUNT_ADMIN`; (c) los permisos reservados (`ADMIN_CORE`, `PLATFORM`) **no se añaden ni se quitan** en ningún rol; (d) cada permiso añadido debe tenerlo el actor («no concede más de lo que posee»); (e) las dependencias (`requires`) deben quedar satisfechas y no se puede quitar un permiso del que otro concedido depende; (f) a lo sumo un `data:scope:*` (ninguno = alcance «propio», el del Cobrador, que hoy no tiene ninguno); (g) si el actor pertenece al rol que edita, el cambio sólo puede **quitar** (`ROLE_SELF_ELEVATION`); (h) `expectedVersion` desfasada → 409 `ROLE_VERSION_CONFLICT`. | **APROBADA** (2026-11-08) |
| D-4 | **Motivo obligatorio** (mínimo 5 caracteres) en **todo** guardado y en restaurar plantilla, no sólo en los de riesgo alto; el modal F lista el riesgo alto añadido, a cuántas personas afecta y avisa que sus sesiones se renuevan. | **APROBADA** (2026-11-08) |
| D-5 | El cambio, la subida de `version`, la renovación de `authz_version` de las membresías del rol y la fila de auditoría ocurren en **una sola transacción**; la publicación a Redis va después del commit (`publish`). Se agrega `AuditService.recordInTx(tx, entry)`. | **APROBADA** (2026-11-08) |
| D-6 | El historial sale de `audit_logs` (`entity='account_role'`, `entity_id` = id del rol) y guarda en `before`/`after` sólo **códigos añadidos y quitados** y el motivo (sin datos personales). Incluye los cambios de plataforma (rollout) si los hay. | **APROBADA** (2026-11-08) |
| D-7 | Nombres y descripciones de los permisos: **claves de i18n por código** en la web (es/en), con la columna `name`/`description` de la base como respaldo si falta una clave; un test exige que los 45 códigos tengan clave en ambos idiomas. | **APROBADA** (2026-11-08) |
| D-8 | Una sesión de soporte sólo puede editar roles con el consentimiento y el interruptor ya existentes (E12); no se agrega nada, se prueba. | **APROBADA** (2026-11-08) |
| D-9 | Cualquier persona con `role:read` ve la lista, el detalle, la comparación y el historial (sólo lectura); los botones de editar / restaurar sólo se dibujan con `role:write`. En una cuenta de una sola persona (gratuito individual) el módulo existe pero no cambia nada de lo que usa. | **APROBADA** (2026-11-08) |

### 5b. Análisis de D-1: ¿`/roles` y `/account-roles` separados, o un solo recurso?

**Inventario (hoy).** `/roles`: sólo `GET /roles`. Web y móvil lo consumen igual y con el mismo tipo compartido (E1). No hay operaciones equivalentes en endpoints distintos: invitar y cambiar rol van por `POST /users/invite` y `PATCH /users/:id` con `roleId`, idénticos para ambas plataformas; las validaciones `@IsUUID() roleId` y las políticas `member.invite` / `member.assignRole` viven una sola vez, en el servidor. La plataforma tiene su propio *rollout* de roles, pero es otra autoridad (persona de plataforma, ADR-F14-08), no un duplicado. No existe duplicación web/móvil que unificar: **ya están unificados**.

**¿`/account-roles` es otro recurso?** No. Es el mismo recurso (el rol de la cuenta) con otras operaciones: la lista de asignables es una *vista filtrada* (por el nivel de quien pregunta) de la colección de roles de la cuenta, y el editor opera sobre esa misma colección. Un `/account-roles` duplicaría la colección y obligaría a mantener dos servicios que calculan nivel, reservados y hechos del rol. Además, al retirar la columna `user_accounts.role_id` (release posterior, D-3 de F5), el `id` de `/roles` pasará a ser el del rol de cuenta: con dos recursos, web y móvil tendrían que migrar de uno a otro; con uno, el cambio es transparente.

**Alternativas.**
- **A. Separados (`/roles` + `/account-roles`).** Cero riesgo para consumidores, pero parte un recurso en dos, duplica la lógica de nivel / reservados / serialización y deja dos contratos para «un rol». Rechazada.
- **B. Unificar bajo `/roles`, compatible (elegida).** Sin parámetros, `GET /roles` es idéntico (misma ruta, mismo permiso, mismas filas filtradas, mismos campos obligatorios); se agregan campos opcionales (los clientes que no los conocen los ignoran) y el filtro `assignable` (por omisión `true`). Las operaciones nuevas están en rutas que hoy no existen (`/roles/:key…`), así que no chocan con nada. Un `RolesService` único con las reglas de nivel y reservados, reutilizadas por la política del editor.
- **C. Reemplazar el contrato de `GET /roles` por la colección completa y mover «asignables» a otra ruta.** Es lo conceptualmente más limpio, pero **rompe** a los móviles ya instalados (no se pueden forzar actualizaciones) y a la web desplegada a medias. Rechazada por compatibilidad.

**Consecuencias de B.** (1) Compatibilidad: un test de contrato fija que `GET /roles` sin parámetros conserva ruta, permiso y forma, y que web y móvil leen sólo `{ id, name, level }`. (2) Orden de rutas: `compare` y `permissions` se declaran antes de `:key`; ninguna clave de rol coincide con esas palabras (las claves son `MANAGER`, `COLLECTOR`…, en mayúsculas). (3) `?assignable=false` exige `role:read` como hoy; la regla de visibilidad no cambia. (4) El tipo compartido pasa de `AssignableRole` a `RoleSummary` (con `AssignableRole` como alias del subconjunto obligatorio): un único contrato en `packages/shared` para web y móvil. (5) El servicio absorbe `listRoles` de `UsersService`. (6) Si el móvil necesitara algún día el editor, usa las mismas rutas y reglas sin cambios en la API; que hoy sea sólo-web es una decisión de producto (H-5, F8), no de la API.

### Cruce con la alineación móvil en curso (regla D1)
El móvil no se toca (decisión de la usuaria, `mobile-refactor-pendiente-f14`). Los permisos que cambie el editor le llegan por el mecanismo existente de versiones (`AUTHZ_STALE` → refresco); `GET /roles` sin parámetros no cambia (D-1, opción B) y sigue siendo el que usa el móvil; los endpoints nuevos son del mismo recurso y no distinguen plataforma, pero el móvil no los consume en esta fase.

## 6. Archivos afectados (IDs HUB; los nuevos se crean al cerrar la fase)

| ID HUB | Archivo / símbolo | Cambio |
|---|---|---|
| H14-062 (nuevo) | `apps/api/src/modules/roles/` (nuevo: controller, service, dto, serializer, spec; absorbe `users/roles.controller.ts` y `UsersService.listRoles`) + `users.module.ts` + registro en el módulo de la app | Recurso `/roles`: lista (filtro `assignable`) y editor |
| H14-063 (nuevo) | `common/authz/policies/role-edit-permissions.policy.ts` (nuevo) + `policies/index.ts` + spec | Política `role.editPermissions` |
| H14-064 (nuevo) | `common/audit/audit.service.ts` (`recordInTx`) | Auditoría dentro de la transacción |
| H14-065 (nuevo) | `packages/shared` (tipos `AccountRoleSummary`, `AccountRoleDetail`, `PermissionCatalogEntry`, `RoleDiff`; códigos de error de roles) | Contratos compartidos |
| H14-066 (nuevo) | `apps/web/src/app/(panel)/seguridad/roles/**` (A, B, historial) y `seguridad/page.tsx` | Listado, detalle e historial |
| H14-067 (nuevo) | `seguridad/roles/[key]/editar/**`, componentes `PermissionRow`, `PermissionModuleAccordion`, `ScopeRadio`, `RiskBadge`, `ChangeSummaryBar`, `ConfirmSensitiveDialog` | Editor (C) y confirmación (F) |
| H14-068 (nuevo) | `seguridad/roles/comparar/**` | Comparación (D) |
| H14-069 (nuevo) | `apps/web/src/messages/es.json`, `en.json` (`permissions.*`, `roles.*`) | Textos |
| H14-070 (nuevo) | `docs/epics/F14/authz-snapshot.json`, `apps/api/package.json` (`test`, `test:integration`), `test/integration/f7-editor-roles.it.ts` (nuevo) | Cobertura y pruebas |
| H14-047 / 048 / 051 / 052 / 054 / 058 (existen) | `permissions.service`, consumidores por nombre de rol, plataforma, accesos de soporte, `requirePermission`, índice de Seguridad | consultados: ver IMPACT-MAP |

## 7. Invariantes que aplican
B1 (RLS: las lecturas y escrituras van por `withTenant`), B3/B4 (el servidor decide: la web sólo oculta), B5 (todo cambio de permisos se audita, en la transacción), B8/B9 (sin migraciones de datos), B10, B11, B12 (todo spec nuevo registrado en `test`), B13, F14-A H-3, H-4, H-9, H-11, H-13; C2 (una oficina / una persona no ve complejidad nueva); D1/D2 (el móvil no se toca; no arrastrar `docs/epics/F15/`). Regla de F6: **toda pantalla nueva con `requirePermission`**.

## 8. Perfiles de tenant y protección del gratuito individual
- **FREE / cobrador independiente (una persona, administrador):** no cambia nada de lo que usa. Puede abrir Seguridad › Roles y permisos (tiene `role:read`/`role:write`) pero no necesita hacerlo; su propio rol `ACCOUNT_ADMIN` es de sólo lectura. Cualquier cambio a roles que él no usa no afecta su token ni su menú.
- **Empresa:** el administrador ajusta Gerente / Supervisor / Cobrador / Auditor / Consulta; las personas con esos roles renuevan sus permisos en su próxima petición, sin cerrar sesión.
- **Regresión del gratuito individual (G5):** registrarse, iniciar sesión, ver el menú, crear cliente y crédito, registrar un pago, exportar, abrir Seguridad y ver la lista de roles sin errores, cambiar foto de perfil, refrescar el token; todo igual que en la línea base de F6.

## 9. Riesgos
| Riesgo | Mitigación |
|---|---|
| Quitar a un rol un permiso que su gente usa y dejar pantallas rotas. | Modal F con el conteo de personas afectadas y los permisos quitados; las sesiones se renuevan y las pantallas ya muestran `<NoAccess/>`/«Tus permisos cambiaron» (F6). |
| Quedarse sin administrador o sin poder editar roles. | `ACCOUNT_ADMIN` inmutable y reservados intocables (D-3 b/c); prueba que un guardado malicioso sobre `ACCOUNT_ADMIN` o con `role:write` es rechazado. |
| Escalada de privilegios (un rol se concede lo que el actor no tiene, o se auto-eleva). | D-3 d/g con pruebas de cada negación; las reglas viven en la política, no en la web. |
| Dos administradores editan a la vez. | `expectedVersion` → 409 y recarga con aviso. |
| Auditoría y cambio desfasados. | D-5: misma transacción; prueba que si la auditoría falla el cambio se revierte. |
| Cambios de un rol que no se reflejan en las sesiones abiertas. | `bumpInTx` + `publish`; prueba de integración: el token del cobrador deja de traer el permiso tras el cambio. |
| El *rollout* de plataforma pisa lo que el administrador personalizó. | `diverged_at` registrado (D-2); prueba de que el *rollout* salta el rol editado. |
| Textos de 45 permisos incompletos en un idioma. | D-7: test de completitud es/en. |
| Romper a los consumidores de `GET /roles` (móviles ya instalados, web). | D-1 opción B: sin parámetros no cambia; campos nuevos sólo opcionales; test de contrato de ruta, permiso y forma. |

## 10. Pruebas
**Existentes que deben seguir verdes:** API `npm test` (2029), `authz-coverage` (con snapshot regenerado), `permission-gates.spec`, `f5-roles-plataforma.it.ts`, `users.service.spec` (rol/oficina), contrato de `GET /roles`, web `vitest` (1283), `tsc` en api, web y shared.

**Nuevas (registradas en `test` / `test:integration` de la API; vitest recoge las de la web):**
- Política `role.editPermissions`: una prueba por regla de D-3 (a…h) y una positiva; no edita `ACCOUNT_ADMIN`; no añade ni quita reservados; no concede lo que el actor no tiene; dependencias; un solo alcance; auto-elevación; conflicto de versión.
- Servicio: cálculo de divergencia y diferencia contra la plantilla; `restore-template`; comparación; historial paginado; el cambio y la auditoría son atómicos (si la auditoría falla, el cambio no queda); `diverged_at` y `version`.
- Contrato de `GET /roles` (unitaria + integración): sin parámetros devuelve sólo los asignables con `{ id, name, level }` obligatorios, igual que antes; `?assignable=false` devuelve todos los roles de la cuenta; web y móvil leen sólo el subconjunto obligatorio.
- Integración `f7-editor-roles.it.ts`: el administrador cambia el rol de UNA cuenta y la otra no cambia; el token del cobrador renovado ya no trae el permiso quitado y su petición siguiente es rechazada con el contrato nuevo; un supervisor / gerente sin `role:write` recibe 403 al editar y 200 al leer; sesión de soporte sin consentimiento 403 (D-8); *rollout* de plataforma salta el rol editado; RLS entre cuentas.
- Shared: tipos y códigos; completitud de i18n de los 45 permisos en es/en.
- Web: lista (A), detalle (B), editor (C: marcar con dependencia, alcance único, reservados bloqueados, barra de cambios), modal (F: motivo obligatorio y errores del servidor sin cerrar), comparación (D), historial (E), `<NoAccess/>` sin `role:read`, botones ocultos sin `role:write`.
- **Snapshot de puertas:** 6 endpoints nuevos (`/roles/permissions`, `/roles/compare`, `/roles/:key`, `PUT …/permissions`, `POST …/restore-template`, `GET …/history`) cambian `authz-snapshot.json`; se regenera y se pide la aprobación al cerrar G5.

## 11. Rollback
Sin migraciones: sólo código y endpoints nuevos. Revertir la rama quita el editor sin tocar datos; los roles que ya se hubieran editado conservan sus permisos (siguen siendo válidos para el token). Si hiciera falta frenar el editor sin desplegar, quitar `role:write` de la plantilla (ya es `ADMIN_CORE`, sólo del administrador).

## 12. Tareas ordenadas (datos → API → web → móvil)
**Datos**
1. Verificar que no hace falta migración (índice de auditoría existente, E13; columnas `version`/`diverged_at` existentes, E3). Si la verificación contradice esto, registrarlo en INCIDENTS antes de seguir.

**API**
2. Tipos y códigos de error compartidos (`packages/shared`): `RoleSummary` (superconjunto) con `AssignableRole` como alias del subconjunto obligatorio.
3. `AuditService.recordInTx` + spec.
4. Política `role.editPermissions` + spec (una por regla) y registro en `POLICIES`.
5. Módulo `roles` (mueve el controlador y `listRoles` desde `users`; `GET /roles` idéntico sin parámetros): filtro `assignable`, lectura (catálogo, detalle, comparar, historial), escritura (`PUT permissions`, `restore-template`) con `bumpInTx` y `publish`; DTO con validación y Swagger.
6. Specs del servicio; registro en el script `test`.
7. Integración `f7-editor-roles.it.ts`; registro en `test:integration`; snapshot de puertas regenerado.

**Web**
8. Claves de i18n de los 45 permisos y de las pantallas (es/en) + test de completitud.
9. Componentes (`RiskBadge`, `PermissionRow`, `PermissionModuleAccordion`, `ScopeRadio`, `ChangeSummaryBar`, `ConfirmSensitiveDialog`).
10. Pantallas A, B, E (lista, detalle, historial) con `requirePermission(role:read)`; tarjeta en `/seguridad`.
11. Editor C + modal F con `requirePermission(role:write)`; manejo de `ROLE_*`, `LAST_ADMIN` y 409.
12. Comparación D.

**Móvil:** ninguna (F8).

## 13. Criterios de cierre
- **G5:** salida pegada en `VERIFICATIONS.md` de: unitarias de API, shared y web; integración completa en `off` y en `enforce` (la fase toca autorización y datos de roles); `tsc` limpio; `next build`; regresión del gratuito individual (§8); snapshot de puertas regenerado y señalado a la usuaria.
- **G6:** `/code-review` con hallazgos corregidos o aceptados con motivo; recorrido del mapa de impacto por H14-062…070 y H14-047/048/051/052/054/058.
- **G7:** HUB, `STATUS`, `HANDOFF`, `VERIFICATIONS`, `INCIDENTS` y `docs/producto/roles-permisos-planes.md` al día. Fin de la orden F4→F7; **F8 (móvil) y F9 sólo con orden de la usuaria**.
