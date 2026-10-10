import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type {
  AgendaSummary,
  AgendaTodaySummary,
  AgingBucketRow,
  AnalyticsSummary,
  CollectorPerformanceRow,
  DashboardWidget,
  KpiValue,
  Member,
  TrendPoint,
  VisitMapPoint,
} from '@kobrax/shared';
import { widgetDefinition } from '@/lib/widget-registry';
import { money, percent } from '@/lib/format';
import { WidgetFrame } from './widget-frame';
import { KpiWidget } from './widgets/kpi-widget';
import { KpiStrip } from './widgets/kpi-strip';
import { AgingBars, AgingDonut } from './widgets/aging-widgets';
import { AgendaToday } from './agenda-today';
import { AgendaDonut, IndicatorsList } from './widgets/agenda-widgets';
import { CollectorsTable } from './widgets/collectors-table';
import { TrendChart } from './widgets/trend-chart';
import { VisitMapWidget } from './widgets/visit-map-widget';

/** Lo que la pantalla ya trajo. El renderer **no pide nada**: reparte. */
export interface DashboardData {
  summary?: AnalyticsSummary;
  aging?: AgingBucketRow[];
  collectors?: CollectorPerformanceRow[];
  agenda?: AgendaSummary;
  /** `GET /agenda/summary`: lo de hoy. `undefined` sin `agenda:read`. */
  today?: AgendaTodaySummary;
  visits?: VisitMapPoint[];
  trend?: TrendPoint[];
  members: Member[];
  currency: string;
  /** El día que dibuja el mapa: es el final del período, no el período entero. */
  day: string;
  errors: Record<string, string | undefined>;
}

const KPI_KEYS = ['outstanding', 'overdue', 'overdueRate', 'creditsInArrears', 'collected'] as const;

/** El tinte de cada tarjeta: rojo para lo que es mora, verde para lo cobrado, neutro para el saldo. */
const KPI_TONE: Record<(typeof KPI_KEYS)[number], 'neutral' | 'danger' | 'success'> = {
  outstanding: 'neutral',
  overdue: 'danger',
  overdueRate: 'danger',
  creditsInArrears: 'danger',
  collected: 'success',
};

/** Los tableros ya guardados pueden traer la métrica `activeCases` (la API ya no la entrega): se lee como `creditsInArrears`. */
const KPI_ALIASES: Record<string, (typeof KPI_KEYS)[number]> = { activeCases: 'creditsInArrears' };

/**
 * Un widget, pintado.
 *
 * 🔴 **Un solo lugar decide qué componente corresponde a cada tipo.** Repartido en `if`s por la
 * pantalla, agregar un widget obligaría a tocar la grilla, el catálogo y el renderer a la vez — y
 * el que se olvide deja un hueco silencioso.
 *
 * Un tipo que la base tenga y el panel no conozca **no rompe la pantalla**: se dibuja su marco con
 * el aviso. Puede pasar de verdad: el tablero se guarda con una versión del panel y se abre con otra.
 */
