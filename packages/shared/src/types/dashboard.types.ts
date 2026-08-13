/**
 * Contrato de los dashboards: **qué widgets hay, dónde están y cómo se guardan**.
 *
 * Un dashboard no es una pantalla escrita a mano: es una lista de widgets con su posición. Por eso
 * «Vista general», «Cobranza» y «Campo» son el mismo código con distinto contenido, y agregar uno
 * nuevo no es programar otra pantalla.
 */

/** Los doce tipos del catálogo. El registry del panel mapea cada uno a su componente. */
export const WIDGET_TYPES = [
  'kpi',
  'line_chart',
  'bar_chart',
  'donut_chart',
  'table',
  'map',
  'funnel',
  'gauge',
  'calendar',
  'list',
  'histogram',
  'text',
] as const;

export type WidgetType = (typeof WIDGET_TYPES)[number];

/**
 * La posición en la grilla de 12 columnas.
 *
 * `minW`/`minH` no son un lujo: un mapa o una tabla de una columna de ancho no muestran nada, y
 * quien arrastra no tiene por qué saberlo.
 */
export interface WidgetLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}

export interface DashboardWidget {
  id: string;
  type: WidgetType;
  title: string;
  layout: WidgetLayout;
  /** Lo propio de cada tipo (métrica, agrupación, cuántas filas). Distinto por widget, por eso libre. */
  config: Record<string, unknown>;
}

export interface DashboardDefinition {
  id: string;
  name: string;
  description?: string;
  /** El que abre por defecto. Uno solo por cuenta; ponerlo en otro apaga el anterior. */
  isDefault: boolean;
  createdBy?: string;
  widgets: DashboardWidget[];
}

/** Lo que se manda al guardar: nombre, predeterminado y **el layout entero en una sola llamada**. */
export interface DashboardPatch {
  name?: string;
  description?: string | null;
  isDefault?: boolean;
  widgets?: DashboardWidget[];
}
