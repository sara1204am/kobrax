import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { CatalogType, type AccountInfo, type CaseListItem, type ClientDetail, type ClientTimelineEntry, type CreditDetail, type Member } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { isUuid } from '@/lib/uuid';
import { EmptyState } from '@/components/panel-ui';
import { AccountSummary } from './account-summary';
import { CasesSection } from './cases-section';
import { ClientCard } from './client-card';
import { CreditsSection } from './credits-section';
import { TimelineSection } from './timeline-section';

/** Cuántas entradas de bitácora entran en la ficha. El resto, en «Ver todo». */
const TIMELINE_PREVIEW = 8;

/**
 * La ficha del cliente: **el perfil operativo**.
 *
 * Carga **enmascarada**: documento, teléfonos y direcciones vienen tokenizados desde la API, y
 * verlos en claro es un click aparte que queda auditado (`client-card.tsx`).
 *
 * 🔴 **No hay ruta de edición.** La ficha se corrige por secciones, en el lugar (`client-card.tsx`).
 * Por eso acá se piden también los créditos crudos y el catálogo de garantías: el modal que edita
 * garantes y garantías los necesita para ofrecerlos, y pedirlos recién al abrirlo haría que el
 * primer clic esperara la red.
 *
 * 🔴 **Ocho llamadas en paralelo, y ninguna puede tumbar la pantalla salvo la del cliente.** Cada
 * bloque cruza un dominio distinto —créditos, casos, bitácora, equipo—, con su propio permiso: un
 * rol sin `case:read` tiene que poder abrir la ficha igual, con la sección de casos diciendo que no
 * la puede ver. La única que decide si hay pantalla es la del cliente.
 */
export default async function ClientePage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { historial?: string };
}) {
  const t = await getTranslations('portfolio');

  /*
   * 🔴 **Un segmento que no es un uuid es un 404, no una ficha vacía.** Este `[id]` se come todo lo
   * que cuelgue de `/cartera/`: con el alta hecha modal, `/cartera/nuevo` —que alguien puede tener
   * guardado en favoritos— caía acá, la API rechazaba `nuevo` con un 400 del `ParseUUIDPipe` y la
   * pantalla decía «no tenés acceso a este cliente». Que es mentira: ese cliente no existe.
   */
  if (!isUuid(params.id)) notFound();

  const [client, credits, account, timeline, cases, team, types, collateralTypes] = await Promise.all([
    apiCall<ClientDetail>(`/clients/${params.id}`, { method: 'GET', auth: true }),
    apiCall<CreditDetail[]>(`/credits?clientId=${params.id}&limit=100`, { method: 'GET', auth: true }),
    apiCall<AccountInfo>('/accounts/me', { method: 'GET', auth: true }),
    apiCall<ClientTimelineEntry[]>(`/clients/${params.id}/timeline?limit=${TIMELINE_PREVIEW}`, { method: 'GET', auth: true }),
    apiCall<CaseListItem[]>(`/cases?clientId=${params.id}&limit=20`, { method: 'GET', auth: true }),
    apiCall<Member[]>('/users', { method: 'GET', auth: true }),
    apiCall<{ code: string; label: string }[]>(`/catalogs/${CatalogType.CREDIT_TYPE}`, { method: 'GET', auth: true }),
    apiCall<{ code: string; label: string }[]>(`/catalogs/${CatalogType.COLLATERAL_TYPE}`, { method: 'GET', auth: true }),
  ]);

  if (client.status === 404) notFound();
  if (client.status !== 200 || !client.body.data) {
    return <EmptyState title={t('noAccess')} text={client.body.error?.message} />;
  }

  const creditos = credits.body.data ?? [];
  const equipo = team.body.data ?? [];
  const moneda = account.body.data?.currencyCode ?? 'BOB';

  return (
    <ClientCard
      client={client.body.data}
      hasActiveCredits={creditos.some((c) => c.status === 'ACTIVE')}
      credits={
        // Si `credit:read` no está, la lista viene vacía y la sección lo dice en vez de mentir con
        // un cero. El catálogo de tipos sí puede faltar sin consecuencia: se muestra «Sin clasificar».
        <CreditsSection
          clientId={params.id}
          credits={creditos}
          types={new Map((types.body.data ?? []).map((c) => [c.code, c.label]))}
          showClosed={searchParams.historial === '1'}
          denied={credits.status === 403}
        />
      }
      creditOptions={creditos}
      currency={moneda}
      collateralTypes={collateralTypes.body.data ?? []}
      summary={<AccountSummary client={client.body.data} credits={creditos} currency={moneda} />}
      timeline={
        <TimelineSection
          entries={timeline.body.data ?? []}
          members={equipo}
          denied={timeline.status === 403}
          seeAllHref={`/cartera/${params.id}/bitacora`}
        />
      }
      cases={<CasesSection cases={cases.body.data ?? []} members={equipo} denied={cases.status === 403} />}
    />
  );
}
