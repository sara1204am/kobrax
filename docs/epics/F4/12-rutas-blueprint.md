# F4/12 — Rutas: Discovery, Blueprint, Gap Analysis y Plan

> **Estado: BORRADOR para revisión. Fase 0 (discovery). No se modificó código, API, DB ni UI.**
> Fecha: 2026-10-08. Todo sale de leer el repo (no se ejecutó nada). Las líneas citadas son las del árbol a esa fecha.
> Abreviaturas: `S` = `packages/database/prisma/schema.prisma`, `API` = `apps/api/src`, `W` = `apps/web/src`, `M` = `apps/mobile`, `SH` = `packages/shared/src`.

---

## A. Resumen ejecutivo

**Cómo está Rutas hoy.** Hay dos productos que casi no se tocan:

- **Móvil = ejecución completa.** Genera/arma la ruta, previsualiza (distancia, duración, ETA por parada), optimiza, **inicia**, navega, registra la visita (6 variantes, GPS con respaldo, foto, cobro, promesa), **cierra la jornada** y funciona offline con cola y borrador.
- **Web = planificación y consulta.** Historial por día/período, resumen por cobrador, planificador (un cobrador por vez) con filtros y mapa, editor de paradas, detalle de ruta con PDF y detalle de parada con evidencia y hash. **No puede iniciar, cancelar ni completar una ruta, ni optimizar, ni previsualizar, ni registrar una visita.**

**Principal problema.** No es visual, es de **dominio y de flujo**:

1. **La API no tiene máquina de estados** (`updateStatus` acepta cualquier transición) y el ciclo de vida solo lo ejecuta el móvil.
2. **La parada no sabe a qué ubicación va** (solo `clientId`/`creditId`); el móvil dibuja un pin por ubicación pero a la API solo le manda cliente+crédito.
3. **La hora de la agenda no llega a la parada ni a la optimización.**
4. **Un supervisor no puede corregir una gestión:** `POST /visits` exige `ROUTE_EXECUTE` (que manager/supervisor no tienen) y registra siempre a nombre de quien llama; la visita es append-only.
5. `/rutas` abre en Historial; la pregunta «¿qué pasa hoy?» no tiene pantalla.

**Visión objetivo.** Rutas = **planificar + ejecutar + supervisar + seguir**, una sola semántica (Route / RouteStop / Location / Visit / Payment / Promise) con **API como única autoridad** de estados y reglas. Web planifica y supervisa; móvil ejecuta en campo. `/rutas` abre en «Hoy».

---

## B. Mapa del sistema actual

```
                        ┌──────────────────────────────────────────┐
  WEB (panel)           │  /rutas  /rutas/planificar  /rutas/[id]  │
  BFF: plan, stops,pdf  │  /rutas/[id]/parada/[sid]                │
                        └───────────────┬──────────────────────────┘
                                        │ solo: GET routes, POST plan→generate, stops, pdf
  MOBILE (Expo)                         ▼
  cola offline ───────►  API NestJS ─ /routes ─ /visits ─ /payments ─ /agenda ─ /mora ─ /clients
  borrador local         │  routes.service  field.service  payments  agenda  mora   clients
                         │  OSRM (preview/optimize, opcional)        │
                         ▼                                           ▼
   PostgreSQL (RLS): route_plans ─ route_stops ─ field_visits ─ field_evidences
                     agenda_items ─ credit_activities ─ payments ─ credit_arrear_episodes
                     clients ─ client_locations ─ client_relations ─ credit_guarantors
```

Cadena de negocio actual (confirmada en código):

```
AGENDA (VISIT SCHEDULED, details.locationId)
   └─ al generar la ruta entra sola (pendingVisits)  → RouteStop.agendaItemId
RouteStop ── POST /visits ──► FieldVisit + CreditActivity(VISIT) + AgendaItem→EXECUTED + Stop→VISITED
   ├─ cobro:   POST /payments (otra llamada, sin vínculo a visita)  → episodio de mora (trigger SQL)
   └─ promesa: POST /agenda  PROMISE_TO_PAY (otra llamada, sin vínculo) → recordatorio −1 día
```

---

## C. Inventario WEB (`W/app/(panel)/rutas/**`)

| Ruta | Propósito | Datos / endpoints | Permisos | Problemas | Reutilizable |
|---|---|---|---|---|---|
| `/rutas` (`page.tsx`) | Historial (día/período) y pestaña Planificación | `GET /auth/me`, `/users`, `GET /routes?...`; período = hasta 5×100 rutas | sin redirect; `ROUTE_ASSIGN` = equipo + CTA; si no, solo lo propio | abre en Historial; textos de `planning.*` desactualizados; tope 500; **no hay vista «Hoy»** | `RouteTabs`, `DayPicker`, `PeriodPicker`, `DataTable`, `CollectorWorkTable`, `WorkSummary` |
| `/rutas/planificar` | Armar la ruta de **un** cobrador/fecha | `GET /mora` (≤100, `excludeRouted`), `/routes?date`, `/arrear-categories`; confirma `POST /api/routes/plan` | redirige si no `ROUTE_ASSIGN` | un cobrador por vez; sin agenda visible; **sin elegir ubicación**; sin preview/optimizar; selección solo en estado local | `PlanScreen`, `PlanFilters`, `AvailableList`, `MapPanel`, `PointsMap`, `lib/plan.ts` |
| `/rutas/[id]` | Detalle + editor de paradas (`?editar=1`) | `GET /routes/:id`, `/users`, `/payments` (por crédito), `/routes/:id/preview`, `/visits?routeId`; PATCH/DELETE/POST stops | alcance lo decide la API | **sin acciones de estado**; el `GET preview` **escribe** en la ruta y re-audita PII; pagos en ventana UTC | `RouteEditor`, `RouteMap`, `summarizeDay` |
| `/rutas/[id]/parada/[sid]` | Visita, GPS, evidencia, hash | `GET /routes/:id`, `/visits?routeStopId`, `/visits/:id` | lectura | solo lectura; sin registrar/corregir | `MapPicker` (visor), enlaces a `/cartera` y `/mora` |
| BFF `api/routes/*` | `plan`, `[id]/pdf`, `[id]/stops`, `[id]/stops/[sid]` | — | `sameOrigin` + Bearer | **faltan**: estado, create/generate directos, preview, optimize, visitas | `proxyMutation` |

