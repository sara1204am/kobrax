# P1 · Home + Agenda (solo lectura)

> **ESTADO: COMPLETO (2026-07-07) — listo para gate `/f10-validar-plan P1`.**
> Depende de: **P0** (mergeado). Build: 🟢 Expo Go. Rama: `f10/P1-home-agenda`.

## 1. Objetivo
Primeras pantallas de campo **reales** (solo lectura): el cobrador abre la app y ve su **jornada** (Home con KPIs + estado de ruta) y su **Agenda diaria** de casos. Cero escritura: solo `GET`. Deja los `*.service.ts` de datos listos para que P2 (gestiones) y P6 (offline) los enchufen sin reescribir.

## 2. Rama
`f10/P1-home-agenda`

## 3. Build
🟢 **Expo Go** — solo listas/datos, sin nativo.

## 4. Pantallas Figma (node-ids del ui-screen-map §4; pull just-in-time por pantalla al construir)
| Pantalla | node-id | Estado |
|---|---|---|
| Home — Jornada Activa | `42:3069` | con ruta activa: saludo + KPIs + resumen de ruta + badge notifs |
| Home — Pre-jornada | `42:3247` | sin ruta activa: mismo layout, estado "sin ruta" (generar ruta = P3) |
| Agenda Diaria | `64:4` | lista (FlashList) de casos asignados del día + filtro por estado |

**Fuera de P1** (→ P2): Detalle de Gestión (`64:425`), pantalla de Notificaciones (`64:538`) y todas las gestiones de escritura (`65:*`, `66:*`).

## 5. Contrato (real, verificado 2026-07-07 contra los controllers; todos GET, envelope `{data,meta,error}` + paginación)
| Uso | Endpoint | Notas |
|---|---|---|
| Casos del cobrador | `GET /api/cases?assigneeId=<mi userId>&status?&overdue?&page?&limit?` | `assigneeId` = `me().userId`. `overdue=true` para el KPI de mora. Paginado (`meta.total`). |
| Ruta activa del día | `GET /api/routes?collectorId=<mi userId>&date=<hoy>&status=IN_PROGRESS` | lista; si vacía → Home Pre-jornada |
| Detalle de ruta (stops) | `GET /api/routes/:id` | progreso = stops `COMPLETED`/total |
| Badge notifs no leídas | `GET /api/notifications?unread=true&limit=1` | **solo el contador** (`meta.total`); la pantalla y el marcar-leído son P2 |

- **Tablas (solo lectura):** `collection_cases`, `route_plans`, `route_stops`, `notifications`.
- **Escritura:** ninguna. `POST /notifications/:id/read` → **P2**.
- **Multi-tenant:** el `accountId` lo pone el backend desde el JWT (guards `TenantGuard`); el móvil no lo manda.

## 6. Auditoría de reuso (Paso B)
| Capacidad | Decisión | Path |
|---|---|---|
| Fetch autenticado (Bearer + refresh) | **REUSAR** | `src/api-client.ts` `authedFetch<T>` |
| Store conectividad / offline banner | **REUSAR** | `src/store/net.ts`, `OfflineIndicator` (ya en `(tabs)/_layout`) |
| Enums de dominio (`CaseStatus`, `RouteStatus`, `RouteStopStatus`, `NotificationType`) | **REUSAR** | `@kobrax/shared` (NUNCA redefinir en móvil) |
| Formato moneda / fecha | **REUSAR** | `@kobrax/shared/utils/{currency,date}.utils` |
| id del cobrador / cuenta | **REUSAR** | `authService.me()` → `userId` |
| Fila de lista pulsable | **REUSAR** | `ui.tsx` `ListRow` |
| Pill de estado | **EXTENDER** | `ui.tsx` `StatusBadge` + nuevo mapeo `CaseStatus`→`BadgeTone` |
| Loading / empty / error | **REUSAR** | `ui.tsx` `EmptyState` + `ActivityIndicator` |
| Listas performantes | **REUSAR** | `@shopify/flash-list` (instalado en P0) |

## 7. Artefactos NUEVOS (justificados + ubicados para reuso)
| Artefacto | Ubicación | Por qué / reuso futuro |
|---|---|---|
| `cases.service.ts` | `src/cases.service.ts` | `listCases(params)` sobre `authedFetch`. Base de Agenda(P1) + Gestiones(P2). |
| `routes.service.ts` | `src/routes.service.ts` | `listRoutes`/`getRoute`. Base de Home(P1) + Rutas(P3). |
| `notifications.service.ts` | `src/notifications.service.ts` | `unreadCount()` (P1). P2 le agrega `list()`+`markRead()`. |
| `CaseCard` | `ui.tsx` | fila de caso (deudor, monto, días de mora, estado) sobre `ListRow`+`StatusBadge`. Reusada en Agenda(P1), Gestiones(P2), Rutas(P3). |
| `StatTile` | `ui.tsx` | tile de KPI (label + valor + tono). Home(P1) + Resumen de jornada(P3). |
| `caseStatusTone(status)` | `ui.tsx` | mapeo presentacional `CaseStatus`→`BadgeTone` (el enum es de shared; el color es UI). |

> **NO** se crea: segundo cliente HTTP, segundo store, `StopRow` (eso es P3), `AmountInput` (P4). Distancia en `CaseCard` → diferida (necesita GPS, dev build).

