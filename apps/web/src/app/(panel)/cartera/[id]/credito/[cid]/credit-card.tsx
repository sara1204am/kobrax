'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  CREDIT_STATUSES,
  hydratePrestamo,
  memberName,
  type CreditDetail,
  type Member,
  type PrestamoForm,
} from '@kobrax/shared';
import type { CatalogOption } from '@/components/client-form';
import { Badge, PageHeader, Section } from '@/components/panel-ui';
import { Button, ErrorBanner, Field, Input, Select } from '@/components/ui';
import { LoanFields, LoanQuotePanel } from '@/components/loan-fields';
import { ArrearsActions } from './arrears-actions';
import { usePermissions } from '@/components/permissions';
import { useToast } from '@/components/toast';
import { sendJson } from '@/lib/client';
import { money, date } from '@/lib/format';
import { creditExtras, creditPatch, hasCreditChanges, type CreditExtras } from '@/lib/credit-patch';

/**
 * La ficha del crédito: **el mismo formulario que lo dio de alta, ya cargado**.
 *
 * 🔴 **Antes eran dos pantallas distintas.** El alta preguntaba modo, capital, interés y cuota con
 * el panel de cotización en vivo; la ficha mostraba capital y tasa **de sólo lectura**, con un
 * comentario que decía que «la API no lo acepta en su DTO» — y `UpdateCreditDto` los acepta desde
 * siempre. Un préstamo con el capital mal tipeado no tenía arreglo desde ninguna parte. Ahora los
 * campos salen del mismo `LoanFields`, así que no se pueden volver a separar.
 *
 * Lo que de verdad **no** se toca después del desembolso —nº de cuotas, moneda, fecha de desembolso—
 * queda arriba, de sólo lectura y dicho: cambiarlos sin regenerar el cronograma deja una tabla de
 * cuotas que no cierra con el préstamo. Eso es una reestructura, y es otra operación.
 *
 * 🔴 **Puede no haber cronograma, y eso no es un error.** Un crédito dado de alta desde el móvil
 * lleva la cuota congelada en `metadata` y su próxima fecha es un dato, no una derivación.
 *
 * Y si el crédito vino de un archivo o de otro core (`locked`), sus campos financieros no se editan:
 * la pantalla los apaga para no ofrecer lo que la API va a rechazar.
 */
