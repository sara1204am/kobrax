> **ESTADO: ronda 3 (2026-07-28) — PASS del validador. Listo para construir (`/f10-etapa` Paso F).**
> La ronda 2 dio FAIL por tres cosas: dos reglas distintas de "ubicación del cliente" entre esta vista
> y la de S1, el flujo de armado sin respuesta para el modo sin señal, y una ruta a medio armar que
> dejaba la pantalla inalcanzable. Cerradas en §5.1, §5.5 y D-S2-VIDA.

# F10 · Rutas · S2 — Crear la ruta desde el mapa (RT-1)

## 1. Objetivo
El cobrador ve su cartera **sobre el mapa** y arma la ruta del día tocando clientes uno por uno. Si el
cliente no existe todavía, lo da de alta con el punto ya marcado. Es la alternativa manual a "Generar
ruta del día" de S1: mismo destino (una ruta con paradas), pero eligiendo él dónde va.

## 2. Rama
`f10/rutas-s2-crear-mapa` (sale de `main`, que ya tiene FUNDACION + S1).

## 3. Build
🔵 **dev build por cable** — es la primera pantalla del módulo hecha de mapa. Corre en el dev build ya
instalado; sólo hace falta rebuild si se toca algo nativo (no está previsto).

## 4. Pantallas Figma
File `daLWsKQGC4Sd1NacU9fmrP`, sección RUTAS `81:5`:

| # | Pantalla | node-id |
|---|---|---|
| RT-1.1 | Mapa de selección, sin nada elegido | `47:471` |
| RT-1.2 | Mapa + cliente elegido (card) + contador del recorrido | `47:586` |
| RT-1.3 | Crear cliente desde el mapa | `47:767` |
| RT-1.4 | Aviso: cliente sin coordenadas | `48:1354` |

Pull de Figma just-in-time al construir, de a una pantalla.

## 5. Contrato (verificado contra el código, 2026-07-28)

| Uso | Endpoint | Estado |
|---|---|---|
| Cartera del cobrador para pintar el mapa | `GET /api/cases?view=portfolio` | Existe y **ya está acotado al cobrador**. Trae nombre, deuda, mora, zona. **Le faltan las coordenadas** → §5.1 |
| Crear la ruta vacía | `POST /api/routes` | Existe. ⚠ Exige `ROUTE_WRITE`: **el cobrador no la puede crear** (mismo muro que S1 destapó en `generate`) → §5.2 |
| Agregar una parada | `POST /api/routes/:id/stops` | **NO EXISTE** → §5.3 |
| Quitar una parada agregada por error | `DELETE /api/routes/:id/stops/:sid` | **NO EXISTE** → §5.3 |
| Mover una parada de posición | `PATCH /api/routes/:id/stops/:sid {sequenceOrder}` | Existe, pero **escribe el número a lo bruto**: choca con `unique(routeId, sequenceOrder)` y no tiene scope → §5.4 |
| Alta de cliente con su ubicación | `POST /api/clients` | Existe; ya lo usa `cliente/nuevo` con `MapPicker` |

Tablas: `route_plans`, `route_stops` (escritura), `collection_cases`, `clients`, `client_locations` (lectura).

### 5.1 Delta: coordenadas en la vista de cartera
`portfolioExtra` (`cases.service.ts:333`) ya lee una ubicación del cliente para sacar `zone`. Se le
suman `latitude`/`longitude` al mismo `select` — **cero queries nuevas**.

⚠ **Pero antes hay que alinear qué ubicación es.** Hoy `portfolioExtra` toma
`orderBy: createdAt asc, take: 1` = **la primera cargada**, mientras que S1 definió en
`routes.serializer.ts` = **la primera `HOME`, y si no hay, la primera**. Con dos reglas distintas, el
pin del mapa y la dirección de la parada pueden ser de lugares distintos para el mismo cliente (el
negocio y la casa). Se unifica con la regla de S1 —la casa es donde se cobra— sacando el `take: 1`
y reusando el mismo criterio. `PortfolioExtra` y
`serializeCase` exponen los dos campos como opcionales: un cliente sin ubicación cargada sigue
existiendo, simplemente no se puede pintar (ese es el caso de RT-1.4).

**Se audita el revelado** (decisión D-S2-AUDIT): la coordenada es el domicilio exacto, así que
`view=portfolio` registra `case_portfolio/PII_REVEAL` — **un registro por consulta**, no por cliente,
igual que hace agenda. Sólo cuando la vista de cartera se pide; el listado normal de casos no cambia.

