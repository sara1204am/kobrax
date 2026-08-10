> **ESTADO: EN BORRADOR — ronda 2 (2026-08-10). NO construir hasta PASS.**
>
> Ronda 2 cierra las tres decisiones de la dueña: **la mora va en la lista** y la lista **abre
> por mora, lo peor primero** · **la cartera es por cliente, y sus créditos viven dentro** ·
> **la supervisora da de alta créditos** · **los adjuntos entran**. Ver §5 y §13.

# W3 — Cartera

## 1. Objetivo

Que desde la oficina se pueda **ver y mantener la cartera entera del negocio**: quién debe,
cuánto, hace cuántos días, y poder corregirlo en pantalla grande. Hoy el único lugar donde
existe un cliente es el teléfono del cobrador, y ahí la lista es **la suya** — la supervisora
no tiene forma de ver la cartera completa ni de arreglar un dato mal cargado en campo.

W3 es además la etapa que **cierra tres deudas que W1 y W2 dejaron anotadas**: la búsqueda (`q`)
del `DataTable`, su orden (`sort`/`dir`), y el primer consumidor real de las dos cosas. El
`DataTable` nació sin consumidor y el code-review se lo marcó; acá se le da uno de verdad.

## 2. Rama

`web/W3-cartera`, **sale de `web/W2-cuenta`** (no de `main`).

Motivo: W3 tiene que cablear la búsqueda **también en `/equipo`**, que sólo existe en W2, y W2
ya subió a `shared` el diff de formularios y los países. Saliendo de `main` habría que
reescribir eso, y el merge terminaría con dos copias — exactamente el bug que se comió media
tarde en el módulo de Cuenta del móvil (`SelectRow`/`PickerSheet` duplicados sin conflicto de
git). **Consecuencia asumida: W3 no mergea a `main` hasta que W2 mergee.**

## 3. Pantallas

| Ruta | Permiso | Qué hace |
|---|---|---|
| `/cartera` | `client:read` | Lista de clientes: búsqueda, filtros, mora coloreada, paginada |
| `/cartera/nuevo` | `client:write` | Alta de cliente (identificación + teléfonos + ubicaciones + garantes) |
| `/cartera/[id]` | `client:read` | Ficha: datos, contactos, ubicaciones, garantes, y **sus créditos** |
| `/cartera/[id]/editar` | `client:write` | Edición del cliente y de sus sub-recursos |
| `/cartera/[id]/prestamo` | `credit:write` | Alta de crédito sobre ese cliente |
| `/cartera/[id]/credito/[cid]` | `credit:read` | Ficha del crédito: datos, cronograma (si tiene) y edición de lo operativo |

🔴 **Las cuatro son rutas privadas nuevas → entran al matcher de `middleware.ts`** con
`/cartera/:path*`, junto con sus handlers del BFF. Es el error más fácil de cometer: la
pantalla anda hasta que expira el access token, 15 minutos después.

En `lib/nav.ts` se le da vuelta el `built: false` a `portfolio`.

## 4. Contrato (verificado contra los controllers y los DTO)

### 4.1 Clientes

| Endpoint | Permiso | Notas |
|---|---|---|
| `GET /clients` | `client:read` | `page` · `limit` (≤100) · `q` · `status` · `risk`. **Orden fijo `createdAt desc`** — ver §5 |
| `GET /clients/:id` | `client:read` | Trae `contacts`, `locations`, `relations` (con **sus** contactos y ubicaciones) y `attachments`. Acepta `?reveal=true` |
| `POST /clients` | `client:write` | Alta atómica: cliente + contactos + ubicaciones + garantes en **una** transacción |
| `PATCH /clients/:id` | `client:write` | Sólo el cliente. Los sub-recursos van por su propia ruta |
| `DELETE /clients/:id` | `client:write` | 204. Soft-delete + `status: INACTIVE` |
| `POST`/`PATCH`/`DELETE /clients/:id/contacts[/:cid]` | `client:write` | |
| `POST`/`PATCH`/`DELETE /clients/:id/locations[/:lid]` | `client:write` | |
| `POST`/`PATCH`/`DELETE /clients/:id/relations[/:rid]` | `client:write` | |
| `POST`/`DELETE /clients/:id/attachments[/:aid]` | `client:write` | Sin `PATCH` |

