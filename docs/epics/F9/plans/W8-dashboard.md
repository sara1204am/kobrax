# W8 — Dashboard (builder de widgets)

> **ESTADO: ronda 1, para leer y decidir.** Cero código escrito. La guía visual es
> `docs/epics-web/dashboard.png` y el pedido largo del 13/08.
>
> ⚠️ **El pedido dice «empecemos con W9», pero lo que describe es W8.** El propio texto lo aclara
> («Implementa W8», «W9: NO implementar todavía Socket.IO») y el BUILD-PLAN también: W8 es el
> dashboard, W9 es realtime. Este plan es de **W8**.

## 1. Objetivo

Que la gerencia vea **el estado del negocio en una pantalla**, y que esa pantalla no sea una foto
fija: un dashboard armado con widgets que se agregan, se mueven, se configuran y **quedan
guardados**, para que «Vista general», «Cobranza» y «Campo» sean el mismo código con distinto
contenido.

Va última a propósito: necesita que los módulos de arriba produzcan datos reales para no medir el
vacío. Con la cartera grande sembrada (12/08) esa condición ya se cumple.

## 2. Auditoría — qué se reusa y qué no existe

| Ya está, se reusa | Dónde |
|---|---|
| Shell del panel, topbar, migas, `usePermissions` | W1 |
| `DataTable` con orden y paginación | W1/W3 · la tabla del ranking |
| `Modal`, `Toast`, `PageHeader`, `Card`, `Badge`, `EmptyState`, `Skeleton` | `components/panel-ui.tsx`, `ui.tsx` |
| `maplibre-gl` **ya instalado y funcionando** | W6, `/rutas/[id]` · el mapa de visitas |
| BFF (`apiCall`, `proxyMutation`, `sameOrigin`) e i18n es/en | W0–W7 |
| Iconos SVG a mano (`Icon` de `panel-shell`) | W1 · **no hay librería de iconos y no hace falta** |
| 🎁 **El contrato de realtime YA EXISTE** en `shared/types/realtime.ts` | F8 · §12 |
| La cartera grande: 1200 deudores, 1577 créditos, 5610 agendados, 561 rutas | seed del 12/08 |

| NO existe | Consecuencia |
|---|---|
| 🔴 **Ningún endpoint de agregación. Ningún módulo `analytics`** | §3 — es la mitad de la etapa |
| 🔴 **Ningún modelo `Dashboard`/`DashboardWidget`** | Migración nueva + RLS |
| Librería de gráficos | D1 |
| Grid con arrastre y redimensión | D2 |
| `analytics.types.ts` en `shared` (el CLAUDE.md lo lista, **pero no está**) | Se crea en T0 |

## 3. 🔴 El hallazgo que ordena la etapa: la API no agrega nada *para nadie*

Los 14 módulos son de CRUD y listados: **no hay módulo `analytics` ni un solo endpoint que
devuelva un agregado**, y `report:read` existe como permiso pero **no lo usa ningún endpoint**
(cero apariciones en toda la API).

⚠️ Corrección de la ronda 1, que decía «ninguna consulta de agregación»: **sí hay dos `groupBy`**,
pero son internos y no los ve nadie —elegir el cobrador con menos casos abiertos
(`cases.service.ts:214`) y contar cuotas para la agenda (`agenda.service.ts:349`)—. Sirven de
precedente del patrón, no de contrato. Y hay `$queryRaw` en producción (la cartera de W3), así que
el SQL crudo no estrena nada.

Y la regla del móvil —«los KPIs se calculan siempre en el cliente», cerrada en `ui-screen-map §8.1`—
**no se puede portar acá**: la tomó un teléfono que mira la jornada de UN cobrador. El dashboard
mira el tenant entero, y con 1577 créditos, 5610 agendados y 4488 paradas, calcular en el navegador
significa **traerse la base por HTTP en cada carga**.

Consecuencia: **W8 es la segunda etapa del panel que toca la API** (la primera fue W5 con `sort`),
y lo que le agrega no es un parámetro: es un módulo entero. Eso cambia el reparto del trabajo —
más o menos la mitad de W8 es backend.

## 4. Contrato nuevo

### 4.1 `analytics` — seis lecturas, todas con los mismos filtros (`report:read`)

Toda consulta es **una sola** con `GROUP BY`, dentro de `withTenant` (RLS). Nada de N+1, y nada de
traer filas para contarlas en Node.

| Endpoint | Devuelve | Alimenta |
|---|---|---|
| `GET /analytics/summary` | saldo total, saldo en mora, % mora, casos activos, recaudado — **y los mismos cinco del período anterior**, que es de donde sale el «↑ 7,4 % vs semana anterior» | los 5 KPI |
| `GET /analytics/portfolio-aging` | saldo y cantidad por tramo de mora | dona + barras |
| `GET /analytics/collector-performance` | por cobrador: casos, saldo, en mora, % mora, recuperado | tabla del ranking |
| `GET /analytics/agenda-summary` | agendados por tipo y por estado + los indicadores de gestión | dona de agenda + lista |
| `GET /analytics/visit-map` | paradas del día con punto y estado | mapa |
| `GET /analytics/collection-trend` | serie por día/semana/mes: saldo y recaudado | gráfico de evolución |

