# EPIC F6 — Rutas, Operación en Campo y Evidencia (Pilar 3 · parte 2)

**ID:** EPIC-F6 · **Estado:** ✅ Completado (base, 2026-06-18) · **Owner:** API + Security (+ Database, Shared, Testing)
**Depende de:** **F5** (casos), **F4** (clientes) · **Requisitos:** RF-07, RF-08, CU-04 (lado servidor)
**Design:** [design-system.md](../design-system.md) · **Arquitectura DB:** `DB_Architecture_COBRA.docx` → **Pilar 3** (rutas/campo)

> ## ✅ Estado de ejecución (base, 2026-06-18)
> Implementado y verificado (126 tests · type-check · `nest build` · **e2e real**). Sin cambios de schema (Pilar 3 ya conforme).
> Módulos `apps/api/src/modules/routes/` y `field-ops/` (+ `field-integrity.ts` puro):
> - **Rutas**: `route_plan` CRUD + **generación** desde los casos abiertos del cobrador **ordenados por prioridad** (CRITICAL primero) → paradas secuenciadas;
>   transición de estado de ruta (PLANNED→IN_PROGRESS→COMPLETED→emite `route.completed`) y de parada (PENDING/IN_ROUTE/VISITED/SKIPPED).
> - **Campo**: `field_visit` con **GPS obligatorio + validado** (`VISIT_GPS`), `outcome`, **append-only**; al visitar marca la parada VISITED, añade actividad `VISIT` al caso, actualiza `last_known_lat/lng` del cobrador y emite `collector.location`.
> - **Evidencia**: `field_evidence` con **verificación SHA-256 server-side** (`field-integrity.ts`; `EVIDENCE_001` si el hash no coincide con el contenido), **inmutable** (sin update/delete). Auditada.
> - Permisos: `route:write`/`route:assign` (planifica = MANAGER/SUPERVISOR), `route:execute` (campo = COLLECTOR).
>
> **e2e:** manager genera ruta para collector (auto, ordenada) → collector registra visita (GPS válido→PROMISE_TO_PAY; inválido→`VISIT_GPS`) → evidencia hash correcto→sellada / incorrecto→`EVIDENCE_001` → manager COMPLETED. Parada→VISITED; audit route GENERATE/UPDATE + evidence CREATE.
>
> **Diferido (documentado):** subida real a **S3/R2 con presigned URL** (en el MVP el hash se verifica con el `content` inline; en prod el server lo descarga de S3) y la **anulación** correctiva auditada. `predicted_recovery_score`/optimización de rutas = IA futura.

> Lleva la cobranza **al terreno**: planifica rutas diarias, ordena visitas y registra la gestión en campo con
> **evidencia inmutable** (foto/firma + GPS + sello SHA-256). Es el backend de **CU-04**; el cliente móvil es **F10**.

## 0. Estado de ejecución
**Pendiente.** Schema modelado y migrado en F1 (`RoutePlan`, `RouteStop`, `FieldVisit`, `FieldEvidence`), con RLS.
`FieldVisit`/`FieldEvidence` ya son **inmutables por diseño** (sin `updated_at`/`deleted_at`). F6 construye los
módulos `routes` y `field-ops` + la **verificación de integridad** de evidencia.

## 1. Objetivo de negocio
Que el cobrador opere con **rutas ordenadas** y que cada gestión en campo quede registrada como **prueba
inalterable** (foto/firma con hash, GPS y timestamp), de modo que cualquier auditoría futura pueda verificar que
la evidencia no se modificó desde su captura. Cubre **CU-04 (ejecución de ruta)** en el servidor.

## 2. Alcance
### Incluye
- **`route_plan`**: plan diario por cobrador (fecha, estado, totales) + **generación** (asigna casos/clientes a la ruta).
- **`route_stop`**: paradas ordenadas (`sequence_order`), estado (PENDING/IN_ROUTE/VISITED/SKIPPED).
- **`field_visit`**: registro de visita con **GPS obligatorio** + `outcome` (resultado de gestión). **Append-only.**
- **`field_evidence`**: foto/firma/audio con **`file_hash` SHA-256 verificado al persistir** (`EVIDENCE_001` si no coincide). **Inmutable.**
- **Flujo de subida** a object storage (S3/R2) vía presigned URL; el hash del **buffer original** se calcula en el cliente y se **reverifica** en el servidor.
### No incluye
- Cliente móvil offline-first (captura, cola de sync, cámara/firma) → **F10**.
- Optimización real de rutas / scoring IA (`predicted_recovery_score`) → futuro (el campo queda nullable).
- `file_integrity` como tabla central polimórfica del doc → **F12** (por ahora el hash va embebido en cada entidad).