export function CreditCard({
  credit,
  clientId,
  team,
  types,
}: {
  credit: CreditDetail;
  clientId: string;
  /** El equipo, para reasignar el préstamo. Vacío si el rol no puede leer `/users`. */
  team: Member[];
  /** Catálogo `CREDIT_TYPE` del tenant. Vacío = el tipo no se ofrece. */
  types: CatalogOption[];
}) {
  const t = useTranslations('portfolio');
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const { can } = usePermissions();
  const editable = can('credit:write') && !credit.locked;

  const [form, setForm] = useState<PrestamoForm>(() => hydratePrestamo(credit));
  const [extras, setExtras] = useState<CreditExtras>(() => creditExtras(credit));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const patch = creditPatch(credit, form, extras);
  const setExtra = (p: Partial<CreditExtras>) => setExtras({ ...extras, ...p });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const { ok, data } = await sendJson<CreditDetail>(`/api/credits/${credit.id}`, patch, 'PATCH');
    setSaving(false);
    if (!ok) {
      setError(data.error?.message ?? t('saveError'));
      return;
    }
    toast(t('saved'));
    router.refresh();
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <PageHeader
        title={money(credit.outstandingBalance, credit.currency)}
        subtitle={t('creditSubtitle', {
          principal: money(credit.principalAmount, credit.currency),
          code: credit.code ?? t('noCode'),
        })}
        /* Las etiquetas van pegadas al saldo que califican, no a media pantalla entre los botones. */
        badge={
          <>
            {credit.locked && <Badge tone="warning">{t('imported')}</Badge>}
            {(credit.daysPastDue ?? 0) > 0 && <Badge tone="danger">{t('days', { count: credit.daysPastDue! })}</Badge>}
            {/* Marcar en mora / poner al día: al lado de los días, que es el dato que cambian. */}
            {can('credit:write') && (
              <ArrearsActions creditId={credit.id} daysPastDue={credit.daysPastDue ?? 0} locked={credit.locked} />
            )}
          </>
        }
        actions={
          <>
            {/* Botones y no links de texto: son las dos salidas de esta pantalla y hay que verlas.
                La de pagos es además la ÚNICA puerta a los de ESTE crédito — registrar y pedir un
                cobro los exigen, y el ledger no elige el crédito: se lo tiene que traer quien llega. */}
            <span className="w-44">
              <Button type="button" variant="ghost" onClick={() => router.push(`/pagos?creditId=${credit.id}`)}>
                {t('creditPayments')}
              </Button>
            </span>
            <span className="w-44">
              <Button type="button" variant="ghost" onClick={() => router.push(`/cartera/${clientId}`)}>
                {t('backToClient')}
              </Button>
            </span>
            {editable && (
              <span className="w-40">
                <Button type="submit" loading={saving} disabled={!hasCreditChanges(patch)}>
                  {t('save')}
                </Button>
              </span>
            )}
          </>
        }
      />

      <ErrorBanner message={error} />
      {credit.locked && <p className="text-[13px] text-k-warning-text">{t('lockedHint')}</p>}

      <Section title={t('sections.creditFixed')}>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
          <Item label={t('fields.currency')} value={credit.currency} />
          <Item label={t('fields.disbursedAt')} value={credit.disbursedAt ? date(credit.disbursedAt, locale) : '—'} />
          <Item
            label={t('fields.installments')}
            value={credit.installmentsCount ? String(credit.installmentsCount) : t('openLoan')}
          />
        </dl>
        <p className="mt-3 text-[12px] text-k-muted">{t('creditFixedHint')}</p>
      </Section>

      <Section title={t('sections.creditEditable')}>
        {/* Los mismos campos que el alta. El nº de cuotas se dibuja apagado: el cálculo lo necesita
            y quien mira lo quiere ver, pero cambiarlo es reestructurar. */}
        <LoanFields form={form} onChange={setForm} disabled={!editable} installmentsCountEditable={false} />

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Field label={t('form.status')}>
            <Select value={extras.status} onChange={(e) => setExtra({ status: e.target.value })} disabled={!can('credit:write')}>
              {CREDIT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`creditStatus.${s}`)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t('fields.code')}>
            <Input value={extras.code} onChange={(e) => setExtra({ code: e.target.value })} disabled={!can('credit:write')} maxLength={64} />
          </Field>

          {types.length > 0 && (
            <Field label={t('fields.creditType')}>
              <Select value={extras.typeCode} onChange={(e) => setExtra({ typeCode: e.target.value })} disabled={!can('credit:write')}>
                <option value="">{t('creditNoType')}</option>
                {types.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label || c.code}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {team.length > 0 && (
            <Field label={t('form.assignedTo')}>
              <Select
                value={extras.assignedManagerId}
                onChange={(e) => setExtra({ assignedManagerId: e.target.value })}
                disabled={!can('credit:write')}
              >
                <option value="">{t('form.unassigned')}</option>
                {team.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {memberName(m)}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <div className="sm:col-span-2">
            <Field label={t('form.notes')}>
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} disabled={!editable} maxLength={500} />
            </Field>
          </div>
        </div>
      </Section>

      {/* El panel en vivo, igual que en el alta: al recotizar en modo B se ve qué cambia antes de
          guardar. Es el mismo cálculo de `shared` que usa el teléfono. */}
      <LoanQuotePanel form={form} currency={credit.currency} />

      <Section title={t('sections.schedule')}>
        <Schedule credit={credit} />
      </Section>
    </form>
  );
}

/**
 * El cronograma, o por qué no hay uno.
 *
 * Sin cuotas **no** se dibuja una tabla vacía: se explica que este crédito lleva la cuota
 * congelada, que es una forma de préstamo del producto y no un dato faltante.
 */
function Schedule({ credit }: { credit: CreditDetail }) {
  const t = useTranslations('portfolio');
  const locale = useLocale();
  const rows = credit.installments ?? [];

  if (rows.length === 0) {
    return (
      <div>
        <p className="text-[14px] text-k-text-2">{t('noSchedule')}</p>
        <p className="mt-1 text-[12px] text-k-muted">
          {t('noScheduleHint', {
            amount: credit.installmentAmount != null ? money(credit.installmentAmount, credit.currency) : '—',
            date: credit.nextDueDate ? date(credit.nextDueDate, locale) : '—',
          })}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[14px]">
        <thead>
          <tr className="border-b border-k-border text-left text-[12px] font-semibold uppercase tracking-wide text-k-text-2">
            <th scope="col" className="py-2 pr-4">{t('schedule.number')}</th>
            <th scope="col" className="py-2 pr-4">{t('schedule.dueDate')}</th>
            <th scope="col" className="py-2 pr-4 text-right">{t('schedule.amount')}</th>
            <th scope="col" className="py-2 pr-4 text-right">{t('schedule.paid')}</th>
            <th scope="col" className="py-2">{t('columns.status')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i.id} className="border-b border-k-border last:border-0">
              <td className="py-2 pr-4 text-k-text-2">{i.number}</td>
              <td className="py-2 pr-4">{date(i.dueDate, locale)}</td>
              <td className="py-2 pr-4 text-right tabular-nums">{money(i.amount, credit.currency)}</td>
              <td className="py-2 pr-4 text-right tabular-nums">{money(i.paidAmount, credit.currency)}</td>
              <td className="py-2">
                <Badge tone={i.status === 'PAID' ? 'success' : i.status === 'OVERDUE' ? 'danger' : 'neutral'}>
                  {t(`installmentStatus.${i.status}`)}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-k-text-2">{label}</dt>
      <dd className="mt-0.5 text-[14px] text-k-text">{value}</dd>
    </div>
  );
}
