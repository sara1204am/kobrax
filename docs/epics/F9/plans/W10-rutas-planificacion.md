# W10 · Rutas: planificación e historial — FASE 0, auditoría

> **Estado: diagnóstico. Cero código escrito.** El plan exige detenerse acá y revisar antes de tocar
> nada estructural.
>
> Fecha del corte: 2026-08-18 · `main` = `c076667`

---

## RUTAS ACTUALMENTE

### Frontend

`apps/web/src/app/(panel)/rutas/`

| Archivo | Qué hace |
|---|---|
| `page.tsx` | Server component. Pide `/routes?date=…`, `/auth/me` y `/users` en paralelo. Resuelve el día con `dayOr` y pinta el aviso «estás viendo sólo tus rutas» cuando falta `ROUTE_ASSIGN`. |
| `routes-table.tsx` | `DataTable` con filtros en panel lateral (cobrador, estado), columnas configurables, tamaño de página y preferencias por usuario. Columnas: Fecha · Cobrador · Estado · Paradas · Distancia. |
| `[id]/page.tsx` | Ficha de una ruta: mapa del recorrido (`RouteMap`), resumen de la jornada (`summarizeDay`), lista de paradas, pagos del día. |
| `[id]/parada/[sid]/page.tsx` | Detalle de una parada con su visita y evidencias. |
| `lib/routes.ts` | Adaptador: `routeQuery`, `routeLimit`, `hasRouteFilters`, y los mapas de color de estado. Con tests. |

- El estado vive **en la URL** (`date`, `collectorId`, `status`, `page`, `pageSize`), como en toda
  tabla del panel. No hay store ni cliente de cache: server components + `fetch`.
- La web **sólo lee rutas**. No hay ninguna pantalla que las cree ni que las asigne.

### Backend

`apps/api/src/modules/routes/` — controller, service, serializer, `osrm.service.ts`, `routes.errors.ts`.

| Endpoint | Qué hace | Puerta |
|---|---|---|
| `POST /routes` | Crea una ruta **vacía** | `ROUTE_READ` + capacidad en el service |
| `POST /routes/generate` | Crea la ruta **con paradas** desde casos (`caseIds` o los abiertos del cobrador) | idem |
| `GET /routes` | Lista paginada. Filtros: `collectorId`, `date` (**un día exacto**), `status` | `ROUTE_READ` |
| `GET /routes/:id` | La ruta **con sus paradas** | `ROUTE_READ` |
| `PATCH /routes/:id` | Cambia el estado | idem |
| `GET /routes/:id/preview` | Polilínea por calles (OSRM), distancia, minutos y orden sugerido | idem |
| `POST /routes/:id/optimize` | Aplica el orden sugerido | idem |
| `POST/DELETE/PATCH /routes/:id/stops[/:sid]` | Agregar, quitar, reordenar y marcar paradas | idem |
| `GET /visits` | Visitas con `outcome`, GPS y notas. Filtros: `routeId`, `routeStopId`, `caseId`, `collectorId`, `date` | `ROUTE_READ` |
| `GET /visits/:id` | Una visita con sus evidencias (foto, firma, hash) | `ROUTE_READ` |

**El scope no lo decide el rol sino la capacidad**, y la respuesta no lo dice (la señal la pone la
pantalla): con `ROUTE_ASSIGN` se ve y se opera sobre todo el equipo; con `ROUTE_EXECUTE` sin assign,
sólo lo propio; con `ROUTE_READ` a secas (auditor/viewer), se ve toda la cuenta sin poder escribir.

Permisos por rol (`packages/shared/src/constants/permissions.ts`):

- OWNER · ACCOUNT_ADMIN · SUPERVISOR → `ROUTE_READ`, `ROUTE_WRITE`, **`ROUTE_ASSIGN`**
- COLLECTOR → `ROUTE_READ`, `ROUTE_EXECUTE`
- AUDITOR · VIEWER → `ROUTE_READ`

### Datos disponibles

