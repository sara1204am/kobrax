# W11 · Rutas: planificación asignando mora — FASE 0, auditoría

> **Estado: diagnóstico. Cero código escrito.** El plan exige auditar antes de tocar nada, y hay
> **tres hallazgos que cambian el flujo propuesto**. Corte: 2026-08-18, `main` = `d5fb946`.
>
> Continúa [`W10-rutas-planificacion.md`](./W10-rutas-planificacion.md), que ya dejó hecho todo el
> historial y una planificación básica.

---

## 0.1 Qué hace hoy `/rutas/planificar`

Se construyó hoy (W10-F5). **No es un formulario genérico**, pero tampoco es el flujo que pide este
plan:

| Hoy | Lo que pide W11 |
|---|---|
| Elegís fecha + cobradores + tope de paradas | Elegís fecha, y **un cobrador a la vez** |
| Cada uno sale con **su propia cartera** (sus casos abiertos, por prioridad) | Elegís **de un pool de mora disponible**, con filtros y mapa |
| El tope se escribe en la pantalla | El tope **viene de Settings** |
| Revisión con `dryRun` y publicación en lote | Confirmación por cobrador, y después el siguiente |

Piezas: `planificar/page.tsx` (guarda por `route:assign`), `plan-form.tsx` (client), y
`POST /api/routes/plan` en el BFF, que por cobrador hace `GET /cases?assigneeId&open&sort=priority` →
`POST /routes/generate`. **Ese handler ya recibe una lista de casos**, así que el flujo de W11 entra
sin reescribirlo: cambia quién elige los casos, no cómo se crean las rutas.

## 0.2 `/rutas` (historial) — **ya cumple las fases 18 y 19 de este plan**

`[Planificación|Historial]` + `[Día|Período]`, tabla por cobrador con días activos, paradas,
completadas y sin gestionar, fila expandible a sus días, y el detalle de la ruta con paradas, horas,
resultado y mapa. **Sin columna de distancia, por decisión ya tomada** (el dato sólo existe si
alguien previsualizó la ruta). No hace falta tocarlo.

---

## 🔴 HALLAZGO 1 — **No existe Settings de rutas. Ni de nada.**

`accounts.settings` y `accounts.configuration` son dos columnas `Json @default("{}")` en el schema…
que **ninguna línea de la API lee ni escribe** (búsqueda en todo `apps/api/src`: cero
ocurrencias). Lo que el panel llama «Cuenta» edita nombre, país, moneda y logo; «Ajustes» son
seguridad y sesiones. La única configuración real del producto es la de **Import**
(`GET/PATCH /imports/portfolio/config`), que tiene su propio modelo.

**No hay máximo de paradas, ni capacidad por ruta, ni horarios, ni reglas de planificación.**

```
Dato requerido:      capacidad de ruta (máximo de paradas por cobrador)
¿Existe?             No
Fuente alternativa:  hoy lo escribe la persona en la pantalla (W10-F5, default 8, tope duro 30)
Cambio backend:      leer/escribir `accounts.settings.routes.maxStops` + pantalla en Cuenta
Impacto:             chico y aditivo (la columna ya está). Pero es **una decisión de producto**:
                     ¿capacidad por cuenta, por sucursal o por cobrador? El schema no tiene ninguna
                     de las tres, y elegir mal se paga cuando aparezca la segunda.
```

⚠️ Mientras no exista, las fases 4 y 11 («la capacidad viene de Settings», «no permitir superar la
capacidad configurada») **no se pueden cumplir como están escritas**. Lo que sí se puede: que el tope
siga siendo un campo de la pantalla y que la barra de capacidad funcione contra ese número.

## 🔴 HALLAZGO 2 — La mora **ya tiene dueño**: no hay un pool de «mora disponible»

Todo `collection_case` tiene `assigneeId`, y hoy **los 1628 casos están repartidos entre los 11
cobradores** (lo dejó así la reparación del seed). El modelo no tiene «mora sin asignar» como estado
normal, ni marca de «tomada por otra ruta».

Por eso, «mora disponible para esta fecha» puede significar tres cosas distintas, y **la respuesta es
una decisión de negocio, no técnica**:

