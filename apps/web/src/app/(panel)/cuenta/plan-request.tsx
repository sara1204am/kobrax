'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { PLANS, PLAN_ORDER, type AccountInfo, type AccountRequestInfo, type PlanCode } from '@kobrax/shared';
import { Button, ErrorBanner, Field } from '@/components/ui';
import { Section } from '@/components/panel-ui';
import { Modal } from '@/components/modal';
import { usePermissions } from '@/components/permissions';
import { useToast } from '@/components/toast';
import { sendJson } from '@/lib/client';
import { dateTime } from '@/lib/format';
import { isIndividualPlan, plansByKind } from '@/lib/plan-view';

/**
 * Cambiar de plan, y en particular **pasar de trabajar solo a trabajar en equipo**.
 *
 * **No cambia nada por sí solo**: queda registrado, se le avisa a Kobrax y lo atiende por consola (el plan lo gestiona
 * Kobrax). La pantalla muestra el estado del último pedido para que quien pidió sepa si ya lo vieron.
 *
 * Los planes se agrupan en *Individual* (una sola persona) y *Equipo* (varias) con lo que incluye cada uno, para que la
 * decisión se tome comparando y no adivinando qué quiere decir «Professional».
 */
export function PlanRequest({ account, requests }: { account: AccountInfo; requests: AccountRequestInfo[] }) {
  const t = useTranslations('account.planRequest');
  const tp = useTranslations('plans');
  const router = useRouter();
  const locale = useLocale();
  const toast = useToast();
  const { can } = usePermissions();
  const editable = can('account:write');

  const changes = requests.filter((r) => r.type === 'PLAN_CHANGE');
  const pending = changes.find((r) => r.status === 'PENDING');
  const last = changes.find((r) => r.status !== 'PENDING');
  const current = account.planCode as PlanCode;
  const solo = isIndividualPlan(current);
  const groups = plansByKind(current);
  // Quien trabaja solo casi siempre quiere el primer escalón de equipo: llega con ese ya elegido.
  const firstTeam = groups.team[0];
  const defaultPlan = (solo ? firstTeam : (groups.team[0] ?? groups.individual[0])) ?? '';

  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<string>(defaultPlan);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    setError(null);
    const { ok, data } = await sendJson('/api/account/requests', { type: 'PLAN_CHANGE', plan, ...(note.trim() ? { note: note.trim() } : {}) }, 'POST');
    setBusy(false);
    if (!ok) {
      setError(data.error?.message ?? t('error'));
      return;
    }
    setOpen(false);
    setNote('');
    toast(t('sent'));
    router.refresh();
  }

  const when = (iso: string) => dateTime(iso, locale, account.timezone ?? undefined);
  const name = (code: string | null) => (code && (PLAN_ORDER as string[]).includes(code) ? tp(`names.${code}`) : (code ?? ''));
  const gain = firstTeam ? PLANS[firstTeam].limits : null;
  const now = PLANS[current]?.limits;

  return (
    <Section title={solo ? t('soloTitle') : t('title')} inner="space-y-4 p-6">
      <p className="text-[13px] leading-relaxed text-k-text-2">{solo ? t('soloText') : t('intro')}</p>

      {solo && gain && now && gain.users !== null && gain.credits !== null && now.users !== null && now.credits !== null && (
        // Lo que se gana al pasar al primer escalón de equipo, con los números del catálogo (no escritos a mano).
        <p className="rounded-xl bg-k-highlight px-4 py-3 text-[13px] leading-relaxed text-k-navy">
          {t('soloGain', {
            plan: tp(`names.${firstTeam}`),
            fromUsers: now.users,
            toUsers: gain.users,
            fromCredits: now.credits,
            toCredits: gain.credits,
          })}
        </p>
      )}

      {pending && (
        <p role="status" className="rounded-xl bg-k-highlight px-4 py-3 text-[13px] text-k-navy">
          {t('pending', { plan: name(pending.plan), date: when(pending.createdAt) })}
        </p>
      )}

      {last && (
        <p className="rounded-xl bg-k-light-bg px-4 py-3 text-[13px] text-k-text-2">
          {last.status === 'HANDLED' ? t('handled', { plan: name(last.plan) }) : t('rejected', { plan: name(last.plan) })}
          {last.handledNote ? ` “${last.handledNote}”` : ''}
        </p>
      )}

      {editable && !pending && (
        <div className="sm:w-64">
          <Button
            variant={solo ? 'primary' : 'ghost'}
            onClick={() => {
              setError(null);
              setPlan(defaultPlan);
              setOpen(true);
            }}
          >
            {solo ? t('seeTeam') : t('ask')}
          </Button>
        </div>
      )}

      <Modal
        wide
        open={open}
        onClose={() => setOpen(false)}
        title={solo ? t('soloModalTitle') : t('modalTitle')}
        actions={
          <>
            <span className="sm:w-36">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                {t('cancel')}
              </Button>
            </span>
            <span className="sm:w-44">
              <Button loading={busy} disabled={!plan} onClick={() => void send()}>
                {t('send')}
              </Button>
            </span>
          </>
        }
      >
        <div className="space-y-5">
          <ErrorBanner message={error} />

          <fieldset className="space-y-4">
            <legend className="sr-only">{t('plan')}</legend>
            {(['individual', 'team'] as const).map(
              (kind) =>
                groups[kind].length > 0 && (
                  <div key={kind} role="radiogroup" aria-label={t(`groups.${kind}`)}>
                    <h3 className="text-[12px] font-semibold uppercase tracking-wide text-k-text-2">
                      {t(`groups.${kind}`)} <span className="font-normal normal-case text-k-muted">· {t(`groupHint.${kind}`)}</span>
                    </h3>
                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                      {groups[kind].map((code) => {
                        const p = PLANS[code];
                        const selected = plan === code;
                        return (
                          <label
                            key={code}
                            className={`cursor-pointer rounded-xl border p-4 ${
                              selected ? 'border-k-periwinkle bg-k-highlight' : 'border-k-border bg-white hover:bg-k-bg'
                            }`}
                          >
                            <span className="flex items-center gap-2">
                              <input type="radio" name="plan" value={code} checked={selected} onChange={() => setPlan(code)} />
                              <span className="text-[15px] font-semibold text-k-navy">{tp(`names.${code}`)}</span>
                            </span>
                            <span className="mt-1 block text-[13px] text-k-text-2">
                              {tp(`price.${code}`, { base: p.price.base, perSeat: p.price.perSeat })}
                            </span>
                            <ul className="mt-3 space-y-1 text-[13px] text-k-text">
                              <li>{p.limits.users === null ? t('features.membersUnlimited') : t('features.members', { n: p.limits.users })}</li>
                              <li>{p.limits.credits === null ? t('features.creditsUnlimited') : t('features.credits', { n: p.limits.credits })}</li>
                              <li>{p.limits.clients === null ? t('features.clientsUnlimited') : t('features.clients', { n: p.limits.clients })}</li>
                              <li>{p.limits.photosPerMonth === null ? t('features.photosUnlimited') : t('features.photos', { n: p.limits.photosPerMonth })}</li>
                            </ul>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ),
            )}
            <p className="text-[12px] text-k-muted">{t('currentIs', { plan: tp(`names.${current}`) })}</p>
          </fieldset>

          <Field label={t('note')} hint={t('noteHint')}>
            <textarea
              value={note}
              maxLength={500}
              rows={3}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-xl border border-k-border bg-white px-3 py-2 text-[14px] text-k-text outline-none focus:border-k-periwinkle focus:shadow-k-focus"
            />
          </Field>
        </div>
      </Modal>
    </Section>
  );
}
