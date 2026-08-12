import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  memberName,
  summarizeDay,
  type DayPayment,
  type Member,
  type RouteItem,
  type RouteStopItem,
  type VisitItem,
} from '@kobrax/shared';
import { RouteMap } from '@/components/route-map';
import { apiCall } from '@/lib/bff';
import { CATEGORY_TONE, ROUTE_STATUS_TONE, STOP_STATUS_TONE } from '@/lib/routes';
import { Badge, Card, EmptyState, Fact, PageHeader } from '@/components/panel-ui';
import { date, money } from '@/lib/format';

/** Techo de pagos del día que se traen para la cuenta. Un día de un tenant no llega a tanto. */
const PAYMENTS_LIMIT = 100;

/**
 * El detalle de una ruta: sus paradas en orden y cómo terminó el día.
 *
 * ⚠️ Esta llamada **revela las direcciones en claro y la API lo audita**. Es lo que hace útil la
 * pantalla —una lista de paradas sin dirección no dice adónde fue nadie— y por eso se pide acá y
 * no para pintar el listado.
 *
 * La cuenta la hace `summarizeDay` de `shared`, la MISMA que corre el teléfono: es la única cuenta
 * del día, y existe porque dos pantallas del mismo día decían cosas distintas.
 */
export default async function RutaPage({ params }: { params: { id: string } }) {
  const t = await getTranslations('panel.routes');
  const locale = await getLocale();

  const detail = await apiCall<RouteItem>(`/routes/${params.id}`, { method: 'GET', auth: true });
  if (detail.status === 404) notFound();
  if (detail.status !== 200 || !detail.body.data) {
    return <EmptyState title={t('title')} text={detail.body.error?.message} />;
  }
  const route = detail.body.data;
  const day = route.plannedDate.slice(0, 10);

  const [team, payments, preview, visits] = await Promise.all([
    apiCall<Member[]>('/users', { method: 'GET', auth: true }),
    /*
     * Los pagos del día **de todo el tenant**: así los devuelve la API, y `summarizeDay` se queda
     * sólo con los de las paradas de esta ruta. Sin ese filtro, el «recaudado» mostraría lo que
     * cobró otra persona. Sin `payment:read` la lista viene vacía y la cuenta muestra cero cobrado,
     * que es lo que este rol puede saber.
     */
    apiCall<DayPayment[]>(`/payments?from=${day}&to=${day}&limit=${PAYMENTS_LIMIT}`, {
      method: 'GET',
      auth: true,
    }),
    /*
     * El recorrido por las calles. Sale de un motor de ruteo que corre en su propio contenedor, así
     * que **puede no estar**: si falla, las paradas se siguen listando y el mapa une los puntos con
     * rectas punteadas. El mapa es un extra, no el contenido.
     */
    apiCall<{ geometry: { latitude: number; longitude: number }[] }>(`/routes/${params.id}/preview`, {
      method: 'GET',
      auth: true,
    }),
    // Las visitas de esta ruta: el punto donde se registró cada una (W6-T0).
    apiCall<VisitItem[]>(`/visits?routeId=${params.id}&limit=${PAYMENTS_LIMIT}`, { method: 'GET', auth: true }),
  ]);

  const members = team.body.data ?? [];
  const collector = members.find((m) => m.userId === route.collectorId);
  const summary = summarizeDay(route, payments.body.data ?? []);
  const stops = route.stops ?? [];

  return (
    <>
      <PageHeader
        title={collector ? memberName(collector) : t('unknownCollector')}
        subtitle={date(route.plannedDate, locale)}
        actions={<Badge tone={ROUTE_STATUS_TONE[route.status]}>{t(`status.${route.status}`)}</Badge>}
      />

      <div className="space-y-6">
        <Card>
          <p className="text-[15px] font-semibold text-k-navy">{t('detail.summary')}</p>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label={t('detail.collected')} value={money(summary.collected, summary.currency)} />
            <Fact label={t('detail.done')} value={t('progress', { done: summary.done, total: summary.total })} />
            <Fact label={t('detail.percent')} value={`${summary.percent}%`} />
            <Fact
              label={t('detail.distance')}
              value={route.totalDistanceKm != null ? t('km', { n: route.totalDistanceKm.toFixed(1) }) : '—'}
            />
          </dl>

          {/* Sólo las categorías con al menos una parada: un cero no cuenta nada y ocupa lugar. */}
          {summary.categories.length > 0 && (
            <ul className="mt-5 flex flex-wrap gap-2">
              {summary.categories.map((c) => (
                <li key={c.key}>
                  <Badge tone={CATEGORY_TONE[c.key]}>
                    {t(`category.${c.key}`)} · {c.count}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <RouteMap
          stops={stops.map((s) => ({
            id: s.id,
            sequenceOrder: s.sequenceOrder,
            latitude: s.latitude,
            longitude: s.longitude,
            label: s.clientName,
          }))}
          visits={(visits.body.data ?? []).map((v) => ({
            id: v.id,
            latitude: v.latitude,
            longitude: v.longitude,
          }))}
          line={preview.body.data?.geometry ?? []}
        />
        {/* El motor de ruteo vive en otro contenedor y puede no estar levantado. Se dice, en vez de
            dejar un mapa con rectas sin explicar por qué. */}
        {preview.status !== 200 && <p className="text-[13px] text-k-text-2">{t('detail.noPreview')}</p>}

        <section>
          <h2 className="mb-3 text-[18px] font-semibold text-k-navy">{t('detail.stops')}</h2>
          {stops.length > 0 ? (
            <ol className="space-y-2">
              {stops.map((stop) => (
                <Stop key={stop.id} routeId={route.id} stop={stop} />
              ))}
            </ol>
          ) : (
            <EmptyState title={t('detail.stopsEmpty')} />
          )}
        </section>
      </div>
    </>
  );
}

/** Una parada de la ruta. Abre su detalle, que es donde vive la evidencia. */
async function Stop({ routeId, stop }: { routeId: string; stop: RouteStopItem }) {
  const t = await getTranslations('panel.routes');

  return (
    <li>
      <Link
        href={`/rutas/${routeId}/parada/${stop.id}`}
        className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-k-border bg-white px-5 py-3.5 hover:bg-k-bg"
      >
        <span className="w-8 shrink-0 text-[14px] font-semibold tabular-nums text-k-navy">{stop.sequenceOrder}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium text-k-text">{stop.clientName ?? '—'}</span>
          {/* La dirección viene en claro y su revelado quedó auditado al abrir la ruta. */}
          <span className="block truncate text-[13px] text-k-text-2">{stop.address ?? '—'}</span>
        </span>
        {/* Cómo terminó pesa más que en qué estado quedó la parada: es lo que se vino a mirar. */}
        {stop.lastOutcome ? (
          <Badge tone="neutral">{t(`outcome.${stop.lastOutcome}`)}</Badge>
        ) : (
          <Badge tone={STOP_STATUS_TONE[stop.status]}>{t(`stopStatus.${stop.status}`)}</Badge>
        )}
      </Link>
    </li>
  );
}
