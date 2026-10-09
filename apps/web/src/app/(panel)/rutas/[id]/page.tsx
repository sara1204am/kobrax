import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  isOpenStop,
  memberName,
  Permission,
  summarizeDay,
  todayISO,
  type ArrearCategory,
  type DayPayment,
  type MeInfo,
  type Member,
  type MoraCreditListItem,
  type RouteChangeRequestItem,
  type RouteItem,
  type VisitItem,
} from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { getAgendaSummary } from '@/lib/agenda-summary';
import { CATEGORY_TONE, ROUTE_STATUS_TONE } from '@/lib/routes';
import { availableQuery, hasPlanFilters, shiftDays, toAvailable, type PlanParams } from '@/lib/plan';
import { Badge, Card, EmptyState, PageHeader } from '@/components/panel-ui';
import { dayDate, money } from '@/lib/format';
import { RouteEditor } from './route-editor';
import { RouteActions } from './route-actions';
import { NextStopCard } from './next-stop-card';
import { ChangeRequestsPanel } from './change-requests-panel';

/** Techo de lo que se trae de un día —pagos y visitas—. Un día de un tenant no llega a tanto. */
const DAY_LIMIT = 100;

/**
 * El detalle de una ruta: **el centro de supervisión de la jornada** (F4/12) — cómo viene, qué sigue, qué se puede
 * hacer con ella (iniciar, completar, cancelar, optimizar) y cada parada con su acción.
 *
 * ⚠️ Esta llamada **revela las direcciones en claro y la API lo audita**. Es lo que hace útil la
 * pantalla —una lista de paradas sin dirección no dice adónde fue nadie— y por eso se pide acá y
 * no para pintar el listado.
 *
 * La cuenta la hace `summarizeDay` de `shared`, la MISMA que corre el teléfono: es la única cuenta
 * del día, y existe porque dos pantallas del mismo día decían cosas distintas.
 *
 * 🔴 **Qué botones se ven lo dice la API** (`capabilities`), no se deduce acá del rol: quien armó la ruta, su cobrador,
 * el administrador y el resto tienen cada uno lo suyo, y repetir esa regla en el panel es repartirla en dos lugares.
 */
