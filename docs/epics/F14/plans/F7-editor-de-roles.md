> ESTADO: BORRADOR (2026-11-08). Pendiente `validar F7` (G4). **D-1…D-9 son propuestas: la usuaria debe aprobarlas antes de construir** (D-3 y D-4 son las que cambian lo que se ve y lo que se puede romper). Ninguna línea de producto se toca antes del PASS de G4.

# Plan F7 · Editor de roles y permisos

> Resuelve **R-07 (UI/API)** del plan maestro (`ROLES-PERMISOS-PLAN.md` §E «Fase 7» y Anexo 1, vistas A–F). Va después de F6, que dejó creada la sección **Seguridad** (`/seguridad`) y la puerta `requirePermission`. Es la última fase de la orden vigente de la usuaria (F4→F7).

## 1. Objetivo
Que el administrador de una cuenta pueda **ver, comparar y cambiar los permisos de los roles de su propia cuenta** desde la web, con las reglas de seguridad del plan maestro (sin dejarse sin administrador, sin concederse más de lo que tiene, sin tocar lo reservado, con dependencias coherentes), con el efecto inmediato sobre las sesiones de las personas afectadas y con cada cambio auditado dentro de la misma transacción.

## 2. Rama
`f14/p7-editor-roles`, desde `f14/p6-web-nav` (F4, F5 y F6 aún no están en `main`).

## 3. Estado inicial con evidencia (releído 2026-11-08)

| # | Hallazgo | Evidencia | Clase |
|---|---|---|---|
| E1 | `GET /roles` existe pero es **otra cosa**: la lista de roles que quien pregunta puede *ofrecer al invitar o cambiar un rol* (globales, de `tier` inferior, sin reservados). La consumen el diálogo de invitar de la web y el formulario del móvil. No sirve ni puede cambiar de forma para el editor. | `apps/api/src/modules/users/roles.controller.ts:7-15`; `users.service.ts:542-551`; web `equipo/invite-dialog.tsx`; móvil `src/account-form.ts` | VERIFICADO |
| E2 | **No hay ningún camino** (API ni web) para cambiar los permisos de un rol de una cuenta. El único escritor de `account_role_permissions` fuera del alta de cuenta es el *rollout* de plataforma, que además **salta** los roles con `diverged_at` no nulo. | `modules/platform/*` (sin endpoints de roles de empresa); `migrations/20261107030000_f14_f5_platform/migration.sql:102` | VERIFICADO |
| E3 | `AccountRole` ya guarda `version`, `diverged_at`, `template_key`, `tier`, `is_system`; `AccountRolePermission` guarda `source` (`TEMPLATE`/`CUSTOM`), `granted_by`, `granted_at`. **Ningún código de la aplicación escribe `diverged_at` ni `version`**: hoy la divergencia no se registra. | `schema.prisma:411-449`; `grep divergedAt apps/api/src` (sin coincidencias fuera de specs) | VERIFICADO |
| E4 | El catálogo de permisos ya trae `risk` (LOW/MEDIUM/HIGH/CRITICAL), `reserved` (`PLATFORM` / `ADMIN_CORE`) y `requires` (JSON de códigos). `ADMIN_CORE` son exactamente `role:write`, `user:write`, `account:write`, `office:write`. Los permisos de plataforma no están en el enum de empresa. Hay 49 permisos. | `schema.prisma:301-326`; `migrations/20261107010000_f14_f5_account_roles/migration.sql:21-27`; `packages/shared/src/enums/permission.enum.ts` | VERIFICADO |
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
- **API nueva `/account-roles`** (módulo propio), con permiso `role:read` para leer y `role:write` para escribir:
  - `GET /account-roles` — roles de la cuenta con origen (plantilla / personalizado), si **difiere** de la plantilla, personas, alcance de datos, cantidad de permisos y última modificación.
  - `GET /account-roles/permissions` — catálogo de permisos agrupado por módulo (código, acción, alcance, riesgo, reservado, dependencias).
  - `GET /account-roles/:key` — detalle: permisos concedidos, diferencia contra la plantilla (añadidos / quitados) y personas.
  - `PUT /account-roles/:key/permissions` — reemplaza el conjunto de permisos (con `expectedVersion` y motivo).
  - `POST /account-roles/:key/restore-template` — vuelve a los permisos de la plantilla (con motivo).
  - `GET /account-roles/:key/history` — historial paginado desde la auditoría.
  - `GET /account-roles/compare?a=&b=` — comparación de dos roles.
- **Política `role.editPermissions`** (en `POLICIES`) con las reglas de la sección 5 / D-3.
- **Auditoría atómica** (`AuditService.recordInTx`) y **renovación inmediata** de las sesiones de las personas del rol (`bumpInTx` + `publish`).
- **Registro de la divergencia** (`diverged_at`, `version`) al editar y al restaurar.
- **Web** (vistas A–F del Anexo 1): `/seguridad/roles` (A), `/seguridad/roles/[key]` (B), `/seguridad/roles/[key]/editar` (C), `/seguridad/roles/comparar` (D), historial (E, pestaña de B y vista propia) y el modal de confirmación (F); la tarjeta «Roles y permisos» en el índice de Seguridad; textos es/en de cada permiso.
- Pruebas unitarias, de integración y de componentes (sección 10); snapshot de puertas regenerado.