## 3. Conformidad con `DB_Architecture_COBRA` — Pilar 3 (rutas/campo)
| Tabla (doc) | Modelo Prisma | Estado | Nota |
|-------------|---------------|--------|------|
| `route_plan` | `RoutePlan` | ✅ Conforme | `collector_id`, `planned_date`, `status`, totales (distancia/minutos). |
| `route_stop` | `RouteStop` | ✅ Conforme (mejora) | Doc usa `visited` boolean; schema usa **estado** `RouteStopStatus` + `visited_at` (más expresivo). `predicted_recovery_score` nullable (IA futura). |
| `field_visit` | `FieldVisit` | ✅ Conforme | GPS `lat/lng/accuracy`, `outcome`, `captured_at`. **Inmutable** (sin update/delete). |
| `field_evidence` | `FieldEvidence` | ✅ Conforme (mejora) | Separa la evidencia de la visita; **`file_hash` SHA-256** + GPS. **Inmutable.** |
| `file_integrity` (transversal) | *(embebido en `file_hash`)* | 🔧 Diferido | El doc propone una tabla central polimórfica → **F12**. Hoy el hash vive en cada entidad (suficiente y más simple). |

### Mejoras propuestas
| # | Mejora | Tipo | Por qué |
|---|--------|------|---------|
| **M1** | **Verificación de hash server-side**: recalcular SHA-256 del archivo subido y compararlo con el `file_hash` declarado → rechazar (`EVIDENCE_001`) si no coincide. | API/Security | Garantiza integridad de la prueba (§1.7 del doc). **Vinculante.** |
| **M2** | **GPS obligatorio y validado** en `field_visit` (rango lat/lng válido, `accuracy` razonable). | API | El doc exige geolocalización de la gestión. |
| **M3** | **Inmutabilidad real**: sin endpoints update/delete sobre visita/evidencia. La **anulación** se modela como **gestión correctiva auditada** (no se muta la fila original). | API/Security | Evidencia inalterable; solo anulación auditada. |
| **M4** | **Orden de paradas** por prioridad del caso (y `predicted_recovery_score` cuando exista IA). | API | Productividad del cobrador (optimización básica). |
| **M5** | **Subida a storage** vía presigned URL (S3/R2) + verificación de hash al confirmar; foto ≤ 800 KB (comprime el cliente). | API/Security | Patrón de evidencia de `CLAUDE.md` mobile/API. |

## 4. Contratos API (F6)
Todos **Bearer** + `TenantGuard` + `RolesGuard`. Respuestas `{data,meta,error}`.
```
# Rutas
POST   /routes                 {collectorId, plannedDate}         (route:write)   → 201
POST   /routes/generate        {collectorId, plannedDate, caseIds?|auto} (route:assign) → 200 (ordena paradas)
GET    /routes        ?collectorId&date&status&page&limit         (route:read)    → 200
GET    /routes/:id                                                (route:read)    → 200 (+ stops ordenados)
PATCH  /routes/:id             {status}                           (route:write)   → 200
PATCH  /routes/:id/stops/:sid  {status|sequenceOrder}             (route:execute) → 200
# Campo (CU-04 backend)
POST   /visits                 {caseId|routeStopId, lat, lng, accuracy?, outcome, notes?} (route:execute) → 201 (append-only)
POST   /visits/:id/evidence    {type, fileHash, fileUrl}          (route:execute) → 201 · 422 EVIDENCE_001 (hash no coincide)
POST   /evidence/upload-url    {type, contentLength}              (route:execute) → 200 {presignedUrl, fileUrl}
```
> Código nuevo: `EVIDENCE_001` (hash de evidencia inválido). Sin endpoints `PATCH/DELETE` para `visits`/`evidence` (inmutables).

