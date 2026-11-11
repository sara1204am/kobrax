'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { PermissionCatalogEntry, RoleDetail, RoleUpdateResult } from '@kobrax/shared';
import { usePermissions } from '@/components/permissions';
import { useToast } from '@/components/toast';
import { ConfirmSensitiveDialog } from '@/components/roles/confirm-sensitive-dialog';
import { summarizeChange } from '@/lib/roles';

/** Las acciones del detalle de un rol: editar y restaurar la plantilla. Sólo se dibujan con `role:write`; la API valida igual. */
export function RoleActions({ role, catalog, roleName }: { role: RoleDetail; catalog: PermissionCatalogEntry[]; roleName: string }) {
  const t = useTranslations('roles');
  const { can } = usePermissions();
  const router = useRouter();
  const toast = useToast();
  const [restoring, setRestoring] = useState(false);

  if (!can('role:write')) return null;
  if (role.editable === false) return <p className="text-[13px] text-k-text-2">{t('detail.locked')}</p>;

  const key = encodeURIComponent(role.key ?? '');
  // Restaurar vuelve a la plantilla: lo que hoy sobra se quita y lo que falta se devuelve.
  const templateSet = [...role.granted.filter((c) => !role.diff.added.includes(c)), ...role.diff.removed];
  const summary = summarizeChange(role.granted, templateSet, catalog);

  return (
    <>
      {role.diverged && role.templateKey && (
        <button type="button" onClick={() => setRestoring(true)} className="h-10 rounded-xl border border-k-border bg-white px-4 text-[14px] font-medium text-k-text-2 hover:bg-k-bg">
          {t('detail.restore')}
        </button>
      )}
      <Link href={`/seguridad/roles/${key}/editar`} className="flex h-10 items-center rounded-xl bg-k-navy px-4 text-[14px] font-semibold text-white hover:bg-k-slate">
        {t('detail.edit')}
      </Link>
      <ConfirmSensitiveDialog
        open={restoring}
        onClose={() => setRestoring(false)}
        mode="restore"
        roleKey={role.key ?? ''}
        roleName={roleName}
        members={role.members ?? 0}
        expectedVersion={role.version ?? 1}
        summary={summary}
        onSaved={(r: RoleUpdateResult) => {
          setRestoring(false);
          toast(t('editor.saved', { n: r.affectedMembers }), 'success');
          router.refresh();
        }}
        onFailed={() => undefined}
      />
    </>
  );
}