**Fuera**
- **Crear y borrar roles** (H-9: operación de plataforma en una fase posterior). Sin `POST /account-roles` ni `DELETE`.
- **Editar `ACCOUNT_ADMIN`** (inmutable, ADR/H-13) y cambiar `tier`, `key` o `template_key` de cualquier rol.
- Editar las **plantillas globales** y el *rollout* (siguen siendo de plataforma, F5).
- Cambiar el rol de **una persona** (ya lo hace Equipo, F2).
- **Móvil** (F8): sigue sin tocarse; recibe los permisos nuevos en su próximo refresco (`AUTHZ_STALE`) igual que hoy.
- Permisos por persona (los *overrides* se retiraron en F5, H-4).
- Rediseño visual / personalización de la interfaz (F15).

## 5. Dependencias
F1 (versiones de autorización), F3 (políticas), F5 (roles por cuenta, atributos del catálogo), F6 (sección Seguridad, `requirePermission`). H-3, H-4, H-9, H-11, H-13 aprobadas (2026-11-04). El plan maestro, Anexo 1, es el diseño de las vistas.

### Decisiones de la fase (todas **PROPUESTA**, esperan a la usuaria)
| ID | Decisión | Estado |
|---|---|---|
| D-1 | La API del editor vive en **`/account-roles`**, no en `/roles`: `GET /roles` conserva su forma (lista de asignables, E1) para no romper el diálogo de invitar ni el móvil. (El plan maestro decía `/roles…`; esta es la única desviación.) | PROPUESTA |
| D-2 | La divergencia se **calcula** comparando con la plantilla (fuente de verdad para la pantalla) y además se **registra** en `diverged_at` al primer cambio efectivo; `restore-template` la limpia. Así el *rollout* de plataforma sigue saltando los roles tocados (E2). | PROPUESTA |
| D-3 | **Reglas de la política `role.editPermissions`:** (a) actor con `role:write`; (b) el rol destino no es `ACCOUNT_ADMIN`; (c) los permisos reservados (`ADMIN_CORE`, `PLATFORM`) **no se añaden ni se quitan** en ningún rol; (d) cada permiso añadido debe tenerlo el actor («no concede más de lo que posee»); (e) las dependencias (`requires`) deben quedar satisfechas y no se puede quitar un permiso del que otro concedido depende; (f) a lo sumo un `data:scope:*`, y siempre uno; (g) si el actor pertenece al rol que edita, el cambio sólo puede **quitar** (`ROLE_SELF_ELEVATION`); (h) `expectedVersion` desfasada → 409 `ROLE_VERSION_CONFLICT`. | PROPUESTA |
| D-4 | **Motivo obligatorio** (mínimo 5 caracteres) en **todo** guardado y en restaurar plantilla, no sólo en los de riesgo alto; el modal F lista el riesgo alto añadido, a cuántas personas afecta y avisa que sus sesiones se renuevan. | PROPUESTA |
| D-5 | El cambio, la subida de `version`, la renovación de `authz_version` de las membresías del rol y la fila de auditoría ocurren en **una sola transacción**; la publicación a Redis va después del commit (`publish`). Se agrega `AuditService.recordInTx(tx, entry)`. | PROPUESTA |
| D-6 | El historial sale de `audit_logs` (`entity='account_role'`, `entity_id` = id del rol) y guarda en `before`/`after` sólo **códigos añadidos y quitados** y el motivo (sin datos personales). Incluye los cambios de plataforma (rollout) si los hay. | PROPUESTA |
| D-7 | Nombres y descripciones de los permisos: **claves de i18n por código** en la web (es/en), con la columna `name`/`description` de la base como respaldo si falta una clave; un test exige que los 49 códigos tengan clave en ambos idiomas. | PROPUESTA |
| D-8 | Una sesión de soporte sólo puede editar roles con el consentimiento y el interruptor ya existentes (E12); no se agrega nada, se prueba. | PROPUESTA |
| D-9 | Cualquier persona con `role:read` ve la lista, el detalle, la comparación y el historial (sólo lectura); los botones de editar / restaurar sólo se dibujan con `role:write`. En una cuenta de una sola persona (gratuito individual) el módulo existe pero no cambia nada de lo que usa. | PROPUESTA |

### Cruce con la alineación móvil en curso (regla D1)
El móvil no se toca (decisión de la usuaria, `mobile-refactor-pendiente-f14`). Los permisos que cambie el editor le llegan por el mecanismo existente de versiones (`AUTHZ_STALE` → refresco); `GET /roles` no cambia (D-1). No hay endpoints nuevos que el móvil consuma.

## 6. Archivos afectados (IDs HUB; los nuevos se crean al cerrar la fase)

