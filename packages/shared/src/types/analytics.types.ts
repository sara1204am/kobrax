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
  /**
   * Los tres de selección múltiple: **una lista, no un valor**.
   *
   * Mirar la cobranza es comparar —dos cobradores de la misma zona, los casos vencidos *y* los que
   * prometieron pagar—, y con un solo valor por filtro eso obliga a mirar de a uno y sumar de
   * memoria. Viajan a la API separados por coma, que es lo que `String(lista)` ya escribe.
   */
  collectorId?: string[];
  caseStatus?: string[];
  priority?: string[];
}

/**
 * Un número del encabezado con su comparación.
 *
 * `previous` es el MISMO número en el período anterior de igual largo, y lo calcula el servidor: es
 * de donde sale el «↑ 7,4 % vs semana anterior». Pedirlo desde cada widget sería pedir dos veces.
 *
 * 🔴 **`null` = no se puede saber, y no es lo mismo que cero.** Los saldos son una FOTO de hoy: la
 * base no guarda cuánto se debía la semana pasada, así que reconstruirlo sería inventar el número
 * que la pantalla presenta como dato duro. Con `null` la flecha no se dibuja.
 *
 * ponytail: la comparación honesta de un saldo necesita una foto diaria (`portfolio_snapshots`).
 * Es su propia etapa; hasta entonces, sólo comparan los flujos —lo recaudado— y los casos activos,
 * que sí se pueden reconstruir con `created_at`/`closed_at`.
 */
export interface KpiValue {
  value: number;
  previous: number | null;
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
  collected: number;
  /**
   * El saldo **reconstruido hacia atrás**: el de hoy más todo lo que se cobró después de esa fecha.
   *
   * ⚠️ Es la curva de lo que la cobranza bajó, no la historia del saldo: **ignora los desembolsos y
   * los castigos posteriores**. Con una foto diaria dejaría de ser una reconstrucción — misma
   * deuda que `KpiValue.previous`.
   */
  outstanding: number;
}

export type TrendGranularity = 'day' | 'week' | 'month';
