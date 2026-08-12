import { getTranslations } from 'next-intl/server';
import type { AccountInfo, Member, PaymentItem } from '@kobrax/shared';
import { apiCall, pageMeta } from '@/lib/bff';
import { paymentQuery, totalOf } from '@/lib/payments';
import { Badge, EmptyState, PageHeader } from '@/components/panel-ui';
import { money } from '@/lib/format';
import { PaymentsTable } from './payments-table';
import { PeriodPicker } from './period-picker';

const LIMIT = 20;

/**
 * El ledger del período.
 *
 * `GET /payments` devuelve los de **todo el tenant**, no los de un cobrador — la lección que dejó
 * Rutas. `registeredBy` dice quién lo cargó, y **no hay parámetro para filtrar por persona**.
 *
 * El total es el de **la página**, no el del período: la API no agrega y sumar el período entero
 * exigiría traerlo entero. Por eso el rótulo dice cuántos pagos está contando.
 */
export default async function PagosPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; creditId?: string; caseId?: string; page?: string };
}) {
  const t = await getTranslations('panel.payments');

  const [list, team, account] = await Promise.all([
    apiCall<PaymentItem[]>(`/payments?${paymentQuery(searchParams, LIMIT)}`, { method: 'GET', auth: true }),
    apiCall<Member[]>('/users', { method: 'GET', auth: true }),
    apiCall<AccountInfo>('/accounts/me', { method: 'GET', auth: true }),
  ]);

  if (list.status !== 200 || !list.body.data) {
    return <EmptyState title={t('title')} text={list.body.error?.message} />;
  }

  const rows = list.body.data;
  const currency = account.body.data?.currencyCode ?? 'BOB';

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          rows.length > 0 ? (
            <Badge tone="neutral">{t('total', { n: rows.length, amount: money(totalOf(rows), currency) })}</Badge>
          ) : undefined
        }
      />

      <PeriodPicker />
      <PaymentsTable
        rows={rows}
        meta={pageMeta(list.body, searchParams.page, LIMIT)}
        members={team.body.data ?? []}
        currency={currency}
      />
    </>
  );
}