| ID HUB | Archivo / símbolo | Cambio |
|---|---|---|
| H14-062 (nuevo) | `apps/api/src/modules/account-roles/` (nuevo: controller, service, dto, serializer, spec) + registro en el módulo de la app | API del editor |
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
| Textos de 49 permisos incompletos en un idioma. | D-7: test de completitud es/en. |
| Mezclar `/roles` (asignables) con el editor. | D-1: rutas separadas; test de que `GET /roles` conserva su forma. |

## 10. Pruebas
**Existentes que deben seguir verdes:** API `npm test` (2029), `authz-coverage` (con snapshot regenerado), `permission-gates.spec`, `f5-roles-plataforma.it.ts`, `users.service.spec` (rol/oficina), web `vitest` (1283), `tsc` en api, web y shared.

**Nuevas (registradas en `test` / `test:integration` de la API; vitest recoge las de la web):**
- Política `role.editPermissions`: una prueba por regla de D-3 (a…h) y una positiva; no edita `ACCOUNT_ADMIN`; no añade ni quita reservados; no concede lo que el actor no tiene; dependencias; un solo alcance; auto-elevación; conflicto de versión.
- Servicio: cálculo de divergencia y diferencia contra la plantilla; `restore-template`; comparación; historial paginado; el cambio y la auditoría son atómicos (si la auditoría falla, el cambio no queda); `diverged_at` y `version`.
- Integración `f7-editor-roles.it.ts`: el administrador cambia el rol de UNA cuenta y la otra no cambia; el token del cobrador renovado ya no trae el permiso quitado y su petición siguiente es rechazada con el contrato nuevo; un supervisor / gerente sin `role:write` recibe 403 al editar y 200 al leer; sesión de soporte sin consentimiento 403 (D-8); *rollout* de plataforma salta el rol editado; `GET /roles` conserva su forma; RLS entre cuentas.
- Shared: tipos y códigos; completitud de i18n de los 49 permisos en es/en.
- Web: lista (A), detalle (B), editor (C: marcar con dependencia, alcance único, reservados bloqueados, barra de cambios), modal (F: motivo obligatorio y errores del servidor sin cerrar), comparación (D), historial (E), `<NoAccess/>` sin `role:read`, botones ocultos sin `role:write`.
- **Snapshot de puertas:** 7 endpoints nuevos cambian `authz-snapshot.json`; se regenera y se pide la aprobación al cerrar G5.

## 11. Rollback
Sin migraciones: sólo código y endpoints nuevos. Revertir la rama quita el editor sin tocar datos; los roles que ya se hubieran editado conservan sus permisos (siguen siendo válidos para el token). Si hiciera falta frenar el editor sin desplegar, quitar `role:write` de la plantilla (ya es `ADMIN_CORE`, sólo del administrador).

## 12. Tareas ordenadas (datos → API → web → móvil)
**Datos**
1. Verificar que no hace falta migración (índice de auditoría existente, E13; columnas `version`/`diverged_at` existentes, E3). Si la verificación contradice esto, registrarlo en INCIDENTS antes de seguir.

**API**
2. Tipos y códigos de error compartidos (`packages/shared`).
3. `AuditService.recordInTx` + spec.
4. Política `role.editPermissions` + spec (una por regla) y registro en `POLICIES`.
5. Módulo `account-roles`: lectura (lista, catálogo, detalle, comparar, historial), escritura (`PUT permissions`, `restore-template`) con `bumpInTx` y `publish`; DTO con validación y Swagger.
6. Specs del servicio; registro en el script `test`.
7. Integración `f7-editor-roles.it.ts`; registro en `test:integration`; snapshot de puertas regenerado.

**Web**
8. Claves de i18n de los 49 permisos y de las pantallas (es/en) + test de completitud.
9. Componentes (`RiskBadge`, `PermissionRow`, `PermissionModuleAccordion`, `ScopeRadio`, `ChangeSummaryBar`, `ConfirmSensitiveDialog`).
10. Pantallas A, B, E (lista, detalle, historial) con `requirePermission(role:read)`; tarjeta en `/seguridad`.
11. Editor C + modal F con `requirePermission(role:write)`; manejo de `ROLE_*`, `LAST_ADMIN` y 409.
12. Comparación D.

**Móvil:** ninguna (F8).

## 13. Criterios de cierre
- **G5:** salida pegada en `VERIFICATIONS.md` de: unitarias de API, shared y web; integración completa en `off` y en `enforce` (la fase toca autorización y datos de roles); `tsc` limpio; `next build`; regresión del gratuito individual (§8); snapshot de puertas regenerado y señalado a la usuaria.
- **G6:** `/code-review` con hallazgos corregidos o aceptados con motivo; recorrido del mapa de impacto por H14-062…070 y H14-047/048/051/052/054/058.
- **G7:** HUB, `STATUS`, `HANDOFF`, `VERIFICATIONS`, `INCIDENTS` y `docs/producto/roles-permisos-planes.md` al día. Fin de la orden F4→F7; **F8 (móvil) y F9 sólo con orden de la usuaria**.
