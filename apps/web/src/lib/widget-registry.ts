import type { DashboardWidget, WidgetType } from '@kobrax/shared';

/**
 * El catálogo de widgets: **qué existe, cómo se llama y de qué tamaño nace**.
 *
 * Vive separado del renderer a propósito. Esto es data —lo consume el buscador del botón «+ Añadir
 * widget», el panel de configuración y el layout por defecto—; el renderer es el que sabe qué
 * componente pintar. Juntos serían un archivo que no se puede importar desde el servidor sin
 * arrastrar todos los widgets con él.
 *
 * `labelKey` es la clave de i18n, no el texto: el panel es bilingüe.
 */
export interface WidgetDefinition {
  type: WidgetType;
  labelKey: string;
  /** El tamaño con el que entra al tablero. Después se redimensiona. */
  defaultSize: { w: number; h: number };
  minSize: { w: number; h: number };
  /**
   * De qué fuente vive. `null` = **todavía no tiene dato detrás**: entra al catálogo y al registry,
   * pero al soltarlo dice qué le falta en vez de dibujar una caja vacía que parece rota.
   */
  source: 'summary' | 'aging' | 'agenda' | 'collectors' | 'visits' | 'trend' | 'agendaToday' | null;
}

export const WIDGET_DEFINITIONS: WidgetDefinition[] = [
  { type: 'kpi', labelKey: 'kpi', defaultSize: { w: 2, h: 2 }, minSize: { w: 2, h: 2 }, source: 'summary' },
  { type: 'donut_chart', labelKey: 'donut', defaultSize: { w: 4, h: 4 }, minSize: { w: 3, h: 3 }, source: 'aging' },
  { type: 'bar_chart', labelKey: 'bars', defaultSize: { w: 4, h: 4 }, minSize: { w: 3, h: 3 }, source: 'aging' },
  { type: 'table', labelKey: 'table', defaultSize: { w: 5, h: 5 }, minSize: { w: 4, h: 4 }, source: 'collectors' },
  { type: 'map', labelKey: 'map', defaultSize: { w: 4, h: 5 }, minSize: { w: 4, h: 4 }, source: 'visits' },
  { type: 'list', labelKey: 'list', defaultSize: { w: 3, h: 5 }, minSize: { w: 3, h: 3 }, source: 'agenda' },
  { type: 'line_chart', labelKey: 'line', defaultSize: { w: 12, h: 5 }, minSize: { w: 4, h: 4 }, source: 'trend' },
  // «Agenda de hoy»: el tipo `calendar` del contrato. No necesitó tipo nuevo ni cambio en la API.
  { type: 'calendar', labelKey: 'calendar', defaultSize: { w: 8, h: 6 }, minSize: { w: 5, h: 5 }, source: 'agendaToday' },
  // Los cuatro de abajo existen en el catálogo y **no tienen fuente todavía**. Prometer un embudo sin
  // definir de qué es el embudo es dibujar un widget vacío; entran igual para que agregar el dato
  // después no obligue a tocar el registry ni la grilla.
  { type: 'funnel', labelKey: 'funnel', defaultSize: { w: 4, h: 4 }, minSize: { w: 3, h: 3 }, source: null },
  { type: 'gauge', labelKey: 'gauge', defaultSize: { w: 3, h: 3 }, minSize: { w: 2, h: 2 }, source: null },
  { type: 'histogram', labelKey: 'histogram', defaultSize: { w: 4, h: 4 }, minSize: { w: 3, h: 3 }, source: null },
  { type: 'text', labelKey: 'text', defaultSize: { w: 3, h: 2 }, minSize: { w: 2, h: 1 }, source: null },
];

/**
 * Lo que el selector «Añadir widget» ofrece: **contenido concreto, no tipos de gráfico**.
 *
 * «KPI» o «Embudo» a secas no le dicen a nadie qué va a ver. Cada entrada es un tipo + la métrica que el
 * renderer lee de `config.metric`, con nombre y descripción propios (`panel.dashboard.catalogItems.<id>`).
 * Los tipos sin fuente de datos (embudo, medidor, histograma, texto) no se ofrecen: siguen en
 * `WIDGET_DEFINITIONS` para que un tablero ya guardado con ellos se abra, pero prometerlos acá sería
 * ofrecer una caja vacía.
 */
