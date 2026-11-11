import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Permission, type RoleCompare, type RoleSummary } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { requirePermission } from '@/lib/authz';
import { EmptyState, PageHeader } from '@/components/panel-ui';
import { RetryState } from '@/components/retry-state';
import { CompareView } from './compare-view';

/** Comparar dos roles (vista D del plan de F14 · F7). Los dos se eligen en la URL (`?a=&b=`); sin elegir, se pide que se elijan. Pide `role:read`. */
export default async function CompareRolesPage({ searchParams }: { searchParams: { a?: string; b?: string } }) {
  const blocked = await requirePermission(Permission.ROLE_READ);
  if (blocked) return blocked;
  const t = await getTranslations('roles');

  const list = await apiCall<RoleSummary[]>('/roles?assignable=false', { method: 'GET', auth: true });
  if (list.status === 0 || list.status >= 500) return <RetryState title={t('errors.generic')} />;
  if (list.status !== 200 || !list.body.data) return <EmptyState title={t('errors.generic')} text={list.body.error?.message} />;
  const roles = list.body.data;

  const a = searchParams.a && roles.some((r) => r.key === searchParams.a) ? searchParams.a : undefined;
  const b = searchParams.b && roles.some((r) => r.key === searchParams.b) ? searchParams.b : undefined;
  let compare: RoleCompare | null = null;
  if (a && b) {
    const res = await apiCall<RoleCompare>(`/roles/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`, { method: 'GET', auth: true });
    if (res.status === 0 || res.status >= 500) return <RetryState title={t('errors.generic')} />;
    compare = res.status === 200 ? (res.body.data ?? null) : null;
  }

  return (
    <>
      <Link href="/seguridad/roles" className="mb-3 inline-block text-[13px] font-medium text-k-purple hover:underline">
        ← {t('back')}
      </Link>
      <PageHeader title={t('compareView.title')} />
      <CompareView roles={roles.map((r) => ({ key: r.key ?? r.name }))} a={a} b={b} compare={compare} />
    </>
  );
}