`/rutas/planificar` y el editor comparten `MapPanel`/`AvailableList`/`FilterPanel`: el rediseño debe seguir compartiéndolos.

---

## D. Inventario MOBILE (`M/app/(tabs)/rutas.tsx`, `M/app/rutas/*`)

| Pantalla | Propósito / estados | Endpoints | Offline | Diferencia con WEB |
|---|---|---|---|---|
| `(tabs)/rutas` | Día: sin ruta · planificada/en curso · finalizada/cancelada; progreso, siguiente parada | `GET /routes?collectorId` (filtra el día **en el teléfono**), `/routes/:id`, pagos del día | lectura cacheada; generar **no** offline | web no tiene «Hoy» |
| `rutas/crear` | Pin **por ubicación**, orden por toque, clientes sin ubicación, alta rápida | `GET /mora?limit=100`, `POST /routes`, `POST/DELETE/PATCH stops` | borrador SecureStore, sync por diferencia, id propio idempotente | web arma por tabla+filtros, sin borrador |
| `rutas/preview` | Distancia, duración, hora estimada por parada, aviso de zigzag, optimizar, **iniciar** | `GET /routes/:id/preview`, `POST /optimize`, `PATCH {IN_PROGRESS}` | optimizar no; iniciar se encola | **solo móvil** |
| `rutas/confirmar` | Jornada iniciada; navegar/llamar | `GET /routes/:id` | — | solo móvil |
| `rutas/mapa` | Mapa activo parada a parada | `GET /routes/:id`, `/preview` | conserva lo cargado | solo móvil |
| `rutas/resultado` | 6 variantes + GPS (respaldo) + foto + cobro + promesa | `POST /visits`, `/evidence`, `POST /payments` (`visit-<id>`), `POST /agenda` | todo encolado, re-encolado parcial | web no registra |
| `rutas/resumen` | Cierre: recaudado, categorías, **completar** (confirma si hay pendientes) | `PATCH {COMPLETED}` | se encola | solo móvil |

Reglas puras candidatas a compartir: `visit-result.ts` (`paymentOutcome`, `paymentCap`, `canSubmitResult`, `buildDetails`), `route-draft.ts` (`diffStops`, `moveStop`, `withStop`), `route-eta.ts`, `route-candidates.ts`.

---

## E. API (hechos)

### E.1 Endpoints

| Método y ruta | Payload clave | Permiso real | Notas |
|---|---|---|---|
| `POST /routes` | `id?, collectorId, plannedDate(@IsDateString), branchId?` | `ROUTE_READ` + `collectorFor` (ASSIGN/WRITE elige cobrador; EXECUTE fuerza el propio; si no 403) | idempotente por `id`; `ROUTE_DUPLICATE_DAY` |
| `POST /routes/generate` | `id?, collectorId, plannedDate, creditIds?` (`auto` **muerto**) | igual | visitas SCHEDULED del día entran solas; sin paradas → `ROUTE_EMPTY`; **sin tope de paradas** (el BFF limita 30) |
| `GET /routes` | `page, limit≤100, collectorId, date, from, to, status, sort, dir` | EXECUTE → solo lo propio | agrega `visitedCount` |
| `GET /routes/:id` | — | cobrador ajeno → 404 | revela PII (audita) |
| `PATCH /routes/:id` | `status` | `assertOwnRoute` (ASSIGN/WRITE/EXECUTE propio) | **sin validación de transición** |
| `GET /routes/:id/pdf` | — | `findOne` | audita PII |
| `GET /routes/:id/preview` | — | `assertOwnRoute` (**auditor/viewer → 403**) | **escribe** `totalDistanceKm/estimatedMinutes`; devuelve `geometry, distanceKm, minutes, stops[etaMinutes], suggestion` |
| `POST /routes/:id/optimize` | — | igual | `trip` OSRM; reordena **todas** las paradas |
| `POST /routes/:id/stops` | `clientId, creditId?` | igual | duplicado por crédito = check no atómico |
| `PATCH /routes/:id/stops/:sid` | `status?, sequenceOrder?` | igual | mover solo PENDING; `status` libre; **no audita** |
| `DELETE /routes/:id/stops/:sid` | — | igual | solo PENDING |
| `GET /visits`, `GET /visits/:id` | filtros | lectura; cobrador acotado | `date` por **día UTC** |
| `POST /visits` | `id?, creditId?/routeStopId?, lat, lng, accuracy?, outcome, notes?, capturedAt?, details?, gpsFallback?` | **`ROUTE_EXECUTE`** | `collectorId` = token; sin audit; no crea pago ni promesa |
| `POST /visits/:id/evidence` | `type, fileUrl, fileHash, content?` | `ROUTE_EXECUTE` | hash solo se verifica si llega `content` |
| `POST /payments` | `creditId, amount, method, channel?, notes?, paymentDate?` + header `idempotency-key` | `PAYMENT_WRITE` (**solo COLLECTOR/admins**) | sin `visitId`; backdate ≤30 días |
| `POST /agenda` / `complete` / `reschedule` / `cancel` / `PATCH` / `DELETE` | ver agenda | `AGENDA_WRITE` (+`ASSIGN` para ajenos) | VISIT exige `details.locationId` con lat/lng (`AGENDA_013`); `complete` de VISIT con parada → `AGENDA_014` |
| `POST /mora/:creditId/activities` | `type, result, notes, promise{amount,promiseDate,paymentMethodCode,bankCode?}` | `collection:write` | crea actividad + promesa en una transacción |
| `POST/PATCH/DELETE /clients/:id/locations` | `locationType, address, zone, latitude, longitude, relationId?` | `CLIENT_WRITE` (COLLECTOR/admins) | sin geocodificación |

### E.2 Máquina de estados HOY