1. **Sólo la del cobrador** que se está planificando → es lo que hace hoy la pantalla; el pool es su
   cartera y no hay reasignación.
2. **La de cualquiera, y planificarla se la reasigna** → hay que llamar también a
   `POST /cases/:id/assign`, y eso **cambia la cartera de dos personas** cada vez que se arma una
   ruta.
3. **Sin tocar la cartera**: la ruta de Juan puede tener paradas de casos de Ana (la parada guarda
   `caseId`, no exige que el caso sea de Juan). Técnicamente ya es posible; el problema es que
   después «los casos de Ana» y «lo que Ana hizo» dejan de coincidir.

```
Dato requerido:      «esta mora ya está en la ruta de alguien ese día»
¿Existe?             No como campo. Se deduce: `route_stops.case_id` de las rutas de esa fecha
Fuente alternativa:  GET /routes?date=X (trae rutas) + GET /routes/:id (trae sus paradas) → N+1
Cambio backend:      `assignedCaseIds` en el listado de rutas del día, o `excludeRouted=<fecha>`
                     en GET /cases (una sola consulta, aditivo)
Impacto:             chico. Sin esto, el filtro «solo mora disponible» (fase 6.12, que el plan pone
                     por defecto) no se puede implementar sin traer todas las rutas del día y sus
                     paradas una por una.
```

## 🔴 HALLAZGO 3 — De los 13 filtros pedidos, **5 existen hoy**

`GET /cases` acepta: `status`, `priority`, `assigneeId`, `clientId`, `overdue` (SLA, **no** mora),
`dpdMin`/`dpdMax`, `q` (nombre), `open`, `view=portfolio`, `sort`, `dir`, `page`, `limit ≤ 100`.

| # | Filtro del plan | ¿Se puede hoy? | Qué falta |
|---|---|---|---|
| 6.1 | Días de mora (rangos y desde/hasta) | ✅ `dpdMin`/`dpdMax` | — |
| 6.2 | Ordenar por mora / saldo / fecha | ✅ `sort=daysPastDue\|balance\|createdAt` | «Más cercano» necesita distancia (ver 6.5) |
| 6.3 | Estado (multi-select) | 🟡 `status` acepta **uno** | multi = cambio en el DTO, o N consultas |
| 6.4 | Zona / localidad / barrio | 🟡 `zone` **viaja** en la respuesta pero **no filtra**; y sólo existe `zone` (texto libre en `client_locations`), no localidad ni barrio | filtro `zone` en `GET /cases`, o filtrar en el cliente sobre lo traído |
| 6.5 | «Cerca de» + radio | ❌ | lat/lng existen por cliente; **no hay búsqueda por radio**. Se puede calcular en el navegador sobre lo ya traído (≤ 100 filas), no sobre la cartera entera |
| 6.6 | Elegir un punto del mapa como centro | ❌ (depende de 6.5) | idem |
| 6.7 | Saldo desde/hasta | ❌ (sí `sort=balance`) | `balanceMin`/`balanceMax` en el DTO |
| 6.8 | Prioridad | ✅ `priority` | multi-select, no |
| 6.9 | Última visita | 🟡 `lastActionAt` **viaja**, no filtra. Y es «última acción», que incluye cambios de estado — no es lo mismo que una visita | filtro, o usar `GET /visits` |
| 6.10 | Resultado de la última visita | 🟡 existe en `field_visits.outcome`, **no en el caso** | join o consulta aparte |
| 6.11 | Promesa de pago | 🟡 `hasActivePromise` **viaja**, no filtra | filtro |
| 6.12 | Sólo mora disponible | ❌ | ver Hallazgo 2 |
| 6.13 | Cobrador actual | ✅ `assigneeId` | — |

**El techo que atraviesa todo**: `limit ≤ 100`. Filtrar en el navegador sólo funciona sobre lo que se
trajo; con 666 cobranzas abiertas, «filtrar en el cliente» significa **filtrar una página**, que es
justo el error que el resto del panel evita. Por eso los filtros que importen de verdad tienen que
terminar en el servidor.

