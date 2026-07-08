# Agenda · 00 — Fundación backend (catálogos + agenda_items)

> **ESTADO: ✅ CONSTRUIDO (2026-07-08, rama `f10/agenda-fundacion`).**
> Verde: API type-check + 174 tests (+8). Smoke real: login cobrador → catalogs (8) + agenda del día
> (deudor enriquecido) + overdue (2 de 3). Migración `20260708000000_add_agenda_module` aplicada + seed cargado.
> Índice: [README.md](./README.md) · Modelo: [DOMAIN.md](./DOMAIN.md).

## 1. Objetivo
Dejar el backend listo para el módulo: la tabla del agendado, sus enums, el sistema de catálogos
configurable por tenant, la seguridad (RLS + scope + audit) y datos de prueba. Sin esto ninguna
pantalla es funcional.

## 2. Prisma / DB
### 2.1 Enums (estructurales, también en `packages/shared`)
- `AgendaItemType`: CALL · VISIT · WHATSAPP · REMINDER · PROMISE_TO_PAY
- `AgendaItemStatus`: SCHEDULED · EXECUTED · CANCELLED · RESCHEDULED  (EXPIRED = derivado: SCHEDULED && fecha < hoy)
- `ScheduleTimeMode`: FIXED · LAPSE · RANGE
- `CatalogType`: PAYMENT_METHOD · BANK · EXPECTED_RESULT · PRIORITY · ADDRESS_TYPE · PHONE_TYPE · CANCEL_REASON · RESCHEDULE_REASON · REMINDER_CATEGORY · CAMPAIGN · CURRENCY

### 2.2 Tabla `agenda_items`
Núcleo en columnas; lo específico por tipo en `details` (JSONB, validado en shared).
| Campo | Tipo | Nota |
|---|---|---|
| id, accountId | uuid | RLS por accountId |
| caseId → collection_cases | uuid | **atado a caso** |
| clientId, creditId | uuid | crédito elegido (cliente puede tener varios) |
| assigneeId | uuid | responsable (default cobrador actual) |
| type | AgendaItemType | inmutable tras ejecutar |
| status | AgendaItemStatus | default SCHEDULED |
| priorityCode, expectedResultCode | string? | **refieren a `catalog_items.code`** (PRIORITY / EXPECTED_RESULT) |
| scheduledDate | Date | oblig., no pasado (salvo permiso) |
| timeMode | ScheduleTimeMode | default FIXED |
| scheduledTime | String? | HH:mm si FIXED |
| timeSlot | String? | LAPSE (MORNING/AFTERNOON/NIGHT) o RANGE ("08:00-10:00") |
| observations | String? | máx configurable |
| details | Jsonb | campos por tipo (ver DOMAIN) |
| resultActivityId | uuid? | case_activities creado al ejecutar |
| createdBy, updatedBy | uuid | audit |
| createdAt/updatedAt/deletedAt | | soft-delete |

Índices: `(accountId, assigneeId, scheduledDate)`, `(accountId, caseId)`, `(accountId, status)`.

### 2.3 Tabla `catalog_items` (genérica, configurable por tenant)
`(id, accountId, catalog: CatalogType, code, label, sortOrder, isActive, metadata jsonb, timestamps)`
con `@@unique(accountId, catalog, code)`, índice `(accountId, catalog, isActive)`.
`metadata` p.ej. `{ "requiresBank": true }` en un PAYMENT_METHOD.

### 2.4 RLS
Policy espejo de las tablas operativas para `agenda_items` y `catalog_items` (aislar por `accountId`).

## 3. Backend NestJS
### 3.1 Módulo `catalogs/`
- `GET /api/catalogs/:catalog` → items activos del tenant (ordenados por `sortOrder`).
- ABM `POST/PATCH/DELETE /api/catalogs/:catalog/:id?` (permiso `CATALOG_WRITE`; audit). **Sin UI** acá.
- Serializer `{ code, label, sortOrder, metadata }`.

### 3.2 Módulo `agenda/` (solo el esqueleto + validación base; los endpoints por pantalla en S1–S6)
- Service base con `withTenant`, scope por capacidad, mapa `type→CaseActivityType` para ejecutar (S4).
- Validador de `details` por tipo (esquemas en shared) — se usa al crear (S2).

### 3.3 Permisos (shared)
`AGENDA_READ` · `AGENDA_WRITE` · `CATALOG_WRITE`. (Decidir si reusar `CASE_*` o nuevos — propuesta: nuevos.)

## 4. Seed — poblar TODAS las tablas del módulo (no quede nada vacío)
> El seed actual (`prisma/seed.ts`) es mínimo: **1 cliente, 1 teléfono, 1 dirección, 1 crédito, 1 caso**.
> Insuficiente: los selectores (teléfono/dirección/crédito) necesitan **varias opciones**. Se amplía
> (idempotente, guardado como el demo actual):

