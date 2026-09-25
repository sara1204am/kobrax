'use client';

import { useLocale, useTranslations } from 'next-intl';
import {
  AmortizationMethod,
  CreditDefinition,
  InterestBase,
  RepaymentForm,
  calculateCredit,
  memberName,
  paymentProgress,
  type CreditDetail,
  type CreditTerms,
  type Member,
} from '@kobrax/shared';
import type { CatalogOption } from '@/components/client-form';
import { Badge, Section } from '@/components/panel-ui';
import { CREDIT_STATUS_TONE, CreditProgress } from '@/components/credit-progress';
import { PaymentPlanTable } from '@/components/payment-plan-table';
import { date, dayDate, money } from '@/lib/format';

/**
 * La ficha del crédito en modo lectura (F4/06 · Fase 3): Condiciones · Estado actual · Plan · Cobranza
 * · Origen. Cada sección responde una pregunta distinta, y ninguna se calcula acá: el plan y la
 * cotización salen de `calculateCredit`, el mismo motor con que la API guardó el crédito.
 */
export function CreditView({ credit, team, types }: { credit: CreditDetail; team: Member[]; types: CatalogOption[] }) {
  const t = useTranslations('portfolio.creditDetail');
  const calculation = credit.terms ? calculateCredit(credit.terms) : null;

  return (
    <>
      <Section title={t('sections.terms')}>
        {credit.terms ? <TermsSummary credit={credit} terms={credit.terms} /> : <LegacyTerms credit={credit} />}
      </Section>

      <Section title={t('sections.current')}>
        <CurrentState credit={credit} />
      </Section>

      <Section title={t('sections.plan')}>
        {calculation ? <TermsPlan credit={credit} schedule={calculation.schedule} /> : <StoredPlan credit={credit} />}
      </Section>

      <Section title={t('sections.collection')}>
        <Collection credit={credit} team={team} types={types} />
      </Section>

      <Section title={t('sections.origin')}>
        <Origin credit={credit} />
      </Section>
    </>
  );
}

/** Las condiciones con que se definió, y lo que dan: cuota, total y ganancia. */
function TermsSummary({ credit, terms }: { credit: CreditDetail; terms: CreditTerms }) {
  const t = useTranslations('portfolio.creditDetail');
  const tf = useTranslations('portfolio.creditForm');
  const tp = useTranslations('portfolio');
  const locale = useLocale();
  const quote = calculateCredit(terms).quote;
  const cur = credit.currency;

  const single =
    (terms.definition === CreditDefinition.CALCULATED && terms.amortization === AmortizationMethod.SINGLE_PAYMENT) ||
    (terms.definition === CreditDefinition.AGREED_TOTAL && terms.repayment === RepaymentForm.SINGLE);
  const count = quote?.installmentsCount;
  const frequency = 'frequency' in terms ? terms.frequency : undefined;

  return (
    <>
      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
        <Item label={t('definition')} value={tf(`definition.${terms.definition}`)} />
        <Item label={tf('principal')} value={money(terms.principal, cur)} />
        {terms.definition === CreditDefinition.CALCULATED && (
          <Item
            label={t('interest')}
            value={t(terms.rateBase === InterestBase.TOTAL ? 'interestTotal' : 'interestPerPeriod', { rate: terms.ratePercent })}
            hint={`${tf(`interestTypes.${terms.interestType}`)} · ${tf(`amortizations.${terms.amortization}`)}`}
          />
        )}
        {terms.definition === CreditDefinition.AGREED_INSTALLMENT && (
          <Item label={tf('installmentAmount')} value={money(terms.installmentAmount, cur)} />
        )}
        {terms.definition === CreditDefinition.AGREED_TOTAL && <Item label={tf('agreedTotal')} value={money(terms.agreedTotal, cur)} />}
        <Item label={t('installments')} value={single ? t('singlePayment') : count ? String(count) : tp('openLoan')} />
        {frequency && !(terms.definition === CreditDefinition.AGREED_TOTAL && single) && (
          <Item label={tf('frequency')} value={tp(`frequency.${frequency}`)} />
        )}
        <Item label={single ? t('paymentDate') : t('firstDueDate')} value={dayDate(terms.firstDueDate, locale)} />
      </dl>

      {quote && (
        <dl className="mt-5 grid gap-4 rounded-xl bg-k-highlight p-4 sm:grid-cols-3">
          <Figure label={quote.installmentVaries ? tf('quote.firstInstallment') : tf('quote.installment')} value={money(quote.installment, cur)} big />
          <Figure label={tf('quote.total')} value={quote.total != null ? money(quote.total, cur) : '—'} />
          <Figure label={tf('quote.profit')} value={quote.profit != null ? money(quote.profit, cur) : '—'} />
        </dl>
      )}
    </>
  );
}