- **Ruta** `PLANNED/IN_PROGRESS/COMPLETED/CANCELLED`: `updateStatus` = `update({status})` + (si CANCELLED) `agendaItemId=null` en **todas** las paradas + (si COMPLETED) emite `route.completed` **cada vez**. No hay tabla de transiciones, ni `startedAt/completedAt`, ni lock, ni validación de paradas pendientes.
- **Parada** `PENDING/IN_ROUTE/VISITED/SKIPPED`: cambia por (1) `PATCH` libre, (2) `POST /visits` (pone VISITED sin mirar estado previo ni de la ruta), (3) `detachVisitFromRoute` de agenda (borra si PLANNED, SKIPPED si IN_PROGRESS). `IN_ROUTE` no lo asigna nada.
- **Concurrencia:** sin `FOR UPDATE`; sin unique `(routeId, creditId)` ni `(agendaItemId)` completo; `addStop` concurrente → P2002 sin reintento (500).
- **Idempotencia por id de cliente:** routes, generate, visits, agenda, payments. **No** en PATCH de ruta/parada, addStop, optimize, evidence.

### E.3 Preview / optimize / dry-run

- **No existe dry-run en la API.** El único `dryRun` es del BFF (`W/app/api/routes/plan/route.ts`): arma filas con `GET /mora` sin llamar a `generate`; **ninguna pantalla lo usa**.
- Preview: `minutes = round(durS/60) + 10·(todas las paradas)`; `etaMinutes` = minutos desde la salida (no hora de reloj; no descuenta VISITED). `suggestion` solo si ahorro ≥1 km **o** ≥10 min.
- OSRM `trip` con `source=first&destination=last`: primera y última fijas. **No hay horas fijas ni ventanas horarias**; `optimize` puede mover visitas con hora fija y paradas ya visitadas.

### E.4 Zona horaria

- Agenda usa `TenantClockService` (`Account.timezone` → país → UTC). **Rutas no usan reloj del tenant**: `plannedDate` entra tal cual (`@IsDateString`, sin validar pasado/futuro); `GET /visits?date` filtra por día UTC; pagos en instantes UTC; `mora.addActivity` usa «ayer UTC». Cuatro «hoy» distintos.

---

## F. Modelo de datos (nombres reales)

```
Client ─1:N─ ClientLocation(locationType HOME|WORK|GUARANTOR|FAMILY|OTHER, address(cifrada), zone,
   │            latitude?, longitude?, relationId?)        ← no hay isPrimary, ni "NEGOCIO", ni updatedAt/deletedAt
   ├─1:N─ ClientRelation(relationshipType, relatedName) ─N:N─ Credit  (CreditGuarantor)
   └─1:N─ Credit ──< CreditArrearEpisode (solo triggers SQL) ──< CreditActivity (append-only)

RoutePlan(collectorId, plannedDate @db.Date, status, totalCases(=paradas), totalDistanceKm?, estimatedMinutes?)
   UNIQUE(account, collector, plannedDate)
   └─1:N─ RouteStop(clientId FK, creditId?, agendaItemId?, sequenceOrder, status, visitedAt?)
            ✗ no tiene locationId / lat / lng   ← la ubicación se deduce al leer (solo propias del cliente)
            └─1:N─ FieldVisit(creditId?, routeStopId?, collectorId, latitude, longitude, outcome, details JSON)
                      └─1:N─ FieldEvidence(type PHOTO|SIGNATURE|DOCUMENT|AUDIO, fileUrl, fileHash)

AgendaItem(type CALL|VISIT|WHATSAPP|REMINDER|PROMISE_TO_PAY, scheduledDate @db.Date,
           timeMode FIXED|LAPSE|RANGE, scheduledTime "HH:mm"?, timeSlot?, assigneeId, details JSON,
           resultActivityId?)   ← VISIT.details.locationId vive aquí y NO pasa a RouteStop
Payment(creditId, amount, method, channel, idempotencyKey)   ← sin visitId/routeStopId
Promesa = AgendaItem(PROMISE_TO_PAY).details{amount,promiseDate,paymentMethodCode,bankCode}  ← sin tabla propia
```

Hechos de dominio que condicionan el diseño:
- **Cliente ≠ ubicación ya existe** (1..N `client_locations`, incluidas las de garantes/familiares vía `relationId`). Lo que falta es que **la parada la referencie**.
- `/mora` ya entrega `locations` por crédito (con punto, incluye garantes/familiares), pero **sin filtrar por `credit_guarantors`**.
- Datos personales: `address` cifrada en reposo; lecturas de ruta/visita auditan `PII_REVEAL`.

---

## G. Matriz WEB vs MOBILE (real hoy → objetivo)

| Funcionalidad | WEB hoy | MOBILE hoy | Objetivo WEB | Objetivo MOBILE | Compartido |
|---|---|---|---|---|---|
| Vista «Hoy» de rutas | ✗ | parcial (la propia) | ✔ equipo | ✔ propia | API `GET /routes?date` |
| Planificar futuro / equipo | un cobrador, mañana | solo hoy/propia | ✔ varios cobradores, fechas | sin cambio | API + permisos |
| Agenda como candidata | solo se mezcla al generar, invisible | invisible | ✔ visible y prioritaria | ✔ | `AgendaItem` |
| Candidatos + filtros | ✔ | `limit=100` sin filtros | conservar | opcional | `toAvailable`↔`toRouteCandidates` |
| Elegir ubicación concreta | ✗ | ✔ visual, no persiste | ✔ persiste | ✔ persiste | **`RouteStop.locationId`** (nuevo) |
| Cliente sin ubicación accionable | ✗ | ✔ (alta + marcar) | ✔ (`MapPicker`) | conservar | `POST/PATCH /clients/:id/locations` |
| Mapa / orden | ✔ | ✔ | conservar + drag&drop | conservar | `diffStops`, `moveStop` |
| Preview (dist/duración/ETA) | ✗ | ✔ | ✔ | conservar | `GET /preview` |
| Optimizar | ✗ | ✔ | ✔ con confirmación | conservar | `POST /optimize` (hay que endurecer) |
| Iniciar / completar / cancelar | ✗ | iniciar+completar | ✔ los tres | iniciar+completar | **máquina de estados en API** |
| Registrar / corregir visita | ✗ | ✔ (propia) | ✔ (supervisor) | conservar | **permiso y modo «a nombre de»** (nuevo) |
| Cobro / promesa | ✔ en `/mora` | ✔ | reutilizar `PaymentActions` / `RegisterActivityButton` | conservar | `visitId` en pago (decidir) |
| Navegar / llamar | opcional | ✔ | — | ✔ | — |
| Offline | ✗ | ✔ | ✗ | ✔ | cola / ids |
| Historial día/período, resumen por cobrador, PDF | ✔ | ✗ | conservar | ✗ | — |
| Evidencia (ver, hash) | ✔ | solo sube | conservar | captura | `FieldEvidence` |
| Firma | solo la dibuja | ✗ | decidir | decidir | `SIGNATURE` |

