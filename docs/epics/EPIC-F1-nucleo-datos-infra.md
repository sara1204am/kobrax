# EPIC F1 — Núcleo de Datos completo + Infra de desarrollo

**ID:** EPIC-F1 · **Estado:** ✅ Completado · **Owner:** Database (+ Shared, Root)
**Depende de:** F0 (fundación) · **Requisitos:** RF-01 (base), RF-06/07/08/09 (modelo), RNF-02/04

> Epic de referencia (retrospectivo). Documenta lo realmente construido y la
> evidencia de verificación.

## 1. Objetivo de negocio
Tener el modelo de datos de los **4 pilares** de Kobrax migrado en PostgreSQL con
**aislamiento multi-tenant garantizado a nivel de motor (RLS)**, e infraestructura
local reproducible. Es el cimiento sobre el que se construye todo el backend.

## 2. Alcance
### Incluye
- Modelo Prisma de Pilar 3 (casos/rutas/visitas/evidencia) y Pilar 4 (pagos) + notificaciones.
- Enums de aplicación en `@kobrax/shared`.
- Infra dev: PostgreSQL 15 + Redis 7 (docker-compose), rol `kobrax_app`.
- Primera migración real, políticas RLS, seed con cadena operativa demo.

### No incluye (out of scope)
- Tablas transversales de seguridad (`access_log`, `data_access_log`, `security_event`,
  `tenant_encryption_key`, `file_integrity`) → **F12**.
- Cualquier endpoint o lógica de negocio (eso es F2+).
- Test automatizado de RLS con testcontainers → **F2** (requiere harness de tests).

## 3. Historias y tareas

| # | Tarea | Agente | Entregable | Estado |
|---|-------|--------|------------|--------|
| 1 | Modelar Pilar 3 | Database | 6 modelos + 7 enums Prisma | ✅ |
| 2 | Modelar Pilar 4 + notificaciones | Database | 3 modelos + 3 enums | ✅ |
| 3 | Enums de app | Shared | `route/visit/payment-request/notification/case-activity` | ✅ |
| 4 | docker-compose + rol app | Root | `docker-compose.yml`, init `kobrax_app` | ✅ |
| 5 | Migración inicial | Database | `20260616022844_init_pillars_1_to_4` | ✅ |
| 6 | Políticas RLS | Database | `prisma/rls/001_enable_rls.sql` (23 tablas) | ✅ |
| 7 | Seed operativo demo | Database | tenant + 3 usuarios + cadena cliente→…→pago | ✅ |
| 8 | Índices parciales del hot-path | Database | migración `add_partial_active_indexes` (7 índices) | ✅ |
| 9 | Monitoreo de queries | Root/Database | `pg_stat_statements` habilitado | ✅ |

### Migraciones y plan de rollback
Prisma **no hace rollback automático**. Estrategia definida:
- **Dev:** `pnpm db:reset` (recrea DB + re-aplica migraciones + seed). Para una migración
  fallida: `prisma migrate resolve --rolled-back <name>`, corregir el SQL y `migrate deploy`
  (procedimiento ya usado con `add_partial_active_indexes`).
- **Prod:** toda migración destructiva (rename/drop) debe acompañarse de un `down.sql` manual
  revisado + backup previo. La migración inicial es additiva (solo `CREATE`); su reversión es
  un `DROP` completo del schema (equivalente a restaurar desde backup).
- **Nomenclatura:** `verb_subject` descriptivo. `init_pillars_1_to_4` describe el alcance
  (no es genérico); las siguientes siguen el patrón (`add_refresh_tokens`, etc.).

## 4. Contratos y modelo de datos
- **28 modelos / 24 enums** (`prisma validate` ✅). Cobertura: Pilares 1–4 + notificaciones.
- Inmutabilidad por diseño: `payments`, `field_visits`, `field_evidences` sin `updated_at`/`deleted_at`.
- Anti-doble-pago: únicos `(account_id, external_transaction_id)` y `(account_id, receipt_number)`.
- Helper RLS `app_current_account()` devuelve `text` (los `id` de Prisma son `text`, no `uuid` nativo).