/** Un crédito anterior a F4/06: no tiene condiciones, sólo lo que se cobra. No se inventa una definición. */
function LegacyTerms({ credit }: { credit: CreditDetail }) {
  const t = useTranslations('portfolio.creditDetail');
  const tp = useTranslations('portfolio');
  const cur = credit.currency;

  return (
    <>
      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
        <Item label={tp('fields.principal')} value={money(credit.principalAmount, cur)} />
        <Item label={tp('fields.installment')} value={credit.installmentAmount != null ? money(credit.installmentAmount, cur) : t('unknown')} />
        <Item label={t('installments')} value={credit.installmentsCount ? String(credit.installmentsCount) : tp('openLoan')} />
        {credit.frequency && <Item label={tp('fields.frequency')} value={tp(`frequency.${credit.frequency}`)} />}
        {credit.interestRate > 0 && <Item label={t('interest')} value={t('interestPerPeriod', { rate: credit.interestRate })} />}
      </dl>
      {!credit.locked && <p className="mt-4 text-[12px] text-k-muted">{t('legacyTerms')}</p>}
    </>
  );
}

/** Cuánto falta, cuándo se cobra y cómo viene. */
function CurrentState({ credit }: { credit: CreditDetail }) {
  const t = useTranslations('portfolio.creditDetail');
  const tp = useTranslations('portfolio');
  const locale = useLocale();
  const cur = credit.currency;
  const days = credit.daysPastDue ?? 0;
  const initial = credit.initialState;

  return (
    <>
      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
        <Figure label={t('outstanding')} value={money(credit.outstandingBalance, cur)} big />
        <Figure label={t('totalToCollect')} value={credit.totalToCollect != null ? money(credit.totalToCollect, cur) : t('unknown')} />
        <Figure label={t('nextDue')} value={credit.nextDueDate ? dayDate(credit.nextDueDate, locale) : t('noNextDue')} />
        <div>
          <dt className="text-[12px] text-k-text-2">{t('arrears')}</dt>
          <dd className="mt-1">
            {days > 0 ? <Badge tone="danger">{tp('days', { count: days })}</Badge> : <Badge tone="success">{t('current')}</Badge>}
          </dd>
        </div>
        {credit.status && (
          <div>
            <dt className="text-[12px] text-k-text-2">{t('status')}</dt>
            <dd className="mt-1">
              <Badge tone={CREDIT_STATUS_TONE[credit.status] ?? 'neutral'} dot>
                {tp(`creditStatus.${credit.status}`)}
              </Badge>
            </dd>
          </div>
        )}
      </dl>

      <CreditProgress
        pct={paymentProgress({
          basis: credit.balanceBasis ?? 'legacy',
          outstandingBalance: credit.outstandingBalance,
          principalAmount: credit.principalAmount,
          totalToCollect: credit.totalToCollect ?? null,
        })}
        label={t('progress')}
      />

      {initial && (initial.paidInstallments > 0 || initial.daysPastDue > 0) && (
        <p className="mt-4 text-[13px] text-k-text-2">
          {initial.paidInstallments > 0 && t('registeredInProgress', { paid: initial.paidInstallments })}{' '}
          {initial.daysPastDue > 0 && t('declaredArrears', { days: initial.daysPastDue })}
        </p>
      )}
      {credit.balanceBasis === 'legacy' && <p className="mt-3 text-[12px] text-k-muted">{t('legacyBalance')}</p>}
    </>
  );
}