---

## H. Gap analysis

**Existe y funciona:** generar ruta con agenda del día; idempotencia de ruta/visita/pago; cierre atómico visita↔actividad↔agenda; cola offline y borrador móvil; historial/resumen web; PDF; detalle de parada con hash; formularios de gestión/pago/promesa en `/mora`; `MapPicker`; `summarizeDay` compartido.

**Existe pero incompleto:** planificador (un cobrador, sin agenda visible, sin ubicación); preview/ETA (relativa, sin horas fijas, cuenta paradas ya hechas); notificación `ROUTE_COMPLETED` (sin cobrador ni conteo); `ROUTE_ASSIGNED` (nunca se emite); evidencia (hash sin verificar sin `content`); filtro de ubicaciones de garante en `/mora`.

**Existe pero mal diseñado:** `updateStatus` sin transiciones; `PATCH stop` con `status` libre y sin auditoría; `GET preview` con escritura; `createVisit` sin validar dueño/estado de parada y ruta; cancelar borra `agendaItemId` también de paradas VISITED; ruta completada con paradas pendientes deja la gestión atrapada (`AGENDA_014`); `plannedDate` con `@IsDateString`; cuatro «hoy».

**Solo en MOBILE:** iniciar, completar, preview/ETA, optimizar, mapa activo, registrar visita, cobro en campo, alta rápida, offline, navegar/llamar.

**Solo en WEB:** historial día/período, resumen por cobrador, planificación de equipo/ayuda, filtros avanzados, PDF, edición de rutas ajenas, evidencia con hash.

**Falta completamente:** `RouteStop.locationId`; máquina de estados; BFF web de estado/preview/optimize/generate/visitas; registro de visita «a nombre de» por supervisor + corrección auditada; hora fija de agenda en la parada y en el optimizador; dry-run real en API; vista «Hoy»; geocodificación; captura de firma; vínculo pago/visita; plan de Rutas web (los planes F10 son del móvil).

---

## I. UX objetivo (sin implementar)

**`/rutas` = «Hoy»** (por defecto): selector de fecha; una fila por cobrador (o por ruta) con estado, progreso, próxima parada + hora, distancia y **una** acción contextual (Planificar / Ver / Iniciar). Pestaña **Historial** (día/período) conserva todo lo actual. Preguntas que responde: *¿qué pasa hoy?*

**Planificar** (un asistente de pasos, no formulario): Fecha → Cobradores → **Agenda** (visitas con hora, bloqueadas/prioritarias) → Candidatos (filtros actuales) → **Ubicación** por candidato (selector con tipo de lugar; sin punto = tarjeta accionable «Agregar ubicación» con `MapPicker`) → Mapa + orden (drag&drop, ↑↓, ✕; ejecutadas bloqueadas; aviso de conflicto con hora fija) → **Preview** (distancia, duración, primera/última visita, timeline ETA, comparación actual vs optimizada con «Aplicar») → **Publicar**.

**`/rutas/[id]` = centro de supervisión:** estado, progreso, recaudado, gestionadas/pendientes, distancia/duración, mapa, paradas (número, cliente, crédito, **ubicación concreta**, hora/ETA, mora, estado, resultado). Acciones **según estado y permiso**: Iniciar · Editar · Optimizar · Cancelar · Completar.

**Parada:** enlaces a `/mora/[creditId]` y `/cartera/[id]` (no se crean pantallas paralelas); **Registrar gestión** reutilizando las 6 variantes del móvil y los formularios existentes de gestión/pago/promesa.

Estética: la de Kobrax (tokens `k-*`, mucho espacio, tablas solo donde ayudan, mapas grandes donde aportan).

---

## J. Arquitectura objetivo

- **API (autoridad):** máquina de estados de ruta y parada con tabla de transiciones, `UPDATE … WHERE status = :esperado` (concurrencia), `startedAt/completedAt`, eventos idempotentes; `RouteStop.locationId`; hora de agenda disponible en parada (`scheduledTime` derivable de `agendaItemId`); reloj del tenant en todo el módulo; `createVisit` con validación de dueño/estado; endpoint de registro «a nombre de» con permiso nuevo o `ROUTE_WRITE`; preview sin efectos secundarios; optimize que respeta estado y horas fijas.
- **Shared (`packages/shared`):** tabla de transiciones (`ROUTE_TRANSITIONS`, `STOP_TRANSITIONS`, `canTransition`), reglas «qué se puede mover/quitar/ejecutar», `paymentOutcome/paymentCap`, `haversineKm/withinRadius`, `toAvailable/toRouteCandidates` unificado, tonos/etiquetas de estado, formato de duración/distancia.
- **Web:** BFF nuevo (`status`, `generate`, `preview`, `optimize`, `visits`), pantallas «Hoy», asistente de planificación, detalle con acciones, formulario de gestión en parada.
- **Móvil:** consumir lo compartido; enviar `locationId`; sin cambios funcionales visibles.
- **DB:** `route_stops.location_id` (FK a `client_locations`, nullable al inicio), `route_plans.started_at/completed_at/cancelled_at`, unique `(route_id, credit_id)` donde aplique, índice único completo de `agenda_item_id` ya cubierto parcialmente.

---

## K. Plan de implementación por fases