### 4.2 Créditos

| Endpoint | Permiso | Notas |
|---|---|---|
| `GET /credits` | `credit:read` | `page` · `limit` · `clientId` · `branchId` · `status`. **Sin `q`** |
| `GET /credits/:id` · `GET /credits/:id/schedule` | `credit:read` | El cronograma **puede venir vacío** (C14) |
| `POST /credits` | `credit:write` | Dos modos, §4.4 |
| `PATCH /credits/:id` | `credit:write` | Sólo lo operativo: `status`, `assignedManagerId`, `branchId`, `code`, `principalAmount`, `interestRate`, `installmentAmount`, `frequency`, `nextDueDate`, `notes` |
| `POST /credits/:id/recalculate-arrears` | `credit:write` | Recalcula la mora a una fecha de corte |

### 4.3 Las reglas del servidor que la pantalla tiene que respetar

Están todas verificadas en `clients.service.ts` y `credits.service.ts`. Si la UI no las conoce,
ofrece botones que la API rechaza.

1. **La PII de la lista SIEMPRE viene enmascarada.** `list()` serializa con `reveal: false`
   fijo — el query param no existe ahí. Documento, dirección, teléfono y correo se ven en
   claro **sólo** en la ficha, y sólo pidiéndolo (§6).
2. **`DELETE` rebota si el cliente tiene créditos `ACTIVE`** (`clientHasActiveCredits`). No es
   un borrado: pone `deletedAt` + `status: INACTIVE`. La pantalla lo llama «Dar de baja», no
   «Eliminar», y **ofrece el botón sólo si el cliente no tiene créditos activos**.
3. **Documento duplicado = error, no aviso** (`clientDuplicate`, por blind index). Vale en el
   alta y en la edición. La web muestra **su** mensaje; no re-implementa la búsqueda del duplicado.
4. **La identidad tiene mínimo por tipo**: `PERSON` exige nombre **y** apellido; `COMPANY`
   exige razón social. El formulario cambia de campos con el tipo.
5. **Los sub-recursos no viajan en el `PATCH` del cliente.** `UpdateClientDto` no los acepta:
   editar un teléfono es un `PATCH /clients/:id/contacts/:cid`. La pantalla de edición manda
   **N llamadas**, una por fila tocada — y por eso `serverId` importa (§7).
6. **El teléfono/la ubicación de un garante cuelga del garante**, no del cliente: misma tabla,
   con `relationId`. El server valida que ese garante sea de **este** cliente.
7. **`GUARANTOR` no es una entidad** (C8): es un `RelationshipType` **y** un `LocationType`.
   «Los garantes de X» son sus `relations`; sus puntos en el mapa son `locations` de tipo
   `GUARANTOR`. No hay tabla ni endpoint de garantes.
8. **El nombre visible tiene una sola regla** (C9): empresa → razón social; persona → nombre +
   apellido. Vive en `clientDisplayName()` de la API. La web **no** arma su propio
   `${firstName} ${lastName}`, que le pondría un espacio suelto a toda empresa.
9. **Monto, tasa, nº de cuotas y moneda no se editan tras el desembolso**: no están en
   `UpdateCreditDto` porque cambiarlos es una reestructura. La ficha los muestra de sólo lectura.

### 4.4 Los dos modos del alta de crédito (D1 del móvil)

| Modo | Cuándo | Qué pasa |
|---|---|---|
| **Cuota congelada** | Viene `installmentAmount` | **No se genera cronograma**: la cuota queda guardada en `credit.metadata` y `nextDueDate` es un dato, no una derivación. Es como da de alta el móvil |
| **Cronograma** | Viene `installmentsCount` sin `installmentAmount` | Se generan las cuotas (`FRENCH`/`FLAT`) |

Y dos banderas más: `outstandingBalance` + `daysPastDue` = «este préstamo ya está en curso»
(digitalizar cartera vieja), y `openCase: true` abre el caso de cobranza en la misma
transacción — el alta del móvil siempre lo pide.

