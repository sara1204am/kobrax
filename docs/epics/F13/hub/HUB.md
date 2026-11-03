# F13 · HUB — registro vivo de puntos de integración

> **Regla A4:** no se implementa un cambio transversal sin consultar este archivo y recorrer `IMPACT-MAP.md`.
> Responde: ¿qué depende de esto? · ¿qué reviso si lo toco? · ¿qué otros módulos se pueden romper? · ¿qué prueba lo protege?
> Plantilla de fila: `../../_framework/TEMPLATES.md` T3. Un ID nunca se reutiliza; si un punto desaparece, se marca `RETIRADO`.

## Estado de esta siembra
Las filas salen de la lectura de **2026-10-29** (búsquedas de `branchId`/`branch_id`/alcance y lectura de los archivos marcados con «L»).
- «L» = archivo/tramo **leído** ese día → la ubicación es VERIFICADA pero el estado sigue `SEMBRADO` hasta releerlo en G1.
- «B» = aparece en una búsqueda, **no leído** → NO VERIFICADO.
- Las columnas Consumidores/Dependencias/Riesgo se completan en G1. Un «—» significa «sin averiguar», no «sin ninguno».
- «Prueba» lista specs que **existen** en el repo; que realmente cubran el alcance/oficina es NO VERIFICADO.

## A · Datos (`packages/database`)
| ID | Módulo | Archivo y símbolo | Responsabilidad | Consumidores | Dependencias | Riesgo | Fase | Cambio realizado | Prueba | Estado |
|---|---|---|---|---|---|---|---|---|---|---|
| HUB-001 | Datos | `prisma/schema.prisma:134` `model Branch` (L) | Oficina plana por cuenta; `managerUserId` suave | HUB-017…022 | `Account` | — | — | — | `branches.service.spec.ts` | SEMBRADO |
| HUB-002 | Datos | `schema.prisma:286-308` `model UserAccount` (L): `branchId` L291, `@@unique([userId, accountId])` L304 | Pertenencia usuario↔cuenta↔rol↔oficina (una oficina por persona) | HUB-009, 011-016, 021, 023 | `Role`, `Branch` | — | — | — | `users.service.spec.ts` | SEMBRADO |
| HUB-003 | Datos | `schema.prisma:804-885` `model Credit` (L): `branchId` L808 | Oficina del crédito | HUB-011, 013, 016, 017 | `Branch` | — | — | — | `credits.service.spec.ts` | SEMBRADO |
| HUB-004 | Datos | `schema.prisma:1524` `model Payment` (B): `branchId` ~L1528 | Oficina del pago (copia la del crédito) | HUB-016, 018 | `Credit` | — | — | — | `payments.service.spec.ts` | SEMBRADO |
| HUB-005 | Datos | `schema.prisma:1328` `model RoutePlan` (B): `branchId` ~L1331 | Oficina de la ruta | HUB-016, 020 | `Branch` | — | — | — | `routes.service.spec.ts` | SEMBRADO |
| HUB-006 | Datos/Shared | `schema.prisma:66-71` `enum PermissionScope` {GLOBAL, ACCOUNT, BRANCH, OWN} (L); `packages/shared/src/enums/permission.enum.ts:5,86-93` `DATA_SCOPE_ALL`/`DATA_SCOPE_BRANCH` (L) | Vocabulario de alcance | HUB-007, 009, 011 | — | — | — | — | `permission-gates.spec.ts` | SEMBRADO |
| HUB-007 | Shared | `packages/shared/src/constants/permissions.ts:15` `ROLE_PERMISSIONS` (L) | Permisos por rol; fuente que siembra `role_permissions` | HUB-009, 011-015, web/móvil | HUB-006, 008 | — | — | — | `permission-gates.spec.ts` | SEMBRADO |
| HUB-008 | Shared | `enums/role.enum.ts:6` `RoleType`; `constants/roles.ts:11` `MOBILE_ROLES` (L) | Los 7 roles y cuáles asigna el móvil | HUB-007, 021, móvil | — | — | — | — | `users.service.spec.ts` | SEMBRADO |