## 8. KPIs del Home (cliente, decisión cerrada §8.1 ui-screen-map)
Derivados de lo disponible en P1 (sin endpoint de agregación):
- **Gestiones / progreso de ruta:** stops `COMPLETED` / total (de `GET /routes/:id`). Sin ruta → "sin ruta activa".
- **Casos asignados:** `meta.total` de `GET /cases?assigneeId`.
- **En mora:** `meta.total` de `GET /cases?assigneeId&overdue=true`.
- **Cobrado hoy:** **placeholder ("—")** hasta **P4** (necesita `payments`). Marcado en UI como pendiente, no se inventa.

## 9. Tareas (leer → UI → pantallas → estados)
1. `cases.service.ts` + `routes.service.ts` + `notifications.service.ts` (thin, sobre `authedFetch`), con tipos de respuesta verificados contra el `select` real de cada `*.service.ts` del API al construir.
2. `caseStatusTone` + `CaseCard` + `StatTile` en `ui.tsx` (+ tests de render mínimos).
3. **Agenda Diaria** (`64:4`): FlashList de `CaseCard` desde `listCases({assigneeId})`; estados loading/empty/error (`EmptyState`); pull-to-refresh.
4. **Home** (`42:3069`/`42:3247`): saludo (`me()`), fila de KPIs (`StatTile`), resumen de ruta activa (o pre-jornada), badge de notifs. Un solo componente que ramifica activa/pre-jornada por si hay ruta `IN_PROGRESS`.
5. Reemplazar los placeholders actuales de `(tabs)/index.tsx` (Inicio) y `(tabs)/agenda.tsx`.
6. Verificar (type-check + jest + expo export) y handoff visual.

## 10. Reglas de la fase
Las 3 del epic §3.3: (1) **sol → contraste** (monto/nombre/días de mora en `navy`/`text`, labels en `muted`); (2) **gama baja → perf** (FlashList, no FlatList; animación solo UI-thread si se usa; arranque < 2 s); (3) **animación con propósito** (pull-to-refresh y press; nada decorativo).
Específicas P1: **solo lectura** (cero `POST`/`PATCH`); **KPIs en cliente** (no pedir agregación al server); `CaseStatus`/tono desde el enum de shared, no hardcodear strings de estado.

## 11. DoD
- Funcional: con la API real (seed), Home muestra jornada+KPIs y Agenda lista los casos del cobrador; estados loading/empty/error visibles; offline no rompe (banner informa, no bloquea).
- Verificación: `type-check` + `jest` + `npx expo export --platform android` verdes.
- Perf (DoD hardware §2 BUILD-PLAN): Agenda (lista núcleo) fluida a 60 fps y arranque < 2 s en Android barato.
- Visual: validación de la usuaria en dispositivo real.

## 12. Riesgos / decisiones abiertas (cerradas 2026-07-07)
- **Forma exacta del `CaseDto`** (nombre deudor, monto, días de mora): **aceptado como verificación en build** — se lee el `select` real de `cases.service.list` del API al construir (§9.1). No bloquea el plan.
- **Ruta activa = `status IN_PROGRESS`**: **aceptado como verificación en build** — se confirma contra el service de routes al traer `GET /routes/:id` (vs `PLANNED`). No bloquea el plan.
- **Badge de notifs en Home**: **CONFIRMADO** — se queda en P1 como contador mínimo de no-leídas; pantalla + marcar-leído = P2.

## ✅ Confirmaciones (2026-07-07)
- [x] Alcance/pantallas por completos (§4): Home `42:3069`+`42:3247` + Agenda `64:4`.
- [x] OK a los 6 artefactos nuevos (§7) y su ubicación.
- [x] OK a los KPIs de P1 y al placeholder de "cobrado hoy" hasta P4 (§8).
- [x] Riesgos §12 cerrados (2 → verificación en build; badge notifs → confirmado).

## 13. Resultado del build (2026-07-07) — CONSTRUIDO, pendiente handoff visual
Verificación verde: **API** type-check + tests 166/166; **Mobile** type-check + jest 48/48 + expo export.

**Hallazgos verificados en build (ajustaron el contrato):**
- `serializeCase` del listado NO traía deudor ni monto (solo IDs) → **decisión de la usuaria: enriquecer backend.**
- Stops se cierran como `VISITED`/`SKIPPED` (no `COMPLETED`) → `routeProgress` cuenta esos.
- `apiFetch` móvil descartaba `meta` → se propagó (los KPIs de conteo leen `meta.total`).

**Ampliación aprobada por la usuaria (fuera del plan original, backend):**
- **Enriquecimiento del DTO de casos**: `cases.list`/`findOne` incluyen `client`(nombre) + `credit`(monto, moneda, `daysPastDue`). `serializeCase` expone `clientName`/`amount`/`currency`/`daysPastDue`. La Agenda muestra nombre + monto + mora **server-side** (no reloj del móvil).
- **Scope por capacidad (adelanto de P10)**: `cases.list/findOne` y `routes.list/findOne` acotan al propio `assigneeId`/`collectorId` salvo que el rol tenga `CASE_ASSIGN`/`ROUTE_ASSIGN`. Regla por **capacidad, nunca por nombre de rol/tenantType**. Plumbing: `permissions` en `RequestContext` + `TenantContextService.can()`.
- **Filtro `open`** en `cases.list` (excluye terminales) → KPI "Casos asignados" cuenta solo abiertos.

**Code-review high (workflow multi-agente): 9 hallazgos confirmados, TODOS resueltos** — FlashList sin altura (colapsaba la lista), Agenda sin salida a login en sesión expirada, Home expulsado a offline en refresh, KPI contando casos terminales, race de filtros, mora con reloj del dispositivo, `me()` repetido por filtro, prioridad sin traducir, cast inseguro de enum. 1 refutado (duplicación ListRow, aceptada).

**Pendiente:** validación visual de la usuaria en dispositivo real → recién ahí merge a `main`.