🔴 **La web se va a encontrar créditos sin cronograma y no puede asumir que siempre hay uno.**
`GET /credits/:id/schedule` puede devolver una lista vacía y eso es correcto, no un error.

### 4.5 Nuevo en el BFF

| Handler | Qué proxea |
|---|---|
| `POST /api/clients` · `PATCH`/`DELETE /api/clients/[id]` | El cliente |
| `POST`/`PATCH`/`DELETE /api/clients/[id]/contacts[/[cid]]` | Idem para `locations` y `relations` |
| `POST /api/credits` · `PATCH /api/credits/[id]` | El crédito |
| `GET /api/clients/[id]/reveal` | El único **GET** con handler propio (§6) |

**El resto de las lecturas no lleva handler**: la lista, la ficha, los créditos y el cronograma
los pide el server component de cada pantalla con `apiCall(..., { auth: true })`. Un handler
para leer sería un salto del servidor a sí mismo.

## 5. 🔴 Los huecos del contrato (lo que W3 tiene que decidir y construir)

Esto es el corazón del plan. Los dos primeros salen de comparar lo que el `DataTable` de W1
manda con lo que `GET /clients` acepta; los otros dos, de las decisiones de la dueña.

### 5.1 La búsqueda (`q`) — **ya está en el servidor, sólo falta la caja**

`ListClientsQueryDto.q` existe y `clients.service.list()` lo resuelve así:

```
q → OR: [ nationalIdHash = hash(q),            ← documento EXACTO, vía blind index
          firstName ILIKE %q%, lastName ILIKE %q%, businessName ILIKE %q% ]
```

O sea: **el documento matchea exacto o no matchea** (está cifrado; no hay ILIKE posible sobre
él), y el nombre matchea parcial. Eso hay que decírselo a quien busca, o va a escribir medio
carnet y concluir que el cliente no existe.

→ Se construye `components/search-box.tsx`: escribe `?q=` en la URL (misma mecánica que el
orden y la página del `DataTable`), vuelve a la página 1, y **debounce de 300 ms** — el mismo
techo que el móvil ya calibró en `use-client-search.ts`. Server component lee `q` y lo pasa a
la API: sin estado de cliente, sin race-guard, porque acá **quien busca es el servidor** y
Next descarta la respuesta vieja solo.

→ Y **se cablea también en `/equipo`**, que es la deuda que W2 dejó anotada. Ahí filtra en
memoria (son pocas filas y `/users` no busca): misma caja, distinto consumidor.

### 5.2 La lista ordenada por mora — `GET /clients?view=portfolio`

**Decisión de la dueña (2026-08-10): la mora va en la lista, y la lista abre por mora, lo peor
primero.** Es como abre la del móvil, y es lo que la oficina va a mirar todos los días.

Eso junta dos problemas en uno solo, porque tienen la misma solución:

- **`GET /clients` no sabe nada de plata.** `serializeClient` devuelve identidad y PII: ni
  deuda, ni mora, ni cuántos créditos.
- **El `DataTable` manda `?sort=&dir=` y nadie lo escucha.** `/clients` ordena siempre por
  `createdAt desc`. Hoy no se nota porque `/equipo` ordena en memoria; con paginación
  server-side, ordenar en memoria ordena **la página**, no la lista, y eso es una mentira en
  pantalla.

Y **ordenar por mora no se puede resolver después de paginar**: la mora del cliente es el
máximo de sus créditos, y la deuda es su suma. Si primero se traen 20 clientes y después se los
enriquece, se ordenaron 20 cualesquiera. **El orden y la agregación son la misma consulta.**

#### Por qué no se copia la cartera del móvil

La del móvil no se arma sobre `/clients` sino sobre `GET /cases?view=portfolio`, agrupando con
`groupPortfolio`. En la web eso falla por dos razones que sólo se ven de cerca:

1. La paginación es **por caso**: agrupar por cliente después de paginar parte a un cliente
   entre dos páginas y le muestra media deuda.