## B · API (`apps/api/src`) — dónde se decide el alcance
| ID | Módulo | Archivo y símbolo | Responsabilidad | Consumidores | Dependencias | Riesgo | Fase | Cambio realizado | Prueba | Estado |
|---|---|---|---|---|---|---|---|---|---|---|
| HUB-009 | Base/RLS | `database/prisma.service.ts:78-100` `withTenant` (L): alcance `ACCOUNT` si hay `DATA_SCOPE_ALL`, si no `OWN` (L93-97) | Fija `app.scope` en la transacción | Todo servicio que usa `withTenant` | HUB-006, 010 | — | — | — | `src/database/prisma-scope.spec.ts` | SEMBRADO |
| HUB-010 | Base/RLS | `packages/database/prisma/rls/002_scope.sql:38-51` `app_current_scope()`, `app_scope_sees_all()` (L) | Lectura del alcance en la base; comentario anuncia el alcance «branch» futuro (L45) | Policies RLS (cuáles lo usan: DESCONOCIDO) | HUB-009 | — | — | — | — | SEMBRADO |
| HUB-011 | Mora | `modules/mora/mora-query.ts:127` `moraAccessConditions`, `:149` `moraScopeOf` (L) | Alcance ALL/BRANCH/OWN en SQL; BRANCH compara con **una** `branch_id` | Mora, Agenda (comentario L146), `visibleCredits` | HUB-002, 003, 006 | — | — | — | `mora-query.spec.ts`, `mora-scope-presets.spec.ts` | SEMBRADO |
| HUB-012 | Agenda | `modules/agenda/agenda.service.ts:175` `assignBranch`, `:212` `listAssignees` (B/parcial) | Límite de agencia al asignar y listar asignables | Agenda | HUB-002 | — | — | — | `agenda.service.spec.ts` | SEMBRADO |
| HUB-013 | Asignaciones | `modules/assignments/assignment.service.ts:118,156-165,216`; `assignment-rules.ts:58-71` `agencyViolations` (B/parcial) | Regla «solo dentro de mi agencia» | Cartera, Import, Agenda | HUB-002, 003 | — | — | — | `assignment.service.spec.ts`, `assignment.coverage.spec.ts`, `assignment.bulk.spec.ts` | SEMBRADO |
| HUB-014 | Import | `modules/imports/import-agency.ts:15` `assertImportAgency` (L) | Límite de agencia al repartir una importación | Import | HUB-013 | — | — | — | `import-agency.spec.ts` | SEMBRADO |
| HUB-015 | Import | `portfolio-import.service.ts:309-310` (alcance official/branch/account), `portfolio-credit.ts:109` (`branchId` del crédito por alcance), `import-config.ts:23` `ScopeKind` (B/parcial) | Define a qué oficina queda cada crédito importado | Import web y móvil | HUB-003 | — | — | — | `import-assignment.spec.ts`, `portfolio-credit.spec.ts`, `import-config.spec.ts` | SEMBRADO |
| HUB-016 | Analítica | `modules/analytics/analytics.service.ts:126,144,186,204,451`; `dto/analytics.dto.ts:36` (L parcial) | Filtro `branchId` opcional sobre tablas transaccionales; sin filtro por alcance del usuario (a verificar) | Dashboard web | HUB-003, 004, 005 | — | — | — | `analytics.service.spec.ts` | SEMBRADO |
| HUB-017 | Créditos | `modules/credits/credits.service.ts:288,332,463` (B) | `branchId` viene del DTO al crear/actualizar; filtro en listado | Cartera web, móvil | HUB-003 | — | — | — | `credits.service.spec.ts` | SEMBRADO |
| HUB-018 | Pagos | `modules/payments/payments.service.ts:174-182` `insertPayment` (B) | Copia `credit.branchId` al pago | Pagos web | HUB-003, 004 | — | — | — | `payments.service.spec.ts` | SEMBRADO |
| HUB-019 | Clientes | `modules/clients/clients.service.ts:460-463` (B) | Filtro de cliente por `branch_id` del crédito | Cartera | HUB-003 | — | — | — | `clients.service.spec.ts` | SEMBRADO |
| HUB-020 | Rutas | `modules/routes/routes.service.ts:306,376` (B) | `branchId` en creación/edición de rutas | Rutas web y móvil | HUB-005 | — | — | — | `routes.service.spec.ts`, `route-access.spec.ts` | SEMBRADO |
| HUB-021 | Usuarios | `modules/users/users.service.ts:187-216`; `member-detail.service.ts` (B/parcial) | Cambiar la oficina de un miembro y auditarlo | Equipo web | HUB-002 | — | — | — | `users.service.spec.ts`, `member-detail.service.spec.ts` | SEMBRADO |
| HUB-022 | Oficinas | `modules/branches/*` (`branches.service.ts` L completo; `branches.controller.ts:16-43` L parcial) | Alta/edición/baja/asignación de oficinas; lectura con `user:read`, escritura con `account:write` | Web Cuenta → Agencias | HUB-001, 002 | — | — | — | `branches.service.spec.ts` | SEMBRADO |
| HUB-023 | Auth | `modules/auth/auth.service.ts:39` fila con `branch_id` (B) | Si `branch_id` viaja al JWT/sesión: DESCONOCIDO | Web, móvil | HUB-002 | — | — | — | `auth.service.spec.ts` | SEMBRADO |
| HUB-024 | Shared | `types/user.types.ts:17,75` (`branchId`, `branchName`); `types/import.types.ts:120` (`branches`) (B) | Contratos que cruzan API↔web↔móvil | Web, móvil, API | HUB-002 | — | — | — | — | SEMBRADO |

