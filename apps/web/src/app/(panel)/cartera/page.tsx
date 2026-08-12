import { getTranslations } from 'next-intl/server';
import type { AccountInfo } from '@kobrax/shared';
import { apiCall, pageMeta } from '@/lib/bff';
import { EmptyState, PageHeader } from '@/components/panel-ui';
import { SearchBox } from '@/components/search-box';
import type { PortfolioRow } from '@/lib/portfolio';
import { PortfolioTable } from './portfolio-table';
import { NewClientButton } from './new-client-button';

const LIMIT = 20;

/** Los que el servidor sabe ordenar. Uno inventado en la URL no viaja: la API lo rechazaría. */
const SORTS = ['dpd', 'debt', 'name', 'status', 'createdAt'];

/**
 * La cartera del negocio.
 *
 * Pide `view=portfolio`, que agrega la deuda y la mora de los créditos de cada cliente **en la
 * misma consulta que ordena** — ordenar por mora después de paginar ordenaría 20 clientes
 * cualesquiera. Por eso el orden, la página y la búsqueda viajan a la API y no se resuelven acá.
 *
 * Abre por mora descendente: lo peor primero, como la lista del teléfono.
 */
export default async function CarteraPage({
  searchParams,
}: {
  searchParams: { q?: string; sort?: string; dir?: string; page?: string; status?: string };
}) {
  const t = await getTranslations('portfolio');

  const page = Math.max(1, Number(searchParams.page) || 1);
  const query = new URLSearchParams({ view: 'portfolio', page: String(page), limit: String(LIMIT) });
  if (searchParams.q?.trim()) query.set('q', searchParams.q.trim());
  if (searchParams.status) query.set('status', searchParams.status);
  if (searchParams.sort && SORTS.includes(searchParams.sort)) {
    query.set('sort', searchParams.sort);
    query.set('dir', searchParams.dir === 'asc' ? 'asc' : 'desc');
  }

  const [list, account] = await Promise.all([
    apiCall<PortfolioRow[]>(`/clients?${query}`, { method: 'GET', auth: true }),
    apiCall<AccountInfo>('/accounts/me', { method: 'GET', auth: true }),
  ]);

  if (list.status !== 200 || !list.body.data) {
    return <EmptyState title={t('noAccess')} text={list.body.error?.message} />;
  }

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} actions={<NewClientButton />} />
      {/* El documento está cifrado: se busca completo o no matchea. Decirlo evita que alguien
          escriba medio carnet y concluya que el cliente no existe. */}
      <SearchBox label={t('search.label')} placeholder={t('search.placeholder')} hint={t('search.hint')} />
      <PortfolioTable
        rows={list.body.data}
        meta={pageMeta(list.body, searchParams.page, LIMIT)}
        currency={account.body.data?.currencyCode ?? 'BOB'}
        hasFilters={Boolean(searchParams.q?.trim() || searchParams.status)}
      />
    </>
  );
}