> Se descartó `GET /clients`: **no está acotado al cobrador** (devuelve la cartera entera del tenant,
> `clients.service.ts:123`) y obligaba a cruzar contra los casos en el móvil.

### 5.2 Delta: el cobrador tiene que poder crear su ruta
`POST /routes` exige `ROUTE_WRITE` y el rol `COLLECTOR` no lo tiene. Se aplica **el mismo patrón que
S1 dejó** en `generate`/`updateStatus`: puerta mínima `ROUTE_READ` en el controller y el service
resuelve el scope — con `ROUTE_WRITE`/`ROUTE_ASSIGN` para cualquier cobrador; con `ROUTE_EXECUTE`,
sólo para sí mismo (se ignora el `collectorId` del body); sin ninguna, 403.

### 5.3 Delta: agregar y quitar paradas (endpoints nuevos)
```
POST   /api/routes/:id/stops   { clientId, caseId? }  → la parada serializada
DELETE /api/routes/:id/stops/:sid                     → 204
```
- **Secuencia:** la parada nueva va al final (`max(sequenceOrder) + 1`), calculado **dentro de la
  transacción** — `route_stops` tiene `@@unique([routeId, sequenceOrder])` y dos toques rápidos en el
  mapa chocarían.
- **Scope:** dueño de la ruta (`ROUTE_EXECUTE`) o `ROUTE_WRITE`. Ruta ajena → 404, como `findOne`.
- **No duplicar:** el mismo caso dos veces en la ruta se rechaza (el cobrador puede tocar dos veces).
- **Respuesta:** reusa `serializeStop` + `crypto` → la parada vuelve con `clientName` y `address`, y la
  lista de S1 la puede pintar sin recargar.
- **Borrar es borrar** (no `SKIPPED`): la parada agregada por error nunca estuvo en la jornada. Sólo se
  permite sobre paradas `PENDING` — una ya visitada es historia y no se toca.
- `totalCases` de la ruta se recalcula en las dos operaciones.
- Al **quitar** una parada del medio, las que siguen se corren para que la secuencia no quede con
  agujeros (`1,2,4`): el número que ve el cobrador en el pin es su posición en el recorrido.

### 5.4 Delta: mover una parada de posición
El orden es **el orden en que las tocaste**, y se puede corregir. `PATCH /routes/:id/stops/:sid`
ya existe pero hoy hace `update({ sequenceOrder })` a secas, y eso **rompe**: `route_stops` tiene
`@@unique([routeId, sequenceOrder])`, así que mover la parada 4 a la posición 2 choca con la que ya
está en 2. Nunca se ejecutó desde la app; el bug estaba latente.

Pasa a ser un **reordenamiento de la lista completa**, dentro de una transacción:
1. leer las paradas de la ruta ordenadas,
2. sacar la movida y volver a insertarla en el índice pedido,
3. reescribir `sequenceOrder` de todas **en dos pasadas** — primero a un rango temporal alto
   (`+1000`), después a los valores finales.

La segunda pasada es lo que evita el choque: la restricción se valida por sentencia, así que sin el
corrimiento temporal dos filas comparten número a mitad de camino.
*[ponytail: dos pasadas y listo. Si algún día pesa, la salida es una constraint `DEFERRABLE` —
migración, no código.]*

- **Scope:** hoy `updateStop` **no verifica de quién es la ruta** (mismo agujero que S1 tapó en
  `updateStatus`): con `ROUTE_EXECUTE` se puede tocar la parada de cualquier ruta del tenant. Se cierra
  acá — dueño de la ruta, o `ROUTE_WRITE`; ruta ajena → 404.
- El cambio de `status` que ese mismo endpoint ya hacía no se toca (lo usa S5).

### 5.5 El borrador local: un solo camino, con red y sin red
**La pantalla nunca escribe directo en el server.** Cada toque (agregar, quitar, mover) se aplica a un
**borrador local** —la lista de paradas que el cobrador quiere, en orden— y ese borrador se persiste.
Después se **sincroniza**: al toque si hay red, cuando vuelva si no la hay. Es el mismo código en los
dos casos; no hay una rama "offline" que se pruebe menos que la otra.

- **Qué se guarda:** `{ routeId | null, caseIds: [] }` en **SecureStore**, el mismo mecanismo que ya
  usan `biometric.ts` y la memoria del archivo de import (cero deps nuevas: `AsyncStorage` no está
  instalado). *[ponytail: sólo ids, ~40 bytes por parada; si una ruta llegara a cientos, mudarlo a
  `expo-file-system` —dep nueva— antes de que SecureStore se queje del tamaño.]*
