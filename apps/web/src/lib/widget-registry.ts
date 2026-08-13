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
  source: 'summary' | 'aging' | 'agenda' | 'collectors' | 'visits' | 'trend' | null;
}

export const WIDGET_DEFINITIONS: WidgetDefinition[] = [
  { type: 'kpi', labelKey: 'kpi', defaultSize: { w: 2, h: 2 }, minSize: { w: 2, h: 2 }, source: 'summary' },
  { type: 'donut_chart', labelKey: 'donut', defaultSize: { w: 4, h: 4 }, minSize: { w: 3, h: 3 }, source: 'aging' },
  { type: 'bar_chart', labelKey: 'bars', defaultSize: { w: 4, h: 4 }, minSize: { w: 3, h: 3 }, source: 'aging' },
  { type: 'table', labelKey: 'table', defaultSize: { w: 5, h: 5 }, minSize: { w: 4, h: 4 }, source: 'collectors' },
  { type: 'map', labelKey: 'map', defaultSize: { w: 4, h: 5 }, minSize: { w: 4, h: 4 }, source: 'visits' },
  { type: 'list', labelKey: 'list', defaultSize: { w: 3, h: 5 }, minSize: { w: 3, h: 3 }, source: 'agenda' },
  { type: 'line_chart', labelKey: 'line', defaultSize: { w: 12, h: 5 }, minSize: { w: 4, h: 4 }, source: 'trend' },
  // Los cinco de abajo existen en el catálogo y **no tienen fuente todavía**. Prometer un embudo sin
  // definir de qué es el embudo es dibujar un widget vacío; entran igual para que agregar el dato
  // después no obligue a tocar el registry ni la grilla.
  { type: 'funnel', labelKey: 'funnel', defaultSize: { w: 4, h: 4 }, minSize: { w: 3, h: 3 }, source: null },
  { type: 'gauge', labelKey: 'gauge', defaultSize: { w: 3, h: 3 }, minSize: { w: 2, h: 2 }, source: null },
  { type: 'calendar', labelKey: 'calendar', defaultSize: { w: 4, h: 4 }, minSize: { w: 3, h: 3 }, source: null },
  { type: 'histogram', labelKey: 'histogram', defaultSize: { w: 4, h: 4 }, minSize: { w: 3, h: 3 }, source: null },
  { type: 'text', labelKey: 'text', defaultSize: { w: 3, h: 2 }, minSize: { w: 2, h: 1 }, source: null },
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
  kpi('outstanding', 0),
  kpi('overdue', 2),
  kpi('overdueRate', 4),
  kpi('activeCases', 6),
  kpi('collected', 8),
  { id: 'w-aging', type: 'donut_chart', title: '', layout: { x: 0, y: 2, w: 4, h: 4 }, config: { metric: 'aging' } },
  { id: 'w-bars', type: 'bar_chart', title: '', layout: { x: 4, y: 2, w: 4, h: 4 }, config: { metric: 'agingBars' } },
  { id: 'w-agenda', type: 'donut_chart', title: '', layout: { x: 8, y: 2, w: 4, h: 4 }, config: { metric: 'agenda' } },
  { id: 'w-team', type: 'table', title: '', layout: { x: 0, y: 6, w: 5, h: 5 }, config: { metric: 'collectors' } },
  { id: 'w-map', type: 'map', title: '', layout: { x: 5, y: 6, w: 4, h: 5 }, config: { metric: 'visits' } },
  { id: 'w-ind', type: 'list', title: '', layout: { x: 9, y: 6, w: 3, h: 5 }, config: { metric: 'indicators' } },
  { id: 'w-trend', type: 'line_chart', title: '', layout: { x: 0, y: 11, w: 12, h: 5 }, config: { metric: 'trend' } },
];

function kpi(metric: string, x: number): DashboardWidget {
  return { id: `w-${metric}`, type: 'kpi', title: '', layout: { x, y: 0, w: 2, h: 2 }, config: { metric } };
}
