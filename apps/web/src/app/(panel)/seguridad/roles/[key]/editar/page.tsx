import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Permission, type PermissionCatalogEntry, type RoleDetail } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { getMe, requirePermission } from '@/lib/authz';
import { EmptyState, PageHeader } from '@/components/panel-ui';
import { NoAccess } from '@/components/no-access';
import { RetryState } from '@/components/retry-state';
import { RoleEditor } from '@/components/roles/role-editor';

/**
 * Editar los permisos de un rol (vista C del plan de F14 · F7). Pide `role:write`. El administrador no se edita: si se llega por la URL se explica.
 * Todo el estado vive en el editor hasta confirmar; las reglas de verdad las hace cumplir la API.
 */
export default async function EditRolePage({ params }: { params: { key: string } }) {
  const blocked = await requirePermission(Permission.ROLE_WRITE);
  if (blocked) return blocked;
  const t = await getTranslations('roles');
  const key = decodeURIComponent(params.key);

  const [detail, catalog, me] = await Promise.all([
    apiCall<RoleDetail>(`/roles/${encodeURIComponent(key)}`, { method: 'GET', auth: true }),
    apiCall<PermissionCatalogEntry[]>('/roles/permissions', { method: 'GET', auth: true }),
    getMe(),
  ]);

  if (detail.status === 404) return <NoAccess text={t('errors.ROLE_NOT_FOUND')} />;
  if (detail.status === 0 || detail.status >= 500 || catalog.status !== 200) return <RetryState title={t('errors.generic')} />;
  if (detail.status !== 200 || !detail.body.data || !catalog.body.data) return <EmptyState title={t('errors.generic')} text={detail.body.error?.message} />;

  const role = detail.body.data;
  const name = t.has(`roleNames.${role.key}`) ? t(`roleNames.${role.key}`) : (role.key ?? role.name);
  const back = `/seguridad/roles/${encodeURIComponent(key)}`;

  if (role.editable === false) {
    return (
      <>
        <Link href={back} className="mb-3 inline-block text-[13px] font-medium text-k-purple hover:underline">
          ← {name}
        </Link>
        <EmptyState title={t('detail.locked')} />
      </>
    );
  }

  return (
    <>
      <Link href={back} className="mb-3 inline-block text-[13px] font-medium text-k-purple hover:underline">
        ← {name}
      </Link>
      <PageHeader title={t('editor.title', { name })} />
      <RoleEditor role={role} catalog={catalog.body.data} roleName={name} selfInRole={me.body.data?.role === role.key} />
    </>
  );
}