- **Cómo sincroniza: por diferencia, no por historial.** Se compara el borrador contra lo que tiene el
  server y se aplican las diferencias (agregar las que faltan, quitar las que sobran, mover las que
  cambiaron de lugar). Es **idempotente**: reintentar no duplica nada, y no hay que ordenar una cola de
  operaciones ni resolver conflictos entre ellas.
- **Cuándo:** al terminar cada toque si hay conexión, y en cada reconexión —`subscribeConnectivity`
  de `store/net.ts` ya existe y ya está montado.
- **Qué ve el cobrador:** el borrador manda en pantalla. Si hay paradas sin sincronizar, se avisa
  ("2 sin sincronizar"), pero **nada se bloquea**: el banner de `OfflineIndicator` ya cubre el aviso
  de conectividad.
- **Alcance:** esta cola es sólo de rutas. Es la **semilla de la cola general de P6**, no su reemplazo:
  cuando P6 traiga WatermelonDB, este borrador se enchufa ahí y se borra.

## 6. Auditoría de reuso

| Capacidad | Decisión | Dónde |
|---|---|---|
| Mapa con pines, selección y controles | **REUSAR** | `src/maps/MapCanvas.tsx` (`markers`, `onMarkerPress`, `controls`) |
| Elegir un punto en el mapa (alta) | **REUSAR** | `src/maps/MapPicker.tsx` — ya está cableado en `cliente/nuevo` |
| Cartera del cobrador (traer + agrupar por cliente) | **REUSAR** | `src/cases.service.ts` (`listCases({view:'portfolio'})`) + `src/portfolio.ts` (`groupPortfolio`) |
| Tarjeta del cliente elegido | **REUSAR** | `src/ui.tsx` › `CaseCard` (nombre + monto + badge; ya lo usa Cartera) |
| Badge de estado de cartera | **REUSAR** | `src/ui.tsx` › `PORTFOLIO_STATUS_META` |
| Cabecera / vacío / fila / botones | **REUSAR** | `src/ui.tsx` › `Header`, `EmptyState`, `ListRow` · `src/components.tsx` › `Button` |
| Formato de plata | **REUSAR** | `src/agenda-form.ts` › `money()` |
| Fecha de hoy para la ruta | **REUSAR** | `src/agenda-form.ts` › `todayISO()` |
| Alta de cliente completa (con mapa) | **EXTENDER** | `app/cliente/nuevo.tsx`: aceptar `lat`/`lng` por parámetro y precargar la primera ubicación en modo mapa |
| Crear ruta / agregar / quitar parada | **EXTENDER** | `src/routes.service.ts` › `addStop()`, `removeStop()` (thin sobre `apiMutate`, junto a las que ya están) |
| Mover una parada de posición | **REUSAR** | `src/routes.service.ts` › `updateStop()` ya manda `sequenceOrder`; el arreglo es del server (§5.4) |
| Lista reordenable del recorrido | **REUSAR** | `src/ui.tsx` › `ListRow` con botones ↑/↓ en el slot `right`. *[ponytail: sin drag & drop — es una dep nueva (`draggable-flatlist`) para mover 5 filas; si el arrastre se pide de verdad, se suma en S3]* |
| Coordenadas del cliente en la cartera | **EXTENDER** | API: `portfolioExtra` + `PortfolioExtra` + `serializeCase` (§5.1); móvil: `ClientPortfolio` de `portfolio.ts` |
| Scope de `create` / paradas | **EXTENDER** | API: `routes.service.ts` + `routes.controller.ts` (§5.2, §5.3) |
| Persistencia local chica | **REUSAR** | `expo-secure-store`, mismo patrón que `biometric.ts` e `import.service.ts` (no hay `AsyncStorage` en el repo) |
| Aviso de sin conexión | **REUSAR** | `src/ui.tsx` › `OfflineIndicator` (ya montado en `(tabs)/_layout`) + `src/store/net.ts` › `subscribeConnectivity` |
| **Borrador de ruta + sincronización por diferencia** | **NUEVO** | `src/route-draft.ts` — lo usan la pantalla del mapa y el arranque de la app (flush al reconectar); **no** puede vivir en la screen |
| **Pantalla de armado en mapa** | **NUEVO** | `app/rutas/crear.tsx` — de un solo uso, vive en la screen |

**Cero componentes nuevos en `ui.tsx` y cero en `src/maps/`**: la fundación y la cartera ya dan todo.

