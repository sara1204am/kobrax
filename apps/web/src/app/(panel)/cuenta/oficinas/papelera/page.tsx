import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { apiCall } from '@/lib/bff';
import { EmptyState } from '@/components/panel-ui';
import type { OfficeRow } from '@/lib/offices';
import { TrashList } from './trash-list';

/** Papelera: las oficinas desactivadas, con «Restaurar». Leerla pide `office:read`; restaurar, `office:write`. */
export default async function OfficeTrashPage() {
  const t = await getTranslations('account.offices');
  const list = await apiCall<OfficeRow[]>('/branches', { method: 'GET', auth: true });
  if (list.status !== 200 || !list.body.data) return <EmptyState title={t('detail.noAccess')} text={list.body.error?.message} />;
  return (
    <>
      <Link href="/cuenta/oficinas" className="mb-3 inline-block text-[13px] font-medium text-k-purple hover:underline">
        ← {t('detail.back')}
      </Link>
      <TrashList rows={list.body.data.filter((r) => !r.active)} />
    </>
  );
}
