'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Member } from '@kobrax/shared';
import { Button } from '@/components/ui';
import { usePermissions } from '@/components/permissions';
import { sendJson } from '@/lib/client';
import type { OfficeDetail, OfficeRow, OfficeType } from '@/lib/offices';
import type { PageMeta } from '@/components/data-table';
import type { OfficeTeamRow } from '@/lib/office-team-table';
import { OfficeFormDialog } from '../office-form';
import { OfficeTeam } from '../office-team';
import { useOfficeApi } from '../use-office-api';

/** Editar o restaurar, según el estado. Sólo con `office:write`. */
export function DetailActions({
  office,
  rows,
  types,
  members,
}: {
  office: OfficeDetail;
  rows: OfficeRow[];
  types: OfficeType[];
  members: Member[];
}) {
  const t = useTranslations('account.offices');
  const { can } = usePermissions();
  const { busy, error, run } = useOfficeApi();
  const [editing, setEditing] = useState(false);
  if (!can('office:write')) return null;
  const row = rows.find((r) => r.id === office.id) ?? null;

  return (
    <div className="flex flex-col items-end gap-2">
      {office.active ? (
        <span className="w-32">
          <Button onClick={() => setEditing(true)}>{t('menu.edit')}</Button>
        </span>
      ) : (
        <span className="w-36">
          <Button loading={busy} onClick={() => void run(() => sendJson(`/api/branches/${office.id}/restore`, null, 'POST'), t('trash.restored'))}>
            {t('trash.restore')}
          </Button>
        </span>
      )}
      {error && (
        <p role="alert" className="max-w-xs text-right text-[12px] text-k-danger">
          {error}
        </p>
      )}
      {editing && (
        <OfficeFormDialog
          open
          onClose={() => setEditing(false)}
          office={row}
          defaultParentId={office.parentId ?? office.id}
          rows={rows}
          types={types}
          members={members}
        />
      )}
    </div>
  );
}

/** El equipo de la oficina, con sumar/sacar si hay `office:write`. La tabla (búsqueda y orden) la resuelve el servidor desde la URL. */
export function DetailTeam({
  office,
  rows,
  members,
  table,
}: {
  office: OfficeDetail;
  rows: OfficeRow[];
  members: Member[];
  table: { rows: OfficeTeamRow[]; meta: PageMeta; searching: boolean };
}) {
  const { can } = usePermissions();
  const row = rows.find((r) => r.id === office.id);
  if (!row) return null;
  return <OfficeTeam office={row} rows={rows} members={members} editable={can('office:write')} table={table} />;
}