## 7. Artefactos nuevos
1. `app/rutas/crear.tsx` — la pantalla de RT-1.1/1.2/1.4. Se entra desde el botón **"Crear desde el
   mapa"** de RT-0a (que S1 dejó apagado con su motivo: este slice lo enciende) **y desde RT-0b**, para
   poder seguir agregando paradas a la ruta ya empezada (D-S2-VIDA).
2. `src/route-draft.ts` — el borrador local (§5.5): leer/guardar/limpiar en SecureStore, `diffStops()`
   (deseado vs server → qué agregar, quitar y mover) y `flush()`. **La diferencia es una función pura y
   se testea sola**, sin red ni React: es el corazón del slice.
3. API: `addStop`/`removeStop` en `routes.service.ts` + sus rutas en el controller (§5.3).
4. Móvil: `addStop`/`removeStop` en `src/routes.service.ts`.

## 8. Tareas
0. **Smoke del motor de mapas** (antes de escribir una línea): abrir `Agenda › crear` en el teléfono y
   confirmar que MapLibre dibuja tiles. Nunca se validó. Si no dibuja, el slice se detiene acá y el
   problema pasa a ser de `tiles.ts`/packs, no de esta pantalla.
1. Backend §5.1: coords en `portfolioExtra` + test (cliente con ubicación, cliente sin ninguna).
2. Backend §5.2: scope de `create` + tests (cobrador crea la suya; auditor 403).
3. Backend §5.3: `POST`/`DELETE` de paradas + tests (secuencia al final, caso duplicado, ruta ajena
   404, parada ya visitada no se borra, sin agujeros al quitar del medio).
3b. Backend §5.4: reordenamiento en `updateStop` + scope + tests (mover del final al medio sin chocar
   la restricción, ruta ajena 404, el cambio de `status` sigue funcionando igual).
4. Móvil: espejo en `cases.service`/`portfolio.ts` (coords) y `routes.service` (`addStop`/`removeStop`).
4b. `src/route-draft.ts` + su test: `diffStops()` puro (agregar/quitar/mover, borrador vacío, borrador
   igual al server = cero llamadas) y persistencia. **Antes de la pantalla**: la pantalla lo consume.
5. `app/rutas/crear.tsx` — mapa con la cartera, loading/vacío/error/offline.
6. RT-1.2: tocar un pin → card del cliente (nombre, dirección, deuda, mora) → **Agregar al recorrido**;
   contador de paradas y **Ver el recorrido**: la lista en el orden en que las tocaste, con ↑/↓ para
   corregir la posición y quitar la que sobre.
7. RT-1.4: los clientes sin coordenadas no se pierden — se listan aparte con el aviso, y desde ahí se
   les carga la ubicación.
8. RT-1.3: tocar el mapa donde no hay nadie → alta de cliente con el punto precargado; al volver, el
   cliente nuevo aparece en el mapa.
8b. Entrada desde RT-0b (`app/(tabs)/rutas.tsx`, de S1): botón **"Agregar paradas en el mapa"** para
   volver al mapa con la ruta del día ya empezada.
9. Verificación: `type-check` + `jest` (API y móvil) + `expo export`. **Smoke offline obligatorio**:
   modo avión → agregar dos paradas → volver la red → las paradas están en el server.

## 9. Reglas de la fase
- **Sol → contraste:** nombre y monto en navy; la dirección en `text2`. Pines: pendiente `navy`,
  agregado al recorrido `purple` (los tonos que `MapCanvas` ya expone).
- **Gama baja:** `MapCanvas` dibuja un `PointAnnotation` por pin y eso aguanta ~30. Una cartera de
  cientos hay que acotarla: se pintan sólo los clientes del viewport o los N más cercanos. Se mide en
  el smoke con datos reales antes de decidir el techo.
- **Animación con propósito:** ninguna nueva; la selección se resuelve con el `selected` del pin.
- **Multi-tenant:** el scope lo aplica el server por capacidad. El móvil no filtra por rol.
- **Un solo motor de mapas:** todo pasa por `src/maps/`; nada de MapLibre suelto en la screen.

## 10. DoD
- [ ] El mapa dibuja tiles reales en el teléfono (tarea 0).
- [ ] Se ve la cartera del cobrador sobre el mapa, con su estado de mora en el pin.
- [ ] Tocar un cliente muestra su card y **Agregar al recorrido** suma la parada de verdad
      (`POST /routes/:id/stops`), con el contador subiendo.
- [ ] Quitar una parada recién agregada la saca de la ruta, y las que siguen se corren (sin agujeros).
- [ ] Mover una parada con ↑/↓ cambia el orden **y sobrevive a recargar la pantalla** (se guardó en el
      server, no sólo en memoria).
