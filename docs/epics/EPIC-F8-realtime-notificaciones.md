# EPIC F8 — Realtime y Notificaciones

**ID:** EPIC-F8 · **Estado:** ✅ Base completada · **Owner:** API (+ Security, Shared, Testing)
**Depende de:** **F5/F6/F7** (emiten eventos de dominio) · **Requisitos:** soporte a RF-06/07/10, RNF-05
**Design:** [design-system.md](../design-system.md) · **Arquitectura DB:** `DB_Architecture_COBRA.docx` (tabla `notification`)

> Da **supervisión en vivo** y **avisos operativos**: un canal WebSocket por tenant/usuario que difunde los eventos
> de casos, pagos, rutas y ubicación del cobrador, más notificaciones persistidas (con stubs de push/SMS/email).

## 0. Estado de ejecución
**✅ Base completada.** `RealtimeGateway` (Socket.io, ns `/events`) con handshake autenticado (access token + denylist)
y rooms derivadas server-side (`tenant:{id}`, `user:{id}`, `tenant:{id}:supervisors`). Módulo `notifications`:
traductor de eventos de dominio (reusa el `EventBusService` ya cableado en F5/F6/F7) → persiste `notification`
(siempre, M4) + emite por WS; REST de bandeja (scope `own`); `collector.location` throttled → `last_known_*` +
broadcast a supervisores; canales push/SMS/email como stubs; job `PROMISE_DUE`. Contrato de realtime en
`@kobrax/shared` (`types/realtime.ts`). **160 tests** verdes (23 nuevos), type-check + build + arranque verificados.

> **Decisión:** se reutiliza el `EventBusService` en proceso (node:events) ya existente en lugar de añadir
> `@nestjs/event-emitter` — mismo desacople emisor/consumidor sin churn. La enumeración de tenants del job de sistema
> usa la función SECURITY DEFINER `promise_due_account_ids()` (`prisma/rls/004_notification_functions.sql`).
>
> **Pendiente (escala/futuro):** story 9 — adaptador Socket.io-Redis para multi-instancia; proveedores reales de
> push/SMS/email; tests de integración WS con dos clientes reales (los unit cubren la derivación de rooms/aislamiento).

## 1. Objetivo de negocio
Que supervisores y gerencia vean la operación **en tiempo real** (casos que cambian, pagos que entran, cobradores en
mapa) y que los usuarios reciban **avisos operativos** oportunos — todo **aislado por tenant** (un evento jamás cruza
de empresa). Sustenta la supervisión remota (propuesta de valor del doc) y la usabilidad (RNF-05).

## 2. Alcance
### Incluye
- **`WebSocketGateway`** (Socket.io, NestJS): handshake autenticado por **access token** (+ denylist), rooms
  `tenant:{accountId}` y `user:{userId}`.
- **Eventos server→client**: `case.updated`, `payment.registered`, `collector.location`, `route.completed`.
- **Bus de eventos de dominio** (`@nestjs/event-emitter`): F5/F6/F7 **emiten**, F8 **traduce** a WS + persistencia.
- **Módulo `notifications`**: persistencia (`notification`), listar/marcar leído, **stubs** de push/SMS/email (interfaz lista).
- **`PROMISE_DUE`**: job programado que avisa promesas de pago próximas a vencer.
### No incluye
- Proveedores reales de push/SMS/email (FCM/APNs/Twilio/SES) → wiring posterior (F8 deja la interfaz `NotificationChannel`).
- UI de supervisión (mapa de cobradores, feed) → **F9 (web)** / **F10 (mobile)** consumen este canal.
- Ingesta masiva de telemetría/analítica histórica → **F11**.

## 3. Conformidad con `DB_Architecture_COBRA`
| Elemento (doc) | Implementación | Estado | Nota |
|----------------|----------------|--------|------|
| `notification` | `Notification` | ✅ Conforme | `type`, `title`, `body`, refs `client/credit/case`, `read_at`, `account_id`+`user_id`. |
| Realtime (rooms por tenant/usuario, eventos `case.updated`/`payment.registered`/`collector.location`/`route.completed`) | `WebSocketGateway` | ✅ Alineado | Definido en `CLAUDE.md` de API; F8 lo implementa. No es una tabla. |
| `NotificationType` | enum shared | ✅ | `CASE_ASSIGNED/CASE_UPDATED/PAYMENT_REGISTERED/ROUTE_ASSIGNED/PROMISE_DUE/SYSTEM`. |

### Mejoras propuestas
| # | Mejora | Tipo | Por qué |
|---|--------|------|---------|
| **M1** | **Auth del WebSocket** por access token en el handshake (reusar la verificación del `JwtAuthGuard`) + chequeo de **denylist** de sesión. | Security | Un socket no autenticado no debe unirse a ninguna room. **Vinculante.** |
| **M2** | **Contrato de eventos en `@kobrax/shared`** (tipos de payload por evento) — fuente única para API/web/mobile. | Shared | Desacopla emisores (F5/F6/F7) de consumidores; tipado end-to-end. |
| **M3** | **Aislamiento estricto de rooms**: un cliente solo se une a `tenant:{su accountId}` y `user:{su userId}` (verificado, no declarado por el cliente). | Security | Evita fuga de eventos entre tenants. **Vinculante.** |
| **M4** | **Entrega + persistencia**: la notificación se guarda siempre; si el usuario está conectado, además se emite por WS (si no, queda para fetch). | API | No se pierden avisos al estar offline. |
| **M5** | **`collector.location`**: ingestión throttled del GPS del móvil → broadcast solo a supervisores del tenant; persiste `last_known_lat/lng` del user. | API/Security | Mapa en vivo sin saturar (RNF-04). |
| **M6** | **`NotificationChannel`** (interfaz) con stubs push/SMS/email + cola; el proveedor real se inyecta luego. | API | Deja F8 cerrable sin depender de credenciales externas. |