### Índices (verificados en `pg_indexes`)
**Compuestos (Prisma `@@index`/`@@unique`)** — ya creados:
```
clients:           (account_id), (account_id, client_status), (account_id, national_id), (deleted_at)
collection_cases:  (account_id, status), (account_id, assignee_id), (account_id, client_id), (deleted_at)
credits:           (account_id), (account_id, status), (account_id, client_id), (deleted_at)
payments:          (account_id, credit_id), (account_id, payment_date),
                   UNIQUE(account_id, external_transaction_id), UNIQUE(account_id, receipt_number)
field_visits:      (account_id, case_id), (account_id, collector_id)
```
**Parciales del hot-path** (migración `add_partial_active_indexes`, `WHERE deleted_at IS NULL`):
```
idx_branches_account_active, idx_clients_account_active, idx_credits_account_active,
idx_cases_account_active, idx_cases_status_active, idx_cases_assignee_active,
idx_users_status_active
```
> Decisión: índices parciales **compuestos** `(account_id, …) WHERE deleted_at IS NULL` en lugar
> del literal `(deleted_at)` del template del agente, porque el patrón real es "filas vivas de mi
> tenant", no "buscar borrados". Los repositorios filtran `deleted_at IS NULL` por defecto.

### Vistas materializadas (analytics)
**Diferidas a F11 (Analítica)** — decisión consciente. `mv_daily_recovery` y derivadas dependen de
datos de pagos/casos que recién maduran tras F5–F7; crearlas en F1 sería prematuro. F11 las crea
con su política de refresco (cron) e índices únicos.

### Seed (documentado)
- **Tenants:** 1 (`DEMO`, INDEPENDENT/STARTER, BO/BOB). El `Tenant B` solo existe en
  `verify_isolation.sql` (efímero, para la prueba de aislamiento).
- **Usuarios (3, todos `pass: Kobrax123!`):** `owner@` (ACCOUNT_ADMIN, isOwner), `supervisor@`
  (SUPERVISOR), `collector@` (COLLECTOR). El caso demo queda asignado al `collector`.
- **Catálogo:** 23 permisos + 7 roles con sus `role_permissions`.
- **Cadena operativa:** cliente → crédito (2 cuotas + mora) → caso → ruta → parada → visita →
  evidencia (hash) → pago.
- **Idempotencia:** por `upsert` (permisos/roles/usuarios/tenant) y guarda por `nationalId`
  para la cadena operativa. **No** usa `deleteMany`. Re-ejecutable sin duplicar.
- **seed:test (pendiente F2):** se añadirá un seed mínimo y determinista, separado de este
  seed de dev, junto con el harness de tests (testcontainers).

## 5. Seguridad & Cumplimiento (checklist)
- [x] `account_id` en las 21 tablas operativas, con índice.
- [x] RLS `ENABLE` + `FORCE` en 23 tablas (incluye `accounts` y overrides).
- [x] Rol de app `kobrax_app` **NOSUPERUSER / NOBYPASSRLS** (verificado en `pg_roles`).
- [x] Separación de URLs: `DATABASE_URL` (migraciones, superuser) vs `APP_DATABASE_URL` (runtime, `kobrax_app`).
- [x] Evidencia con `file_hash` SHA-256 (campo obligatorio en `field_evidences`).
- [ ] Cifrado AES-256 de campos sensibles → se implementa en **F4**.

### Estado actual de campos sensibles (para la migración de F4)
Hoy están como **texto plano** (sin cifrar). F4 los migrará a AES-256-GCM **conservando datos**
(leer plano → cifrar → escribir; no recrear columnas). Tipo actual:
```
clients.national_id   : String  (plaintext temporal → AES-256 en F4)
clients.tax_id        : String  (plaintext temporal → AES-256 en F4)
client_contacts.value : String  (teléfono/email; plaintext temporal → AES-256 en F4)
profiles.phone        : String  (plaintext temporal → AES-256 en F4)
profiles.document_number : String (plaintext temporal → AES-256 en F4)
users.mfa_secret      : String? (plaintext temporal → cifrar en F2/F4)
```
> Ningún dato sensible se expone en respuestas ni logs en fases previas; la tokenización
> de presentación (`777****`) también es responsabilidad de F4.

