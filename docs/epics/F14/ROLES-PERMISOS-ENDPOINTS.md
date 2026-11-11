# F14 · Anexo — los 202 endpoints y el permiso que exigen

> Generado el 2026-11-04 leyendo los metadatos de Nest (`@Roles` y `@UseGuards`) de los 25 controladores. Acompaña a [`ROLES-PERMISOS-AUDITORIA.md`](./ROLES-PERMISOS-AUDITORIA.md).
>
> - **Permiso(s) exigido(s):** los que declara el guard (`RolesGuard` exige **todos**). _solo sesión_ = hay que estar autenticado pero no se pide permiso (rutas propias: perfil, sesiones, notificaciones, archivos). _público_ = sin autenticación (login, registro, salud…).
> - **Roles que pasan:** los que tienen todos los permisos del guard. Es el *permiso*; el **alcance por oficina** recorta además sobre qué datos.
> - Hay permisos que se comprueban **dentro del servicio** y no aparecen aquí (ver hallazgo R-05: `route:write`, `route:assign`, `route:execute`).

| Método | Ruta | Permiso(s) exigido(s) en el guard | Roles que pasan |
|---|---|---|---|
| GET | `/agenda` | `agenda:read` | Super admin, Admin, Gerente, Supervisor, Cobrador |
| POST | `/agenda` | `agenda:write` | Super admin, Admin, Gerente, Supervisor, Cobrador |
| DELETE | `/agenda/:id` | `agenda:write` | Super admin, Admin, Gerente, Supervisor, Cobrador |
| GET | `/agenda/:id` | `agenda:read` | Super admin, Admin, Gerente, Supervisor, Cobrador |
| PATCH | `/agenda/:id` | `agenda:write` | Super admin, Admin, Gerente, Supervisor, Cobrador |
| POST | `/agenda/:id/cancel` | `agenda:write` | Super admin, Admin, Gerente, Supervisor, Cobrador |
| POST | `/agenda/:id/complete` | `agenda:write` | Super admin, Admin, Gerente, Supervisor, Cobrador |
| POST | `/agenda/:id/postpone` | `agenda:write` | Super admin, Admin, Gerente, Supervisor, Cobrador |
| POST | `/agenda/:id/reschedule` | `agenda:write` | Super admin, Admin, Gerente, Supervisor, Cobrador |
| GET | `/agenda/assignees` | `agenda:assign` | Super admin, Admin, Gerente, Supervisor |
| POST | `/agenda/clients/:clientId/contacts` | `agenda:write` | Super admin, Admin, Gerente, Supervisor, Cobrador |
| GET | `/agenda/clients/:clientId/context` | `agenda:write` | Super admin, Admin, Gerente, Supervisor, Cobrador |
| POST | `/agenda/clients/:clientId/locations` | `agenda:write` | Super admin, Admin, Gerente, Supervisor, Cobrador |
| PATCH | `/agenda/clients/:clientId/locations/:locationId` | `agenda:write` | Super admin, Admin, Gerente, Supervisor, Cobrador |
| GET | `/agenda/overdue` | `agenda:read` | Super admin, Admin, Gerente, Supervisor, Cobrador |
| GET | `/agenda/summary` | `agenda:read` | Super admin, Admin, Gerente, Supervisor, Cobrador |
| GET | `/analytics/agenda-summary` | `report:read` | todos |
| GET | `/analytics/collection-trend` | `report:read` | todos |
| GET | `/analytics/collector-performance` | `report:read` | todos |
| GET | `/analytics/portfolio-aging` | `report:read` | todos |
| GET | `/analytics/summary` | `report:read` | todos |
| GET | `/analytics/visit-map` | `report:read` | todos |
| POST | `/uploads` | _solo sesión_ | todos |
| GET | `/uploads/:name` | _solo sesión_ | todos |
| DELETE | `/assignments/:id` | `assignment:write` | Super admin, Admin, Gerente, Supervisor |
| GET | `/assignments/assignees` | `assignment:write` | Super admin, Admin, Gerente, Supervisor |
| POST | `/assignments/bulk` | `assignment:write` | Super admin, Admin, Gerente, Supervisor |
| POST | `/assignments/support` | `assignment:write` | Super admin, Admin, Gerente, Supervisor |
| POST | `/assignments/temporary` | `assignment:write` | Super admin, Admin, Gerente, Supervisor |
| GET | `/auth/accounts` | _solo sesión_ | todos |
| POST | `/auth/change-password` | _solo sesión_ | todos |
| POST | `/auth/forgot-password` | _público_ | todos |
| GET | `/auth/invitation/:code` | _público_ | todos |
| POST | `/auth/invitation/accept` | _público_ | todos |
| POST | `/auth/login` | _público_ | todos |
| POST | `/auth/logout` | _público_ | todos |
| GET | `/auth/me` | _solo sesión_ | todos |
| POST | `/auth/mfa/backup-codes/regenerate` | _solo sesión_ | todos |
| POST | `/auth/mfa/challenge` | _público_ | todos |
| POST | `/auth/mfa/disable` | _solo sesión_ | todos |
| POST | `/auth/mfa/enroll` | _solo sesión_ | todos |
| POST | `/auth/mfa/setup/skip` | _público_ | todos |
| POST | `/auth/mfa/setup/start` | _público_ | todos |
| POST | `/auth/mfa/setup/verify` | _público_ | todos |
| POST | `/auth/mfa/verify` | _solo sesión_ | todos |
| POST | `/auth/refresh` | _público_ | todos |
| POST | `/auth/reset-password` | _público_ | todos |
| POST | `/auth/select-account` | _público_ | todos |
| DELETE | `/auth/sessions` | _solo sesión_ | todos |
| GET | `/auth/sessions` | _solo sesión_ | todos |
| DELETE | `/auth/sessions/:id` | _solo sesión_ | todos |
| POST | `/auth/switch-account` | _solo sesión_ | todos |
| GET | `/visits` | `route:read` | todos |
| POST | `/visits` | `route:read` | todos |
| GET | `/visits/:id` | `route:read` | todos |
| POST | `/visits/:id/evidence` | `route:read` | todos |
| GET | `/arrear-categories` | `collection:read` | todos |
| PUT | `/arrear-categories` | `account:write` | Super admin, Admin |
| GET | `/catalogs/:catalog` | `catalog:read` | Super admin, Admin, Gerente, Supervisor, Cobrador |
| POST | `/catalogs/:catalog` | `catalog:write` | Super admin, Admin, Gerente |
| DELETE | `/catalogs/:catalog/:id` | `catalog:write` | Super admin, Admin, Gerente |
| PATCH | `/catalogs/:catalog/:id` | `catalog:write` | Super admin, Admin, Gerente |
| GET | `/clients` | `client:read` | todos |
| POST | `/clients` | `client:write` | Super admin, Admin, Gerente, Cobrador |
| DELETE | `/clients/:id` | `client:write` | Super admin, Admin, Gerente, Cobrador |
| GET | `/clients/:id` | `client:read` | todos |
| PATCH | `/clients/:id` | `client:write` | Super admin, Admin, Gerente, Cobrador |
| POST | `/clients/:id/attachments` | `client:write` | Super admin, Admin, Gerente, Cobrador |
| DELETE | `/clients/:id/attachments/:aid` | `client:write` | Super admin, Admin, Gerente, Cobrador |
| PATCH | `/clients/:id/attachments/:aid` | `client:write` | Super admin, Admin, Gerente, Cobrador |
| POST | `/clients/:id/collaterals` | `client:write` | Super admin, Admin, Gerente, Cobrador |
| DELETE | `/clients/:id/collaterals/:gid` | `client:write` | Super admin, Admin, Gerente, Cobrador |
| PATCH | `/clients/:id/collaterals/:gid` | `client:write` | Super admin, Admin, Gerente, Cobrador |
| POST | `/clients/:id/contacts` | `client:write` | Super admin, Admin, Gerente, Cobrador |
| DELETE | `/clients/:id/contacts/:cid` | `client:write` | Super admin, Admin, Gerente, Cobrador |
| PATCH | `/clients/:id/contacts/:cid` | `client:write` | Super admin, Admin, Gerente, Cobrador |
| GET | `/clients/:id/income-profile` | `client:read` | todos |
| PUT | `/clients/:id/income-profile` | `client:write` | Super admin, Admin, Gerente, Cobrador |
| POST | `/clients/:id/locations` | `client:write` | Super admin, Admin, Gerente, Cobrador |
| DELETE | `/clients/:id/locations/:lid` | `client:write` | Super admin, Admin, Gerente, Cobrador |
| PATCH | `/clients/:id/locations/:lid` | `client:write` | Super admin, Admin, Gerente, Cobrador |
| GET | `/clients/:id/pdf` | `client:read` | todos |
| POST | `/clients/:id/relations` | `client:write` | Super admin, Admin, Gerente, Cobrador |
| DELETE | `/clients/:id/relations/:rid` | `client:write` | Super admin, Admin, Gerente, Cobrador |
| PATCH | `/clients/:id/relations/:rid` | `client:write` | Super admin, Admin, Gerente, Cobrador |
| GET | `/clients/:id/timeline` | `client:read` | todos |
| POST | `/clients/duplicate-check` | `client:read` | todos |
| GET | `/credits` | `credit:read` | Super admin, Admin, Gerente, Supervisor, Cobrador, Auditor |
| POST | `/credits` | `credit:write` | Super admin, Admin, Gerente, Cobrador |
| GET | `/credits/:id` | `credit:read` | Super admin, Admin, Gerente, Supervisor, Cobrador, Auditor |
| PATCH | `/credits/:id` | `credit:write` | Super admin, Admin, Gerente, Cobrador |
| POST | `/credits/:id/arrears` | `credit:write` | Super admin, Admin, Gerente, Cobrador |
| POST | `/credits/:id/arrears/clear` | `credit:write` | Super admin, Admin, Gerente, Cobrador |
| POST | `/credits/:id/link-client` | `credit:write` | Super admin, Admin, Gerente, Cobrador |
| POST | `/credits/:id/recalculate-arrears` | `credit:write` | Super admin, Admin, Gerente, Cobrador |
| GET | `/credits/:id/schedule` | `credit:read` | Super admin, Admin, Gerente, Supervisor, Cobrador, Auditor |
| DELETE | `/credits/:id/write-off` | `credit:write` | Super admin, Admin, Gerente, Cobrador |
| POST | `/credits/:id/write-off` | `credit:write` | Super admin, Admin, Gerente, Cobrador |
| POST | `/credits/link-review/:clientId/confirm` | `credit:write` | Super admin, Admin, Gerente, Cobrador |
| POST | `/credits/reassign-office` | `assignment:write` | Super admin, Admin, Gerente, Supervisor |
| POST | `/accounts` | _público_ | todos |
| GET | `/accounts/me` | `account:read` | Super admin, Admin, Gerente |
| PATCH | `/accounts/me` | `account:write` | Super admin, Admin |
| GET | `/accounts/me/activity` | `audit:read` | Super admin, Admin, Auditor |
| GET | `/accounts/me/plan-history` | `account:read` | Super admin, Admin, Gerente |
| GET | `/accounts/me/requests` | `account:read` | Super admin, Admin, Gerente |
| POST | `/accounts/me/requests` | `account:write` | Super admin, Admin |
| GET | `/accounts/me/retention` | `account:read` | Super admin, Admin, Gerente |
| POST | `/accounts/me/transfer-ownership` | `account:write` | Super admin, Admin |
| GET | `/notifications/devices` | _solo sesión_ | todos |
| POST | `/notifications/devices` | _solo sesión_ | todos |
| DELETE | `/notifications/devices/:installationId` | _solo sesión_ | todos |
| GET | `/exports/agenda` | `report:export` | Super admin, Admin, Gerente, Auditor |
| GET | `/exports/backup` | `report:export` | Super admin, Admin, Gerente, Auditor |
| GET | `/exports/clients` | `report:export` | Super admin, Admin, Gerente, Auditor |
| GET | `/exports/locations` | `report:export` | Super admin, Admin, Gerente, Auditor |
| GET | `/exports/mora` | `report:export` | Super admin, Admin, Gerente, Auditor |
| POST | `/imports/portfolio` | `client:import` | Super admin, Admin, Gerente, Supervisor, Cobrador |
| GET | `/imports/portfolio/advisors` | `client:import` | Super admin, Admin, Gerente, Supervisor, Cobrador |
| DELETE | `/imports/portfolio/advisors/:code` | `client:import` | Super admin, Admin, Gerente, Supervisor, Cobrador |
| PUT | `/imports/portfolio/advisors/:code` | `client:import` | Super admin, Admin, Gerente, Supervisor, Cobrador |
| GET | `/imports/portfolio/config` | `client:import` | Super admin, Admin, Gerente, Supervisor, Cobrador |
| PATCH | `/imports/portfolio/config` | `client:import` | Super admin, Admin, Gerente, Supervisor, Cobrador |
| GET | `/imports/portfolio/runs` | `client:import` | Super admin, Admin, Gerente, Supervisor, Cobrador |
| GET | `/imports/portfolio/runs/:id` | `client:import` | Super admin, Admin, Gerente, Supervisor, Cobrador |
| GET | `/imports/portfolio/runs/:id/file` | `client:import`, `client:pii:read` | Super admin, Admin, Gerente |
| GET | `/imports/portfolio/runs/:id/items` | `client:import` | Super admin, Admin, Gerente, Supervisor, Cobrador |
| POST | `/clients/imports` | `client:import`, `client:write` | Super admin, Admin, Gerente, Cobrador |
| GET | `/mora` | `collection:read` | todos |
| GET | `/mora/:creditId` | `collection:read` | todos |
| POST | `/mora/:creditId/activities` | `collection:write` | Super admin, Admin, Gerente, Supervisor, Cobrador |
| GET | `/mora/:creditId/episodes` | `collection:read` | todos |
| GET | `/mora/:creditId/metrics` | `collection:read` | todos |
| GET | `/mora/:creditId/notes` | `collection:read` | todos |
| POST | `/mora/:creditId/notes` | `collection:write` | Super admin, Admin, Gerente, Supervisor, Cobrador |
| DELETE | `/mora/:creditId/notes/:noteId` | `collection:write` | Super admin, Admin, Gerente, Supervisor, Cobrador |
| PATCH | `/mora/:creditId/notes/:noteId` | `collection:write` | Super admin, Admin, Gerente, Supervisor, Cobrador |
| PATCH | `/mora/:creditId/priority` | `collection:write` | Super admin, Admin, Gerente, Supervisor, Cobrador |
| GET | `/mora/:creditId/promises` | `collection:read` | todos |
| GET | `/mora/branches` | `collection:read` | todos |
| GET | `/mora/export.csv` | `collection:export`, `collection:read` | todos |
| GET | `/mora/export.pdf` | `collection:export`, `collection:read` | todos |
| GET | `/notifications` | _solo sesión_ | todos |
| POST | `/notifications/:id/read` | _solo sesión_ | todos |
| POST | `/notifications/read-all` | _solo sesión_ | todos |
| GET | `/branches` | `office:read` | Super admin, Admin, Gerente, Supervisor |
| POST | `/branches` | `office:write` | Super admin, Admin |
| DELETE | `/branches/:id` | `office:write` | Super admin, Admin |
| GET | `/branches/:id` | `office:read` | Super admin, Admin, Gerente, Supervisor |
| PATCH | `/branches/:id` | `office:write` | Super admin, Admin |
| POST | `/branches/:id/deactivate` | `office:write` | Super admin, Admin |
| POST | `/branches/:id/members` | `office:write` | Super admin, Admin |
| DELETE | `/branches/:id/members/:userId` | `office:write` | Super admin, Admin |
| POST | `/branches/:id/move` | `office:write` | Super admin, Admin |
| POST | `/branches/:id/restore` | `office:write` | Super admin, Admin |
| GET | `/payment-requests` | `payment:read` | todos |
| POST | `/payment-requests` | `payment:write` | Super admin, Admin, Gerente, Supervisor, Cobrador |
| GET | `/payment-requests/:id` | `payment:read` | todos |
| POST | `/payment-requests/:id/confirm` | `payment:approve` | Super admin, Admin, Gerente |
| GET | `/payments` | `payment:read` | todos |
| POST | `/payments` | `payment:write` | Super admin, Admin, Gerente, Supervisor, Cobrador |
| GET | `/payments/:id` | `payment:read` | todos |
| GET | `/users` | `user:read` | Super admin, Admin, Gerente |
| DELETE | `/users/:id` | `user:write` | Super admin, Admin |
| GET | `/users/:id` | `user:read` | Super admin, Admin, Gerente |
| PATCH | `/users/:id` | `user:write` | Super admin, Admin |
| GET | `/users/:id/activity` | `user:read` | Super admin, Admin, Gerente |
| GET | `/users/:id/activity/events` | `user:read` | Super admin, Admin, Gerente |
| GET | `/users/:id/audit` | `audit:read` | Super admin, Admin, Auditor |
| GET | `/users/:id/connections` | `user:write` | Super admin, Admin |
| POST | `/users/:id/invite/resend` | `user:invite` | Super admin, Admin |
| POST | `/users/invite` | `user:invite` | Super admin, Admin |
| GET | `/users/me/profile` | _solo sesión_ | todos |
| PATCH | `/users/me/profile` | _solo sesión_ | todos |
| GET | `/roles` | `role:read` | Super admin, Admin |
| GET | `/routes` | `route:read` | todos |
| POST | `/routes` | `route:read` | todos |
| GET | `/routes/:id` | `route:read` | todos |
| PATCH | `/routes/:id` | `route:read` | todos |
| GET | `/routes/:id/change-requests` | `route:read` | todos |
| POST | `/routes/:id/change-requests` | `route:read` | todos |
| PATCH | `/routes/:id/change-requests/:rid` | `route:read` | todos |
| POST | `/routes/:id/optimize` | `route:read` | todos |
| GET | `/routes/:id/pdf` | `route:read` | todos |
| GET | `/routes/:id/preview` | `route:read` | todos |
| POST | `/routes/:id/stops` | `route:read` | todos |
| DELETE | `/routes/:id/stops/:sid` | `route:read` | todos |
| PATCH | `/routes/:id/stops/:sid` | `route:read` | todos |
| POST | `/routes/generate` | `route:read` | todos |
| POST | `/routes/leg` | `route:read` | todos |
| POST | `/routes/plan-preview` | `route:read` | todos |
| GET | `/health` | _público_ | todos |
| GET | `/health/live` | _público_ | todos |
| GET | `/dashboards` | `report:read` | todos |
| POST | `/dashboards` | `report:read` | todos |
| DELETE | `/dashboards/:id` | `report:read` | todos |
| GET | `/dashboards/:id` | `report:read` | todos |
| PATCH | `/dashboards/:id` | `report:read` | todos |
| POST | `/dashboards/:id/duplicate` | `report:read` | todos |
| GET | `/branch-types` | `office:read` | Super admin, Admin, Gerente, Supervisor |
| POST | `/branch-types` | `office:write` | Super admin, Admin |
| PATCH | `/branch-types/:id` | `office:write` | Super admin, Admin |