2. **Un cliente sin caso abierto no aparece.** En el teléfono da igual (el cobrador ve su
   trabajo del día); en la oficina no: el cliente que acabás de dar de alta desaparecería de la
   cartera hasta que alguien le abra un caso.

#### La consulta

Una sola, cruda, dentro de `withTenant`. **Es el único SQL crudo del panel** y se paga a
propósito: Prisma sabe ordenar por `_count` de una relación, pero no por `SUM` ni por `MAX`.

```sql
SELECT c.id,
       COALESCE(SUM(cr.outstanding_balance), 0) AS total_debt,
       COALESCE(MAX(cr.days_past_due), 0)       AS max_days_past_due,
       COUNT(cr.id)                             AS credit_count
FROM clients c
LEFT JOIN credits cr ON cr.client_id = c.id AND cr.deleted_at IS NULL   -- ← en el ON, no en el WHERE
WHERE c.deleted_at IS NULL AND <status / risk / q>
GROUP BY c.id
ORDER BY max_days_past_due DESC, total_debt DESC, c.last_name, c.business_name
LIMIT $limit OFFSET $skip
```

Después, un `findMany({ where: { id: { in: ids } } })` normal de Prisma para serializar (que es
donde vive el descifrado y el enmascarado de la PII), reordenado según los ids que devolvió la
consulta. Total = `COUNT(DISTINCT c.id)` con el mismo `WHERE`.

🔴 **`cr.deleted_at IS NULL` va en el `ON`, no en el `WHERE`.** En el `WHERE` convierte el
`LEFT JOIN` en un `INNER JOIN` y **los clientes sin créditos desaparecen** — que es exactamente
el bug que estamos evitando al no copiar la cartera del móvil. El DoD lo prueba (§12).

Tres cosas más que la consulta tiene que respetar:

- **RLS.** `clients` y `credits` tienen `tenant_isolation` — pero definida en
  `packages/database/prisma/rls/001_enable_rls.sql`, **no** en `migrations/`: se aplica aparte
  con `psql`. Buscarla entre las migraciones y no encontrarla hace pensar que no existe. La
  consulta **no filtra `account_id` a mano**: corre como `kobrax_app` dentro de `withTenant`, y
  ahí RLS la cubre. Fuera de `withTenant` no hay contexto y no devuelve nada.
- **`q` se parametriza, no se interpola.** `$queryRaw` con template etiquetado. Es texto que
  escribe cualquiera en una caja de búsqueda.
- **El `WHERE` queda duplicado** entre el camino Prisma y el crudo. Se asume: son seis líneas y
  el camino de siempre no se toca. La red que lo agarra es un spec: *la misma búsqueda devuelve
  los mismos clientes con y sin `view=portfolio`*.

#### Lo que la lista NO puede mostrar: el próximo vencimiento

`nextDueDate` e `installmentAmount` **no son columnas**. Viven en `credit.metadata` (crédito
nacido en el móvil, sin cronograma) o se derivan de `credit_installments` (crédito con
cronograma), y quien los resuelve es **`creditView()` de `shared`** — la misma función que usa
la API para la tarjeta del móvil.

O sea: no hay nada que ordenar ni agregar en SQL. Por eso el desempate del orden es **mora desc
→ deuda desc → nombre**, y no «mora desc → próximo vencimiento asc» como en el teléfono. La
próxima fecha se ve **en la ficha**, donde cada crédito la calcula con `creditView()`.

Es una diferencia deliberada con el móvil y hay que dejarla escrita, porque desde afuera parece
un olvido.

#### Las columnas y su orden

| Columna | Ordenable | De dónde sale |
|---|---|---|
| Cliente | sí (`name`) | `clientDisplayName` — apellido, nombre / razón social |
| Documento | no | Enmascarado siempre (§4.3.1) |
| Deuda | sí (`debt`) | `SUM(outstanding_balance)` |
| Mora | **sí — y es el default, desc** | `MAX(days_past_due)` |
| Créditos | no | `COUNT` |
| Estado | sí (`status`) | `portfolioStatus` de `shared` → mismo color que en el teléfono |

`portfolioStatus` ya es la fuente única del badge en el móvil: mismo estado, mismo color, las
dos pantallas. **No se reimplementa el semáforo en la web.**