## C · Web (`apps/web/src`)
| ID | Módulo | Archivo y símbolo | Responsabilidad | Consumidores | Dependencias | Riesgo | Fase | Cambio realizado | Prueba | Estado |
|---|---|---|---|---|---|---|---|---|---|---|
| HUB-025 | Cuenta | `app/(panel)/cuenta/agencias/{page,branches-manager}.tsx` (L page); `lib/cuenta-tabs.ts:22` (L) | Única pantalla que gestiona oficinas; pestaña con `user:read` | Administrador | HUB-022 | — | — | — | `branches-manager.test.tsx`, `cuenta-tabs.test.ts` | SEMBRADO |
| HUB-026 | Cartera | `app/(panel)/cartera/portfolio-table.tsx:150`; `lib/cartera-query.ts:28` (B) | Filtro de agencia | Cartera | HUB-017, 019 | — | — | — | — | SEMBRADO |
| HUB-027 | Mora | `lib/mora.ts:15,53`; `app/(panel)/mora/arrears-table.tsx` (B) | Filtro y columna de agencia | Mora | HUB-011 | — | — | — | `arrears-table.test.tsx`, `mora.test.ts` | SEMBRADO |
| HUB-028 | Dashboard | `lib/dashboard.ts:80` deja pasar `branchId`; `components/dashboard/dashboard-filters.tsx` **sin** selector de agencia (L búsqueda: 0 coincidencias) | El dashboard acepta el filtro pero no lo ofrece | Dashboard | HUB-016 | — | — | — | — | SEMBRADO |
| HUB-029 | Equipo | `app/(panel)/equipo/members-table.tsx` (sin columna/filtro de agencia: búsqueda 0 coincidencias); `equipo/[userId]/member-tabs.tsx:56` muestra la agencia en la ficha (L) | La lista no dice de qué oficina es cada miembro | Equipo | HUB-021 | — | — | — | `members-table.test.tsx` | SEMBRADO |
| HUB-030 | Import | `app/(panel)/import/ajustes/setup-steps.tsx`; `lib/import.ts` (B) | Elegir alcance por agencia en ajustes de importación | Import | HUB-015 | — | — | — | `import.test.ts` | SEMBRADO |

## D · Móvil (`apps/mobile`)
| ID | Módulo | Archivo y símbolo | Responsabilidad | Consumidores | Dependencias | Riesgo | Fase | Cambio realizado | Prueba | Estado |
|---|---|---|---|---|---|---|---|---|---|---|
| HUB-031 | Mora | `app/mora/[creditId].tsx:242` muestra `branchName` (L búsqueda) | Único lugar visible de agencia en la ficha | Cobrador | — | — | — | — | — | SEMBRADO |
| HUB-032 | Import | `app/ajustes/importacion.tsx:128,247,362`; `src/import.service.ts:255-280` `scopeRefName` (L búsqueda) | Elegir alcance por agencia al importar | Independiente | HUB-015 | — | — | — | `import.service.test.ts` | SEMBRADO |
| HUB-033 | Rutas | `src/routes.service.ts:51,63` `branchId?` (L búsqueda) | Campo opcional en contratos de ruta | Cobrador | HUB-020 | — | — | — | — | SEMBRADO |
| HUB-034 | Offline | `src/sync/hydrate.ts`, `src/offline-data.ts`, `src/sync/agenda-offline.ts` (B: coincidieron con una búsqueda de texto por «oficina»/«office»; **no leídos**) | Qué datos baja el teléfono: si respeta el alcance es DESCONOCIDO | Cobrador | — | — | — | — | — | SEMBRADO |

## Cómo se actualiza una fila
`SEMBRADO` → (G1) `VERIFICADO <fecha>` con consumidores y dependencias llenos → (fase) `MODIFICADO <fase>` con «Cambio realizado» y «Prueba» → (G7) `REVERIFICADO <fecha>`. Entradas nuevas se agregan al final de su sección con el siguiente ID libre.
