'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CreditDetail } from '@kobrax/shared';
import { Field, Input } from '@/components/ui';
import { money } from '@/lib/format';
import type { PortfolioRow } from '@/lib/portfolio';

/**
 * Elegir sobre qué crédito se registra un pago: primero la persona, después su préstamo. Es el mismo
 * recorrido que «Nueva tarea» de la agenda, para que quien ya lo conoce no aprenda otro.
 *
 * 🔴 **Sólo se ofrecen los créditos que aceptan un pago.** La API exige un crédito `ACTIVE` (o una
 * operación de fuente externa, que no toca el saldo): ofrecer uno pagado o cancelado sería dejar
 * elegirlo para que el servidor lo rechace después.
 *
 * ⚠️ **Los datos en claro del deudor no se piden acá.** La búsqueda devuelve la vista de cartera
 * —nombre y carnet enmascarado—; teléfonos y direcciones son de la agenda, y leerlos deja rastro.
 */
export function CreditPicker({ onPick }: { onPick: (credit: CreditDetail) => void }) {
  const t = useTranslations('panel.payments');

  const [q, setQ] = useState('');
  const [hits, setHits] = useState<PortfolioRow[]>([]);
  const [client, setClient] = useState<{ id: string; name: string } | null>(null);
  const [credits, setCredits] = useState<CreditDetail[]>([]);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);

  // Con freno: sin él cada tecla es una consulta y las respuestas vuelven desordenadas.
  useEffect(() => {
    if (client || q.trim().length < 3) return setHits([]);
    const id = setTimeout(async () => {
      setSearching(true);
      const res = await fetch(`/api/clients?q=${encodeURIComponent(q.trim())}&limit=8`).catch(() => null);
      const body = res ? await res.json().catch(() => ({})) : {};
      setSearching(false);
      setHits(Array.isArray(body?.data) ? body.data : []);
    }, 300);
    return () => clearTimeout(id);
  }, [q, client]);

  async function pickClient(c: PortfolioRow) {
    const name = c.businessName || [c.firstName, c.lastName].filter(Boolean).join(' ') || '—';
    setClient({ id: c.id, name });
    setSearching(true);
    setFailed(false);
    const res = await fetch(`/api/credits?clientId=${c.id}`).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    setSearching(false);
    if (!res?.ok) return setFailed(true);
    const all: CreditDetail[] = Array.isArray(body?.data) ? body.data : [];
    setCredits(all.filter((cr) => cr.locked || cr.status === 'ACTIVE'));
  }

  function back() {
    setClient(null);
    setCredits([]);
    setFailed(false);
  }

  if (!client) {
    return (
      <>
        <Field label={t('register.searchClient')}>
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('register.searchHint')} />
        </Field>
        <div className="mt-3 min-h-[80px]">
          {searching && <p className="text-[13px] text-k-text-2">{t('register.searching')}</p>}
          {!searching && q.trim().length >= 3 && hits.length === 0 && (
            <p className="text-[13px] text-k-text-2">{t('register.noClients')}</p>
          )}
          <ul className="space-y-1">
            {hits.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => void pickClient(c)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-k-border bg-white px-3 py-2.5 text-left text-[14px] text-k-text hover:bg-k-bg"
                >
                  <span>{c.businessName || [c.firstName, c.lastName].filter(Boolean).join(' ') || '—'}</span>
                  {/* El carnet enmascarado: con dos homónimos es lo único que los separa. */}
                  {c.nationalId && <span className="text-[12px] text-k-muted">{c.nationalId}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-k-border bg-k-bg px-3 py-2.5">
        <span className="text-[14px] font-medium text-k-text">{client.name}</span>
        <button type="button" onClick={back} className="text-[13px] font-medium text-k-periwinkle hover:underline">
          {t('register.changeClient')}
        </button>
      </div>

      {searching && <p className="text-[13px] text-k-text-2">{t('register.searching')}</p>}
      {failed && <p className="text-[13px] text-k-danger">{t('register.creditsError')}</p>}
      {!searching && !failed && credits.length === 0 && (
        <p className="rounded-xl bg-k-warning-bg px-3 py-2.5 text-[13px] text-k-warning-text">{t('register.noCredits')}</p>
      )}
      <ul className="space-y-1">
        {credits.map((cr) => (
          <li key={cr.id}>
            <button
              type="button"
              onClick={() => onPick(cr)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-k-border bg-white px-3 py-2.5 text-left text-[14px] text-k-text hover:bg-k-bg"
            >
              <span>{cr.code ?? t('register.noCode')}</span>
              <span className="text-[13px] text-k-text-2">
                {money(cr.outstandingBalance, cr.currency)} ·{' '}
                {(cr.daysPastDue ?? 0) > 0 ? t('register.inArrears', { days: cr.daysPastDue ?? 0 }) : t('register.current')}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