- [ ] Dos toques seguidos no rompen la secuencia ni duplican la parada.
- [ ] Un cliente sin coordenadas aparece en el aviso de RT-1.4, no desaparece.
- [ ] Crear cliente desde el mapa vuelve con el cliente pintado en su punto.
- [ ] La ruta armada acá se ve en el tab Rutas (RT-0b) con nombre y dirección en cada parada.
- [ ] **En modo avión se puede armar la ruta igual**: agregar, quitar y mover funcionan, la pantalla
      avisa cuántas paradas faltan sincronizar y **nada se bloquea**.
- [ ] Al volver la conexión, lo armado offline aparece en el server sin duplicar ni perder nada
      (incluido salir y volver a abrir la app con el borrador pendiente).
- [ ] Salir del mapa a medio armar y volver por RT-0b retoma la misma ruta, no crea otra.
- [ ] `type-check` + `jest` verdes en API y móvil + `expo export`.
- [ ] `/code-review` + `/ponytail-review` aplicados.
- [ ] Validación visual por la usuaria, por cable.

## 11. Decisiones cerradas (con la usuaria, 2026-07-28)
- **D-S2-DATOS — la cartera sale de `view=portfolio` con coordenadas.** Ya está acotada al cobrador y
  ya trae lo que la card necesita. `GET /clients` quedó descartado por alcance de datos.
- **D-S2-CREAR — paradas en vivo, con endpoint propio.** La ruta se crea vacía y cada toque agrega la
  parada en el server. Cuesta dos endpoints nuevos, y a cambio deja servido el "Agregar parada extra"
  sobre una ruta ya empezada (RT-0c) que hoy no tiene por dónde entrar.
- **D-S2-ALTA — el alta desde el mapa es la de cartera.** `cliente/nuevo` acepta `lat`/`lng` y precarga
  la ubicación en modo mapa. Un solo formulario de alta en toda la app.
- **D-S2-ORDEN — manda el orden en que tocás, y se puede corregir.** Las paradas se agregan al final y
  el cobrador las mueve con ↑/↓ (§5.4). Distinto de `generate`, que ordena por prioridad: cuando armás
  la ruta a mano, el criterio es tuyo. S3 sigue siendo quien previsualiza y sugiere el orden óptimo.
- **D-S2-AUDIT — el revelado de coordenadas se audita.** Un registro `case_portfolio/PII_REVEAL` por
  consulta de `view=portfolio` (§5.1). Mismo criterio que S1 aplicó a las direcciones de las paradas.
- **D-S2-OFFLINE — se arma la ruta sin señal y se sincroniza al reconectar.** Borrador local
  persistido + sincronización **por diferencia** (§5.5). Un solo camino con red y sin red. Costo
  aceptado: una cola chica propia, porque la general (P6/WatermelonDB) todavía no existe; cuando
  llegue, esto se enchufa ahí. Se descartó "pedir conexión para armar" (rompía offline-first) y la
  selección sólo en memoria (se perdía al cerrar la app).
- **D-S2-VIDA — la ruta a medio armar ES la ruta del día.** No se borra ni se descarta al salir: queda
  `PLANNED` y se sigue editando. Para que no quede inalcanzable —RT-0a sólo aparece cuando NO hay ruta—
  el botón **"Agregar paradas en el mapa"** vive también en RT-0b.

## 12. Riesgos
- **MapLibre nunca se vio renderizar.** Es el riesgo grande del slice y la tarea 0 lo despeja primero.
  Si los tiles no cargan, el problema es la fuente self-hosted en R2 (que depende de publicar los
  extractos OSM), no la pantalla.
- **Cartera grande sobre el mapa** (regla de gama baja arriba): techo a medir en el smoke.
- **Coordenadas = domicilio.** Viajan en el listado de cartera; por eso D-S2-AUDIT las audita.
- **La cola local es código nuevo que P6 va a reemplazar.** Se acota a rutas y se apoya en piezas que
  ya existen (`SecureStore`, `subscribeConnectivity`) justamente para que reemplazarla sea barato. El
  riesgo real no es escribirla, es que se convierta en una segunda capa de sync permanente: queda
  anotada como deuda con destino (P6).

## ⏸️ Pendiente de confirmar
- (nada) — las siete decisiones (D-S2-DATOS · CREAR · ALTA · ORDEN · AUDIT · OFFLINE · VIDA) quedaron
  cerradas con la usuaria.