```
RoutePlan          id, accountId, branchId, collectorId, plannedDate (@db.Date),
                   status, totalCases, totalDistanceKm, estimatedMinutes, createdAt
                   @@unique(accountId, collectorId, plannedDate)   ← nuevo, 18/08

RouteStop          id, routeId, clientId, caseId?, sequenceOrder, status,
                   visitedAt?, predictedRecoveryScore?     @@unique(routeId, sequenceOrder)

FieldVisit         id, caseId?, routeStopId?, collectorId, lat/lng, accuracy?,
                   outcome, notes?, details(JSON), capturedAt        INMUTABLE
FieldEvidence      foto/firma + hash SHA-256                          INMUTABLE
```

Estados: `RouteStatus` = PLANNED · IN_PROGRESS · COMPLETED · CANCELLED ·
`RouteStopStatus` = PENDING · IN_ROUTE · VISITED · SKIPPED.

Cómo se calcula hoy cada dato de la tabla:

- **Paradas** → `totalCases`, un contador que se escribe al crear la ruta. Es el **planificado**.
- **Distancia** y **duración** → `totalDistanceKm` / `estimatedMinutes`, que **sólo se llenan cuando
  alguien abre `GET /routes/:id/preview`** desde el teléfono (OSRM + 10 min por parada). Un `GET`
  que escribe su propio cache, marcado como tal. En los datos de demo son **aleatorios del seed**;
  por eso la columna Duración ya se quitó (`c076667`) y la de Distancia tiene el mismo origen.
- **Estado** → columna propia, la mueve el móvil.
- **Fecha** → `plannedDate`, día civil; se formatea con `dayDate()` en UTC.
- **Cobradores** → `GET /users`, que da **403 sin `user:read`** (el caso de una supervisora): la
  pantalla degrada a «Cobrador» en vez de decir «sin cobrador».

---

## NO EXISTE

1. **Rango de fechas en `GET /routes`.** `ListRoutesQueryDto` acepta `date` (un día exacto), no
   `from`/`to`. Sin esto no hay vista por período. *(Fases 1-Período, 2, 3)*
2. **Paradas realizadas en el listado.** `GET /routes` **no incluye `stops`** y no hay ningún
   contador de visitadas: el «5 / 8» no se puede calcular hoy sin pedir cada ruta una por una.
   *(Fase 1-Día, 2, 3)*
3. **Cualquier agregación de rutas o paradas por cobrador y período.** `analytics` tiene seis
   lecturas y ninguna agrega paradas: `collector-performance` agrega **casos, saldo, mora y
   recaudado**, y `visit-map` devuelve paradas con coordenadas de **un solo día**. *(Fase 2, 3)*
4. **Planificación multi-ruta.** No hay endpoint que cree N rutas en una operación, ni concepto de
   «planificación» como entidad. *(Fase 5-8)*
5. **Borrador vs publicada.** `RouteStatus` no tiene `DRAFT`: una ruta creada nace `PLANNED` y ya es
   visible para el cobrador. Separar guardar de publicar **exige un valor de enum nuevo** (migración
   propia: `ALTER TYPE ADD VALUE` no convive con otras sentencias). *(Fase 8)*
6. **Distribución de visitas entre cobradores.** Lo más cercano es `leastLoadedCollector` de
   **casos** (`POST /cases/:id/assign` con `auto`), que reparte cartera, no paradas de una ruta.
   *(Fase 7)*
7. **Aviso al cobrador.** `NotificationType.ROUTE_ASSIGNED` existe y el móvil ya sabe pintarlo, pero
   **ningún punto de la API lo emite**. Una ruta creada desde la web aparecería en el teléfono sin
   avisar. *(Fase 5, 9)*
8. **Expansión de filas, stepper/wizard y drag & drop de tarjetas** en el panel. *(Fases 3, 5, 7)*
9. **Tests de componente de la pantalla de rutas.** Sólo hay tests del adaptador (`lib/routes.test.ts`).

## YA EXISTE Y SE PUEDE REUTILIZAR