> `ponytail:` la deuda se suma **sin mirar la moneda**. Hoy una cuenta tiene una sola moneda
> (W2, `currencyCode`), así que la suma es honesta. El día que un tenant preste en dos, esta
> celda miente y hay que partirla por moneda.

### 5.3 El alta de crédito desde la oficina

**Decisión de la dueña: sí, la supervisora da de alta créditos, con la cotización en vivo.**

La cotización es **la misma que la del teléfono** — por eso `prestamo-form.ts` se promueve a
`shared` (§7) y no se reescribe. Si el escritorio cotiza distinto que el teléfono, es un bug de
plata y aparece meses después, en la boca de un cliente.

Dos cosas que el alta de oficina define y la del móvil no tenía que definir:

1. **`assignedManagerId` = el cobrador que se elija en el formulario**, no quien lo crea. En el
   teléfono coinciden (el cobrador se lo asigna a sí mismo); en la oficina, no: la supervisora
   carga el préstamo y se lo reparte a alguien. La lista de cobradores sale de `GET /users`, que
   W2 ya consume en `/equipo`.
2. **`openCase: true`**, igual que el alta del móvil. Sin caso, el crédito no le llega a nadie:
   queda cargado y nadie lo cobra.

El resto del contrato no cambia — los dos modos del §4.4 valen igual, y la web va a usar sobre
todo el de **cuota congelada**, que es como está cargada la cartera que ya existe.

### 5.4 Los adjuntos

**Decisión de la dueña: entran.** Con un techo que hay que decir en voz alta:

- **Subir sí se puede**, y sin nada nuevo: `POST /uploads` + `GET /uploads/:name` ya existen y
  W2 les dejó handler (`/api/account/upload`, `/api/uploads/[name]`) para la foto de perfil y el
  QR de cobro. El nombre que devuelve se guarda como `fileUrl` del adjunto.
- **Listar y borrar sí**: tipo, fecha y hash.
- 🔴 **Abrirlos no.** `serializeAttachment` **no devuelve la URL a propósito** — el comentario
  dice que se pide con un endpoint firmado, que es F6. La web sabe que el archivo existe, no
  cuál es. Se listan con su tipo y su fecha, y **no se dibuja un botón de «ver» que no funciona**
  (regla §3.7 del BUILD-PLAN).

Queda anotado para F6: exponer el adjunto por endpoint firmado enciende el «ver» sin tocar nada
más de esta pantalla.

## 6. La PII y el revelado auditado

`GET /clients/:id?reveal=true` devuelve documento, dirección, teléfono y correo **en claro**, y
deja un registro `client/PII_REVEAL` en la auditoría. Sin el flag, todo viene enmascarado.

Dos cosas que la web tiene que respetar y son fáciles de romper:

1. 🔴 **El formulario de edición carga con `reveal=true`, siempre.** El comentario del
   controller lo dice: antes exigía `CLIENT_PII_READ`, el cobrador no lo tenía, y el formulario
   mostraba la máscara — al guardar, **escribía la máscara encima del dato real**. La web tiene
   el mismo pie: si la ficha se edita con el valor enmascarado, borra el carnet del cliente.
2. **La ficha de lectura arranca enmascarada** y tiene un «Ver datos completos» que dispara el
   `reveal`. Un `reveal` por cada apertura de ficha llenaría la auditoría de ruido y volvería
   inútil el registro justo el día que haga falta leerlo.

→ Por eso `GET /api/clients/[id]/reveal` es el único GET con handler propio: es una **acción**
que deja rastro, disparada por un click, no una lectura de página.

## 7. Lo que se promueve a `shared` (regla §3.9)

