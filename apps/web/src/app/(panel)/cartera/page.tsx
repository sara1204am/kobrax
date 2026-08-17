import { getTranslations } from 'next-intl/server';
import { CatalogType, type AccountInfo, type MeInfo, type Member } from '@kobrax/shared';
import { apiCall, pageMeta } from '@/lib/bff';
import { RetryState } from '@/components/retry-state';
import type { PortfolioRow } from '@/lib/portfolio';
import { carteraQuery, DEFAULT_PAGE_SIZE, hasCarteraFilters } from '@/lib/cartera-query';
import { PortfolioTable } from './portfolio-table';
import { NewClientButton } from './new-client-button';

/**
 * La cartera del negocio.
 *
 * Pide `view=portfolio`, que agrega la deuda y la mora de los créditos de cada cliente **en la
 * misma consulta que ordena y filtra** — ordenar por mora después de paginar ordenaría 50 clientes
 * cualesquiera, y filtrar por mora en el navegador filtraría sólo la página visible. Por eso todo
 * el estado de la tabla viaja a la API y nada se resuelve acá.
 *
 * Abre por mora descendente: lo peor primero, como la lista del teléfono.
 */
export default async function CarteraPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const t = await getTranslations('portfolio');
  const query = carteraQuery(searchParams);

  /*
   * Todo en paralelo. Los tres de al lado son para los filtros globales y las preferencias, y
   * **ninguno puede tumbar la pantalla**: un rol sin `user:read` recibe 403 en `/users` y la cartera
   * tiene que seguir abriendo igual, con el selector de cobrador vacío.
   */
  const [list, account, me, team, collateralTypes] = await Promise.all([
    apiCall<PortfolioRow[]>(`/clients?${query}`, { method: 'GET', auth: true }),
    apiCall<AccountInfo>('/accounts/me', { method: 'GET', auth: true }),
    apiCall<MeInfo>('/auth/me', { method: 'GET', auth: true }),
    apiCall<Member[]>('/users', { method: 'GET', auth: true }),
    // Para el modal de alta: sin catálogo, el tipo de garantía se escribe libre y no pasa nada.
    apiCall<{ code: string; label: string }[]>(`/catalogs/${CatalogType.COLLATERAL_TYPE}`, { method: 'GET', auth: true }),
  ]);

  if (list.status !== 200 || !list.body.data) {
    // Con `[Reintentar]`: si la API se cayó un segundo, recargar a mano perdería los filtros que la
    // persona venía armando. El mensaje lo pone el servidor, que es el que sabe qué falló.
    return (
      <>
        <p className="mb-4 text-[14px] text-k-text-2">{t('subtitle')}</p>
        <RetryState title={t('noAccess')} text={list.body.error?.message} />
      </>
    );
  }

  return (
    <>
      {/* Sin título: la pantalla ya se llama «Cartera» en el menú de la izquierda, y repetirlo en
          26 px empuja la tabla —que es a lo que se viene— media pantalla hacia abajo. Queda la
          bajada, que sí dice algo que el menú no dice. */}
      <p className="mb-4 text-[14px] text-k-text-2">{t('subtitle')}</p>
      <PortfolioTable
        rows={list.body.data}
        meta={pageMeta(list.body, searchParams.page, Number(query.get('limit')) || DEFAULT_PAGE_SIZE)}
        currency={account.body.data?.currencyCode ?? 'BOB'}
        hasFilters={hasCarteraFilters(searchParams)}
        userId={me.body.data?.userId}
        collectors={team.body.data ?? []}
        action={
          <NewClientButton
            currency={account.body.data?.currencyCode ?? 'BOB'}
            collateralTypes={collateralTypes.body.data ?? []}
          />
        }
        // Las sucursales todavía no existen como endpoint: cuando exista, entra acá y el filtro ya
        // está cableado. Mientras tanto se dibuja apagado en vez de esconderse y reaparecer un día.
        branches={[]}
      />
    </>
  );
}
