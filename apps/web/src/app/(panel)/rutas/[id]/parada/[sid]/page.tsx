import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  GPS_FALLBACK_KEY,
  memberName,
  Permission,
  RouteStopStatus,
  todayISO,
  type EvidenceItem,
  type MeInfo,
  type Member,
  type RouteItem,
  type RouteStopItem,
  type VisitDetail,
  type VisitItem,
} from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { getAgendaSummary } from '@/lib/agenda-summary';
import { STOP_STATUS_TONE } from '@/lib/routes';
import { Badge, Card, EmptyState, Fact, PageHeader } from '@/components/panel-ui';
import { dateTime, money, time } from '@/lib/format';
import { StopRecordButton } from './stop-actions';
import { WhatsAppButton } from '../../whatsapp-button';

const TABS = ['info', 'credit', 'locations', 'visits', 'evidence'] as const;
type Tab = (typeof TABS)[number];

/**
 * Una parada, su cliente y **la prueba de que alguien estuvo ahí** (F4/12).
 *
 * Es la pantalla que W6 vino a hacer posible: hasta T0, la foto, el punto y el hash no eran alcanzables desde ningún
 * lado. La visita y su evidencia **son inmutables** —`field_visits` y `field_evidences` no tienen `updated_at` ni
 * `deleted_at`—, así que acá no hay nada que editar ni borrar. Es justo lo que las vuelve prueba, y la pantalla lo dice:
 * lo que se puede hacer es **registrar la gestión** que falta o **corregir** una con una visita nueva que dice cuál corrige.
 *
 * Cinco pestañas, que viven en la URL (`?tab=`): lo que se ve al abrir es el historial si la parada ya se visitó, y la
 * información si todavía no.
 */