export async function WidgetRenderer({
  widget,
  data,
  editable,
  actions,
}: {
  widget: DashboardWidget;
  data: DashboardData;
  editable: boolean;
  actions?: React.ReactNode;
}) {
  const t = await getTranslations('panel.dashboard');
  const metric = String(widget.config?.metric ?? '');
  const def = widgetDefinition(widget.type);
  const frame = (title: string, body: React.ReactNode, error?: string, empty?: string) => (
    <WidgetFrame title={widget.title || title} actions={actions} editable={editable} error={error} empty={empty}>
      {body}
    </WidgetFrame>
  );

  // Sin fuente de datos el widget existe pero no tiene qué mostrar: se dice, no se dibuja vacío.
  if (def && def.source === null) return frame(t(`catalog.${def.labelKey}`), null, undefined, t('noSource'));

  switch (widget.type) {
    case 'kpi': {
      // La tira: cuatro indicadores en un solo widget (el tablero por defecto).
      if (metric === 'strip') {
        return (
          <WidgetFrame
            title={widget.title || t('widgets.kpiStrip')}
            actions={actions}
            editable={editable}
            tile="none"
            error={data.errors.summary}
            empty={data.summary ? undefined : t('error')}
          >
            {data.summary ? <KpiStrip summary={data.summary} trend={data.trend} currency={data.currency} /> : null}
          </WidgetFrame>
        );
      }
      const wanted = KPI_ALIASES[metric] ?? metric;
      const key = (KPI_KEYS as readonly string[]).includes(wanted) ? (wanted as (typeof KPI_KEYS)[number]) : 'outstanding';
      const kpi: KpiValue | undefined = data.summary?.[key];
      const format =
        key === 'overdueRate' ? percent : key === 'creditsInArrears' ? (v: number) => v.toLocaleString('es-BO') : (v: number) => money(v, data.currency);
      // D7: saldo, mora y recaudo llevan su desglose por fuente. La tasa y los créditos en mora no: una tasa
      // partida no suma, y los créditos en mora no son plata de nadie.
      const partKey = key === 'outstanding' || key === 'overdue' || key === 'collected' ? key : null;
      const parts = partKey
        ? data.summary?.bySource.map((s) => ({ label: t(`sources.${s.source}`), value: format(s[partKey]) }))
        : undefined;
      const label = widget.title || t(`kpi.${key}`);
      return (
        <WidgetFrame
          title={label}
          actions={actions}
          editable={editable}
          tile={KPI_TONE[key]}
          error={data.errors.summary}
          empty={kpi ? undefined : t('error')}
        >
          {kpi ? <KpiWidget kpi={kpi} format={format} parts={parts} label={label} /> : null}
        </WidgetFrame>
      );
    }

    case 'donut_chart':
      if (metric === 'agenda') {
        return frame(
          t('widgets.agenda'),
          data.agenda ? <AgendaDonut summary={data.agenda} /> : null,
          data.errors.agenda,
        );
      }
      return frame(
        t('widgets.aging'),
        data.aging ? <AgingDonut rows={data.aging} currency={data.currency} /> : null,
        data.errors.aging,
      );

    case 'bar_chart':
      return frame(t('widgets.agingBars'), data.aging ? <AgingBars rows={data.aging} /> : null, data.errors.aging);

    case 'table':
      return frame(
        t('widgets.collectors'),
        data.collectors ? (
          <CollectorsTable rows={data.collectors} members={data.members} currency={data.currency} />
        ) : null,
        data.errors.collectors,
      );

    case 'map':
      return frame(
        t('widgets.map'),
        data.visits ? <VisitMapWidget points={data.visits} day={data.day} /> : null,
        data.errors.visits,
      );

    case 'list':
      return frame(
        t('widgets.indicators'),
        data.agenda ? <IndicatorsList summary={data.agenda} /> : null,
        data.errors.agenda,
      );

    case 'calendar':
      // «Agenda de hoy»: sin `agenda:read` no hay resumen y el widget lo dice en vez de dibujarse vacío.
      return (
        <WidgetFrame
          title={widget.title || t('agendaToday.title')}
          actions={actions}
          editable={editable}
          aside={
            <Link href="/agenda" className="text-[13px] font-medium text-k-periwinkle hover:underline">
              {t('agendaToday.view')} →
            </Link>
          }
          empty={data.today ? undefined : t('agendaToday.noAccess')}
        >
          {data.today ? <AgendaToday summary={data.today} /> : null}
        </WidgetFrame>
      );

    case 'line_chart':
      return frame(
        t('widgets.trend'),
        data.trend ? <TrendChart points={data.trend} currency={data.currency} /> : null,
        data.errors.trend,
      );

    default:
      return frame(widget.type, null, undefined, t('unknownWidget'));
  }
}