| Se promueve | De dónde | Por qué |
|---|---|---|
| `quoteFor` · `currentInstallment` · `totalBelowCapital` · `canSubmitPrestamo` · `initialPrestamo` · `buildPrestamoPayload` + el tipo `PrestamoForm` | `prestamo-form.ts` | 🔴 **Es plata.** Dos implementaciones = dos cuotas para el mismo préstamo, y la diferencia aparece meses después en la boca de un cliente. La matemática de abajo (`quoteLoan`, `quoteFromInstallment`) **ya está en `shared/utils/loan.ts`**: lo que falta subir es la capa que decide *cuál* se usa y *cuándo* el alta es válida |
| `buildClientePayload` · `canSubmitCliente` · `hydrateCliente` · `initialCliente` · `emptyContact/Location/Relation` + sus tipos | `cliente-form.ts` | Acá viven tres reglas del modelo que la web volvería a descubrir a los golpes: **WhatsApp es un `ContactType` aparte** (el switch del formulario), las filas vacías **se descartan**, y `serverId` es lo que hace que editar sepa qué actualizar y qué crear |
| `diffCliente` | `cliente-diff.ts` | El `PATCH` parcial del cliente y sus sub-recursos. Hermano de `diffAccount`, que W2 ya subió a `utils/patch.ts` |

| NO se promueve | Por qué |
|---|---|
| `groupPortfolio` · `matchesChip` · `matchesSearch` · `filterPortfolio` | Están escritos sobre `CaseListItem` (la cartera del cobrador, agrupada desde casos). La web arma la suya desde `/clients` con la agregación del servidor (§5.2): no es la misma entrada. `portfolioStatus`, que es **la** regla del estado, ya está en `shared` y sí se usa |
| `sortPortfolio` · `PortfolioSort` | Ordena una lista **ya traída entera**. En la web ordena el servidor porque la lista viene paginada (§5.2): subirlo sería subir código que la web no puede usar |
| `PORTFOLIO_SORT_LABEL` · `PAYMENT_METHODS`-style labels | Copy en español. Mismo criterio que W1 con las etiquetas de estado y W2 con `ROLE_HINT` |
| `use-client-search.ts` | Es un hook de React y `shared` no depende de React. Además la web no lo necesita: **busca el servidor** (§5.1). Lo que se hereda es el número (300 ms), no el código |

Promover = mover el archivo, dejar el móvil importando de `shared`, y verificar que **sus tests
pasan sin tocarlos** (`prestamo-form.test.ts`, `cliente-form.test.ts`, `cliente-diff.test.ts`,
`portfolio.test.ts`). Si un test hay que cambiarlo, se cambió comportamiento.

## 8. Auditoría de reuso

| Capacidad | Decisión | Dónde |
|---|---|---|
| Tabla, paginación, orden en la URL | **REUSAR** | `components/data-table.tsx` (W1) |
| Modal de confirmación · toasts · vacíos · encabezado · badges | **REUSAR** | `modal.tsx` · `toast.tsx` · `panel-ui.tsx` |
| Esconder acciones sin permiso | **REUSAR** | `usePermissions()` (W1) |
| Botón, input, campo, error | **REUSAR** | `components/ui.tsx` |
| `apiCall`, `sameOrigin`, `bearerHeaders` · `postJson`, `sendJson` | **REUSAR** | `lib/bff.ts` · `lib/client.ts` (`sendJson` lo agregó W2, y W3 lo estrena en serio: son muchos `PATCH`/`DELETE`) |
| Estado de cartera → color | **REUSAR** | `portfolioStatus` de `@kobrax/shared` |
| Máscara de documento / teléfono / correo | **REUSAR** | `shared/utils/tokenize.ts` — la API ya manda enmascarado; esto es por si la web tiene que enmascarar algo propio |
| Moneda y fechas | **REUSAR** | `shared/utils/currency.utils.ts` · `date.utils.ts` · `lib/format.ts` |
| Cotización del préstamo · formulario de cliente · diff | **PROMOVER** | del móvil a `shared` (§7) |
| Próxima fecha y cuota de un crédito | **REUSAR** | `creditView()` de `@kobrax/shared` — la misma que usa la API para la tarjeta del móvil (§5.2) |
| Subir y servir un archivo | **REUSAR** | `POST /uploads` · `GET /uploads/:name` y sus handlers de W2 (§5.4) |
| Lista de cobradores para asignar | **REUSAR** | `GET /users`, que W2 ya consume en `/equipo` (§5.3) |
| Caja de búsqueda | **NUEVO** | `components/search-box.tsx` — y se cablea en `/equipo` |
| `sort`/`dir` y `view=portfolio` en `GET /clients` | **NUEVO (API)** | §5.2 — el único SQL crudo del panel |
| Formulario acordeón de cliente (contactos, ubicaciones, garantes) | **NUEVO** | la pantalla; la lógica viene de `shared` |
| Ficha con pestañas y lista de créditos | **NUEVO** | la pantalla |

