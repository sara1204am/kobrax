/**
 * Contrato de `/analytics` — lo que el dashboard pregunta y lo que la API contesta.
 *
 * 🔴 **La API agrega, el panel dibuja.** Es la decisión que ordena W8 y se aparta a propósito de la
 * del móvil («los KPIs se calculan en el cliente»): ésa la tomó un teléfono que mira la jornada de
 * UN cobrador. Acá se mira el tenant entero —1500 créditos, 5500 agendados— y calcularlo en el
 * navegador es traerse la base por HTTP en cada carga.
 *
 * Las seis respuestas viven acá porque las escribe la API y las lee el panel; una copia a mano en
 * cada lado deriva sin que nadie lo note.
 */
import type { AgingBucketCode } from '../utils/aging.js';

/**
 * Los filtros globales de la pantalla. **Los seis viajan a los seis endpoints**: un widget que
 * ignore uno muestra otra cosa que sus vecinos y nadie sabe cuál de los dos miente.
 */
export interface DashboardFilters {
  /** `YYYY-MM-DD`. Sin rango, cada endpoint usa el suyo por defecto. */
  dateFrom?: string;
  dateTo?: string;
  branchId?: string;
  collectorId?: string;
  caseStatus?: string;
  priority?: string;
}

/**
 * Un número del encabezado con su comparación.
 *
 * `previous` es el MISMO número en el período anterior de igual largo, y viene del servidor: es de
 * donde sale el «↑ 7,4 % vs semana anterior». Calcular la variación en el panel obligaría a pedir
 * el período viejo por separado desde cada widget.
 */
export interface KpiValue {
  value: number;
  previous: number;
}

export interface AnalyticsSummary {
  outstanding: KpiValue;
  overdue: KpiValue;
  /** Porcentaje 0-100, no una fracción: es lo que se muestra y así no se redondea dos veces. */
  overdueRate: KpiValue;
  activeCases: KpiValue;
  collected: KpiValue;
  currency: string;
}

export interface AgingBucketRow {
  bucket: AgingBucketCode;
  amount: number;
  credits: number;
}

export interface CollectorPerformanceRow {
  collectorId: string;
  cases: number;
  outstanding: number;
  overdue: number;
  /** 0-100. Lo calcula el servidor, que es el que tiene los dos números exactos. */
  overdueRate: number;
  collected: number;
}

export interface AgendaSummary {
  byType: { type: string; total: number }[];
  byStatus: { status: string; total: number }[];
  /** Los «indicadores de gestión»: visitas y llamadas hechas, contactos, promesas, pagos. */
  indicators: { code: string; value: number; previous: number }[];
}

/** Una parada del día con su punto. Sin coordenada no viaja: el mapa no la puede dibujar. */
export interface VisitMapPoint {
  stopId: string;
  clientId: string;
  latitude: number;
  longitude: number;
  status: string;
  sequenceOrder: number;
  collectorId: string;
}

export interface TrendPoint {
  /** `YYYY-MM-DD` — el primer día del punto, sea día, semana o mes. */
  date: string;
  outstanding: number;
  collected: number;
}

export type TrendGranularity = 'day' | 'week' | 'month';
