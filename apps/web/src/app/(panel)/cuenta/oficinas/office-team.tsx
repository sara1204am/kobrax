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
          <TeamList
            members={current}
            portfolios={portfolios}
            editable={editable}
            busy={busy}
            onTakeOut={(m) => void run(() => sendJson(`/api/branches/${office.id}/members/${m.userId}`, null, 'DELETE'), t('team.removed'))}
          />
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

type Portfolio = OfficePortfolio | undefined;

/** Las cifras de una persona, ya sumadas por moneda: «Bs 11.000,00» (o «Bs 1.000,00 · $us 200,00» con dos monedas). */
function sumBy(p: Portfolio, pick: (c: OfficePortfolio['byCurrency'][number]) => number): string {
  return !p || p.byCurrency.length === 0 ? money(0) : p.byCurrency.map((c) => money(pick(c), c.currency)).join(' · ');
}

/**
 * El equipo de la oficina. Con cartera (`portfolios`) es una tabla de columnas fijas —persona, créditos, créditos en mora,
 * cartera y cartera en mora— con las cifras en peso normal y la mora en rojo (token `k-danger`) sólo si la hay; sin cartera
 * (el formulario de editar), una lista de nombres. «Sacar» es un botón, no un enlace.
 *
 * La mora es el saldo adeudado de los créditos atrasados, no la cuota.
 */
function TeamList({
  members,
  portfolios,
  editable,
  busy,
  onTakeOut,
}: {
  members: Member[];
  portfolios?: Record<string, OfficePortfolio>;
  editable: boolean;
  busy: boolean;
  onTakeOut: (m: Member) => void;
}) {
  const { t } = useOfficeApi();
  const takeOut = (m: Member) => (
    <span className="inline-block w-24">
      <Button type="button" variant="ghost" disabled={busy} aria-label={t('team.takeOutOf', { name: memberLabel(m) })} className="!h-9 !text-[13px] !text-k-danger" onClick={() => onTakeOut(m)}>
        {t('team.takeOut')}
      </Button>
    </span>
  );

  if (!portfolios) {
    return (
      <ul className="mt-2 divide-y divide-k-border rounded-xl border border-k-border">
        {members.map((m) => (
          <li key={m.userId} className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="min-w-0">
              <span className="block truncate text-[14px] text-k-text">{memberLabel(m)}</span>
              <span className="block truncate text-[12px] text-k-text-2">{m.roleName}</span>
            </span>
            {editable && takeOut(m)}
          </li>
        ))}
      </ul>
    );
  }

  const Th = ({ children, right }: { children: React.ReactNode; right?: boolean }) => (
    <th scope="col" className={`px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-k-text-2 ${right ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  );
  return (
    <div className="mt-2 overflow-x-auto rounded-xl border border-k-border">
      <table className="w-full min-w-[44rem] table-fixed text-[14px]">
        <colgroup>
          <col className="w-[30%]" />
          <col className="w-[10%]" />
          <col className="w-[13%]" />
          <col className="w-[17%]" />
          <col className="w-[17%]" />
          {editable && <col className="w-[13%]" />}
        </colgroup>
        <thead>
          <tr className="border-b border-k-border bg-k-bg">
            <Th>{t('team.stats.person')}</Th>
            <Th right>{t('team.stats.credits')}</Th>
            <Th right>{t('team.stats.arrearsCredits')}</Th>
            <Th right>{t('team.stats.portfolio')}</Th>
            <Th right>{t('team.stats.arrears')}</Th>
            {editable && <th scope="col" className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-k-text-2"><span className="sr-only">{t('team.takeOut')}</span></th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-k-border">
          {members.map((m) => {
            const p = portfolios[m.userId];
            const late = (p?.arrearsCredits ?? 0) > 0;
            return (
              <tr key={m.userId}>
                <td className="px-3 py-3">
                  <span className="block truncate text-k-text">{memberLabel(m)}</span>
                  <span className="block truncate text-[12px] text-k-text-2">{m.roleName}</span>
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-k-text">{p?.credits ?? 0}</td>
                <td className={`px-3 py-3 text-right tabular-nums ${late ? 'text-k-danger' : 'text-k-text'}`}>{p?.arrearsCredits ?? 0}</td>
                <td className="px-3 py-3 text-right tabular-nums text-k-text">{sumBy(p, (c) => c.balance)}</td>
                <td className={`px-3 py-3 text-right tabular-nums ${late ? 'text-k-danger' : 'text-k-text'}`}>{sumBy(p, (c) => c.arrearsBalance)}</td>
                {editable && <td className="px-3 py-3 text-right">{takeOut(m)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