**No entran catálogos.** `/catalogs` tiene `ADDRESS_TYPE` y `PHONE_TYPE`, pero el alta del móvil
no los usa: los tipos son enums de Prisma y así los manda el DTO. Consumirlos acá sería
inventar una configurabilidad que el resto del producto no tiene.

**Nada de deps nuevas.** No hace falta ninguna: no hay mapa en W3 (marcar el punto de una
ubicación es W6, con `maplibre-gl`) ni gráficos.

## 9. i18n

Namespace `portfolio` nuevo: lista, filtros, formularios, tipos de contacto/ubicación/relación,
estados del cliente y del crédito, y los rótulos de la cotización. Como en W2, **los rótulos de
enum se traducen acá**, no se suben a `shared`.

## 10. Tareas (en orden)

- [ ] 1. Promover a `shared` la cotización, el formulario de cliente y el diff (§7); dejar el
      móvil importando de ahí y correr **sus** tests sin tocarlos.
- [ ] 2. API: `sort`/`dir` y `view=portfolio` en `GET /clients` (§5.2), con sus specs — incluida
      la del `LEFT JOIN` (un cliente sin créditos sigue en la lista) y la de los dos caminos
      devolviendo los mismos ids.
- [ ] 3. `/cartera`: lista con `DataTable`, mora coloreada con `portfolioStatus`, orden por mora
      desc por defecto, filtros de estado y riesgo, y el vacío.
- [ ] 4. `components/search-box.tsx` + cablearlo en `/cartera` **y en `/equipo`** (§5.1).
- [ ] 5. `/cartera/[id]`: ficha del cliente, con el revelado auditado detrás de un click (§6).
- [ ] 6. `/cartera/nuevo` y `/cartera/[id]/editar`: alta y edición, con sus sub-recursos. La
      edición carga con `reveal=true` (§6.1) y manda **sólo lo que cambió**.
- [ ] 7. Créditos: lista dentro de la ficha, ficha del crédito con su cronograma (que puede no
      existir, §4.4) y edición de lo operativo.
- [ ] 8. Alta de crédito con la cotización en vivo, el cobrador asignado y `openCase` (§5.3).
- [ ] 9. Adjuntos: listar por tipo/fecha/hash, subir por `/uploads` y borrar. Sin «ver» (§5.4).
- [ ] 10. Baja del cliente, con la regla de los créditos activos (§4.3.2).
- [ ] 11. Sumar `/cartera` al matcher de `middleware.ts` y a sus handlers del BFF; encender
      `portfolio` en el menú (`built: true`).
- [ ] 12. i18n del namespace `portfolio`.
- [ ] 13. Actualizar `BASE-INVENTORY` (lo promovido + los artefactos de W3) y el estado de la
      etapa en el BUILD-PLAN.

## 11. Reglas de la fase

1. **La UI no re-implementa las reglas del servidor**: las anticipa para no ofrecer lo
   imposible, y cuando la API dice que no, se muestra **su** mensaje.
2. **Ninguna regla de negocio nueva en `apps/web`**: si aparece, se promueve a `shared`.
3. **Sólo se manda lo que cambió** (`diffCliente`). Guardar sin tocar nada no llama a nadie.
4. **La PII en claro sólo con `reveal`, y el formulario de edición SIEMPRE con `reveal`** (§6).
5. **Ocultar ≠ autorizar.** `usePermissions` esconde; la API sigue validando.
6. **Nada de deps nuevas** (§8).
7. Responsive de entrada: la tabla scrollea **dentro de su caja**; la ficha apila en 768.

## 12. DoD

- [ ] `type-check` · `test` · `build` de la web verdes; `type-check` y tests de la API (528 + los
      nuevos de §5.2/§5.3).
