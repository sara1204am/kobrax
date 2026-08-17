# DataTable — la tabla de listado del panel

Componente genérico de tabla. **No sabe nada del dominio**: qué es una deuda, cómo se formatea un
boliviano o qué significa «en mora» vive en las columnas y los filtros que le pasan. La misma tabla
dibuja clientes, casos, rutas o pagos cambiando la configuración.

Lo usan hoy: `cartera`, `casos`, `rutas`, `pagos`, `equipo` e `import/columnas`.

---

## La decisión que ordena todo: el estado vive en la URL

```
/cartera?q=perez&dpdMin=90&sort=debt&dir=desc&page=2&pageSize=50
```

La tabla **no llama a la API**. Escribe la URL; Next vuelve a renderizar el server component de la
pantalla, que lee los mismos `searchParams`, le pide a la API lo que toca y le pasa `rows` y `meta`
ya resueltos.

Eso hace que:

- la vista se comparta por link y el botón «atrás» funcione;
- no haya dos verdades sobre en qué página estamos;
- **no haga falta `AbortController`**: Next descarta la navegación anterior, así que una respuesta
  vieja nunca pisa a la nueva, y tampoco hay pedidos duplicados;
- se mantenga el patrón BFF del panel — ningún componente cliente habla con la API.

Es lo que en el plan de refactor se llama «adaptador de datos», resuelto de otra forma: el adaptador
es **una función pura** que traduce el estado de la tabla a la query de la API
(`lib/cartera-query.ts`), no una función que hace `fetch`.

---

## Uso mínimo

```tsx
<DataTable
  columns={columns}
  rows={rows}
  rowKey={(r) => r.id}
  meta={meta}
  empty={<EmptyState title="Sin clientes" />}
/>
```

Todo lo demás es opcional, y **lo que no se pide no se dibuja**: sin `tableId` no hay menú de
columnas ni selector de tamaño de página; sin `filters` no hay panel ni botón que lo abra. Por eso
las cinco tablas que ya existían siguen viéndose igual.

## Props

| Prop | Qué hace |
|---|---|
| `columns` | Ver abajo. |
| `rows` / `meta` | Lo que devolvió la API. `meta` es `{total, page, limit, pages}`. |
| `rowKey` | El id estable de la fila. De acá sale la selección. |
| `empty` | Lista vacía **sin filtros puestos**. |
| `noResults` | Vacía **por los filtros**. Es otro problema: se arregla borrando el filtro. |
| `error` | La API falló. Reemplaza a la tabla entera; poné un `[Reintentar]` adentro (`RetryState`). |
| `tableId` | Habilita ⚙ Columnas, tamaño de página y preferencias. |
| `userId` | Con `tableId`, guarda las preferencias por persona. |
| `filters` | Los filtros del panel izquierdo. |
| `filtered` | ¿Hay algún filtro puesto? Lo sabe la pantalla. Decide `empty` vs `noResults` y si el panel abre solo. |
| `search` | La barra ancha de búsqueda (`<SearchBox wide />`). |
| `entityLabel` | El plural de lo que se lista (`clientes`). Va en el pie y en la barra de selección. |
| `actions` | La acción de la pantalla («Nuevo cliente»), a la derecha de la barra. |

### La barra de arriba

```
[Filtros aplicados] [Columnas]                                          [Nuevo cliente]
```

Los controles **de la vista** van juntos a la izquierda; el de filtros, del mismo lado que el panel
que abre — un interruptor lejos de lo que enciende obliga a buscar con la vista qué cambió.

La acción de la pantalla va sola a la derecha, y **acá y no en el encabezado de la página**: actúa
sobre esta lista, así que queda a la altura de la mano sin subir la vista hasta el título para
volver a bajar. Va a la medida de los otros botones de la barra (`h-9`, 13 px): tres controles en
una fila con tres alturas distintas se leen como tres cosas sin relación entre sí.

## Columnas

```ts
{
  key: 'debt',              // identifica la columna Y es lo que viaja en ?sort=
  header: 'Deuda',
  render: (row) => money(row.totalDebt, currency),
  sortable: true,
  defaultDir: 'desc',       // hacia dónde ordena el PRIMER clic
  numeric: true,            // alineada a la derecha, tabular
  center: true,             // centrada (pastillas, cifras de un dígito)
  visibleByDefault: false,  // existe, pero arranca apagada
}
```

**Sólo se declara `sortable` lo que el servidor sabe ordenar.** Un control que ordena por otra cosa
que la que muestra es peor que no tenerlo: en Cartera, la columna Estado se deriva en el navegador,
así que no es ordenable — el servidor sólo sabría ordenar por `client_status`, que es otra cosa.

## Filtros

Todos viven en el **panel izquierdo**, nunca dentro del encabezado: con una columna apagada o la
tabla scrolleada, un filtro puesto queda fuera de la vista, la lista sale corta y no hay forma de
saber por qué.

