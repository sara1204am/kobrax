# @kobrax/database

Schema de Prisma, migraciones, seeds y políticas RLS de PostgreSQL.

## Cobertura del schema

- **Pilar 1 — Multi-tenant / Acceso**: `accounts, branches, users, profiles, roles, permissions, role_permissions, user_permission_overrides, user_accounts, user_sessions, audit_logs`
- **Pilar 2 — Clientes y Créditos**: `clients, client_contacts, client_locations, client_relations, client_attachments, credits, credit_installments, arrears`
- **Pilar 3 — Casos y Rutas**: `collection_cases, case_activities, route_plans, route_stops, field_visits, field_evidences`
- **Pilar 4 — Pagos**: `payments, payment_requests`
- **Transversal**: `notifications`

> Las tablas transversales de seguridad (`access_log`, `data_access_log`, `security_event`, `tenant_encryption_key`, `file_integrity`) se modelan en la fase de Hardening (F12).

### Inmutabilidad por diseño
`payments`, `field_visits` y `field_evidences` no tienen `updated_at`/`deleted_at`: son **append-only**. La corrección se hace con registros de reverso auditados, nunca editando.

## Convenciones (no negociables)

- Modelos `PascalCase` singular · columnas `snake_case` via `@map` · tablas `snake_case` plural via `@@map`.
- `id` uuid; `created_at` / `updated_at` / `deleted_at` (soft delete) en entidades maestras.
- `account_id` + índice en toda tabla operativa.
- Enums nativos de PostgreSQL.

## Comandos

```bash
pnpm db:generate     # genera el cliente Prisma
pnpm db:migrate      # crea/aplica migración en dev
pnpm db:seed         # carga permisos, roles y tenant demo (idempotente)
pnpm db:studio       # explora la DB
```

## RLS (aislamiento multi-tenant)

Tras cada migración que cree tablas operativas, aplicar las políticas:

```bash
psql "$DATABASE_URL" -f prisma/rls/001_enable_rls.sql
```

La API setea el contexto del tenant antes de cada query (ver `withTenant()` en `src/index.ts`):

```sql
SET LOCAL app.current_account_id = '<uuid>';
```

> El rol `kobrax_app` NO debe tener `BYPASSRLS`. Nunca conectar la app como superuser.

## Credenciales del seed demo

Tenant `DEMO` · contraseña común `Kobrax123!`:

| Email | Rol |
|-------|-----|
| `owner@kobrax.demo` | ACCOUNT_ADMIN (owner) |
| `supervisor@kobrax.demo` | SUPERVISOR |
| `collector@kobrax.demo` | COLLECTOR |

El caso de cobranza demo queda asignado al `collector`. Seed idempotente (upsert).

## Verificar aislamiento multi-tenant (RLS)

```bash
docker exec -i kobrax-postgres psql -U postgres -d kobrax -f - < prisma/rls/verify_isolation.sql
```

## Monitoreo de queries

`pg_stat_statements` está habilitado (ver `docker-compose.yml`):

```sql
SELECT query, calls, mean_exec_time
FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 20;
```