**Los tramos de mora son los pedidos**: `1-30 · 31-90 · 91-180 · 181-360 · 361-450 · >450`. Salen de
`credits.days_past_due` y `credits.outstanding_balance`, que ya existen — **no se crea ninguna tabla
para esto** (§14 del pedido).

⚠️ Tres trampas heredadas de W3, que ya se pagaron una vez: el `deleted_at` de créditos va **en el
`ON`** del LEFT JOIN, el orden termina siempre en un id (sin desempate `LIMIT/OFFSET` repite filas)
y la columna de estado del cliente es `client_status`, no `status`.

### 4.2 `dashboards` — la persistencia (dos modelos nuevos + RLS)

```
Dashboard        id · accountId · name · description · isDefault · createdBy · timestamps
DashboardWidget  id · dashboardId · type · title · x · y · w · h · config(Json) · timestamps
```

`x/y/w/h` **como columnas y no dentro del Json**: son lo que más se escribe (cada arrastre) y lo
único que se va a querer consultar. `config` sí es Json: es distinto por tipo de widget.

Endpoints: `GET /dashboards`, `POST`, `GET /:id`, `PATCH /:id` (nombre, predeterminado **y el
layout completo en una sola llamada**), `DELETE /:id`, `POST /:id/duplicate`.

🔴 **Toda tabla operativa nueva lleva `account_id` y su política RLS.** La RLS de `clients` y
`credits` **no vive en `migrations/`** sino en `prisma/rls/001_enable_rls.sql`, que se aplica aparte
con `psql`: el archivo nuevo va ahí y hay que acordarse de correrlo, o la tabla queda sin aislar.

### 4.3 Lo que va a `shared`

`DashboardFilters` (`dateFrom`, `dateTo`, `branchId`, `collectorId`, `caseStatus`, `priority`), los
tipos de las seis respuestas, `WidgetType`, `WidgetLayout`, `DashboardDefinition`, y **los tramos de
mora como constante** (`AGING_BUCKETS`): si la API los corta de una forma y el panel los rotula de
otra, el gráfico miente y nadie lo nota.

## 5. Decisiones que necesito antes de escribir código

| # | Decisión | Mi recomendación |
|---|---|---|
| **D1** | **Gráficos: ¿a mano en SVG o una librería?** | **A mano.** Son dona, barras, línea y medidor: unas 40 líneas de SVG cada uno, con los tokens `k-*` de la marca y sin dependencia. Recharts son ~100 kB gz y trae su propia idea del diseño. Lo que sí regala una librería son **tooltips y ejes automáticos**; el mockup no los muestra. Si más adelante hacen falta, se cambia un widget sin tocar el resto — para eso está el registry |
| **D2** | **Arrastrar y redimensionar: ¿`react-grid-layout` o layout por presets?** | **`react-grid-layout`** (~30 kB). Escribir a mano arrastre + redimensión + colisiones + responsive no es ser lazy, es una semana de bugs. Es la única dependencia nueva que pediría |
| **D3** | **¿De quién es un dashboard: de la empresa o de cada persona?** | Del **tenant**, con `createdBy` para saber quién lo armó. Editar la vista general pide `report:read` + ser quien lo creó o admin. Un dashboard por persona duplica todo y nadie lo pidió |
| **D4** | **«Compartir» y «Presentar»** (están en el texto, **no en la imagen**) | **Fuera de W8.** Compartir es permisos de verdad (¿con quién? ¿link público?) y presentar es pantalla completa. El botón que sí entra es **+ Añadir widget** |
| **D5** | **¿Qué se corta si hay que cortar?** | El **builder**, no los números. Un dashboard fijo con datos reales sirve; un builder impecable sobre datos inventados, no. Por eso el orden de las tareas es API → pantalla fija → builder |

## 6. Pantalla

`/dashboard` — **ya existe** como aterrizaje mínimo y **es el destino post-login**: lo apuntan
`app/page.tsx`, `lib/client.ts` (`routeByStep`), `login/select-account`, la invitación y el ítem
`home` del menú. W8 la reemplaza.

⚠️ Es la ruta a la que cae **todo el mundo al entrar**: si revienta, el panel entero parece roto.
Su `error.tsx` y sus estados vacíos no son adorno.

Ya está en el matcher del middleware y en `nav.ts` (`home`), así que no hay ruta nueva que registrar.

## 7. Los widgets

**Doce tipos** (`kpi`, `line_chart`, `bar_chart`, `donut_chart`, `table`, `map`, `funnel`, `gauge`,
`calendar`, `list`, `histogram`, `text`) detrás de **un registry**: `widgetRegistry[type]` para
pintar y `widgetDefinitions` para el catálogo del botón «+ Añadir widget» (nombre, descripción,
icono, `defaultSize`). Sin un solo `if (type === ...)` desperdigado por la app.

**Los doce del dashboard por defecto**, tal cual la imagen: 5 KPI · dona de cartera por mora ·
barras por rango · dona de agenda · tabla de cobradores (Top 8) · mapa de visitas de hoy · lista de
indicadores de gestión · línea de evolución.

