import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  GPS_FALLBACK_KEY,
  type EvidenceItem,
  type RouteItem,
  type VisitDetail,
  type VisitItem,
} from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { STOP_STATUS_TONE } from '@/lib/routes';
import { Badge, Card, EmptyState, Fact, PageHeader } from '@/components/panel-ui';
import { dateTime, money } from '@/lib/format';

/**
 * Una parada y **la prueba de que alguien estuvo ahí**.
 *
 * Es la pantalla que W6 vino a hacer posible: hasta T0, la foto, el punto y el hash no eran
 * alcanzables desde ningún lado. La visita y su evidencia **son inmutables** —`field_visits` y
 * `field_evidences` no tienen `updated_at` ni `deleted_at`—, así que acá no hay nada que editar ni
 * borrar. Es justo lo que las vuelve prueba, y la pantalla lo dice.
 */
export default async function ParadaPage({ params }: { params: { id: string; sid: string } }) {
  const t = await getTranslations('panel.routes');
  const locale = await getLocale();

  // No hay `GET /stops/:id`: la parada sale de su ruta, que además valida el alcance de un saque.
  const [route, visits] = await Promise.all([
    apiCall<RouteItem>(`/routes/${params.id}`, { method: 'GET', auth: true }),
    apiCall<VisitItem[]>(`/visits?routeStopId=${params.sid}`, { method: 'GET', auth: true }),
  ]);

  if (route.status === 404) notFound();
  if (route.status !== 200 || !route.body.data) {
    return <EmptyState title={t('title')} text={route.body.error?.message} />;
  }
  const stop = route.body.data.stops?.find((s) => s.id === params.sid);
  if (!stop) notFound();

  /*
   * El listado de visitas no trae evidencias —traerlas para pintar una tabla sería tráfico que
   * nadie mira—, así que el detalle de cada una se pide aparte. Una parada normalmente tiene una;
   * dos si se fue dos veces.
   */
  const details = await Promise.all(
    (visits.body.data ?? []).map((v) =>
      apiCall<VisitDetail>(`/visits/${v.id}`, { method: 'GET', auth: true }).then((r) => r.body.data),
    ),
  );
  const registered = details.filter((v): v is VisitDetail => v != null);

  return (
    <>
      <PageHeader
        title={stop.clientName ?? t('stop.sequence', { n: stop.sequenceOrder })}
        subtitle={t('stop.sequence', { n: stop.sequenceOrder })}
        actions={<Badge tone={STOP_STATUS_TONE[stop.status]}>{t(`stopStatus.${stop.status}`)}</Badge>}
      />

      <div className="space-y-6">
        <Card>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label={t('stop.address')} value={stop.address ?? '—'} />
            <Fact
              label={t('stop.debt')}
              value={stop.overdueAmount != null ? money(stop.overdueAmount, stop.currency ?? 'BOB') : '—'}
            />
            <Fact label={t('stop.daysPastDue')} value={stop.daysPastDue != null ? String(stop.daysPastDue) : '—'} />
          </dl>
          <div className="mt-5 flex flex-wrap gap-4">
            <Link href={`/cartera/${stop.clientId}`} className="text-[14px] font-medium text-k-purple hover:underline">
              {t('detail.openClient')}
            </Link>
            {stop.caseId && (
              <Link href={`/mora/${stop.caseId}`} className="text-[14px] font-medium text-k-purple hover:underline">
                {t('detail.openCase')}
              </Link>
            )}
          </div>
        </Card>

        {registered.length > 0 ? (
          registered.map((visit) => <Visit key={visit.id} visit={visit} locale={locale} />)
        ) : (
          <EmptyState title={t('stop.notVisited')} />
        )}
      </div>
    </>
  );
}

async function Visit({ visit, locale }: { visit: VisitDetail; locale: string }) {
  const t = await getTranslations('panel.routes');
  // El servidor lo DERIVA además de creerle al cliente: el punto es la ubicación conocida de la
  // parada y no una lectura del GPS. Sin decirlo, una auditoría lo leería como GPS real.
  const estimated = visit.details[GPS_FALLBACK_KEY] === true;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[15px] font-semibold text-k-navy">{t(`outcome.${visit.outcome}`)}</p>
        <p className="text-[13px] text-k-text-2">{dateTime(visit.capturedAt, locale)}</p>
      </div>

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

      <div className="mt-5">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-k-text-2">{t('stop.evidence')}</p>
        {visit.evidences.length > 0 ? (
          <ul className="mt-3 grid gap-4 sm:grid-cols-2">
            {visit.evidences.map((e) => (
              <Evidence key={e.id} evidence={e} locale={locale} />
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-[14px] text-k-text-2">{t('stop.evidenceEmpty')}</p>
        )}
      </div>

      <p className="mt-5 border-t border-k-border pt-4 text-[13px] text-k-text-2">{t('stop.immutable')}</p>
    </Card>
  );
}

async function Evidence({ evidence, locale }: { evidence: EvidenceItem; locale: string }) {
  const t = await getTranslations('panel.routes');
  const isImage = evidence.type === 'PHOTO' || evidence.type === 'SIGNATURE';

  return (
    <li className="rounded-2xl border border-k-border p-4">
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
