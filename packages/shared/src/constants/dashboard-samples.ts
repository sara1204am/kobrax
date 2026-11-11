import type { WidgetType } from '../types/dashboard.types.js';

/**
 * Los tres tableros de ejemplo con los que arranca cada persona: **Indicadores**, **Gráficos** y **Agenda**.
 *
 * Son sólo un punto de partida: se crean una vez, la primera vez que alguien abre el dashboard, y desde ahí son SUYOS
 * (los renombra, los borra o arma otros). `config.metric` es lo que el renderer usa para elegir qué dato pinta cada widget.
 */
export interface DashboardSampleWidget {
  type: WidgetType;
  x: number;
  y: number;
  w: number;
  h: number;
  config: Record<string, unknown>;
}

export interface DashboardSample {
  name: string;
  widgets: DashboardSampleWidget[];
}

export const DASHBOARD_SAMPLES: readonly DashboardSample[] = [
  {
    name: 'Indicadores',
    widgets: [
      { type: 'kpi', x: 0, y: 0, w: 12, h: 2, config: { metric: 'strip' } },
      { type: 'list', x: 0, y: 2, w: 5, h: 5, config: { metric: 'indicators' } },
      { type: 'table', x: 5, y: 2, w: 7, h: 5, config: { metric: 'collectors' } },
    ],
  },
  {
    name: 'Gráficos',
    widgets: [
      { type: 'donut_chart', x: 0, y: 0, w: 4, h: 5, config: { metric: 'aging' } },
      { type: 'bar_chart', x: 4, y: 0, w: 4, h: 5, config: { metric: 'agingBars' } },
      { type: 'donut_chart', x: 8, y: 0, w: 4, h: 5, config: { metric: 'agenda' } },
      { type: 'line_chart', x: 0, y: 5, w: 12, h: 5, config: { metric: 'trend' } },
    ],
  },
  {
    name: 'Agenda',
    widgets: [
      { type: 'calendar', x: 0, y: 0, w: 8, h: 6, config: { metric: 'agendaToday' } },
      { type: 'donut_chart', x: 8, y: 0, w: 4, h: 6, config: { metric: 'agenda' } },
      { type: 'map', x: 0, y: 6, w: 12, h: 5, config: { metric: 'visits' } },
    ],
  },
];