| Fase | Objetivo | Archivos aprox. | API | Riesgos / dependencias | Tests |
|---|---|---|---|---|---|
| **0 (esta)** | Discovery | este doc | — | — | — |
| **1 — Estados en API** (bloqueante) | Máquina de estados de ruta/parada; endurecer `createVisit`, `updateStop`, cancelar (no borrar `agendaItemId` de VISITED), resolver ruta parcial; reloj del tenant y regex `YYYY-MM-DD` en rutas | `routes.service/controller/dto`, `field.service`, `shared` (transiciones), migración `started_at…` | `PATCH /routes/:id` con validación; códigos de error nuevos | datos existentes en estados «raros»; móvil debe seguir funcionando (compat) | specs de transición, concurrencia, replay, permisos; integración agenda↔ruta |
| **2 — Ubicación en la parada** | `RouteStop.locationId`; móvil y web lo envían; `/mora` filtra garantes por `credit_guarantors` | schema + migración, `routes.serializer`, `mora.service`, `M/route-draft`, `W/lib/plan` | `AddStopDto.locationId?`, generate acepta mapa crédito→ubicación | retrocompat (paradas viejas sin ubicación); PII | serializer, `addStop`, móvil `diffStops` |
| **3 — Web: vista «Hoy» + acciones de estado** | `/rutas` abre en Hoy; Iniciar/Cancelar/Completar con confirmaciones | `page.tsx`, componentes nuevos, BFF `status` | usa Fase 1 | depende de F1 | vitest de BFF + componentes |
| **4 — Planificador completo** | Asistente: fecha, varios cobradores, agenda visible, ubicación por candidato, orden drag&drop, clientes sin ubicación accionables | `planificar/*`, reutilizar `MapPanel`, `MapPicker` | `generate` con `locationId`; (opcional) dry-run real | tamaño de PR; reutilizar, no reescribir | `plan.test`, nuevos |
| **5 — Preview y optimización web** | Preview con comparación, ETA, hora fija; optimizar con confirmación | BFF `preview/optimize`, `route-eta` compartido | **preview sin escritura**; optimize respeta estado y horas fijas | OSRM opcional (degradar) | `routes.service.spec`, `osrm.spec` |
| **6 — Gestión desde web** | Registrar/corregir visita (supervisor), cobro, promesa | formulario en `parada/[sid]`, reutiliza `RegisterActivityButton`/`PaymentActions` | endpoint «a nombre de» + audit; vínculo pago↔visita (decisión) | **permisos**, duplicación de pagos/visitas | integración visita+pago+promesa |
| **7 — Historial y límites** | Revisar topes (500/100) y métricas | `routes.ts`, `page.tsx` | agregación en API si hace falta | — | `routes.test` |
| **8 — Refactor compartido** | Mover reglas duplicadas a `shared` | ver J | — | no extraer antes de confirmar duplicación | tests de shared |
| **9 — QA** | Plan N | — | — | — | N |

Orden recomendado: **1 → 2 → 3 → 5 → 4 → 6 → 7 → 8 → 9** (la Fase 1 desbloquea todo; Preview antes del planificador completo porque este lo usa para «Publicar»).

---

## L. Decisiones abiertas (necesito tu aprobación)

1. **¿Quién puede iniciar, cancelar y completar?** Hoy ASSIGN/WRITE/EXECUTE valen igual. Propuesta: iniciar/completar = dueño o manager; **cancelar = solo ASSIGN/WRITE**.
2. **¿Se permite registrar visita desde la web?** Si sí: ¿con `ROUTE_WRITE`/`ASSIGN` o un permiso nuevo (`route:record`)? ¿queda marcada como «registrada por supervisor» y con auditoría? ¿se permite **corregir** (hoy la visita es append-only) o solo registrar una nueva con nota?
3. **Ruta parcialmente ejecutada:** al completar con paradas pendientes, ¿pasan a SKIPPED y liberan la gestión de agenda? (propuesta: sí, con confirmación).
4. **Cancelar ruta en curso:** ¿qué pasa con paradas VISITED (se conservan) y con las pendientes (SKIPPED + liberar agenda)? ¿se avisa al cobrador?
5. **Ubicación sin coordenadas:** ¿bloquea la publicación, o entra con aviso? (la agenda ya exige punto para VISIT).
6. **Visita agendada con hora fija:** ¿es restricción dura para el optimizador (no se mueve) o aviso? (propuesta: fija su posición; se avisa del conflicto).
7. **Planificar varios días:** ¿sí? implica una ruta por cobrador y día (ya garantizado) y UI de calendario.
8. **Clientes de otro cobrador:** hoy «ayuda» sin cambiar el responsable. ¿se mantiene? ¿requiere permiso?
9. **Zona horaria:** ¿unificamos todo el módulo con `TenantClockService`? (propuesta: sí, en Fase 1).
10. **Firma:** ¿se captura (móvil+web) o se retira del contrato/documentación?
11. **Vínculo pago↔visita:** ¿agregamos `visitId` a `payments` o seguimos con dos llamadas independientes?
12. **`ROUTE_ASSIGNED`:** ¿se emite al planificar para otro cobrador (notificación + push)?
13. **Tipo de lugar «negocio»:** ¿se agrega al enum o se usa `WORK`?
14. **Geocodificación por texto:** ¿se incorpora (proveedor, costo) o seguimos con pin manual?

---

## L.bis — Decisiones resueltas (respuesta de la usuaria, 2026-10-08)

Numeración de la sección L. Lo marcado ⚠️ queda pendiente de confirmar.

| # | Decisión |
|---|---|
| 1 | **Autoría manda.** Quien creó la ruta puede modificarla, cancelarla o eliminarla. El cobrador inicia, completa y cancela **su** ruta. El manager/admin asigna rutas a sus cobradores. Si **otra persona** (no la creadora) modifica una ruta o visita, **debe dejar una observación con el motivo**. ⚠️ Confirmar si «pedir permiso» es una modificación directa con motivo obligatorio (lo asumido) o un flujo de solicitud con aprobación. |
| 2 | **Sí se registra visita desde la web**, por quien creó la ruta o el administrador (olvido, sin señal, sin batería). Queda **marcada como registrada por X** (cobrador o administrador). **No se edita** una visita registrada: se **agrega una nueva como nota** (sin historial de ediciones). ⚠️ Permiso exacto (¿`ROUTE_ASSIGN/WRITE` + creador, o `route:record` nuevo?). |
| 3 | **Completar con paradas pendientes exige un motivo escrito** (falta de tiempo, se hará otro día, etc.). ⚠️ Confirmar que las pendientes pasan a «saltada» y liberan su gestión de agenda para reprogramar. |
| 4 | **Cancelar:** primero alerta «¿seguro?». Con **visitas ya registradas no se cancela: se cierra** (completa), porque no se borra información. **Sin ninguna visita**, se cancela con **motivo obligatorio** (enfermedad, etc.). |
| 5 | **Sí** se planifican varios días (la agenda también agenda a futuro). |
| 6 | **Sin coordenadas = obligatorio completarlas al crear la ruta** (ubicación del cliente o de quien se visite). No se publica sin punto. |
| 7 | **No** se agrega el tipo «negocio»: con los actuales basta. |
| 8 | **No** geocodificación por texto: pin manual. |
| 9 | **Hora fija = restricción dura:** la visita fija su posición; si el orden genera conflicto horario, **se muestra siempre**. La visita agendada puede modificarse (la hora no es inmutable). |
| 10 | **Se mantiene** planificar créditos de otro cobrador **solo con permiso de asignar**, con la **insignia «Ayuda» siempre visible** en la parada. |
| 11 | **Sí** unificar el módulo con el reloj de la empresa (`TenantClockService`). |
| 12 | **Sí** vincular pago con visita (`visitId` opcional: no toda visita genera pago). |
| 13 | **Sí** avisar al cobrador cuando se le asigna una ruta (`ROUTE_ASSIGNED`). |
| 14 | **Firma: se retira del contrato por ahora**; se reevalúa cuando haya caso de uso. |

