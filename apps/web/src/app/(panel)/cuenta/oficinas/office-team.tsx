'use client';

import { useState } from 'react';
import type { Member } from '@kobrax/shared';
import { Button, ErrorBanner, Field, Select } from '@/components/ui';
import { sendJson } from '@/lib/client';
import { money } from '@/lib/format';
import { memberLabel } from '@/lib/branches';
import { officeCandidates, officeLabelOf, officeMembers, type OfficePortfolio, type OfficeRow } from '@/lib/offices';
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
  portfolios,
}: {
  office: OfficeRow;
  rows: OfficeRow[];
  members: Member[];
  editable: boolean;
  /** Lo que cada persona tiene a su cargo (por `userId`). Sin esto la lista es sólo nombres, como en el formulario. */
  portfolios?: Record<string, OfficePortfolio>;
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
              <li key={m.userId} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-3 py-2.5">
                <span className="min-w-0 flex-1 basis-48">
                  <span className="block truncate text-[14px] text-k-text">{memberLabel(m)}</span>
                  <span className="block truncate text-[12px] text-k-text-2">{m.roleName}</span>
                </span>
                {portfolios && <MemberPortfolio portfolio={portfolios[m.userId]} />}
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

/** Créditos, cartera y mora de una persona: tres cifras chicas con su rótulo. La mora es el saldo adeudado, no la cuota. */
function MemberPortfolio({ portfolio }: { portfolio?: OfficePortfolio }) {
  const { t } = useOfficeApi();
  const p = portfolio ?? { credits: 0, arrearsCredits: 0, byCurrency: [] };
  const sum = (pick: (c: OfficePortfolio['byCurrency'][number]) => number) =>
    p.byCurrency.length === 0 ? money(0) : p.byCurrency.map((c) => money(pick(c), c.currency)).join(' · ');
  const cells: { label: string; value: string; danger?: boolean; sub?: string }[] = [
    { label: t('team.stats.credits'), value: String(p.credits), sub: p.arrearsCredits > 0 ? t('team.stats.inArrears', { n: p.arrearsCredits }) : undefined },
    { label: t('team.stats.portfolio'), value: sum((c) => c.balance) },
    { label: t('team.stats.arrears'), value: sum((c) => c.arrearsBalance), danger: p.arrearsCredits > 0 },
  ];
  return (
    <dl className="flex shrink-0 items-start gap-6">
      {cells.map((c) => (
        <div key={c.label} className="min-w-[5.5rem]">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-k-slate">{c.label}</dt>
          <dd className={`mt-0.5 text-[14px] font-semibold tabular-nums ${c.danger ? 'text-k-danger' : 'text-k-navy'}`}>{c.value}</dd>
          {c.sub && <dd className="text-[11px] text-k-danger">{c.sub}</dd>}
        </div>
      ))}
    </dl>
  );
}