```ts
const filters: FilterDef[] = [
  { keys: ['collectorId'], label: 'Cobrador', type: 'select', options, allLabel: 'Todos los cobradores' },
  { keys: ['dpdMin', 'dpdMax'], label: 'Rango de mora', type: 'numberRange' },
  { keys: ['estado'], label: 'Estado', type: 'radio', options: [...] },
];
```

`keys` son **las claves de la URL**. Un rango usa dos; el resto, una. Qué significa cada clave lo
traduce el adaptador de la pantalla, no el componente.

Tipos disponibles: `text` · `numberRange` · `select` · `multiSelect` · `radio`.

### Agregar un tipo de filtro

En `data-table-filters.tsx`: escribí el control y sumalo a `FILTER_CONTROLS`. **No se toca
`data-table.tsx`** — la tabla busca el control en el registro, no lo conoce.

```tsx
function DateRangeFilter({ value, onChange, def }: FilterControlProps) { /* … */ }

export const FILTER_CONTROLS = { …, dateRange: DateRangeFilter };
```

Los de escribir (`text`, `numberRange`) esperan 350 ms antes de navegar; los de elegir salen al
toque — marcar una opción es una decisión tomada, y esperar a que «termine de escribir» se siente
roto.

## Escribir un adaptador

Una función pura, del lado del server component. Su trabajo es **descartar lo que no debería
viajar**: la API valida, y un 400 no rompe una columna — deja la pantalla sin datos.

```ts
export function carteraQuery(params: Record<string, string | undefined>): URLSearchParams {
  const query = new URLSearchParams({ view: 'portfolio', page, limit });
  // un número a medio escribir («-», «1e») no viaja
  // un id que no es uuid no viaja
  // un `sort` que el servidor no conoce no viaja
  return query;
}
```

Ver `lib/cartera-query.ts`, con sus tests en `lib/cartera-query.test.ts`.

## Columnas configurables

Se reordenan **arrastrando** —API nativa de HTML5 (`draggable` + `onDragOver` + `onDrop`), sin
dependencias— y también con **`Alt` + ↑/↓**: arrastrar no existe para quien navega con teclado, y sin
la alternativa reordenar sería una función que sólo tienen algunos.

El **ojo** dice si la columna se ve: abierto está, tachado no. Es la misma acción que un checkbox,
pero se entiende sin leer la etiqueta.

Sólo se arrastran las columnas visibles: una apagada no tiene lugar en el orden.

## Preferencias

Con `tableId` + `userId`, la tabla recuerda filtros, orden, tamaño de página y columnas en
`localStorage`, bajo `tablePrefs:{userId}:{tableId}` (ver `lib/table-prefs.ts`).

- **Se aplican sólo si la URL viene limpia.** Un link compartido manda sobre lo que filtraste ayer.
- **`version` es obligatorio.** El día que cambien las columnas, lo guardado apunta a columnas que ya
  no existen: con el número, lo viejo se descarta y se cae a los defaults. Molesta una vez; no rompe
  nunca.
- **La página no se guarda.** Volver y aterrizar en la página 7 de una lista que cambió no restaura
  nada.
- Las «vistas guardadas» (`Mi cartera`, `Mora crítica`) entran acá sin migración dolorosa: hoy se
  guarda un objeto; mañana, `{ views: [...], active }` con `version: 2`.

## Lo que NO hace (y por qué)

- **Selección de filas.** Existió y se sacó entera: no hay ninguna acción en lote que ofrecer, y una
  casilla que no lleva a nada es una promesa incumplida. Vuelve con un `git revert` el día que haya
  una acción de verdad; cuando vuelva, la selección va **por id y no por posición** —al cambiar de
  página los índices son otras filas y se mudaría sola a otra persona—.

- **Scroll infinito.** El adaptador es `page`/`pageSize`: agregar una vista continua después no
  obliga a reescribir nada, y la paginación no se sacrifica mientras tanto.
- **Virtualización.** Con 100 filas por página no hace falta. Se mide antes de agregarla.
- **Acciones en lote.** El alcance del refactor era el listado. Sin acciones no hay selección (ver arriba).
- **Export.** La capa de query del backend quedó lista para reusarse; el export no se implementó.
- **`pageSize` 200.** La API valida `limit ≤ 100`. No vale romper el contrato por una opción.
- **Totales aproximados.** Hubo un techo («10.000+») mientras la cartera agregaba en cada request.
  Con los agregados denormalizados el `COUNT(*)` cuesta 18–72 ms sobre 100.000 personas: el número
  exacto salió más barato que la complejidad de esconderlo.

## Convención pendiente: dos tablas en una pantalla

Los parámetros son planos (`sort`, `page`, `dpdMin`). El día que haya **dos tablas en la misma
pantalla**, se prefijan con el `tableId` (`cartera.sort`, `cartera.page`). No hay ninguna hoy, así
que la convención queda escrita y sin implementar.