**Confirmaciones (2026-10-08, 2.ª ronda):**
- **#1 → Solicitud con aprobación.** Quien NO creó la ruta no la modifica directo: crea una **solicitud de cambio** (tipo, detalle, **motivo obligatorio**) que el creador aprueba o rechaza; al aprobarse, la API aplica el cambio. Implica entidad nueva (`route_change_requests`), bandeja y notificaciones (ver O.3).
- **#2 → Sin permiso nuevo.** Registrar visita desde web: **creador de la ruta o `ROUTE_ASSIGN/WRITE`**; la visita queda «registrada por X».
- **#3/#4 → Pendientes = SKIPPED + liberan agenda**, con el motivo escrito; las visitadas se conservan.
- **Rutas existentes sin creador:** se rigen por permisos (ASSIGN/WRITE o cobrador dueño) hasta que haya `created_by`.
- **Rama:** trabajo en rama/worktree nuevo desde `main` (sin arrastrar el trabajo de agenda sin commitear).
- **Orden de trabajo:** API + web primero; **móvil solo después de validar visualmente la web**.

**Consecuencias técnicas descubiertas al resolver:**
- `route_plans` **no guarda quién creó la ruta** (no hay `created_by`). La regla «el creador manda» exige agregarlo (migración + backfill: rutas existentes sin creador → se asume el cobrador o se deja nulo y se cae a la regla por permisos).
- Hacen falta **motivos obligatorios** (texto) en: modificar ruta ajena, completar con pendientes, cancelar, registrar visita a nombre de otro. Persisten en un campo de la ruta/visita o en auditoría (a decidir).
- Retirar la firma implica quitar `SIGNATURE` del contrato/documentación (o dejar el enum sin uso) y ajustar el visor web.

---

## M. Riesgos

| Riesgo | Detalle | Mitigación propuesta |
|---|---|---|
| **Estados** | transiciones libres; `route.completed` repetido; cancelar pierde vínculo histórico | Fase 1, `UPDATE … WHERE status` + eventos idempotentes |
| **Concurrencia** | sin locks; `addStop` 500; duplicados por carrera | uniques + reintento + transacción condicional |
| **Permisos** | `ROUTE_WRITE` ≈ `ROUTE_ASSIGN`; supervisor sin `ROUTE_EXECUTE`/`PAYMENT_WRITE`; auditor 403 en preview | definir matriz de permisos antes de Fase 3/6 |
| **Timezone** | 4 «hoy» distintos; `?date` de visitas en UTC; `plannedDate` sin validar | `TenantClockService` en todo el módulo |
| **Duplicación de pagos** | pago y visita son llamadas separadas | mantener `Idempotency-Key`; decidir `visitId` |
| **Duplicación de visitas** | segunda visita sobre misma parada con otro id | validar estado/dueño; unique lógico |
| **Offline sync** | cola con acciones que dependen de estado del servidor; transiciones nuevas pueden rechazar acciones encoladas | códigos de error permanentes vs transitorios; compat de contrato |
| **Ruta parcial** | gestión atrapada por `AGENDA_014` | regla de cierre (L.3) |
| **Ubicaciones múltiples** | sin `isPrimary`; garantes sin filtrar por crédito | `locationId` en parada + filtro `credit_guarantors` |
| **Datos personales** | direcciones en claro en ruta/PDF; `PII_REVEAL` repetido; preview audita 3 veces | auditar una vez; preview sin PII innecesaria |
| **Evidencias** | `fileUrl`/`fileHash` sin verificar; adjuntar a visitas ajenas; reintento duplica | validar dueño, prefijo del tenant, unique `(visitId,fileHash)` |
| **Optimizador** | mueve VISITED y visitas con hora; condición de carrera preview→resequence | optimizar solo PENDING, dentro de una transacción |

---

## N. Plan de pruebas

- **API (specs + integración):** tabla completa de transiciones válidas/ inválidas; replay de `PATCH` completar (no re-emite evento); `createVisit` con parada ajena / ruta CANCELLED / parada VISITED; cancelar conserva `agendaItemId` de VISITED; `addStop` concurrente; `plannedDate` con hora; fecha pasada; reloj del tenant en rutas; permisos por rol (matriz) incl. auditor/viewer; `optimize` respeta VISITED y horas fijas; preview sin escritura; `locationId` (de otro cliente → 404; garante de otro crédito → rechazo).
- **Web (vitest):** BFF `status/preview/optimize/visits` (CSRF, errores); vista «Hoy» (permisos, vacío, estados); botones según estado/permiso (nunca acciones inválidas); asistente de planificación (agenda visible, sin ubicación, mínimo de paradas, orden); parada bloqueada; formulario de gestión (6 variantes, validaciones de `validateVisitDetails`).
- **Móvil (jest):** compat con transiciones nuevas (acciones encoladas rechazadas con error permanente); `locationId` en `diffStops`; no duplicación de visita/pago/promesa; flujo offline→online.
- **Integración extremo a extremo (hoy no existe E2E):** agenda → generar → iniciar → visita (+pago/promesa) → completar → mora/cartera reflejan.
- **Regresión:** correr `pnpm test` completo (línea base de cierre F4/11: API 1375, web 809, móvil 726, shared 306 según el doc; **no se verificó**).

---

## O. Propuesta visual (9 vistas) → reutilización