export interface CatalogItem {
  /** Clave de i18n y de búsqueda; también identifica al widget recién creado. */
  id: string;
  type: WidgetType;
  config: Record<string, string>;
  /** Tamaño propio cuando difiere del natural del tipo (la tira de KPIs va a todo el ancho). */
  size?: { w: number; h: number };
}

export const CATALOG_ITEMS: CatalogItem[] = [
  { id: 'kpiStrip', type: 'kpi', config: { metric: 'strip' }, size: { w: 12, h: 2 } },
  { id: 'kpiOutstanding', type: 'kpi', config: { metric: 'outstanding' } },
  { id: 'kpiOverdue', type: 'kpi', config: { metric: 'overdue' } },
  { id: 'kpiOverdueRate', type: 'kpi', config: { metric: 'overdueRate' } },
  { id: 'kpiCreditsInArrears', type: 'kpi', config: { metric: 'creditsInArrears' } },
  { id: 'kpiCollected', type: 'kpi', config: { metric: 'collected' } },
  { id: 'agingDonut', type: 'donut_chart', config: { metric: 'aging' } },
  { id: 'agingBars', type: 'bar_chart', config: { metric: 'agingBars' } },
  { id: 'agendaDonut', type: 'donut_chart', config: { metric: 'agenda' } },
  { id: 'indicatorsList', type: 'list', config: { metric: 'indicators' } },
  { id: 'collectorsTable', type: 'table', config: { metric: 'collectors' } },
  { id: 'visitsMap', type: 'map', config: { metric: 'visits' } },
  { id: 'trendLine', type: 'line_chart', config: { metric: 'trend' } },
  { id: 'agendaToday', type: 'calendar', config: { metric: 'agendaToday' } },
];

const BY_TYPE = new Map(WIDGET_DEFINITIONS.map((d) => [d.type, d]));

export function widgetDefinition(type: string): WidgetDefinition | undefined {
  return BY_TYPE.get(type as WidgetType);
}

/**
 * El tablero que se ve cuando la cuenta **todavía no guardó ninguno**.
 *
 * No se siembra en la base: si se sembrara, una cuenta nueva arrancaría con filas que nadie pidió y
 * borrar el tablero dejaría la pantalla vacía para siempre. Acá es un valor por defecto — se guarda
 * recién cuando alguien toca algo y aprieta guardar.
 *
 * Los `config.metric` son los que el renderer usa para elegir qué dato mostrar.
 */
export const DEFAULT_WIDGETS: DashboardWidget[] = [
  // Una sola tira con saldo, cartera en mora (monto y %), créditos en mora y recaudo.
  { id: 'w-kpis', type: 'kpi', title: '', layout: { x: 0, y: 0, w: 12, h: 2 }, config: { metric: 'strip' } },
  { id: 'w-today', type: 'calendar', title: '', layout: { x: 0, y: 2, w: 8, h: 6 }, config: { metric: 'agendaToday' } },
  { id: 'w-aging', type: 'donut_chart', title: '', layout: { x: 8, y: 2, w: 4, h: 6 }, config: { metric: 'aging' } },
  { id: 'w-bars', type: 'bar_chart', title: '', layout: { x: 0, y: 8, w: 4, h: 4 }, config: { metric: 'agingBars' } },
  { id: 'w-agenda', type: 'donut_chart', title: '', layout: { x: 4, y: 8, w: 4, h: 4 }, config: { metric: 'agenda' } },
  { id: 'w-ind', type: 'list', title: '', layout: { x: 8, y: 8, w: 4, h: 4 }, config: { metric: 'indicators' } },
  { id: 'w-team', type: 'table', title: '', layout: { x: 0, y: 12, w: 5, h: 5 }, config: { metric: 'collectors' } },
  { id: 'w-map', type: 'map', title: '', layout: { x: 5, y: 12, w: 7, h: 5 }, config: { metric: 'visits' } },
  { id: 'w-trend', type: 'line_chart', title: '', layout: { x: 0, y: 17, w: 12, h: 5 }, config: { metric: 'trend' } },
];
