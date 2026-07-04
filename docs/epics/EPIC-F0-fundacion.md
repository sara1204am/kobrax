# EPIC F0 — Fundación (Monorepo + Pilar 1 + Pilar 2)

**ID:** EPIC-F0 · **Estado:** ✅ Completado · **Owner:** Root + Database + Shared
**Depende de:** — · **Requisitos:** RF-01, RF-02, RF-03, RF-04, RF-05 (modelo de datos)

> Epic retrospectivo. Documenta el cimiento construido antes de F1: monorepo,
> paquete `shared`, y el modelo de datos de **Pilar 1 (Identidad/Acceso)** y
> **Pilar 2 (Clientes/Créditos)**. F1 añade encima Pilar 3+4 e infra.

## 1. Objetivo de negocio
Establecer la base técnica de Kobrax: monorepo Turborepo, contratos compartidos y
el modelo multi-tenant + RBAC + core financiero, sobre el que se asienta todo.

## 2. Alcance
### Incluye
- Monorepo (Turborepo + pnpm), `tsconfig.base`, prettier, `.env.example`.
- `@kobrax/shared` (enums, DTOs `{data,meta,error}`, constantes, utils).
- Pilar 1 (Identidad/Acceso) y Pilar 2 (Clientes/Créditos) en Prisma.
- Ubicación de los 8 agentes (CLAUDE.md) en sus dominios.

### No incluye
- Pilar 3/4, infra docker, RLS, migración → **F1**.
- Lógica de aplicación / endpoints → **F2+**.

## 3. Tablas entregadas (verificadas en `information_schema`)

### Pilar 1 — Identidad y Acceso
| Tabla | Campos clave | Cubre |
|-------|--------------|-------|
| `accounts` | `account_type`, `account_status`, `plan_code`, `max_users`, `country_code`, `currency_code`, `timezone`, `settings` JSONB, `configuration` JSONB | RF-01 |
| `branches` | `account_id`, `name`, `code`, `city`, `address`, `manager_user_id`, `active` | RF-01 (segmentación por sucursal) |
| `users` | `email`, `password_hash`, `mfa_enabled`, `mfa_secret`, `failed_login_attempts`, `locked_until`, `user_status`, `last_login_at` | RF-02, CU-01 |
| `profiles` | `user_id` (1:1), `first_name`, `last_name`, `phone`, `document_number`, `photo_url`, `employee_code`, `supervisor_user_id`, `hire_date` | RF-02 |
| `roles` | `name`, `level`, `is_system` | RF-03 |
| `permissions` | `code` (`{recurso}:{acción}`), `module`, `action`, `resource`, `scope` | RF-03 |
| `role_permissions` | `(role_id, permission_id)` | RF-03 |
| `user_permission_overrides` | `granted`, `reason`, `expires_at` (excepciones temporales) | RF-03 |
| `user_accounts` | `user_id`+`account_id`+`role_id`+`branch_id`, `is_owner`, `is_default` (multi-empresa) | RF-01/02 |
| `user_sessions` | `user_id`, `account_id`, `ip_address`, `device_info`, `login_at`, `logout_at`, `is_active` | CU-01 (sesiones) |
| `audit_logs` | append-only: `action`, `entity`, `before`/`after` JSONB, `ip`, `user_agent` | RNF-01 |

### Pilar 2 — Clientes y Créditos
| Tabla | Campos clave | Cubre |
|-------|--------------|-------|
| `clients` | `client_type`, `client_status`, `national_id`, `tax_id`, `risk_segment`, `metadata` JSONB | RF-04, CU-02 |
| `client_contacts` | `contact_type`, `value`, `is_primary`, `is_verified` | RF-04 |
| `client_locations` | GPS `latitude`/`longitude`, `zone`, `photo_urls`, `visit_schedule` | RF-04, RF-08 |
| `client_relations` | red de localización (`relationship_type`, `is_contactable`) | RF-04 |
| `client_attachments` | `file_type`, `file_url`, `file_hash`, `encrypted` | RF-04 |
| `credits` | `branch_id`, `principal_amount`, `outstanding_balance`, `interest_rate`, `currency`, `status`, `days_past_due`, `assigned_manager_id` | RF-05 |
| `credit_installments` | `number`, `due_date`, `amount`, `paid_amount`, `status` (cronograma) | RF-05 |
| `arrears` | `days_overdue`, `overdue_amount`, `interest`, `penalty` (mora) | RF-05, CU-03 |

## 4. Enums entregados (Pilar 1+2)
`AccountType` (FINANCIAL_INSTITUTION/COLLECTION_AGENCY/RETAIL_CREDIT/INDEPENDENT) ·
`AccountStatus` (ACTIVE/TRIAL/SUSPENDED/INACTIVE/CANCELLED) ·
`PlanCode` (STARTER/PROFESSIONAL/BUSINESS/ENTERPRISE) ·
`UserStatus` (ACTIVE/INACTIVE/SUSPENDED/**LOCKED**/PENDING) ·
`PermissionAction`, `PermissionScope` (global/account/branch/own) ·
`ClientType`, `ClientStatus`, `ContactType`, `LocationType`, `RelationshipType`,
`AttachmentType`, `CreditStatus`, `InstallmentStatus`.

## 5. Modelo RBAC + Multi-tenant
- **Identidad global** (`users`) ↔ **membresía por tenant** (`user_accounts`) con rol y sucursal.
  Un usuario puede pertenecer a varias cuentas con roles distintos.
- **RBAC granular**: `roles` → `role_permissions` → `permissions` + `user_permission_overrides`
  (excepciones con expiración). Permisos efectivos = base del rol ± overrides.
- **Separación credenciales/persona**: `users` (login) vs `profiles` (datos personales).
- `@kobrax/shared` expone `RoleType`, `Permission`, `PermissionScope`, `ROLE_PERMISSIONS`,
  `CASE_TRANSITIONS` como única fuente de verdad para la API y la UI.

## 6. Criterios de aceptación (DoD)
- [x] `prisma validate` ✅ (los 19 modelos de Pilar 1+2 forman parte de los 28 totales tras F1).
- [x] Las 8 áreas de agente (CLAUDE.md) ubicadas en sus rutas.
- [x] `@kobrax/shared` compila y exporta enums/DTOs/constantes/utils.
- [x] Estados de `account` y `user` (incl. `LOCKED`, `CANCELLED`) en enums nativos.

## 7. Estado heredado que consumen las fases siguientes
- **F1**: aplica RLS sobre estas tablas + añade Pilar 3/4 e infra.
- **F2 (auth)**: usa `users` (mfa/lockout/status), `user_sessions`, `user_accounts`, `roles`,
  `permissions`, `role_permissions`, `user_permission_overrides`. Añade `refresh_tokens` (no existe en F0/F1).
- **F4 (cifrado)**: cifra `clients.national_id`, `clients.tax_id`, `client_contacts.value`,
  `profiles.phone`, `profiles.document_number` (hoy texto plano — ver EPIC-F1 §5).
- **F11 (analítica)**: construye vistas materializadas sobre cases/payments/arrears.

> **Nota de trazabilidad:** este epic existe para que toda tabla de Pilar 1+2 tenga un
> documento de origen. Auditar el modelo de datos = EPIC-F0 (Pilar 1+2) + EPIC-F1 (Pilar 3+4).
