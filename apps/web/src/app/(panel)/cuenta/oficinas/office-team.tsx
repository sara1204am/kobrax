'use client';

import { useState } from 'react';
import type { Member } from '@kobrax/shared';
import { Button, ErrorBanner, Field, Select } from '@/components/ui';
import { sendJson } from '@/lib/client';
import { memberLabel } from '@/lib/branches';
import { officeCandidates, officeLabelOf, officeMembers, type OfficeRow } from '@/lib/offices';
import { useOfficeApi } from './use-office-api';

/**
 * El equipo de una oficina: quién está, y sumar o sacar personas.
 *
 * 🔴 **Una sola oficina por persona** (y cuenta, por ahora): sumar a alguien que ya está en otra la MUEVE, y la pantalla
 * dice de cuál viene antes de hacerlo. No se ofrece «agregar otra». Cambiar la oficina cambia lo que la persona ve.
 */
export function OfficeTeam({
  office,
  rows,
  members,
  editable,
}: {
  office: OfficeRow;
  rows: OfficeRow[];
  members: Member[];
  editable: boolean;
}) {
  const { busy, error, setError, run, t } = useOfficeApi();
  const [picked, setPicked] = useState('');
  const current = officeMembers(members, office.id);
  const candidates = officeCandidates(members, office.id);
  const chosen = candidates.find((m) => m.userId === picked);
  const from = chosen ? officeLabelOf(rows, chosen.branchId) : null;

  return (
    <div className="space-y-5">
      <ErrorBanner message={error} />
      <div>
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-k-text-2">{t('team.current')}</h3>
        {current.length === 0 ? (
          <p className="mt-2 text-[13px] text-k-text-2">{t('team.none')}</p>
        ) : (
          <ul className="mt-2 divide-y divide-k-border rounded-xl border border-k-border">
            {current.map((m) => (
              <li key={m.userId} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-[14px] text-k-text">{memberLabel(m)}</span>
                  <span className="block truncate text-[12px] text-k-text-2">{m.roleName}</span>
                </span>
                {editable && (
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={t('team.takeOutOf', { name: memberLabel(m) })}
                    onClick={() => void run(() => sendJson(`/api/branches/${office.id}/members/${m.userId}`, null, 'DELETE'), t('team.removed'))}
                    className="shrink-0 text-[13px] font-medium text-k-danger hover:underline disabled:opacity-50"
                  >
                    {t('team.takeOut')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {editable && office.active && (
        <div className="space-y-3">
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-k-text-2">{t('team.add')}</h3>
          <p className="text-[12px] text-k-muted">{t('team.oneOffice')}</p>
          {candidates.length === 0 ? (
            <p className="text-[13px] text-k-text-2">{t('team.noCandidates')}</p>
          ) : (
            <>
              <Field label={t('team.person')}>
                <Select
                  value={picked}
                  onChange={(e) => {
                    setPicked(e.target.value);
                    setError(null);
                  }}
                >
                  <option value="">{t('team.pick')}</option>
                  {candidates.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {memberLabel(m)}
                      {officeLabelOf(rows, m.branchId) ? ` — ${t('team.comesFrom', { name: officeLabelOf(rows, m.branchId) as string })}` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              {chosen && from && <p role="note" className="rounded-xl bg-k-warning-bg px-3 py-2 text-[13px] text-k-warning-text">{t('team.willMove', { name: memberLabel(chosen), from })}</p>}
              <div className="flex justify-end">
                <span className="sm:w-48">
                  <Button
                    loading={busy}
                    disabled={!picked}
                    onClick={() =>
                      void run(() => sendJson(`/api/branches/${office.id}/members`, { userId: picked }, 'POST'), t('team.added'), () => setPicked(''))
                    }
                  >
                    {t('team.assign')}
                  </Button>
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