## 6. Criterios de aceptación (DoD) — con evidencia
- [x] `prisma validate` → **28 modelos / 24 enums**.
- [x] `docker compose up` → `postgres` y `redis` **healthy**.
- [x] `prisma migrate dev` aplica en limpio → `20260616022844_init_pillars_1_to_4`.
- [x] Índices parciales aplicados → migración `add_partial_active_indexes` (7 índices `*_active`).
- [x] RLS aplicada → **23 tablas, 23 políticas**.
- [x] `pg_stat_statements` activo (`SELECT … FROM pg_stat_statements`).
- [x] `db:seed` corre idempotente (catálogo + tenant DEMO + 3 usuarios con rol + cadena operativa).
- [x] **Aislamiento multi-tenant verificado** (reproducible vía `prisma/rls/verify_isolation.sql`):

  | Conexión | clientes | casos |
  |----------|----------|-------|
  | superuser (sin RLS) | 2 | — |
  | `kobrax_app` · DEMO | 1 | 1 |
  | `kobrax_app` · Tenant B | 1 | **0** |
  | `kobrax_app` · sin contexto | **0** | — |

## 7. Estrategia de tests
- **Verificación reproducible** (no solo manual): script versionado
  [`prisma/rls/verify_isolation.sql`](../../packages/database/prisma/rls/verify_isolation.sql).
  Ejecutar: `docker exec -i kobrax-postgres psql -U postgres -d kobrax -f - < prisma/rls/verify_isolation.sql`.
- El **test automatizado** `rls.spec` (testcontainers) se difiere a F2 con el harness de Jest.

## 8. Observabilidad & métricas
- **`pg_stat_statements` habilitado** (docker-compose `shared_preload_libraries` + extensión).
  Permite monitoreo de queries lentas desde el día 1; F2+ lo consume para detectar N+1 y
  queries sin índice. Consulta base:
  `SELECT query, calls, mean_exec_time FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 20;`
- Logs de Prisma habilitados en dev (`query`, `warn`, `error`).

## 9. Riesgos y mitigaciones
| Riesgo | Mitigación aplicada |
|--------|---------------------|
| Puerto 5432 ocupado por PG nativo de Windows | Contenedor publicado en **5434**. |
| App conectada como superuser bypassea RLS | Rol `kobrax_app` dedicado + `FORCE RLS`. |
| `id` text vs uuid en políticas RLS | Helper `app_current_account()` retorna `text`. |

## 10. Contrato para fases siguientes

### Contrato OBLIGATORIO de contexto de tenant (F2)
La API **debe** conectar con `APP_DATABASE_URL` (rol `kobrax_app`) y, en **cada request
autenticado**, setear el contexto del tenant **dentro de la misma transacción** que ejecuta
las queries (porque `SET LOCAL` solo vive en su transacción):

```ts
// apps/api — patrón obligatorio (ya disponible como withTenant() en @kobrax/database)
await prisma.$transaction(async (tx) => {
  await tx.$executeRawUnsafe(`SET LOCAL app.current_account_id = '${accountId}'`);
  // ...todas las queries del request van aquí, sujetas a RLS...
});
```

Garantías que F2 debe preservar (verificadas en F1, ver `verify_isolation.sql`):
- Sin `SET` → `kobrax_app` devuelve **0 filas** (no es un fallo silencioso: no hay fuga, hay vacío).
- `account_id` del JWT == el del `SET LOCAL`. **Nunca** derivar el tenant del body/params.
- `accountId` debe sanitizarse/validarse como UUID antes de interpolar (evitar inyección en el `SET`).
- Defensa en profundidad: además del RLS, `TenantGuard` valida que el recurso pertenece al tenant.
- **Prohibido** ejecutar queries de negocio con `DATABASE_URL` (superuser): bypassea RLS.

### Otras notas
- **Vistas materializadas** → se crean en **F11** (Analítica), no antes.
- **Cifrado de campos sensibles** → **F4** (ver §5 para el estado actual y el tipo de cada campo).
- **Tablas transversales de seguridad** (`access_log`, `security_event`, BYOK…) → **F12**.
- **Usuarios para tests de F2**: el seed ya provee `owner`/`supervisor`/`collector` con roles
  distintos, suficientes para probar RBAC y aislamiento.