---

## Matriz de datos de la mora (fase 0.4)

Todo con `GET /cases?view=portfolio`, que es **lo que ya usa el móvil para armar rutas desde el
mapa** (`app/rutas/crear.tsx`: `listCases({view:'portfolio', open:true, limit:100})`).

| Dato | Existe | Fuente | ¿Filtrable en la API? |
|---|---|---|---|
| Cliente (nombre) | ✅ | `clientName` | por `q` (nombre) |
| Documento | ✅ enmascarado | `documentMasked` | no |
| Crédito | ✅ | `creditId`, `creditCode` | no |
| Saldo | ✅ | `amount` + `currency` | **no** (sólo orden) |
| Días de mora | ✅ | `daysPastDue` | ✅ `dpdMin`/`dpdMax` |
| Estado del caso | ✅ | `status` | ✅ (uno) |
| Prioridad | ✅ | `priority` (+ `priorityPinned`) | ✅ |
| Latitud / longitud | ✅ | `locations[]` (del cliente **y de sus garantes**) | no |
| Dirección | ✅ | `locations[].address` | no |
| Zona | ✅ | `zone` | no |
| Localidad / barrio | ❌ | — | — |
| Cobrador actual | ✅ | `assigneeId` | ✅ |
| Ruta actual | ❌ | se deduce de `route_stops` | no |
| Última acción | 🟡 | `lastActionAt` (no es «última visita») | no |
| Última visita y su resultado | 🟡 | `GET /visits?caseId=` (otra consulta) | por caso |
| Promesa vigente | ✅ | `hasActivePromise` | no |
| Fecha de la promesa | 🟡 | vive en `agenda_items` (PROMISE_TO_PAY) | por agenda |
| Teléfono | ❌ en este listado | cifrado, se revela en la ficha del cliente | no |
| Distancia a un punto | ❌ | calculable con lat/lng | no |

**Componentes reutilizables** (además de los de W10): `RouteMap` (dibuja paradas y recorrido; para
elegir puntos habría que extenderlo o usar `map-picker`), `DataTable` con **selección de filas**
(hoy sólo Mora), el panel de filtros con sus tipos (`select`, `multiSelect`, `numberRange`,
`dateRange`, `radio`), y `groupPortfolio` del móvil —agrupa casos por cliente con sus ubicaciones—,
que es **regla y no texto**, así que se puede promover a `shared`.

---

## Riesgos

1. 🔴 **Reasignar cartera sin decirlo.** Si «asignar mora a la ruta de Juan» reasigna el caso, dos
   carteras cambian por cada parada, y el historial por cobrador (W10-F2) empieza a contar el trabajo
   en la persona equivocada. Hay que decidirlo antes de escribir una línea.
2. 🔴 **Filtros que sólo filtran una página.** Con `limit ≤ 100` y 666 cobranzas abiertas, cualquier
   filtro resuelto en el navegador miente sobre el total. El contador «18 clientes encontrados» que
   pide la fase 6.14 sería el de la página.
3. **El mapa con 666 puntos**: `RouteMap` se arma una vez y no reacciona a cambios (lo dice su propio
   comentario). Para lista↔mapa interactivos (fase 10) hay que revisarlo o hacer uno nuevo.
4. **Concurrencia (caso 3 de la fase 23)**: la única defensa real de hoy es el `unique(cuenta,
   cobrador, día)` de `route_plans` — dos supervisores **sí** pueden meter el mismo caso en dos rutas
   de cobradores distintos. `route_stops` sólo tiene `unique(routeId, sequenceOrder)`.
5. **`zone` es texto libre**: sirve para agrupar sólo si está escrito igual en todas las filas.

## Cambios mínimos, en orden de valor

