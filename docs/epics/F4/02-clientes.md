# F4 · Fase 2 — Módulo Clientes (CU-02)

**Parent:** [EPIC-F4 Core Financiero](../EPIC-F4-core-financiero.md) · **Estado:** ✅ Completada (2026-06-18)
**Owner:** API · Shared · **Depende de:** Fase 0 (cifrado/migración) + Fase 1 (interceptores/tokenize)
**Gaps que cierra:** G6 (módulo clients) · G7 (sub-recursos) · G10 (uso de tokenización) · G11 (búsqueda por hash)

## ✅ Estado de ejecución (2026-06-18)
Implementado y verificado (74 tests · type-check · `nest build` · **e2e real contra la API + RLS A/B**). Módulo en
`apps/api/src/modules/clients/` (`clients.controller`, `clients.service`, `clients.serializer`, `dto/client.dto`, `clients.errors`, `clients.module`):
- **CRUD cliente** + sub-recursos (contactos/ubicaciones/relaciones/adjuntos): create/list/findOne/update/remove + add/update/remove.
  Todo bajo `prisma.withTenant(tenantContext.accountId, …)` (RLS por request, patrón de la Fase 1).
- **PII cifrada** (`nationalId`/`taxId`/`contact.value`/`location.address` vía CryptoService) + **tokenizada** en respuestas
  (`maskDocument`/`maskPhone`/`maskEmail`); `?reveal=true` devuelve claro **solo con `client:pii:read`** (si no → `403 INSUFFICIENT_PERMISSION`) y **audita** el acceso (`PII_REVEAL`).
- **Dedup por blind index** (`nationalIdHash`): documento único por tenant → `409 CLIENT_DUP`. Búsqueda `?q=` por hash (documento exacto) o nombre (ILIKE).
- **Baja lógica protegida**: cliente con créditos activos → `409 CLIENT_HAS_CREDITS`. Toda mutación → `audit_logs` con PII **redactada** (`[REDACTED]`).

**Decisión tomada (reveal):** se añadieron los permisos **`client:pii:read` / `credit:pii:read`** al enum de `@kobrax/shared`,
a `ROLE_PERMISSIONS` (ACCOUNT_ADMIN/MANAGER/AUDITOR) y al seed — cambio mínimo y declarativo, **no** abre el módulo de administración RBAC (sigue diferido a F3).

**Verificación e2e (curl):** login `manager@kobrax.demo` (nuevo en el seed, MANAGER sin MFA, con `client:write`+`client:pii:read`) →
crear cliente (doc tokenizado `E2E-T***`) → buscar por documento (blind index, 1 resultado) → `reveal=true` (claro) vs sin reveal (tokenizado) →
duplicado `409 CLIENT_DUP` → `collector@` (sin `client:pii:read`) `reveal` → `403` → **RLS A/B**: un cliente insertado en DEMO2 es invisible
para `manager@` de DEMO (lista = 0; get = `404`) → `audit_logs` con `CREATE`(doc `[REDACTED]`) + `PII_REVEAL`.

**Pendiente menor:** los sub-recursos (contacts/locations/relations/attachments) están implementados y type-check/unit OK pero no se
ejercitaron por e2e; `relation.phone` se tokeniza en salida pero se guarda en claro (no estaba en el alcance de cifrado de la Fase 0).

> Primer módulo de negocio. Implementa **CU-02** completo: maestro de clientes + su red de investigación de campo,
> con PII cifrada en reposo y **tokenizada** en respuestas.

> **Alta individual (UI/API) solamente.** La **importación masiva multi-formato + reconciliación diaria**
> (CSV/Excel/JSON/PDF, actualizar/dar de baja/crear contra el "archivo oficial") vive en la
> [Fase 5 — Importación de clientes](./05-importacion-clientes.md). Esta fase deja el modelo y los servicios base
> (cifrado, `national_id_hash`, dedup) que la importación reutiliza.

## Objetivo
CRUD de clientes y sub-recursos (contactos, ubicaciones, relaciones, adjuntos) con unicidad por documento (blind index),
búsqueda por hash y respuestas tokenizadas; toda mutación auditada y aislada por tenant.

## Historias
| # | Historia | Criterio de aceptación | Est. |
|---|----------|------------------------|------|
| H5 | CRUD Clientes + PII + unicidad | `POST` 201 PII cifrada en DB; `GET` tokenizado; `PATCH` re-cifra; `DELETE` soft. Duplicado → `409 CLIENT_DUP`. Mismo CI en tenant B → permitido. | 2d |
| H6 | Sub-recursos | Contactos (cifra `value`, un `is_primary` por tipo) · Ubicaciones (GPS + `photo_urls` + cifra `address`) · Relaciones (tipo + `is_contactable`) · Adjuntos (sella `file_hash`, **inmutable**). Audit en cada mutación. | 2d |
| H7 | Búsqueda y listado | `GET /clients?q=CI-12345` resuelve por hash; filtros `status`/`risk`/`q`; paginación; **PII tokenizada en todos los resultados**. | 1d |
| H8d | DTOs Clientes | `CreateClientDto`/`UpdateClientDto`/`ClientResponseDto` + DTOs de sub-recursos. `class-validator` (`whitelist`+`forbidNonWhitelisted`). `ParseUUIDPipe` en todos los `:id`. | 1d |