## 5. Modelo de datos (cambios F6)
Sin cambios de schema (Pilar 3 ya conforme). F6 es lógica de servicio + integración con storage. (M4/M5 son de servicio.)
Variables nuevas: `S3_BUCKET`/`S3_REGION`/`S3_ACCESS_KEY`/`S3_SECRET_KEY` (object storage) desde env validado al boot.

## 6. Historias y tareas
| # | Historia | Agente | Estado |
|---|----------|--------|--------|
| 1 | Módulo `routes`: `route_plan` CRUD + generación + ordenamiento de paradas por prioridad | API | ⏳ |
| 2 | `route_stop`: estado/secuencia, transición de paradas (PENDING→IN_ROUTE→VISITED/SKIPPED) | API | ⏳ |
| 3 | Módulo `field-ops`: `field_visit` con **GPS obligatorio** + `outcome`; append-only | API | ⏳ |
| 4 | `field_evidence`: **verificación SHA-256 server-side** (`EVIDENCE_001`); inmutable | Security | ⏳ |
| 5 | Presigned upload a S3/R2 + reverificación de hash al confirmar; límite de tamaño | Security | ⏳ |
| 6 | Anulación auditada (gestión correctiva; sin mutar la evidencia original) | API/Security | ⏳ |
| 7 | Eventos `route.completed`, `collector.location` (los consume F8) | API | ⏳ |
| 8 | DTOs + enums (ya existen `RouteStatus`/`RouteStopStatus`/`VisitOutcome`/`EvidenceType`) | Shared | ⏳ |
| 9 | Tests: GPS inválido rechazado, hash verificado/`EVIDENCE_001`, evidencia inalterable, no cross-tenant | Testing | ⏳ |

## 7. Seguridad & Cumplimiento (checklist F6)
- [ ] RLS del tenant en toda query; `JwtAuthGuard`+`TenantGuard`+`RolesGuard` (`route:*`).
- [ ] **Hash SHA-256 de evidencia verificado server-side** antes de persistir (`EVIDENCE_001` si no coincide).
- [ ] `field_visit`/`field_evidence` **inmutables**: sin update/delete; anulación = registro correctivo auditado.
- [ ] GPS obligatorio y validado en cada visita; `captured_at` del dispositivo + sello del servidor.
- [ ] Subida a storage con presigned URL (sin exponer credenciales); validación de tipo/tamaño; URLs no adivinables.
- [ ] Toda mutación de ruta deja `audit_logs`; la evidencia sellada no se audita como cambio (es alta única).

## 8. DoD (F6)
- [ ] Plan de ruta generado con paradas **ordenadas por prioridad**; estados de parada transicionan correctamente.
- [ ] Visita requiere **GPS válido**; sin él se rechaza.
- [ ] Evidencia con hash correcto se sella; con hash que no coincide → `EVIDENCE_001`.
- [ ] La evidencia/visita **no es editable ni borrable** (verificado por test); solo anulación auditada.
- [ ] Aislamiento multi-tenant (test A/B); `lint`+`type-check`+`test` verdes; cobertura ≥ 80%.

## 9. Estrategia de tests
- **Unit:** validación de GPS, verificación de hash (coincide / no coincide), ordenamiento de paradas, inmutabilidad (no hay setters/endpoints).
- **Integración (testcontainers):** registrar visita + evidencia con hash válido, rechazo `EVIDENCE_001`, RLS A/B, eventos emitidos.

## 10. Observabilidad & métricas
- `audit_logs` por plan/parada y anulaciones. Métricas: visitas efectivas por cobrador, paradas completadas/saltadas, % evidencia válida, distancia/tiempo por ruta.

## 11. Riesgos
| Riesgo | Mitigación |
|--------|-----------|
| Evidencia manipulada tras la captura | Hash SHA-256 del original verificado server-side + inmutabilidad |
| Visitas falsas sin presencia real | GPS obligatorio + `accuracy` + sello de tiempo del servidor |
| Credenciales de storage expuestas | Presigned URLs server-side; nunca llaves en el cliente |
| Necesidad de "corregir" una evidencia | Anulación auditada + registro correctivo (no se muta la original) |
| Optimización de rutas no disponible aún | Orden por prioridad ahora; `predicted_recovery_score` nullable para IA futura |