Grid de **12 columnas en escritorio, 8 en tablet, 1–2 en teléfono**, con `minW`/`minH` por tipo
(KPI 2×2, tabla y mapa 4×4) para que nadie deje un mapa de una columna de ancho.

**Cada widget se banca solo sus cuatro estados** —cargando, con datos, vacío, error—. Un spinner
global tapando todo es lo que hace que un dashboard se sienta lento aunque no lo sea.

## 8. Tareas

| # | Tarea | Sale verde con |
|---|---|---|
| T0 | `shared`: filtros, tipos de las 6 respuestas, `WidgetType`, `WidgetLayout`, `AGING_BUCKETS` | shared build + tests |
| T1 | API: módulo `analytics` con los 6 endpoints (`report:read`), agregando en SQL | specs del servicio + type-check |
| T2 | API: migración `dashboards` + `dashboard_widgets` + **su RLS** + CRUD | migración aplicada + specs |
| T3 | Seed: **pagos coherentes** (bajan el saldo) y casos `PAID`/`CLOSED`. Hoy hay 15 pagos y ningún caso pagado: los KPI de recaudación y el gráfico de evolución **medirían el vacío** | correr el seed y mirar los números |
| T4 | Web: `DashboardShell` + header + filtros globales + grid en modo Ver, con datos reales de T1 | pantalla + tests de `lib/dashboard` |
| T5 | Web: los widgets de datos (KPI, dona, barras, línea, tabla, lista, mapa) con sus 4 estados | pantalla |
| T6 | Web: registry + renderer + catálogo «+ Añadir widget» | test del registry |
| T7 | Web: modo Editar — arrastrar, redimensionar, duplicar, borrar, configurar; guardado con `debounce` | pantalla + test del debounce |
| T8 | Web: varios dashboards (crear, renombrar, duplicar, borrar, predeterminado) | pantalla |

**T3 va antes que la pantalla, y no es un detalle**: sin pagos, tres de los cinco KPI y el gráfico
de evolución muestran cero, y no hay forma de saber si es un bug o es el dato.

## 9. Filtros

Van **arriba de los KPI**, no abajo, y afectan a **todos** los widgets: fecha (con presets: hoy,
ayer, 7 días, 30 días, este mes, mes anterior, personalizado), sucursal, cobrador, estado y
prioridad. Viajan en la URL, como en todo el panel.

🔴 **Un filtro que no discrimina nada no se dibuja.** Hoy el tenant tiene **cero sucursales**, así
que el selector de sucursal **no aparece** — y el de cobrador sí, porque hay 11. Es la regla del
pedido (§6) y se puede comprobar el primer día.

## 10. Tests

| Qué | Dónde |
|---|---|
| Los tramos de mora: que 450 caiga en `361-450` y 451 en `>450` | `shared`, junto a la constante |
| Que cada agregación sea **una consulta**, con su `where` de tenant y el `deleted_at` en el `ON` | specs de la API, mirando el SQL |
| El período anterior (de dónde sale el «vs semana anterior») | idem |
| Que el layout se guarde **una vez** y no una por pixel | test del `debounce` |
| El registry: un tipo desconocido no revienta la pantalla | `widget-registry.test.ts` |

## 11. Trampas y riesgos

- 🔴 **`/dashboard` es el aterrizaje de todo el mundo.** Romperla es romper el panel entero.
- 🔴 **Es la etapa más grande del F9 y toca los tres paquetes.** Si algo se cae, que sea el builder
  (D5), nunca los números.
- ⚠️ **La RLS de la tabla nueva no va sola en la migración**: vive en `prisma/rls/` y se aplica con
  `psql`. Grepear las migraciones y no encontrarla hace pensar que falta.
- ⚠️ **El mapa es `maplibre-gl` y son 250 kB**: hoy los paga sólo `/rutas/[id]`. En el dashboard se
  carga **diferido**, o el aterrizaje del panel engorda para todos, incluido quien no mira el mapa.
- ⚠️ **Tocar `shared` obliga a reiniciar el `dev`** de la web (`resolve.symlinks=false`).
- ⚠️ Las de siempre: `next build` con el `dev` apagado · `-LiteralPath` con `[id]` en PowerShell ·
  `git commit -F` y **nunca `git add` a ciegas** (en W6 se coló un documento ajeno; en W7 casi).

## 12. Fuera de alcance

- **Realtime (W9).** No entra `socket.io-client`. Y no hay que inventar ninguna interfaz para
  prepararlo: **`shared/types/realtime.ts` ya existe** desde F8, con los nombres de evento
  (`case.updated`, `payment.registered`, `collector.location`) y sus payloads. W9 se enchufa ahí.
- **Compartir y presentar** (D4).
- **Exportar a PDF/Excel.** `report:export` existe como permiso y no lo usa nadie; es su propia
  etapa.
- **Widgets sin dato detrás**: `funnel`, `gauge`, `calendar`, `histogram` y `text` entran al
  catálogo y al registry, pero el dashboard por defecto no los usa. Prometer un embudo sin definir
  de qué es el embudo es dibujar un widget vacío.