| Necesidad del plan | Qué reutilizar |
|---|---|
| Tabla, filtros laterales, columnas configurables, paginación, preferencias por usuario | `components/data-table.tsx` + `data-table-filters.tsx` (`tableId`, `FilterDef`) |
| **Selección múltiple de filas** | `DataTable` prop `selection` — hoy sólo la usa Mora (`BulkActions`) |
| **Rango de fechas con presets** | `lib/dashboard.ts`: `DATE_PRESETS` (`today`, `yesterday`, `d7`, `d30`, `month`, `prevMonth`) + `presetRange()`, y `dashboard-filters.tsx` como referencia de UI |
| Filtro de rango dentro del panel lateral | tipo `dateRange` de `FilterDef` (nuevo, lo estrenó Pagos) con `defaults` |
| Navegación por día | `components/day-picker.tsx` (lo comparten agenda y rutas) |
| **Toggle de dos vistas** (Día/Período, Planificación/Historial) | `ViewToggle` de `agenda-screen.tsx` — hoy es local, se promueve tal cual |
| Estado en la URL, compartible por link | patrón de `agenda-screen.tsx` (`go({...})`) y del `DataTable` |
| Mapa con recorrido y paradas | `components/route-map.tsx` (maplibre, ya en `/rutas/[id]`) · `map-picker.tsx` para elegir un punto |
| Mapa de paradas de un día, con estado y cobrador | `GET /analytics/visit-map` + el widget que ya lo dibuja |
| Badges de estado, tarjetas, hechos, vacíos, **skeleton** | `components/panel-ui.tsx` (`Badge`, `Card`, `Fact`, `EmptyState`, `Skeleton`) |
| Error con reintento | `components/retry-state.tsx` |
| Modal | `components/modal.tsx` (⚠️ `Drawer` **se borró**; si hace falta, vuelve con un `git revert`) |
| Búsqueda de clientes/cartera para elegir visitas | `GET /clients?view=portfolio` (server) y `GET /api/clients` del BFF (cliente), ya usados por Cartera y por el modal de agenda |
| Casos abiertos por cobrador (los candidatos naturales a parada) | `GET /cases` con `assigneeId`, `sort`, `dpdMin` — lo usa Mora |
| Crear la ruta con sus paradas | **`POST /routes/generate` con `caseIds`** — un supervisor con `ROUTE_ASSIGN` ya puede hacerlo para cualquier cobrador |
| Reordenar paradas / optimizar | `POST /routes/:id/optimize` (OSRM trip) y `PATCH …/stops/:sid` |
| Resultados de visita | `GET /visits?routeId=` con `outcome`, hora y notas; `categoryOf` + `CATEGORY_TONE` para agrupar |
| Drag & drop sin dependencias | el de `ColumnsMenu` (HTML5 nativo, con alternativa de teclado `Alt`+flechas) |

🔴 **El hallazgo que más cambia el plan: la planificación ya es posible con la API de hoy.** Un
supervisor con `ROUTE_ASSIGN` puede crear la ruta de otro cobrador con las paradas que elija
(`POST /routes/generate` con `collectorId` + `caseIds`). Las Fases 5-7 son, en su primera versión,
**UI sobre endpoints que ya existen** — no backend nuevo. Lo único que falta de verdad es el borrador
(Fase 8) y el aviso al cobrador.

## REQUIERE CAMBIO

Ordenados por lo que desbloquean, con el cambio mínimo:

| # | Necesidad | Hoy | Falta | Cambio mínimo | Impacto |
|---|---|---|---|---|---|
| 1 | Historial por período | `GET /routes` sólo filtra un día | rango | `from`/`to` en `ListRoutesQueryDto` + `plannedDate: { gte, lte }` en el `where` | Aditivo. Ningún consumidor actual se entera; el móvil sigue mandando `date` |
| 2 | «5 / 8» y «completadas» | el listado no trae paradas | contador de visitadas por ruta | un `groupBy` de `route_stops` por `routeId` + `status` en `list()`, y `visitedCount` en el serializer | Aditivo en el contrato (`RouteItem` en `shared`). Una consulta más por página |
| 3 | Resumen por cobrador del período | no hay agregación | paradas/completadas/días/distancia por cobrador | **se puede resolver sin endpoint nuevo**: con (1) y (2), la web suma las rutas del rango en memoria — son ≤ 100 filas por página y un período de una semana con 11 cobradores son 77 filas | Cero backend. ⚠️ Si el período es largo hay que paginar o subir el `limit`; documentar el techo |
| 4 | Publicar vs borrador | `PLANNED` es el estado inicial y ya es visible | un estado previo | `DRAFT` en el enum `RouteStatus` (**migración propia**) + `list()` que lo excluya para el cobrador | Toca el móvil (etiquetas de estado) y el filtro de la web. **Recomiendo diferirlo** hasta que el flujo de planificación esté probado |
| 5 | Aviso al cobrador | nadie emite `ROUTE_ASSIGNED` | emitirla al crear la ruta de otro | una línea en `generate`/`create` cuando `collectorId !== usuario` | Aditivo; el móvil ya la sabe pintar |

---

## Riesgos

1. 🔴 **Métricas que no existen y se ven reales.** «Completadas», «no realizadas» y «distancia» del
   resumen semanal salen de datos que hoy son parciales: la distancia **sólo existe si alguien
   previsualizó la ruta** (y en la demo es un aleatorio del seed). Mostrar una columna «Distancia»
   sumada por cobrador es sumar ceros y valores inventados. Antes de pintarla hay que decidir: o se
   calcula de verdad, o no va.
2. **El techo del listado.** `limit ≤ 100` (lo valida el DTO). Un período de un mes con 11
   cobradores son ~240 rutas: la suma en memoria necesita paginar o el resumen sale corto **sin que
   nada lo diga**. Es el riesgo típico de agregar en el cliente.
3. **No romper la vista diaria.** La pantalla actual es la única forma de consultar rutas y ya está
   en uso; el plan lo dice explícitamente. La Fase 1 debe dejarla intacta como modo «Día».
4. **Dos «estados» conviviendo.** Si entra `DRAFT`, el estado de la ruta pasa a mezclar ciclo de
   planificación con ciclo de ejecución. Es la clase de decisión que se paga cara si se toma rápido.
5. **El móvil no debe enterarse.** Cualquier cambio en `RouteItem` tiene que ser aditivo: el teléfono
   comparte los tipos de `shared` y una propiedad obligatoria nueva le rompe el type-check.
6. **Densidad de la pantalla.** Fase 1.5 pide indicadores compactos; el panel **no tiene** un
   componente de stat tile fuera del dashboard (`components/dashboard/widgets/`), que arrastra
   `react-grid-layout`. Hay que extraer algo mínimo, no importar el dashboard.

## Cambios mínimos recomendados (propuesta de orden real)

Respeta el orden del plan, pero mueve el backend imprescindible al principio de cada fase que lo
necesita, en vez de dejarlo para después:

```
F1  Estructura: [Planificación | Historial] + [Día | Período], con Día = lo de hoy, intacto.
    → sin backend. `ViewToggle` promovido + estado en la URL.
F1b Backend mínimo (1) y (2): rango en `GET /routes` + `visitedCount`.
    → desbloquea Período y el «5 / 8» a la vez. Aditivo, con spec.
F2  Período: tabla por cobrador sumando en la web (3). Sin columna de distancia hasta decidir
    el riesgo 1. Indicadores compactos con lo que sí es real.
F3  Expansión de la fila del cobrador → sus días. Componente nuevo pequeño en `DataTable`
    (`renderExpanded`), no una pantalla aparte.
F4  Detalle de paradas: `GET /visits?routeId=` — ya existe todo, es sólo UI.
F5-7 Planificación sobre `POST /routes/generate` (ya posible). Distribución manual primero:
    elegir casos y repartirlos entre cobradores, una llamada por cobrador.
F8  Revisión + publicación. `DRAFT` sólo si la dueña lo pide después de usar el flujo.
```

**Lo que NO se hace en la primera entrega**: algoritmo de optimización propio, mapa de
distribución interactivo, drag & drop entre cobradores, y `DRAFT`. Todo eso queda documentado y
entra cuando el flujo simple esté en uso.