- [ ] Los tests del móvil pasan **sin modificarse** tras la promoción a `shared`.
- [ ] Buscar por nombre parcial encuentra; por documento **completo** encuentra; por documento
      parcial **no** — y la pantalla lo explica.
- [ ] **La cartera abre con el de más mora arriba**, sin tocar nada.
- [ ] Ordenar por una columna cambia la lista **entera**, no la página: la fila 1 de la página 1
      es distinta al invertir el orden.
- [ ] 🔴 Un cliente **sin créditos** aparece en la cartera, con deuda 0 y mora 0 (la trampa del
      `LEFT JOIN` del §5.2, y el bug que tendría copiar la cartera del móvil).
- [ ] La misma búsqueda devuelve los mismos clientes con y sin `view=portfolio`.
- [ ] Un cliente en mora se ve del mismo color que en el teléfono (`portfolioStatus`).
- [ ] El crédito dado de alta desde la web le aparece **al cobrador que se eligió**, no a quien
      lo cargó, y con su caso abierto.
- [ ] Un adjunto se sube, se lista con su hash y se borra. **No hay botón de «ver»** (§5.4).
- [ ] Editar un cliente y guardar **no borra su carnet** (la trampa del §6.1).
- [ ] Dar de alta con un documento ya existente muestra el mensaje del servidor, no un 500.
- [ ] Un crédito dado de alta desde el móvil (sin cronograma) abre su ficha sin romperse.
- [ ] La cuota que calcula la web es **la misma** que calcula el teléfono para los mismos datos.
- [ ] Dar de baja a un cliente con crédito activo está **deshabilitado**, y forzarlo por API falla.
- [ ] Un `COBRADOR` no ve `/cartera` completa si su rol no lo permite; la API lo rechaza igual.
- [ ] La cartera funciona en es y en en.
- [ ] Validación visual en 1440, 1280, 1024, 768 y 390.

## 13. Decisiones de la dueña (2026-08-10)

| # | Decisión | Dónde vive |
|---|---|---|
| D1 | **La mora va en la lista, y la lista abre por mora — lo peor primero** | §5.2. Es lo que obliga al `view=portfolio` y al único SQL crudo del panel |
| D2 | **La cartera es por cliente; sus créditos viven dentro de la ficha** | §3. Descarta la lista por crédito (`/credits`, que no busca ni trae el nombre del cliente) |
| D3 | **La supervisora da de alta créditos, con la cotización en vivo** | §5.3. El cobrador asignado se elige en el formulario |
| D4 | **Los adjuntos entran**, sabiendo que no se pueden abrir hasta F6 | §5.4 |

### ⏸️ Pendiente de confirmar (ronda 3)

- [ ] Copy del aviso de búsqueda por documento («el documento se busca completo»): ¿va como
      texto de ayuda fijo bajo la caja, o sólo cuando no hay resultados?
- [ ] La ficha del cliente: ¿pestañas (Datos · Créditos · Garantes · Adjuntos) o todo en una
      sola columna larga? Con 4 secciones, una columna larga puede alcanzar.
- [ ] ¿Un cliente dado de baja (`INACTIVE` + `deletedAt`) sigue apareciendo en la cartera detrás
      de un filtro, o desaparece? Hoy `GET /clients` **no lo devuelve nunca** — mostrarlo sería
      trabajo de API.

## 14. Verificación

```powershell
pnpm --filter @kobrax/shared build      # la promoción cambia shared: se recompila primero
pnpm --filter @kobrax/mobile test       # sus tests, SIN tocarlos
pnpm --filter @kobrax/api type-check ; pnpm --filter @kobrax/api test
pnpm --filter @kobrax/web type-check ; pnpm --filter @kobrax/web test
pnpm --filter @kobrax/web build         # con el dev APAGADO
```

⚠️ Después de `pnpm --filter @kobrax/shared build`, **reiniciar el `dev`**: `resolve.symlinks =
false` hace que Next no vigile los cambios de `shared` y siga sirviendo el módulo viejo. El
síntoma (`X is not a function` sobre algo que acabás de exportar) desconcierta igual.