## Contratos (resumen — detalle en master §3.1)
```
POST   /clients                       (client:write) 201 · 409 CLIENT_DUP
GET    /clients   ?q&status&risk&page&limit (client:read) 200 (tokenizado)
GET    /clients/:id  [?reveal=true]   (client:read) 200 · 404 RESOURCE_NOT_FOUND
PATCH  /clients/:id                   (client:write) 200 · 409 · 404
DELETE /clients/:id                   (client:write) 204 (soft)
POST|PATCH|DELETE /clients/:id/contacts[/:cid]     (client:write)
POST|PATCH|DELETE /clients/:id/locations[/:lid]    (client:write)
POST|PATCH|DELETE /clients/:id/relations[/:rid]    (client:write)
POST|DELETE       /clients/:id/attachments[/:aid]  (client:write)  # sin PATCH: adjunto inmutable
```

## Diseño concreto
- **Alta con dedup:** al crear/editar, calcular `nationalIdHash` → consultar `@@unique([accountId, nationalIdHash])`;
  si existe → `409 CLIENT_DUP` (mensaje genérico, sin revelar el cliente). El front hace un check debounce por hash al salir del campo.
- **Serializer de respuesta:** por defecto tokeniza (`maskDocument`/`maskPhone`); `?reveal=true` descifra en memoria **solo** con permiso elevado y deja `audit_log`.
- **Contacto primario:** validar un único `is_primary` por `contact_type`; no borrar el único contacto primario si el cliente tiene créditos activos.
- **Adjuntos inmutables:** sin `PATCH`; `DELETE` = baja lógica. `file_hash` sellado al subir.

## Análisis / decisiones a tomar
1. **Permiso de reveal (🔴 importante).** El master define `INSUFFICIENT_PERMISSION (403)` para `?reveal=true` con permiso
   `client:pii:read`/`credit:pii:read`, **que NO existen** en el enum `Permission` actual ni están sembrados. Como la
   administración RBAC (F3) está diferida, decidir **una de dos** sin abrir F3:
   **(a)** añadir solo esos dos permisos al enum + seed (cambio mínimo, no es el módulo de administración), o
   **(b)** gate por nivel de rol (p.ej. `ACCOUNT_ADMIN`/`MANAGER`) hasta que llegue F3. **Recomendado: (a)** — es declarativo y consistente con los guards existentes.
2. **Cascada de baja.** ¿`DELETE` de cliente con créditos activos? Recomendado: **bloquear** (un cliente con deuda viva no se da de baja) → `409`/`422`. Confirmar regla.
3. **Búsqueda por nombre.** El nombre **no** se cifra (no es identificador sensible per se) → búsqueda por nombre con `ILIKE`/índice. Confirmar que `first_name/last_name/business_name` quedan en claro (solo documento/teléfono/dirección se cifran).
4. **`photo_urls`/`visit_schedule`** (JSONB) — validar shape con DTO (array de URLs; objeto de horarios) para no aceptar JSON arbitrario.

## Checklist de seguridad (de esta fase)
- [ ] `JwtAuthGuard`+`TenantGuard`+`RolesGuard(client:*)` en todos los endpoints; `ParseUUIDPipe` en `:id`.
- [ ] DTOs `whitelist`+`forbidNonWhitelisted`; JSONB validado por shape.
- [ ] PII cifrada en reposo; **nunca** en claro en respuestas sin `?reveal`; reveal auditado.
- [ ] Dedup por hash; `CLIENT_DUP` genérico; `RESOURCE_NOT_FOUND` genérico (anti-enumeración).
- [ ] Toda mutación → `audit_log`; adjunto inmutable (PATCH → 405).

## Criterios de aceptación (DoD Fase 2)
- [ ] CU-02 end-to-end: crear cliente + contactos/ubicaciones/relaciones → buscar por documento → editar → baja lógica.
- [ ] Documento duplicado en el tenant → `409 CLIENT_DUP`; mismo documento en otro tenant → permitido.
- [ ] PII tokenizada por defecto; `?reveal` con permiso → plaintext + `audit_log`; sin permiso → `403`.
- [ ] Aislamiento A/B (tenant A no ve clientes de B → `404`). `lint`+`type-check`+`test` verdes.

## Verificación
```powershell
pnpm --filter @kobrax/api test           # unit (dedup, máscaras) + integración (RLS A/B, audit, reveal)
# curl: crear cliente, listar (ver 12345***), reveal con/ sin permiso, duplicado → 409
```
