# Discovery · 00-leads — pistas del análisis previo (2026-10-29)

> ⚠️ **Esto NO es Discovery.** Son pistas de una conversación de análisis, guardadas para no perderlas.
> En G1 cada una se **relee contra el código** y pasa a su archivo `01…09` como hallazgo (T1), o se descarta.
> No se usan como fundamento de un diseño ni de un plan hasta entonces.

| Lead | Hecho | Clase | Evidencia | Pasa a |
|---|---|---|---|---|
| L-01 | `Branch` es una lista plana por cuenta (sin padre ni tipo), con `managerUserId` suave | VERIFICADO | `packages/database/prisma/schema.prisma:134-155` | 01 |
| L-02 | Una persona tiene una sola oficina por cuenta | VERIFICADO | `schema.prisma:291,304` (`branchId?`, `@@unique([userId, accountId])`) | 01 |
| L-03 | El alcance `BRANCH` lo aplica el código de la aplicación; en la base solo hay `account` y `own` | VERIFICADO (código leído) / INFERIDO (que ninguna policy lo use: solo se vio la carpeta `prisma/rls/`) | `prisma.service.ts:93-97`; `mora-query.ts:127-143`; `rls/002_scope.sql:45-50` | 05 |
| L-04 | `SUPERVISOR` pasó de `data:scope:all` a `data:scope:branch`; gerente y administrador conservan `all` | VERIFICADO | migración `20261004010000_alcance_supervisor_agencia`; `shared/constants/permissions.ts:46,70` | 05 |
| L-05 | `MANAGER` tiene `DATA_SCOPE_ALL`; `ACCOUNT_ADMIN` tiene todos los permisos | VERIFICADO | `permissions.ts:17-48` | 05 |
| L-06 | Los roles son globales (nombre único, sin cuenta) | VERIFICADO | `schema.prisma:215-227` | 05 |
| L-07 | El móvil solo asigna `ACCOUNT_ADMIN`, `SUPERVISOR`, `COLLECTOR`; los otros se administran en web | VERIFICADO | `shared/constants/roles.ts:11` | 05 |
| L-08 | Crear/editar oficinas y mover gente exige `account:write`; `MANAGER` solo tiene `account:read` y `user:read` | VERIFICADO | `branches.controller.ts:16-43`; `permissions.ts:44-45` | 05 |
| L-09 | `credits.branch_id` sale del DTO o del alcance de la importación; no se encontró que se derive del responsable | VERIFICADO (origen) / INFERIDO (que no se derive) | `credits.service.ts:288`; `portfolio-credit.ts:109` | 02 |
| L-10 | La lista de Equipo no muestra ni filtra por oficina; el dashboard acepta `branchId` pero no ofrece selector; Cartera y Mora sí filtran | VERIFICADO (por búsqueda de texto) | `members-table.tsx`, `dashboard-filters.tsx`; `portfolio-table.tsx:150`; `lib/mora.ts:53`; `lib/dashboard.ts:80` | 03 |
| L-11 | **Contradicción:** `plans.ts:12` y `docs/producto/README.md` dicen que no hay función/API de sucursales; existe el módulo `branches` con alta, edición, baja y asignación | CONTRADICTORIO | `packages/shared/src/constants/plans.ts:12` · `docs/producto/README.md` (hallazgos transversales) vs `apps/api/src/modules/branches/` | 09 |
| L-12 | La grilla de planes fija «Sucursales» FREE=1, PROFESSIONAL=3, BUSINESS=10; en código no hay tope `branches` | INFERIDO | `docs/business/LIMITES-POR-PLAN.md:149`; `plans.ts:12` | 08 |
| L-13 | Según la documentación, el alcance por fila está activo solo en Mora, Agenda, Rutas y visitas; Cartera y Pagos muestran toda la cuenta | NO VERIFICADO (solo documento) | `docs/producto/README.md` (Producto) | 02 |
| L-14 | El móvil quedó desfasado de la web; existe un plan de alineación en curso; las 5 pestañas del móvil no se filtran por permiso | INFERIDO (documentos) | `F10/plans/alineacion-web/README.md:1-15`; `docs/producto/README.md` | 04 |
| L-15 | Hoy la única entrada de cartera es por archivo (`imports/portfolio`); el enum `CreditDataOrigin` reserva `API`; la búsqueda de texto no halló claves de máquina ni colas (`@Cron`, BullMQ); sí hay trabajos por CLI (`arrears:run`, `plan:lifecycle`) | VERIFICADO (búsqueda limitada) | `portfolio-import.controller.ts:56`; `schema.prisma:562-567`; `apps/api/package.json` | 06 |
| L-16 | La analítica calcula con SQL directo sobre tablas transaccionales (`credits`, `payments`, `route_plans`), varias consultas por carga | VERIFICADO | `analytics.service.ts:124-146,186,451`; `analytics.dto.ts:38` («seis consultas») | 02 |
| L-17 | El script `test` de la API lista los specs uno por uno | VERIFICADO | `apps/api/package.json` | 07 |
| L-18 | Hoy el despliegue es un solo servidor, sin balanceador ni réplica | INFERIDO (documento) | `docs/producto/demo-datos-y-despliegue.md:254` | 08 |
| L-19 | Qué rol y qué oficina recibe quien se registra solo (tenant individual) | DESCONOCIDO | `alineacion-web/README.md` §1.1 pide «verificar» | 02 |
| L-20 | Si `Role.level` se usa; si analítica se protege con `report:read`; si `branch_id` viaja en JWT/sesión; si hay policies RLS por alcance fuera de `prisma/rls/` | DESCONOCIDO | — | 05 |