1. **Catálogos** por tenant (`catalog_items`): medios de pago (efectivo/depósito/transferencia/QR/cheque/débito/crédito/pago móvil/caja/agencia/cobrador; los que requieren banco con `metadata.requiresBank`), bancos BO (Unión/BCP/Mercantil/BISA/Ganadero/FIE/Sol/EcoFuturo…), prioridades, resultados esperados (cobrar/recordar/confirmar visita/confirmar pago/negociar), tipos de dirección y teléfono, motivos cancelación/reprogramación, categorías de recordatorio, monedas.
2. **Clientes** (≥5) con datos ricos para probar selectores:
   - **Teléfonos** (`client_contacts`) **múltiples** por cliente: celular + oficina + casa + referencia (tipo vía catálogo PHONE_TYPE).
   - **Direcciones** (`client_locations`) **múltiples**: casa + trabajo + negocio (tipo vía ADDRESS_TYPE), con GPS.
   - **Créditos** (`credits`): al menos **un cliente con 2+ créditos** (distinto saldo) → probar "¿cuál crédito?".
   - **Casos** (`collection_cases`) abiertos **asignados al cobrador de prueba**.
3. **Agendados** (`agenda_items`) del cobrador en la **semana**, sobre esos casos/clientes, cubriendo los **5 tipos** con `details` realista (teléfono elegido, dirección elegida, monto+medio+banco en promesa, descripción+prioridad en recordatorio):
   - varios **HOY** (algún `EXECUTED` con `resultActivityId`),
   - varios **FUTUROS**,
   - **≥3 VENCIDOS** (PENDING/SCHEDULED con fecha previa) para probar "máx 2 + ver más".
4. Verificar que Home/Agenda muestren datos reales, no estados vacíos.

## 4.bis Auditoría de reuso (Paso B)
| Capacidad | Decisión | Path |
|---|---|---|
| Aislamiento por tenant | REUSAR | `PrismaService.withTenant` + patrón RLS de las tablas operativas |
| Contexto + scope por capacidad | REUSAR | `TenantContextService` (`accountId`/`userId`/`can()`) |
| Envelope `{data,meta,error}` + paginación | REUSAR | `ResponseDto` de `@kobrax/shared` |
| Audit trail | REUSAR | `AuditService.record` |
| Guards Jwt+Tenant+Roles + `@Roles` | REUSAR | `apps/api/src/modules/auth/guards` |
| Cliente / teléfonos / direcciones / créditos-saldo | REUSAR | `clients`, `client_contacts`, `client_locations`, `credits` |
| Medio de pago base | REUSAR / conciliar | enum `PaymentMethod` (ver decisión §7) |
| `agenda_items` + `catalog_items` + enums + `details` | NUEVO | Prisma + `packages/shared` (enums), no en móvil |

## 5. No-negociables / reglas de la fase
Multi-tenant por **capacidad** (nunca `tenantType`) · RLS en las 2 tablas nuevas · TS estricto sin `any` ·
`{data,meta,error}` · audit en toda mutación (crear/editar/eliminar/ejecutar) · enums de dominio SIEMPRE en
`packages/shared` (nunca redefinir en API/móvil). (Las 3 reglas UI de §3.3 no aplican: slice sin pantalla.)

## 6. Tests (node:test)
Catálogos: lectura filtra por tenant + activos + orden. Agenda: RLS/scope por cobrador; validación de
`details` por tipo (rechaza monto>saldo en PROMISE, teléfono faltante en CALL, etc.).

## 7. DoD
Migración aplicada + RLS activa; `GET /catalogs/:catalog` devuelve el seed; tablas listas para S1;
API `type-check` + tests verdes. (Sin UI → sin verificación de móvil en este slice.)

## 8. Decisiones (CERRADAS 2026-07-08)
- **Permisos NUEVOS** `AGENDA_READ`/`AGENDA_WRITE`/`CATALOG_WRITE` en `packages/shared` (no reusar `CASE_*`).
- **Medio de pago del agendado = catálogo** `PAYMENT_METHOD` (lista rica configurable). El enum `PaymentMethod`
  de `payments` queda intacto; al registrar el pago real (P4) se concilia catálogo→enum. No se toca `payments` acá.
- **Estados**: default `SCHEDULED`. Se **quita `PENDING`** del enum (todo agendado nace con fecha → SCHEDULED).
  Enum final: `SCHEDULED · EXECUTED · CANCELLED · RESCHEDULED` (+ `EXPIRED` derivado). "Vencido" = `SCHEDULED && scheduledDate < hoy`.