export default async function ParadaPage({
  params,
  searchParams,
}: {
  params: { id: string; sid: string };
  searchParams: { tab?: string };
}) {
  const t = await getTranslations('panel.routes');
  const ts = await getTranslations('panel.routes.stopPage');
  const tl = await getTranslations('portfolio.locationType');
  const locale = await getLocale();

  // No hay `GET /stops/:id`: la parada sale de su ruta, que además valida el alcance de un saque.
  const [route, visits, me, team, agendaToday] = await Promise.all([
    apiCall<RouteItem>(`/routes/${params.id}`, { method: 'GET', auth: true }),
    apiCall<VisitItem[]>(`/visits?routeStopId=${params.sid}`, { method: 'GET', auth: true }),
    apiCall<MeInfo>('/auth/me', { method: 'GET', auth: true }),
    apiCall<Member[]>('/users', { method: 'GET', auth: true }),
    getAgendaSummary(),
  ]);

  if (route.status === 404) notFound();
  if (route.status !== 200 || !route.body.data) {
    return <EmptyState title={t('title')} text={route.body.error?.message} />;
  }
  const data = route.body.data;
  const stop = data.stops?.find((s) => s.id === params.sid);
  if (!stop) notFound();

  /*
   * El listado de visitas no trae evidencias —traerlas para pintar una tabla sería tráfico que
   * nadie mira—, así que el detalle de cada una se pide aparte. Una parada normalmente tiene una;
   * dos si se corrigió.
   */
  const details = await Promise.all(
    (visits.body.data ?? []).map((v) =>
      apiCall<VisitDetail>(`/visits/${v.id}`, { method: 'GET', auth: true }).then((r) => r.body.data),
    ),
  );
  const registered = details.filter((v): v is VisitDetail => v != null).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const evidences = registered.flatMap((v) => v.evidences.map((e) => ({ evidence: e, visit: v })));

  const members = team.body.data ?? [];
  const nameOf = (id?: string) => {
    const m = members.find((x) => x.userId === id);
    return m ? memberName(m) : undefined;
  };
  const collectorName = nameOf(data.collectorId) ?? t('unknownCollector');
  const caps = data.capabilities;
  const viewerIsCollector = me.body.data?.userId === data.collectorId;
  const canPay = (me.body.data?.permissions ?? []).includes(Permission.PAYMENT_WRITE);
  const today = agendaToday?.date ?? todayISO();
  const visited = stop.status === RouteStopStatus.VISITED;
  const canRecord = !!caps?.recordVisit && !!stop.creditId;
  const tab: Tab = (TABS as readonly string[]).includes(searchParams.tab ?? '') ? (searchParams.tab as Tab) : visited ? 'visits' : 'info';
  const recordStop = {
    id: stop.id,
    creditId: stop.creditId,
    clientName: stop.clientName,
    address: stop.address,
    latitude: stop.latitude,
    longitude: stop.longitude,
    overdueAmount: stop.overdueAmount,
    currency: stop.currency,
    externalSource: stop.externalSource,
  };
  const href = (to: Tab) => `/rutas/${params.id}/parada/${params.sid}?tab=${to}`;

  return (
    <>
      <Link href={`/rutas/${params.id}`} className="mb-3 inline-block text-[13px] font-medium text-k-slate hover:underline">
        ← {ts('back')}
      </Link>
      <PageHeader
        title={stop.clientName ?? t('stop.sequence', { n: stop.sequenceOrder })}
        subtitle={[t('stop.sequence', { n: stop.sequenceOrder }), stop.creditId ? ts('daysLate', { n: stop.daysPastDue ?? 0 }) : null].filter(Boolean).join(' · ')}
        badge={<Badge tone={STOP_STATUS_TONE[stop.status]}>{t(`stopStatus.${stop.status}`)}</Badge>}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-3">
            {stop.creditId && (
              <Link href={`/mora/${stop.creditId}`} className="text-[13px] font-medium text-k-purple hover:underline">
                {t('detail.openMora')}
              </Link>
            )}
            <Link href={`/cartera/${stop.clientId}`} className="text-[13px] font-medium text-k-purple hover:underline">
              {t('detail.openClient')}
            </Link>
            <WhatsAppButton clientId={stop.clientId} clientName={stop.clientName} />
            {canRecord && !visited && (
              <StopRecordButton stop={recordStop} collectorName={collectorName} viewerIsCollector={viewerIsCollector} canPay={canPay} today={today} />
            )}
          </div>
        }
      />

      <nav aria-label={ts('tabsLabel')} className="mb-5 flex flex-wrap gap-1 border-b border-k-border">
        {TABS.map((id) => (
          <Link
            key={id}
            href={href(id)}
            aria-current={tab === id ? 'page' : undefined}
            className={`-mb-px border-b-2 px-4 py-2.5 text-[14px] font-medium ${
              tab === id ? 'border-k-navy text-k-navy' : 'border-transparent text-k-text-2 hover:text-k-text'
            }`}
          >
            {ts(`tabs.${id}`)}
            {id === 'visits' && registered.length > 0 && <span className="ml-1.5 text-[12px] text-k-muted">{registered.length}</span>}
            {id === 'evidence' && evidences.length > 0 && <span className="ml-1.5 text-[12px] text-k-muted">{evidences.length}</span>}
          </Link>
        ))}
      </nav>

      {tab === 'info' && (
        <Card>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label={t('stop.address')} value={stop.address ?? '—'} />
            <Fact label={ts('place')} value={placeOf(stop, tl)} />
            <Fact label={ts('hour')} value={stop.visitedAt ? time(stop.visitedAt, locale) : (stop.scheduledTime ?? '—')} />
            <Fact label={t('stop.debt')} value={stop.overdueAmount != null ? money(stop.overdueAmount, stop.currency ?? 'BOB') : '—'} />
            <Fact label={t('stop.daysPastDue')} value={stop.daysPastDue != null ? String(stop.daysPastDue) : '—'} />
            <Fact label={ts('lastResult')} value={stop.lastOutcome ? t(`outcome.${stop.lastOutcome}`) : t('stop.notVisited')} />
          </dl>
          {stop.agendaItemId && <p className="mt-4 text-[13px] text-k-text-2">{ts('fromAgenda')}</p>}
        </Card>
      )}

      {tab === 'credit' && (
        <Card>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label={t('stop.debt')} value={stop.overdueAmount != null ? money(stop.overdueAmount, stop.currency ?? 'BOB') : '—'} />
            <Fact label={t('stop.daysPastDue')} value={stop.daysPastDue != null ? String(stop.daysPastDue) : '—'} />
            <Fact label={ts('source')} value={stop.externalSource ?? 'Kobrax'} />
          </dl>
          {stop.externalSource && <p className="mt-3 text-[13px] text-k-warning-text">{ts('externalHint')}</p>}
          <div className="mt-4">
            {stop.creditId ? (
              <Link href={`/mora/${stop.creditId}`} className="text-[14px] font-medium text-k-purple hover:underline">
                {ts('creditFull')}
              </Link>
            ) : (
              <p className="text-[14px] text-k-text-2">{ts('noCredit')}</p>
            )}
          </div>
        </Card>
      )}

      {tab === 'locations' && (
        <Card>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label={ts('place')} value={placeOf(stop, tl)} />
            <Fact label={t('stop.address')} value={stop.address ?? ts('noAddress')} />
            <Fact label={ts('point')} value={stop.latitude != null && stop.longitude != null ? `${stop.latitude.toFixed(5)}, ${stop.longitude.toFixed(5)}` : ts('noPoint')} />
          </dl>
          <Link href={`/cartera/${stop.clientId}`} className="mt-4 inline-block text-[14px] font-medium text-k-purple hover:underline">
            {ts('allLocations')}
          </Link>
        </Card>
      )}

      {tab === 'visits' && (
        <div className="space-y-4">
          {registered.length === 0 ? (
            <EmptyState title={t('stop.notVisited')} />
          ) : (
            registered.map((visit) => (
              <Visit
                key={visit.id}
                visit={visit}
                locale={locale}
                registeredByName={nameOf(visit.registeredBy)}
                collectorName={collectorName}
                fix={
                  canRecord && !visit.correctsVisitId ? (
                    <StopRecordButton
                      stop={recordStop}
                      collectorName={collectorName}
                      viewerIsCollector={viewerIsCollector}
                      canPay={canPay}
                      today={today}
                      correctsVisitId={visit.id}
                      variant="ghost"
                    />
                  ) : null
                }
              />
            ))
          )}
          {registered.length > 0 && <p className="text-[13px] text-k-text-2">{t('stop.immutable')}</p>}
        </div>
      )}

      {tab === 'evidence' &&
        (evidences.length > 0 ? (
          <ul className="grid gap-4 sm:grid-cols-2">
            {evidences.map(({ evidence }) => (
              <Evidence key={evidence.id} evidence={evidence} locale={locale} />
            ))}
          </ul>
        ) : (
          <EmptyState title={t('stop.evidenceEmpty')} />
        ))}
    </>
  );
}