## 4. Contratos (F8)
**WebSocket** (Socket.io, namespace `/events`):
```
handshake: auth.token = <accessToken>   → valida + une a rooms tenant:{accountId}, user:{userId}
server→client: case.updated | payment.registered | collector.location | route.completed
client→server: collector.location {lat,lng}   (solo COLLECTOR; throttled; route:execute)
```
**REST** (Bearer + `TenantGuard`):
```
GET  /notifications        ?unread&page&limit     → 200 (propias del usuario)
POST /notifications/:id/read                       → 204
POST /notifications/read-all                       → 204
```
> Sin permisos nuevos: cada usuario solo ve/gestiona **sus** notificaciones (scope `own`).

## 5. Modelo de datos (cambios F8)
Sin cambios de schema (`Notification` ya conforme). Variables: `SOCKET_CORS_ORIGIN`. Eventos en Redis pub/sub si se escala
a múltiples instancias del gateway (adaptador Socket.io-Redis) — **recomendado** para escalabilidad horizontal (RNF-02).

## 6. Historias y tareas
| # | Historia | Agente | Estado |
|---|----------|--------|--------|
| 1 | `RealtimeGateway` (Socket.io) + auth de handshake por access token + denylist | Security | ✅ |
| 2 | Rooms `tenant:{accountId}` / `user:{userId}` / `…:supervisors` con **aislamiento verificado** | Security | ✅ |
| 3 | Bus de eventos (reusa `EventBusService` existente) + contrato de payloads en `@kobrax/shared` | API/Shared | ✅ |
| 4 | Traductor evento de dominio → WS + persistencia de `notification` | API | ✅ |
| 5 | `collector.location` (ingestión throttled + broadcast a supervisores + `last_known_*`) | API | ✅ |
| 6 | Módulo REST de notificaciones (listar/marcar leído) | API | ✅ |
| 7 | Job `PROMISE_DUE` (cuotas próximas a vencer → cobrador asignado) | API | ✅ |
| 8 | `NotificationChannel` (interfaz + stubs push/SMS/email) | API | ✅ |
| 9 | (Escala) adaptador Socket.io-Redis para multi-instancia | API | ⏳ (futuro) |
| 10 | Tests: aislamiento de rooms por tenant, entrega+persistencia, throttle, REST, job | Testing | ✅ (unit) |

## 7. Seguridad & Cumplimiento (checklist F8)
- [x] Handshake WS **autenticado** (access token válido + no en denylist); sin token → `disconnect`.
- [x] El cliente **no elige** sus rooms: el servidor las deriva de su `accountId`/`userId` (`deriveRooms`).
- [x] Ningún evento cruza de tenant (rooms derivadas server-side; `collector.location` solo a supervisores del mismo tenant).
- [x] `collector.location` solo de cobradores (`route:execute`); throttle 5 s/socket; broadcast solo a `…:supervisors`.
- [x] Notificaciones expuestas solo a su destinatario (scope `own`, filtrado por `userId`); payloads sin PII.
- [x] CORS del socket restringido (`SocketIoAdapter` + `SOCKET_CORS_ORIGIN`).

## 8. DoD (F8)
- [x] Un evento de un tenant **solo** llega a clientes de ese tenant (rooms derivadas; unit de aislamiento).
- [x] `case.updated`/`payment.registered`/`route.completed` emitidos por F5/F6/F7 llegan por WS y quedan **persistidos** (feed a supervisores; `case.updated` persiste en cambios de estado).
- [x] Notificación marcable como leída (idempotente, 404 si ajena); el usuario solo ve las suyas.
- [~] Reconexión con backoff: la maneja el cliente Socket.io (web/mobile, F9/F10); socket sin auth → `disconnect` (verificado).
- [x] `type-check`+`build`+`test` verdes (160 tests, 23 de F8). Cobertura formal ≥80% pendiente del harness de coverage.

## 9. Estrategia de tests
- **Unit:** auth de handshake (token válido/ inválido/ denylisted), derivación de rooms, throttle de location, `NotificationChannel` stub.
- **Integración:** dos clientes en tenants distintos → un evento llega solo al correcto; entrega+persistencia; emisión desde un evento de dominio simulado.

## 10. Observabilidad & métricas
- Conexiones activas por tenant, eventos emitidos por tipo, latencia de entrega, notificaciones no leídas. Logs sin PII.

## 11. Riesgos
| Riesgo | Mitigación |
|--------|-----------|
| Fuga de eventos entre tenants | Rooms derivadas server-side + auth de handshake + test de aislamiento |
| Socket no autenticado | Validación de access token + denylist en el handshake |
| Saturación por `collector.location` | Throttle/rate-limit + (escala) adaptador Redis |
| Pérdida de avisos con usuario offline | Persistir siempre la notificación; WS es entrega adicional, no única |
| Acoplamiento emisor↔consumidor | Bus de eventos + contrato de payloads en `@kobrax/shared` |