export default async function RutaPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: PlanParams & { editar?: string };
}) {
  const t = await getTranslations('panel.routes');
  const locale = await getLocale();

  const detail = await apiCall<RouteItem>(`/routes/${params.id}`, { method: 'GET', auth: true });
  if (detail.status === 404) notFound();
  if (detail.status !== 200 || !detail.body.data) {
    return <EmptyState title={t('title')} text={detail.body.error?.message} />;
  }
  const route = detail.body.data;
  const day = route.plannedDate.slice(0, 10);
  const closed = route.status === 'COMPLETED' || route.status === 'CANCELLED';
  const caps = route.capabilities ?? {
    isOwner: false,
    start: false,
    complete: false,
    cancel: false,
    cancelBlockedByVisits: false,
    edit: false,
    requestChange: false,
    recordVisit: false,
  };

  /*
   * Los pagos se piden **por crédito**, uno por parada, y no con una ventana del día.
   *
   * Dos motivos, los dos aprendidos a los golpes: `from`/`to` con la misma fecha arman una ventana
   * de ancho CERO —`paymentDate` es un timestamp, así que sólo entraría un pago hecho a medianoche
   * exacta— y el «recaudado» daba siempre 0. Y pidiendo el día entero del tenant, una sola página
   * de 100 puede dejar afuera pagos de esta ruta y mostrar MENOS plata de la que entró, sin avisar.
   *
   * Por crédito es exacto y acotado: son tantas llamadas como paradas con crédito, y una parada no junta
   * cien pagos en un día. Sin `payment:read` vuelven vacías y se muestra cero cobrado, que es lo
   * que ese rol puede saber.
   *
   * 🔴 **Pero acotado AL DÍA de la ruta.** Sin `from`/`to`, «Recaudado» sumaba todos los pagos que
   * ese crédito tuvo alguna vez: una ruta planificada para mañana, con cero paradas gestionadas, decía
   * que había recaudado mil cuatrocientos bolivianos. `summarizeDay` filtra por crédito, no por fecha —
   * da por hecho que los pagos que recibe son los del día.
   *
   * ponytail: la ventana es en UTC y el día del tenant es el de Bolivia (UTC−4). Un pago después de
   * las 20:00 cae en el día siguiente de esta cuenta. Se arregla el día que `TenantClockService`
   * —que ya existe y usa la agenda— llegue a pagos; hasta entonces el error es de horas, no de meses.
   */
  const creditIds = [...new Set((route.stops ?? []).map((s) => s.creditId).filter((id): id is string => !!id))];

  /*
   * 🔴 Los créditos en mora que se pueden sumar **sólo se piden al editar**: son cien créditos, y
   * quien entra a mirar cómo terminó la jornada no los necesita. Es la misma consulta que arma la
   * ruta la primera vez (`GET /mora`), acotada a la cartera del cobrador de ESTA ruta salvo que se
   * pida ayuda de todo el equipo; los que ya son parada de esta ruta se descartan abajo.
   */
  const editing = searchParams.editar === '1' && (caps.edit || caps.requestChange);
  const planParams: PlanParams = { ...searchParams, collectorId: route.collectorId };

  const [me, team, paymentsByCredit, preview, visits, available, categories, requests, agendaToday] = await Promise.all([
    apiCall<MeInfo>('/auth/me', { method: 'GET', auth: true }),
    apiCall<Member[]>('/users', { method: 'GET', auth: true }),
    Promise.all(
      creditIds.map((creditId) =>
        apiCall<DayPayment[]>(`/payments?creditId=${creditId}&from=${day}&to=${shiftDays(day, 1)}&limit=${DAY_LIMIT}`, {
          method: 'GET',
          auth: true,
        }),
      ),
    ),
    /*
     * El recorrido por las calles. Sale de un motor de ruteo que corre en su propio contenedor, así
     * que **puede no estar**: si falla, las paradas se siguen listando y el mapa une los puntos con
     * rectas punteadas. El mapa es un extra, no el contenido.
     *
     * ponytail: se pide en cada visita a la ficha. Desde F4/12 ese GET ya no escribe si el valor no cambió ni en una ruta
     * cerrada, pero sigue registrando el revelado de datos personales: el arreglo de fondo es que `preview` no los
     * devuelva, y eso es de la API.
     */
    apiCall<{ geometry: { latitude: number; longitude: number }[] }>(`/routes/${params.id}/preview`, {
      method: 'GET',
      auth: true,
    }),
    // Las visitas de esta ruta: el punto donde se registró cada una (W6-T0).
    apiCall<VisitItem[]>(`/visits?routeId=${params.id}&limit=${DAY_LIMIT}`, { method: 'GET', auth: true }),
    /*
     * La mora que se puede sumar: **siempre que la ruta siga abierta**, porque de ahí salen las sugerencias del mapa
     * (mora sin ruta cerca de las paradas). Mirando, va sin filtros —sólo la cartera de este cobrador y la que tiene de
     * ayuda—; al editar, con los que la persona puso.
     */
    !closed
      ? apiCall<MoraCreditListItem[]>(`/mora?${availableQuery(editing ? planParams : { collectorId: route.collectorId }, day)}`, { method: 'GET', auth: true })
      : null,
    editing ? apiCall<ArrearCategory[]>('/arrear-categories', { method: 'GET', auth: true }) : null,
    // Los pedidos de cambio: los ve quien manda sobre la ruta y quien pide.
    caps.isOwner || caps.requestChange
      ? apiCall<RouteChangeRequestItem[]>(`/routes/${params.id}/change-requests`, { method: 'GET', auth: true })
      : null,
    getAgendaSummary(),
  ]);

  const members = team.body.data ?? [];
  const collector = members.find((m) => m.userId === route.collectorId);
  const collectorName = collector ? memberName(collector) : t('unknownCollector');
  const summary = summarizeDay(route, paymentsByCredit.flatMap((r) => r.body.data ?? []));
  const stops = route.stops ?? [];
  const openStops = stops.filter((s) => isOpenStop(s.status as never));
  const next = openStops[0];
  // Lo que ya es parada de ESTA ruta no se ofrece de nuevo (además del `excludeRouted` del servidor).
  const enRuta = new Set(creditIds);
  const disponibles = (available?.body.data ?? []).filter((c) => !enRuta.has(c.creditId)).map(toAvailable);
  const perms = me.body.data?.permissions ?? [];
  const viewerIsCollector = !!me.body.data && me.body.data.userId === route.collectorId;
  const today = agendaToday?.date ?? todayISO();
  // Un punto en (0, 0) es el «sin ubicación» de una visita cargada desde el panel: no se dibuja en el mapa.
  const visitPoints = (visits.body.data ?? [])
    .filter((v) => v.latitude !== 0 || v.longitude !== 0)
    .map((v) => ({ latitude: v.latitude, longitude: v.longitude }));

  return (
    <>
      <PageHeader
        title={collectorName}
        // El día de la ruta no tiene hora: formateado en la zona local se corría un día para atrás.
        subtitle={dayDate(route.plannedDate, locale)}
        // El estado va al lado del nombre: dice QUÉ ES esta ruta, no es una acción. A la derecha
        // quedaba a media pantalla de aquello que califica.
        badge={<Badge tone={ROUTE_STATUS_TONE[route.status]} dot>{t(`status.${route.status}`)}</Badge>}
        actions={
          <div className="flex flex-col items-end gap-2">
            <RouteActions
              routeId={route.id}
              status={route.status}
              capabilities={caps}
              openStops={openStops.length}
              viewerIsCollector={viewerIsCollector}
            />
            {/* Navegación llana: el navegador maneja la descarga con el `Content-Disposition` del
                backend. Mismo revelado auditado que ya paga esta pantalla al pedir el detalle. */}
            <a href={`/api/routes/${route.id}/pdf`} className="text-[13px] font-medium text-k-purple hover:underline">
              {t('detail.downloadPdf')}
            </a>
          </div>
        }
      />

      <div className="space-y-6">
        <Card>
          {/*
           * 🔴 **Cuatro números y una barra, no cuatro rótulos iguales.** Antes el avance era un «0%»
           * suelto al lado de «0 de 4», con el mismo peso que el resto: había que leer los cuatro
           * para saber cómo venía el día. Lo que se viene a mirar es cuánto entró y cuánto falta.
           */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[15px] font-semibold text-k-navy">{t('detail.summary')}</p>

            {/* Sólo las categorías con al menos una parada: un cero no cuenta nada y ocupa lugar. */}
            {summary.categories.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {summary.categories.map((c) => (
                  <li key={c.key}>
                    <Badge tone={CATEGORY_TONE[c.key]}>
                      {t(`category.${c.key}`)} · {c.count}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat tone="money" label={t('detail.collected')} value={money(summary.collected, summary.currency)} strong />
            <Stat tone="work" label={t('detail.done')} value={t('progress', { done: summary.done, total: summary.total })} />
            <Stat tone="pending" label={t('detail.pending')} value={String(openStops.length)} />
            <Stat
              tone="map"
              label={t('detail.distance')}
              value={route.totalDistanceKm != null ? t('km', { n: route.totalDistanceKm.toFixed(1) }) : null}
              // Sin distancia se dice por qué no la hay: un «—» parece un cero o un dato perdido.
              empty={t('detail.noDistance')}
            />
          </dl>

          {/*
           * La barra dice de un vistazo lo que el «0 de 4» dice leyendo. 🔴 El número va igual al
           * lado: el color no es el dato —hay quien no lo distingue—, y una barra sin cifra obliga a
           * calcular a ojo cuántas paradas faltan.
           */}
          <div className="mt-5 flex items-center gap-3">
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={summary.percent}
              aria-label={t('detail.percent')}
              className="h-2.5 flex-1 overflow-hidden rounded-full bg-k-light-bg"
            >
              <div
                className={`h-full rounded-full ${
                  summary.percent === 100 ? 'bg-k-success' : 'bg-gradient-to-r from-k-periwinkle to-k-purple'
                }`}
                style={{ width: `${summary.percent}%` }}
              />
            </div>
            <span className="shrink-0 text-[13px] font-medium tabular-nums text-k-text-2">{summary.percent}%</span>
          </div>

          {/* El motivo escrito de un cierre con paradas sin gestionar, o de una cancelación: queda a la vista. */}
          {route.statusReason && closed && (
            <p className="mt-4 rounded-lg border border-k-border bg-k-bg px-3 py-2 text-[13px] text-k-text-2">
              <span className="font-medium text-k-text">
                {route.status === 'CANCELLED' ? t('detail.cancelledReason') : t('detail.reasonOfClose')}:
              </span>{' '}
              {route.statusReason}
            </p>
          )}
        </Card>

        {!closed && (
          <NextStopCard
            routeId={route.id}
            stop={next}
            canRecord={caps.recordVisit}
            collectorName={collectorName}
            viewerIsCollector={viewerIsCollector}
            canPay={perms.includes(Permission.PAYMENT_WRITE)}
            today={today}
          />
        )}

        <ChangeRequestsPanel routeId={route.id} requests={requests?.body.data ?? []} isOwner={caps.isOwner} viewerId={me.body.data?.userId} />

        {/*
         * El mapa, las paradas y su edición: todo junto en el cliente. El orden, el quitar y el
         * sumar necesitan estado, y media lista pintada en el servidor y media acá son dos lugares
         * donde arreglar el mismo detalle.
         */}
        {stops.length > 0 || editing ? (
          <RouteEditor
            routeId={route.id}
            stops={stops}
            visits={visitPoints}
            line={preview.body.data?.geometry ?? []}
            editing={editing}
            available={disponibles}
            total={Math.max(0, (available?.body.meta?.total ?? disponibles.length) - (available?.body.data?.length ?? 0) + disponibles.length)}
            filtered={hasPlanFilters(planParams)}
            categories={(categories?.body.data ?? []).map((c) => ({ code: c.code, name: c.name }))}
            capabilities={caps}
            collectorName={collectorName}
            viewerIsCollector={viewerIsCollector}
            canPay={perms.includes(Permission.PAYMENT_WRITE)}
            today={today}
          />
        ) : (
          <section>
            <h2 className="mb-3 text-[18px] font-semibold text-k-navy">{t('detail.stops')}</h2>
            <EmptyState title={t('detail.stopsEmpty')} />
          </section>
        )}
      </div>
    </>
  );
}

/**
 * Los colores del resumen: la plata, el trabajo, lo que falta y el mapa.
 *
 * 🔴 El color va en el **fondo y en la línea de abajo**, nunca en el número: sobre estos tintes, un
 * verde de 24 px queda por debajo del contraste mínimo. El dato se lee en navy en todas, y el
 * color sirve para encontrar la tarjeta de un vistazo, no para decir qué dice.
 */
const STAT_TONES = {
  money: 'border-b-k-success bg-k-success-bg',
  work: 'border-b-k-purple bg-k-highlight',
  pending: 'border-b-k-warning bg-k-warning-bg',
  map: 'border-b-k-periwinkle bg-k-light-bg',
} as const;

/**
 * Un número del resumen del día. Distinto de `Fact`: acá el valor **es** lo que se viene a mirar, así
 * que se lee de lejos, y el que falta se explica en vez de mostrar un guión.
 */
function Stat({
  label,
  value,
  empty,
  strong,
  tone,
}: {
  label: string;
  value: string | null;
  empty?: string;
  /** El número principal de la tarjeta. Uno solo: si todos gritan, ninguno destaca. */
  strong?: boolean;
  tone: keyof typeof STAT_TONES;
}) {
  // Los bordes se declaran por lado: `border-k-border` pinta los cuatro, y que el color de abajo lo
  // pise dependería del orden en el que Tailwind emita las reglas.
  return (
    <div
      className={`rounded-xl border-x border-t border-b-4 border-x-k-border border-t-k-border px-4 py-3.5 ${STAT_TONES[tone]}`}
    >
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-k-slate">{label}</dt>
      <dd
        className={`mt-1.5 tabular-nums ${
          value === null
            ? 'text-[15px] text-k-text-2'
            : strong
              ? 'text-[24px] font-semibold leading-tight text-k-navy'
              : 'text-[20px] font-medium leading-tight text-k-navy'
        }`}
      >
        {value ?? empty}
      </dd>
    </div>
  );
}