/** El plan que dan las condiciones guardadas. */
function TermsPlan({ credit, schedule }: { credit: CreditDetail; schedule: ReturnType<typeof calculateCredit>['schedule'] }) {
  const t = useTranslations('portfolio.creditDetail');
  if (!schedule || schedule.length === 0) return <p className="text-[14px] text-k-text-2">{t('openLoanPlan')}</p>;
  const paid = credit.initialState?.paidInstallments ?? 0;

  return (
    <>
      <p className="mb-3 text-[12px] text-k-muted">
        {t('planHint')} {paid > 0 && t('planPaidHint', { count: paid })}
      </p>
      <PaymentPlanTable rows={schedule} currency={credit.currency} />
    </>
  );
}

/**
 * El cronograma guardado (web anterior a F4/06), o por qué no hay uno. Sin cuotas **no** se dibuja
 * una tabla vacía: el crédito lleva la cuota congelada, que es una forma de préstamo y no un faltante.
 *
 * Las fechas van con `dayDate` (UTC): son días civiles, y con `date()` Bolivia las pintaba un día antes.
 */
function StoredPlan({ credit }: { credit: CreditDetail }) {
  const t = useTranslations('portfolio');
  const td = useTranslations('portfolio.creditDetail');
  const locale = useLocale();
  const rows = credit.installments ?? [];

  if (rows.length === 0) {
    return (
      <div>
        <p className="text-[14px] text-k-text-2">{t('noSchedule')}</p>
        <p className="mt-1 text-[12px] text-k-muted">
          {t('noScheduleHint', {
            amount: credit.installmentAmount != null ? money(credit.installmentAmount, credit.currency) : '—',
            date: credit.nextDueDate ? dayDate(credit.nextDueDate, locale) : '—',
          })}
        </p>
      </div>
    );
  }

  return (
    <>
      <p className="mb-3 text-[12px] text-k-muted">{td('storedPlanHint')}</p>
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
                <td className="whitespace-nowrap py-2 pr-4">{dayDate(i.dueDate, locale)}</td>
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
    </>
  );
}

/** Quién lo cobra y cómo se lo identifica. */
function Collection({ credit, team, types }: { credit: CreditDetail; team: Member[]; types: CatalogOption[] }) {
  const t = useTranslations('portfolio.creditDetail');
  const tp = useTranslations('portfolio');
  const manager = team.find((m) => m.userId === credit.assignedManagerId);
  const type = types.find((c) => c.code === credit.typeCode);

  return (
    <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
      <Item label={t('manager')} value={manager ? memberName(manager) : tp('form.unassigned')} />
      <Item label={tp('fields.code')} value={credit.code ?? tp('noCode')} />
      <Item label={tp('fields.creditType')} value={type ? type.label || type.code : (credit.typeCode ?? tp('creditNoType'))} />
      <div className="sm:col-span-3">
        <Item label={t('notes')} value={credit.notes || '—'} />
      </div>
    </dl>
  );
}

/** De dónde vino. Lo que no cambia nunca: moneda y desembolso. */
function Origin({ credit }: { credit: CreditDetail }) {
  const t = useTranslations('portfolio.creditDetail');
  const tp = useTranslations('portfolio');
  const locale = useLocale();

  return (
    <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
      <Item label={t('origin')} value={credit.origin ? t(`origins.${credit.origin}`) : '—'} />
      <Item label={tp('fields.currency')} value={credit.currency} />
      <Item label={tp('fields.disbursedAt')} value={credit.disbursedAt ? date(credit.disbursedAt, locale) : '—'} />
      {credit.createdAt && <Item label={t('createdAt')} value={date(credit.createdAt, locale)} />}
      {credit.externalRef && <Item label={t('externalRef')} value={credit.externalRef} />}
    </dl>
  );
}

function Item({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-k-text-2">{label}</dt>
      <dd className="mt-0.5 text-[14px] text-k-text">{value}</dd>
      {hint && <p className="mt-0.5 text-[12px] text-k-muted">{hint}</p>}
    </div>
  );
}

function Figure({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div>
      <dt className="text-[12px] text-k-text-2">{label}</dt>
      <dd className={`mt-0.5 font-semibold tabular-nums text-k-navy ${big ? 'text-[22px]' : 'text-[16px]'}`}>{value}</dd>
    </div>
  );
}