/** «Garante · Juan Pérez», «Domicilio», o nada si la parada es anterior a F4/12 y no guarda su ubicación. */
function placeOf(stop: RouteStopItem, label: (key: string) => string): string {
  if (!stop.locationType) return '—';
  const type = label(stop.locationType);
  return stop.locationOwner ? `${type} · ${stop.locationOwner}` : type;
}

async function Visit({
  visit,
  locale,
  registeredByName,
  collectorName,
  fix,
}: {
  visit: VisitDetail;
  locale: string;
  registeredByName?: string;
  collectorName: string;
  fix: React.ReactNode;
}) {
  const t = await getTranslations('panel.routes');
  const ts = await getTranslations('panel.routes.stopPage');
  // El servidor lo DERIVA además de creerle al cliente: el punto es la ubicación conocida de la
  // parada y no una lectura del GPS. Sin decirlo, una auditoría lo leería como GPS real.
  const estimated = visit.details[GPS_FALLBACK_KEY] === true;
  // Cargada desde el panel por alguien que no es el cobrador: se dice quién, para que el rastro sea honesto.
  const byOther = visit.registeredBy && visit.registeredBy !== visit.collectorId;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-k-navy">
          {t(`outcome.${visit.outcome}`)}
          {visit.correctsVisitId && <Badge tone="warning">{ts('correction')}</Badge>}
        </p>
        <p className="flex items-center gap-3 text-[13px] text-k-text-2">
          {dateTime(visit.capturedAt, locale)}
          {fix}
        </p>
      </div>

      {(byOther || visit.source === 'WEB') && (
        <p className="mt-2 text-[13px] text-k-text-2">
          {byOther ? ts('loadedBy', { name: registeredByName ?? ts('someone'), collector: collectorName }) : ts('loadedFromPanel')}
        </p>
      )}

      <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Fact label="GPS" value={`${visit.latitude.toFixed(5)}, ${visit.longitude.toFixed(5)}`} />
        <Fact label={t('stop.accuracy')} value={visit.accuracy != null ? `± ${visit.accuracy} m` : '—'} />
      </dl>
      {estimated && <p className="mt-2 text-[13px] text-k-warning-text">{t('stop.gpsEstimated')}</p>}

      {visit.notes && (
        <div className="mt-5">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-k-text-2">{t('stop.notes')}</p>
          <p className="mt-1 text-[15px] text-k-text">{visit.notes}</p>
        </div>
      )}

      {visit.evidences.length > 0 && (
        <p className="mt-4 text-[13px] text-k-text-2">{ts('withEvidence', { n: visit.evidences.length })}</p>
      )}
    </Card>
  );
}