Referencia: `Downloads/propuestas de rutas.png`. **Regla: manda la paleta, tipografía y componentes de la app (`k-*`, `panel-ui`, `DataTable`…); la imagen aporta estructura y jerarquía, no estilos.** Todo lo de la columna «Reutiliza» ya existe.

| # | Vista propuesta | Reutiliza | Falta (API / web) |
|---|---|---|---|
| 1 | **Rutas · Hoy**: 4 totales (cobradores, paradas, gestionadas, pendientes), pestañas *Rutas de hoy / Historial*, tabla por cobrador (estado, paradas, progreso, recaudado, siguiente parada, acción única) | `RouteTabs`, `DayPicker`, `DataTable`, `Badge`, `WorkSummary`/`ToneTile`, `summarizeDay` | API: el listado no trae **siguiente parada ni recaudado** → ampliar `GET /routes` (o `GET /routes/today`) sin N+1. Acción contextual según estado/permiso |
| 2 | **Planificar · Fecha y cobradores** + visitas agendadas del día (hora, cliente, tipo, crédito, prioridad) | stepper nuevo sobre `PlanScreen`; `GET /agenda` (VISIT SCHEDULED) | multiselección de cobradores y varios días; tabla de agenda con aviso «se marcan automáticamente» |
| 3 | **Clientes y ubicaciones**: candidatos con filtros + panel de ubicaciones disponibles (casa, trabajo, garante, familiar), «Predeterminada», «Agregar a la ruta» | `AvailableList`, `FilterPanel`, `/mora.locations` (ya trae garantes/familiares), `MapPicker` | `RouteStop.locationId`; «predeterminada» = primera HOME propia (regla ya usada en mora); filtro por `credit_guarantors`; ubicación sin punto → obligatoria (decisión 6) |
| 4 | **Mapa y orden**: lista arrastrable + mapa + Optimizar orden + Ver tiempos | `MapPanel`, `PointsMap`, `RouteMap`, `diffStops`/`moveStop` | drag&drop; botón optimizar (BFF `optimize`); hora fija = posición fija |
| 5 | **Vista previa**: 6 visitas / 12,4 km / 2 h 35, hora de inicio y fin, sugerencia «ahorra 2,6 km», tabla orden·cliente·ubicación·hora·distancia, Volver / **Confirmar y publicar** | `route-eta` (a `shared`), `RouteMap` | **preview sin ruta persistida** (endpoint sin estado `POST /routes/preview` con puntos ordenados) para no crear una ruta antes de publicar; ETA como hora de reloj |
| 6 | **Detalle de ruta (jornada)**: 4 tarjetas (recaudado, gestionadas, pendientes, distancia), barra %, mapa, «Siguiente parada», PDF, «Más acciones» | `[id]/page.tsx`, `summarizeDay`, `RouteMap`, `Card`/`Badge` | acciones de estado (iniciar/completar/cancelar con motivo) y solicitudes de cambio; Navegar/Llamar opcionales en web |
| 7 | **Lista de paradas con acciones** (#, cliente, hora, deuda, mora, estado, resultado, Ver/Registrar) | `RouteEditor` lista, `DataTable` | columna resultado (`lastOutcome` ya existe); botón Registrar |
| 8 | **Registrar gestión** (6 variantes, monto, método, nota, evidencia) | `validateVisitDetails`, `RegisterActivityButton`, `PaymentActions`, `/api/uploads`, `Modal` | `POST /visits` desde web por creador/ASSIGN-WRITE con `registeredBy`; `visitId` en pago; nota en lugar de edición |
| 9 | **Detalle de parada** (tabs Información / Crédito / Ubicaciones / Historial / Evidencias; enlaces a Mora y Cartera) | `parada/[sid]/page.tsx`, enlaces `/mora/[creditId]` y `/cartera/[id]` | pestañas; historial de visitas de la parada y notas |

### O.1 Principios de diseño (de la imagen, aplicados a Kobrax)
Una acción principal por fila (Ver / Iniciar / Planificar según estado); badges de estado con los tonos existentes (`ROUTE_STATUS_TONE`); paso a paso con stepper de 4 pasos en planificar; mapas grandes solo en orden/preview/jornada; sin tarjetas de relleno.

### O.2 Publicar sin estado nuevo
La imagen separa *Vista previa* de *Publicar*. Propuesta: **no agregar estado BORRADOR**; el borrador vive en la pantalla y el preview se calcula con un endpoint sin estado; **Publicar = crear la ruta (PLANNED) + notificar al cobrador (`ROUTE_ASSIGNED`)**. Evita rutas a medias visibles para el cobrador.

### O.3 Solicitudes de cambio (decisión 1)
- Tabla `route_change_requests`: `route_id`, `requested_by`, `kind` (`ADD_STOP`, `REMOVE_STOP`, `REORDER`, `EDIT_VISIT_NOTE`, `CANCEL`, `COMPLETE`), `payload` JSON, `reason` (obligatorio), `status` (`PENDING|APPROVED|REJECTED`), `decided_by`, `decided_at`, `decision_note`.
- El creador (o ASSIGN/WRITE si no hay creador) ve una bandeja en `/rutas/[id]` y en el menú de notificaciones; al aprobar, la API aplica el cambio con las mismas validaciones de la máquina de estados.
- ⚠️ **Alcance a validar:** ¿todos los `kind` pasan por solicitud, o solo los que alteran la ruta de otro (agregar/quitar/reordenar/cancelar)? Propuesta v1: **solo `ADD_STOP`, `REMOVE_STOP`, `REORDER` y `CANCEL`**.

### O.4 Fases revisadas
| Fase | Alcance | Capa |
|---|---|---|
| 1 | Máquina de estados + `created_by` + motivos + reloj del tenant + endurecer `createVisit`/`updateStop` | API + shared |
| 2 | `RouteStop.locationId`, `visitId` en pago, filtro de garantes, `registeredBy` en visita | DB + API |
| 3 | Vista **Hoy** (vista 1) + acciones de estado (vista 6) | API (listado ampliado) + web |
| 4 | Planificador por pasos (vistas 2-4) + preview sin estado (vista 5) + publicar | API + web |
| 5 | Registrar gestión desde web (vistas 7-9) | API + web |
| 6 | Solicitudes de cambio (O.3) | DB + API + web |
| 7 | Validación visual con la usuaria → **recién entonces** móvil (consumir `shared`, `locationId`, nuevos códigos de error) | móvil |

---

## Anexo — Hallazgos menores a no perder

- `GenerateRouteDto.auto` no se lee; `totalCases` es nombre legado; `ROUTE_ASSIGNED` solo en seed/móvil.
- Textos `panel.routes.planning.*` y JSDoc de `routeQuery` desactualizados; README F10/rutas dice 8 outcomes (son 10) y S4–S6 figuran «borrador» aunque están construidos; no existe plan S3.
- Variables `OSRM_URL`, `NEXT_PUBLIC_MAP_STYLE_URL`, `EXPO_PUBLIC_MAP_STYLE_URL` no están en `.env.example`; el extracto OSRM de Bolivia se baja a mano.
- Packs de mapas offline del móvil requieren `EXPO_PUBLIC_MAP_STYLE_URL` (precondición de ops abierta).
- El móvil filtra «hoy» en el teléfono porque el backend compara fecha exacta.

---

## P. Estado de la implementación (2026-10-08) — API + web hechos; móvil pendiente de tu validación

Rama: `feat/rutas-f4-12` (worktree `E:\kobrax\kobrax-rutas`), parte de `fix/qa-bugs` — no de `main`, que está 118 commits atrás y
no tiene la agenda F4/11 de la que depende Rutas. **Sin commitear.** La migración `20261008000000_rutas_f4_12` ya está aplicada en la base local.

### Hecho

| Fase | Qué quedó | Dónde |
|---|---|---|
| 1 · Estados | Máquina de estados de ruta y parada en la API (transición válida, `UPDATE … WHERE status`, reintento idempotente, hora de inicio/cierre, motivo obligatorio, paradas sin gestionar → SALTADAS, no se cancela con visitas); autoría (`created_by`); reloj de la empresa y `YYYY-MM-DD` en rutas; `createVisit`/`updateStop`/`addEvidence` endurecidos | `routes.service.ts`, `route-access.ts`, `field.service.ts`, `shared/utils/route-rules.ts`, migración |
| 2 · Ubicación | `route_stops.location_id` (elegir domicilio/garante/trabajo; sin elegir se guarda la principal); `requirePoints`; `payments.visit_id`; visita con `registered_by`/`source`/`corrects_visit_id` | `generate`, `addStop`, `payments.service.ts` |
| 3 · «Hoy» + acciones | `/rutas` abre en **Hoy** (4 totales, una fila por cobrador, «Iniciar / Ver / Planificar»); listado trae `nextStop` y `collected`; ficha con Iniciar/Completar/Cancelar/Optimizar (con motivo), «Siguiente parada» | `today-board.tsx`, `route-actions.tsx`, `[id]/page.tsx` |
| 4 · Planificador | 4 pasos (fecha y cobrador · clientes y ubicaciones · mapa y orden con arrastrar · vista previa) y publicar; vista previa **sin guardar** (`POST /routes/plan-preview`); optimizar respeta horas fijas | `plan-screen.tsx`, `plan-preview.tsx`, `plan-location-dialog.tsx` |
| 5 · Gestión web | Registrar gestión (6 variantes, foto, cobro ligado a la visita, promesa) a nombre del cobrador; corregir = visita nueva; detalle de parada con 5 pestañas | `record-visit-dialog.tsx`, `parada/[sid]/page.tsx` |
| 6 · Solicitudes | `route_change_requests` (agregar/quitar/mover parada y cancelar) con aprobar/rechazar/retirar, avisos y bandeja en la ficha | `route-changes.service.ts`, `change-requests-panel.tsx` |
| Aviso | `ROUTE_ASSIGNED` se emite al publicar; `ROUTE_CANCELLED`, `ROUTE_CHANGE_REQUESTED/DECIDED`; la campanita lleva a la ruta | `notifications.service.ts` |

Bugs que ya existían y quedaron corregidos de paso: `chosenCredits` comparaba `text = uuid` (planificar a mano con créditos elegidos daba 500 contra la base real; los
tests con mocks no lo veían); `GET /visits?date=` filtraba por día UTC; completar dos veces repetía `route.completed` y su notificación; cancelar borraba el vínculo de
paradas ya visitadas.

### Verificación

API 1452 unitarias + 42 de integración (base real descartable); shared 326; web 891 + `next build`; móvil 750 (solo se tocó un mapa de íconos para que compile). Humo
manual contra la base local: las 4 pantallas responden 200 para gerente, supervisor y cobrador, sin errores de servidor.

### Cómo validarlo visualmente

`pnpm --filter @kobrax/api build && pnpm --filter @kobrax/api start` (puerto del `.env`) y `pnpm --filter @kobrax/web dev`. Usuarios demo (clave `Kobrax123!`):
`manager@kobrax.demo` (arma y supervisa), `collector@kobrax.demo` (Carlos) y `cobrador1@kobrax.demo`.
Recorrido sugerido: `/rutas` (Hoy) → «Planificar» a Diego Mamani → ficha de una ruta → «Registrar gestión» → entrar como Carlos y pedir un cambio → volver como la gerente y aprobarlo.

### Pendiente / decisiones que quedaron abiertas

1. **Móvil** (tras tu validación): enviar `locationId`, pedir motivo al cerrar con paradas pendientes (hoy se tolera su ausencia SOLO para el cobrador, a propósito: es un shim a quitar),
   mostrar «pedí el cambio» ante `ROUTE_REQUEST_REQUIRED`, avisos nuevos y `visitId` en el cobro; mover `visit-result.ts` a `shared` (ya existe la versión compartida).
2. **Cobro desde la web**: lo registra quien tiene `payment:write` (cobrador y administrador). Un gerente/supervisor puede registrar la visita pero no el cobro: ¿se le da `payment:write`?
3. **Firma** (decisión 14): sigue en el enum y en el visor de evidencia; falta retirarla del contrato y de los docs.
4. Paradas anteriores a F4/12 no guardan su ubicación; una visita web a una parada sin punto se guarda en (0, 0) marcada como estimada y el mapa la oculta.
5. Navegar/Llamar desde la web (opcional en tu plan) no se hizo.
6. Las rutas anteriores sin creador se rigen por permisos (quien administra rutas y su cobrador).
