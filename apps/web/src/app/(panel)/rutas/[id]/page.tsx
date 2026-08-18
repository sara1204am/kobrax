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
import { dayDate, money, time } from '@/lib/format';

/** Techo de lo que se trae de un día —pagos y visitas—. Un día de un tenant no llega a tanto. */
const DAY_LIMIT = 100;

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

  /*
   * Los pagos se piden **por caso**, uno por parada, y no con una ventana del día.
   *
   * Dos motivos, los dos aprendidos a los golpes: `from`/`to` con la misma fecha arman una ventana
   * de ancho CERO —`paymentDate` es un timestamp, así que sólo entraría un pago hecho a medianoche
   * exacta— y el «recaudado» daba siempre 0. Y pidiendo el día entero del tenant, una sola página
   * de 100 puede dejar afuera pagos de esta ruta y mostrar MENOS plata de la que entró, sin avisar.
   *
   * Por caso es exacto y acotado: son tantas llamadas como paradas con caso, y una parada no junta
   * cien pagos en un día. Sin `payment:read` vuelven vacías y se muestra cero cobrado, que es lo
   * que ese rol puede saber.
   */
  const caseIds = [...new Set((route.stops ?? []).map((s) => s.caseId).filter((id): id is string => !!id))];

  const [team, paymentsByCase, preview, visits] = await Promise.all([
    apiCall<Member[]>('/users', { method: 'GET', auth: true }),
    Promise.all(
      caseIds.map((caseId) =>
        apiCall<DayPayment[]>(`/payments?caseId=${caseId}&limit=${DAY_LIMIT}`, { method: 'GET', auth: true }),
      ),
    ),
    /*
     * El recorrido por las calles. Sale de un motor de ruteo que corre en su propio contenedor, así
     * que **puede no estar**: si falla, las paradas se siguen listando y el mapa une los puntos con
     * rectas punteadas. El mapa es un extra, no el contenido.
     *
     * ponytail: se pide en cada visita a la ficha, y del otro lado ese GET **escribe** la distancia
     * en la ruta y registra un segundo revelado de PII. Se acepta porque el recorrido por calles es
     * lo que justifica el mapa; el arreglo de fondo es que `preview` no escriba ni audite —es una
     * lectura— y eso es de la API, no del panel.
     */
    apiCall<{ geometry: { latitude: number; longitude: number }[] }>(`/routes/${params.id}/preview`, {
      method: 'GET',
      auth: true,
    }),
    // Las visitas de esta ruta: el punto donde se registró cada una (W6-T0).
    apiCall<VisitItem[]>(`/visits?routeId=${params.id}&limit=${DAY_LIMIT}`, { method: 'GET', auth: true }),
  ]);

  const members = team.body.data ?? [];
  const collector = members.find((m) => m.userId === route.collectorId);
  const summary = summarizeDay(route, paymentsByCase.flatMap((r) => r.body.data ?? []));
  const stops = route.stops ?? [];

  return (
    <>
      <PageHeader
        title={collector ? memberName(collector) : t('unknownCollector')}
        // El día de la ruta no tiene hora: formateado en la zona local se corría un día para atrás.
        subtitle={dayDate(route.plannedDate, locale)}
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
          visits={(visits.body.data ?? []).map((v) => ({ latitude: v.latitude, longitude: v.longitude }))}
          line={preview.body.data?.geometry ?? []}
        />
        {/*
          🔴 Se mira la GEOMETRÍA, no el status: cuando el motor de ruteo está caído la API **degrada
          con 200 y una geometría vacía**, así que preguntar por el status dejaba el aviso sin
          dibujarse nunca — justo el «mapa con rectas y sin explicación» que se quería evitar.
        */}
        {!preview.body.data?.geometry?.length && (
          <p className="text-[13px] text-k-text-2">{t('detail.noPreview')}</p>
        )}

        <section>
          <h2 className="mb-3 text-[18px] font-semibold text-k-navy">{t('detail.stops')}</h2>
          {stops.length > 0 ? (
            <ol className="space-y-2">
              {stops.map((stop) => (
                <Stop key={stop.id} routeId={route.id} stop={stop} locale={locale} />
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
async function Stop({ routeId, stop, locale }: { routeId: string; stop: RouteStopItem; locale: string }) {
  const t = await getTranslations('panel.routes');

  return (
    <li>
      <Link
        href={`/rutas/${routeId}/parada/${stop.id}`}
        className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-k-border bg-white px-5 py-3.5 hover:bg-k-bg"
      >
        {/*
         * 🔴 **La hora en vez del número, cuando ya se visitó.** El orden planificado deja de
         * importar apenas la jornada arranca: lo que se viene a mirar es a qué hora se pasó por cada
         * puerta, que es lo que reconstruye el día —y lo que delata una mañana entera en una zona—.
         * Sin visitar sigue el número: es lo único que hay, y dice en qué lugar de la fila está.
         */}
        <span className="w-12 shrink-0 text-[14px] font-semibold tabular-nums text-k-navy">
          {stop.visitedAt ? time(stop.visitedAt, locale) : stop.sequenceOrder}
        </span>
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