async function Evidence({ evidence, locale }: { evidence: EvidenceItem; locale: string }) {
  const t = await getTranslations('panel.routes');
  // La firma se retiró del panel (decisión 14): solo la foto se dibuja; cualquier otra evidencia vieja se muestra como enlace.
  const isImage = evidence.type === 'PHOTO';

  return (
    <li className="rounded-2xl border border-k-border bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[14px] font-medium text-k-text">{t(`evidenceType.${evidence.type}`)}</span>
        <span className="text-[13px] text-k-text-2">{dateTime(evidence.capturedAt, locale)}</span>
      </div>

      {/*
        🔴 `fileUrl` ya ES la ruta: `uploads` devuelve `/api/uploads/<nombre>` y el móvil guarda eso
        tal cual. Anteponer el prefijo otra vez daba `/api/uploads//api/uploads/...` y ninguna foto
        se veía. Y en el panel esa misma ruta pega en SU handler, que proxea con el Bearer — la
        única puerta que valida el tenant.

        Sólo se dibuja lo que apunta a nuestra ruta: una evidencia vieja con una URL externa no se
        puede autenticar, así que se muestra el enlace en vez de una imagen rota.

        `img` a secas y no `next/image`: son archivos privados servidos por nuestro handler, no
        assets optimizables.
      */}
      {isImage &&
        (evidence.fileUrl.startsWith('/') ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={evidence.fileUrl}
            alt={t(`evidenceType.${evidence.type}`)}
            className="mt-3 max-h-64 w-full rounded-xl border border-k-border object-cover"
          />
        ) : (
          <a
            href={evidence.fileUrl}
            rel="noreferrer"
            target="_blank"
            className="mt-3 block break-all text-[13px] text-k-purple hover:underline"
          >
            {evidence.fileUrl}
          </a>
        ))}

      <p className="mt-3 text-[12px] font-semibold uppercase tracking-wide text-k-text-2">{t('stop.hash')}</p>
      {/* Entero y en monoespaciada: sus 64 caracteres son lo que prueba que el archivo no cambió,
          y recortarlo lo volvería decorativo. */}
      <p className="mt-1 break-all font-mono text-[12px] text-k-text">{evidence.fileHash}</p>
      <p className="mt-1 text-[12px] text-k-muted">{t('stop.hashHint')}</p>
    </li>
  );
}
