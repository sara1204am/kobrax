import { getTranslations } from 'next-intl/server';
import { Permission, type AccountInfo, type CaseListItem, type MeInfo, type Member } from '@kobrax/shared';
import { apiCall, type ApiEnvelope } from '@/lib/bff';
import { caseQuery, hasCaseFilters } from '@/lib/cases';
import { EmptyState, PageHeader } from '@/components/panel-ui';
import { CaseFilters } from './case-filters';
import { CasesTable } from './cases-table';
import { GenerateButton } from './generate-button';

const LIMIT = 20;

export interface CasesSearchParams {
  status?: string;
  priority?: string;
  assigneeId?: string;
  overdue?: string;
  sort?: string;
  dir?: string;
  page?: string;
}

/**
 * Los casos abiertos del equipo.
 *
 * 🔴 **La misma pantalla muestra cosas distintas según quién mire, y la respuesta no lo dice.**
 * `GET /cases` acota por capacidad: con `case:assign` devuelve todo el tenant, y sin él sólo lo
 * propio. Un cobrador ve una lista corta y correcta sin ninguna señal de que está filtrada, así
 * que la señal la pone la pantalla.
 *
 * El orden y la página **los resuelve el servidor** (`?sort=&dir=&page=`, W5-T0): ordenar acá
 * ordenaría las 20 filas de la página y dejaría la de 200 días de mora escondida en la página 4.
 */
export default async function CasosPage({ searchParams }: { searchParams: CasesSearchParams }) {
  const t = await getTranslations('panel.cases');
  const query = caseQuery(searchParams, LIMIT);

  const [list, me, team, account] = await Promise.all([
    apiCall<CaseListItem[]>(`/cases?${query}`, { method: 'GET', auth: true }),
    apiCall<MeInfo>('/auth/me', { method: 'GET', auth: true }),
    apiCall<Member[]>('/users', { method: 'GET', auth: true }),
    apiCall<AccountInfo>('/accounts/me', { method: 'GET', auth: true }),
  ]);

  if (list.status !== 200 || !list.body.data) {
    return <EmptyState title={t('title')} text={list.body.error?.message} />;
  }

  const permissions = me.body.data?.permissions ?? [];
  const supervises = permissions.includes(Permission.CASE_ASSIGN);
  // El equipo puede venir vacío si el rol no tiene `user:read`: el filtro por cobrador
  // simplemente no se dibuja, y la lista sigue siendo legible.
  const members = team.body.data ?? [];

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={supervises ? <GenerateButton /> : undefined}
      />

      {!supervises && (
        <p className="mb-4 rounded-xl border border-k-border bg-k-bg px-4 py-3 text-[13px] text-k-text-2">
          {t('scopedToMine')}
        </p>
      )}

      <CaseFilters members={members} showAssignee={supervises && members.length > 0} />
      <CasesTable
        rows={list.body.data}
        meta={pageMeta(list.body, searchParams.page)}
        members={members}
        currency={account.body.data?.currencyCode ?? 'BOB'}
        filtered={hasCaseFilters(searchParams)}
      />
    </>
  );
}

/** El `meta` del sobre, con respaldo por si la respuesta no lo trae. */
function pageMeta(body: ApiEnvelope<CaseListItem[]>, pageParam?: string) {
  const page = Math.max(1, Number(pageParam) || 1);
  const total = body.meta?.total ?? body.data?.length ?? 0;
  return {
    total,
    page: body.meta?.page ?? page,
    limit: body.meta?.limit ?? LIMIT,
    pages: body.meta?.pages ?? Math.max(1, Math.ceil(total / LIMIT)),
  };
}