| # | Para qué | Cambio | Tamaño |
|---|---|---|---|
| 1 | Que la pantalla muestre **la mora con su mapa y sus filtros** | ninguno: `GET /cases?view=portfolio` ya trae todo lo de la matriz | — |
| 2 | «Sólo mora disponible» (6.12) | `assignedCaseIds` en `GET /routes?date=` **o** `excludeRouted` en `GET /cases` | chico, aditivo |
| 3 | Saldo y zona como filtro (6.4, 6.7) | `balanceMin`/`balanceMax` y `zone` en `ListCasesQueryDto` | chico, aditivo |
| 4 | Capacidad de verdad (fases 4 y 11) | `accounts.settings.routes.maxStops` + su pantalla en Cuenta | mediano, decisión de producto |
| 5 | «Cerca de» y radio (6.5, 6.6) | filtro geográfico en la API (o aceptar que es sobre lo traído) | mediano |
| 6 | Última visita y resultado (6.9, 6.10) | derivarlos de `field_visits` en el listado | mediano |
| 7 | Estados y prioridades multi-select (6.3, 6.8) | aceptar lista en el DTO | chico |

**Lo que NO recomiendo tocar todavía**: el mapa interactivo con selección por área (6.6), la
distribución automática geográfica (fase 15 — no existe ningún algoritmo que reutilizar; el
`leastLoadedCollector` que hay reparte **casos por carga**, no paradas por cercanía) y el ajuste
manual con exceso de capacidad (fase 17), que depende de 4.

---

---

# ✅ RESPUESTAS DE LA DUEÑA (18/08) — decisiones cerradas

1. **La ruta se arma con lo que le corresponde a cada cobrador de su lista**, pero **se puede
   reasignar momentáneamente como ayuda** entre cobradores. → Es la opción **(3)** del Hallazgo 2:
   la parada va a la ruta de quien ayuda y **el `assigneeId` del caso NO cambia**. La ayuda es de esa
   jornada, no un traspaso de cartera. Técnicamente ya es posible: `route_stops` guarda `case_id` sin
   exigir que el caso sea del dueño de la ruta.
   - Consecuencia buena: el historial por cobrador (W10-F2) cuenta **paradas de la ruta**, así que el
     trabajo de ayudar se le cuenta a quien lo hizo, y la cartera sigue diciendo de quién es la deuda.
   - Consecuencia a cuidar: la pantalla tiene que **decir** cuándo una parada es ayuda a otro, o se
     lee como si le hubieran sacado la cartera a alguien.
2. **No hay capacidad máxima. Sí un mínimo de asignación por cobrador.** Se da vuelta la fase 11: no
   se bloquea al noveno cliente, se **avisa cuando un cobrador queda por debajo del mínimo**. Ocho es
   el número que el negocio usa hoy (es el que arma el seed «cada ruta que se arme es de 8 visitas»).
3. **Todos los filtros de la sección 3**, incluidos los que necesitan backend.

## Orden de construcción que sale de eso

| Etapa | Qué | Depende de |
|---|---|---|
| **A1** | Filtros aditivos en `GET /cases`: `zone`, `balanceMin/Max`, `status` y `priority` **multi**, `hasPromise`, `excludeRouted=<fecha>` | — |
| **A2** | Última visita y resultado anterior (desde `field_visits`) | — |
| **A3** | Cercanía: `near=lat,lng` + `radiusKm` | A1 |
| **B** | La pantalla: por cobrador, lista + mapa, filtros, mínimo y ayuda entre cobradores | A1 |

---

## ⛔ Las preguntas que motivaron esas respuestas

1. **¿La planificación reasigna cartera?** (Hallazgo 2). Si la respuesta es «cada cobrador visita lo
   suyo», el flujo por cobrador se construye sobre lo que ya existe y **sin backend nuevo**. Si es
   «el supervisor reparte la mora de la agencia», hace falta decidir si eso cambia el `assigneeId`
   del caso o sólo la parada.
2. **¿Dónde vive la capacidad?** ¿Por cuenta (una sola para todos), por sucursal o por cobrador?
   Ninguna existe hoy; la primera es la más barata y la última es la que el negocio suele querer.
3. **¿Qué filtros son imprescindibles para la primera versión?** Con lo que hay se puede entregar hoy
   mismo: días de mora, prioridad, estado, cobrador, búsqueda por nombre y orden por mora o saldo.
   Zona, saldo, cercanía, última visita y promesa **necesitan backend**, y son cuatro cambios
   chicos pero no gratis.
