/**
 * Las condiciones del crédito en el móvil (F4/06 · Fase 5): **el mismo modelo que la web** —cómo se
 * define, sus campos, la cotización y el plan— con controles táctiles.
 *
 * 🔴 **Acá no se calcula nada.** El estado (`creditFormState`), el plan (`calculateCredit`) y el
 * «ya está en curso» (`registeredState`) salen de `@kobrax/shared`, con el mismo motor que usa la API
 * para guardar: la cuota que ve el cobrador es la que se cobra.
 */
import { useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import {
  AmortizationMethod,
  ArrearsMethod,
  CreditDefinition,
  InterestBase,
  InterestType,
  OFFERED_FREQUENCIES,
  RateConvention,
  RatePeriod,
  RepaymentForm,
  TermUnit,
  paymentPlanCsv,
  periodicRatePercent,
  rateBaseApplies,
  ratePeriodApplies,
  termInstallments,
  CHARGE_KINDS,
  type CreditForm,
  type CreditFormCharge,
  type CreditFormState,
  type CreditScheduleRow,
  type InitialStateForm,
  type RegisteredStateResult,
  type RegistrationSituation,
} from '@kobrax/shared';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { AmountInput, BottomSheet, Chips, SectionLabel } from '@/ui';
import { Field } from '@/components';
import { money, MONTHS } from '@/agenda-form';
import {
  AMORTIZATION_HINT,
  ARREARS_METHOD_HINT,
  ARREARS_METHOD_LABEL,
  AMORTIZATION_LABEL,
  DEFINITION_HINT,
  DEFINITION_LABEL,
  FREQUENCY_LABEL,
  INITIAL_STATE_ISSUE,
  INTEREST_TYPE_LABEL,
  RATE_BASE_LABEL,
  RATE_CONVENTION_LABEL,
  RATE_PERIOD_LABEL,
  REPAYMENT_LABEL,
  CHARGE_KIND_LABEL,
  TERM_UNIT_LABEL,
  TERMS_ISSUE,
} from '@/credit-labels';

/** Un día civil (`YYYY-MM-DD`), en UTC: con la zona local Bolivia lo mostraría un día antes. */
export function prettyDay(iso?: string | null): string {
  if (!iso) return 'Sin fecha';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const DEFINITIONS = Object.values(CreditDefinition).map((d) => ({ value: d, label: DEFINITION_LABEL[d] }));
const REPAYMENTS = Object.values(RepaymentForm).map((r) => ({ value: r, label: REPAYMENT_LABEL[r] }));
const INTEREST_TYPES = Object.values(InterestType).map((i) => ({ value: i, label: INTEREST_TYPE_LABEL[i] }));
// Cuota fija · cuota variable (capital fijo: la API guarda su cronograma) · pago único.
const AMORTIZATIONS = Object.values(AmortizationMethod).map((a) => ({ value: a, label: AMORTIZATION_LABEL[a] }));
const RATE_BASES = Object.values(InterestBase).map((b) => ({ value: b, label: RATE_BASE_LABEL[b] }));
const RATE_PERIODS = Object.values(RatePeriod).map((p) => ({ value: p, label: RATE_PERIOD_LABEL[p] }));
const RATE_CONVENTIONS = Object.values(RateConvention).map((c) => ({ value: c, label: RATE_CONVENTION_LABEL[c] }));
const ARREARS_METHODS = Object.values(ArrearsMethod).map((m) => ({ value: m, label: ARREARS_METHOD_LABEL[m] }));
const TERM_UNITS = Object.values(TermUnit).map((u) => ({ value: u, label: TERM_UNIT_LABEL[u] }));
const CHARGE_KIND_OPTIONS = CHARGE_KINDS.map((k) => ({ value: k, label: CHARGE_KIND_LABEL[k] }));

/** Cómo se define el crédito y sólo los campos que esa definición necesita. */
export function CreditTermsFormView({ form, onChange, currency }: { form: CreditForm; onChange: (f: CreditForm) => void; currency: string }) {
  const [picker, setPicker] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const set = (p: Partial<CreditForm>) => onChange({ ...form, ...p });

  const calculated = form.definition === CreditDefinition.CALCULATED;
  const agreedInstallment = form.definition === CreditDefinition.AGREED_INSTALLMENT;
  const agreedTotal = form.definition === CreditDefinition.AGREED_TOTAL;
  const single =
    (calculated && form.amortization === AmortizationMethod.SINGLE_PAYMENT) || (agreedTotal && form.repayment === RepaymentForm.SINGLE);
  // Las ofrecidas hoy, más la que ya tenga el crédito para no perderla al editar.
  const frequencies = (OFFERED_FREQUENCIES.includes(form.frequency) ? OFFERED_FREQUENCIES : [...OFFERED_FREQUENCIES, form.frequency]).map((f) => ({
    value: f,
    label: FREQUENCY_LABEL[f],
  }));

  // D17: la tasa de cada cuota cuando el % es de otro período, y las cuotas cuando el plazo es en meses/años.
  const periodic = periodicRatePercent({ ...form, ratePercent: Number(form.ratePercent) });
  const rateHint =
    form.ratePeriod !== RatePeriod.PER_INSTALLMENT && form.ratePercent.trim() !== '' && Number.isFinite(periodic)
      ? `Equivale a ${periodic.toLocaleString('es', { maximumFractionDigits: 4 })} % por cuota (${FREQUENCY_LABEL[form.frequency].toLowerCase()}).`
      : null;
  const installments = termInstallments(form.installmentsCount, form.termUnit, form.frequency);
  const termHint =
    form.termUnit !== TermUnit.INSTALLMENTS && form.installmentsCount.trim() !== '' && Number.isFinite(installments) ? `= ${installments} cuotas` : null;

  // Calcular cuotas ofrece cuota fija o variable. Pago único sólo si el crédito ya lo tiene (no se pierde al editar).
  const amortizations = AMORTIZATIONS.filter((a) => a.value !== AmortizationMethod.SINGLE_PAYMENT || form.amortization === AmortizationMethod.SINGLE_PAYMENT);
  // En Calcular cuotas el período se dice en meses o años; «cuotas» sólo si uno guardado no da meses enteros.
  const termUnits = calculated
    ? [...TERM_UNITS].reverse().filter((u) => u.value !== TermUnit.INSTALLMENTS || form.termUnit === TermUnit.INSTALLMENTS) // años, meses
    : TERM_UNITS;

  const setCharge = (id: string, p: Partial<CreditFormCharge>) =>
    set({ charges: form.charges.map((c) => (c.id === id ? { ...c, ...p } : c)) });
  const addCharge = () => set({ charges: [...form.charges, { id: `n${Date.now()}`, label: '', kind: 'first_amount', value: '' }] });

  // Cuota variable = capital fijo: el interés corre sobre el saldo y es simple (compuesto no se ofrece, D4).
  const setAmortization = (amortization: AmortizationMethod) =>
    set({ amortization, ...(amortization === AmortizationMethod.FIXED_PRINCIPAL ? { interestType: InterestType.SIMPLE } : {}) });

  const onDate = (e: DateTimePickerEvent, d?: Date) => {
    setPicker(false);
    if (e.type === 'set' && d) set({ firstDueDate: new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10) });
  };

  return (
    <View style={{ gap: SPACING.xs }}>
      <SectionLabel>¿Cómo se define?</SectionLabel>
      <Chips options={DEFINITIONS} value={form.definition} onChange={(definition) => set({ definition })} />
      <Text style={styles.hint}>{DEFINITION_HINT[form.definition]}</Text>

      <SectionLabel>Monto a prestar</SectionLabel>
      <AmountInput value={form.principal} onChangeText={(principal) => set({ principal })} currencySymbol={currency} accessibilityLabel="Monto a prestar" />

      {calculated && (
        <>
          <Field label="Interés (%)" value={form.ratePercent} onChangeText={(ratePercent) => set({ ratePercent })} keyboardType="decimal-pad" placeholder="10" />
          {/* D17: a qué período se refiere el %, independiente de cada cuánto se paga. */}
          {ratePeriodApplies(form) && (
            <>
              <SectionLabel>El interés es</SectionLabel>
              <Chips options={RATE_PERIODS} value={form.ratePeriod} onChange={(ratePeriod) => set({ ratePeriod })} />
              {rateHint && <Text style={styles.hint}>{rateHint}</Text>}
            </>
          )}
          <SectionLabel>Tipo de cuota</SectionLabel>
          <Chips options={amortizations} value={form.amortization} onChange={setAmortization} />
          <Text style={styles.hint}>{AMORTIZATION_HINT[form.amortization]}</Text>
        </>
      )}
      {agreedInstallment && (
        <>
          <SectionLabel>Cuota acordada</SectionLabel>
          <AmountInput value={form.installmentAmount} onChangeText={(installmentAmount) => set({ installmentAmount })} currencySymbol={currency} accessibilityLabel="Cuota acordada" />
        </>
      )}
      {agreedTotal && (
        <>
          <SectionLabel>Total acordado</SectionLabel>
          <AmountInput value={form.agreedTotal} onChangeText={(agreedTotal) => set({ agreedTotal })} currencySymbol={currency} accessibilityLabel="Total acordado" />
          <SectionLabel>Forma de pago</SectionLabel>
          <Chips options={REPAYMENTS} value={form.repayment} onChange={(repayment) => set({ repayment })} />
        </>
      )}

      {(calculated || agreedInstallment || (agreedTotal && form.repayment === RepaymentForm.INSTALLMENTS)) && (
        <Field
          label={calculated && single ? 'Plazo (en períodos)' : agreedInstallment ? 'Período del préstamo (vacío = préstamo abierto)' : 'Período del préstamo'}
          value={form.installmentsCount}
          onChangeText={(installmentsCount) => set({ installmentsCount })}
          keyboardType="decimal-pad"
          placeholder={agreedInstallment ? 'Opcional' : '5'}
        />
      )}
      {(calculated || agreedInstallment || (agreedTotal && form.repayment === RepaymentForm.INSTALLMENTS)) && (
        <>
          <Chips options={termUnits} value={form.termUnit} onChange={(termUnit) => set({ termUnit })} />
          {termHint && <Text style={styles.hint}>{termHint}</Text>}
        </>
      )}

      {!(agreedTotal && single) && (
        <>
          <SectionLabel>{calculated && single ? 'Cada período es' : 'Frecuencia de pago'}</SectionLabel>
          <Chips options={frequencies} value={form.frequency} onChange={(frequency) => set({ frequency })} />
        </>
      )}

      <SectionLabel>{single ? 'Fecha de pago' : 'Primer pago'}</SectionLabel>
      <Pressable style={styles.dateBtn} onPress={() => setPicker(true)} accessibilityRole="button">
        <Text style={styles.dateText}>{prettyDay(form.firstDueDate)}</Text>
      </Pressable>

      {/* Siempre: el método de mora (D20) vale para cualquier definición. Lo demás, sólo en «Calcular cuotas». */}
      <>
          <Pressable onPress={() => setAdvanced((v) => !v)} accessibilityRole="button" style={{ paddingVertical: SPACING.sm }}>
            <Text style={styles.collapse}>{advanced ? '▾' : '▸'} Opciones avanzadas</Text>
          </Pressable>
          {advanced && (
            <View style={{ gap: SPACING.xs }}>
              <SectionLabel>Cómo se cuenta la mora</SectionLabel>
              <Chips options={ARREARS_METHODS} value={form.arrearsMethod} onChange={(arrearsMethod) => set({ arrearsMethod })} />
              <Text style={styles.hint}>{ARREARS_METHOD_HINT[form.arrearsMethod]}</Text>

              {calculated && (
              <>
              {form.amortization !== AmortizationMethod.FIXED_PRINCIPAL && (
                <>
                  <SectionLabel>Tipo de interés</SectionLabel>
                  <Chips options={INTEREST_TYPES} value={form.interestType} onChange={(interestType) => set({ interestType })} />
                </>
              )}
              {ratePeriodApplies(form) && form.ratePeriod !== RatePeriod.PER_INSTALLMENT && (
                <>
                  <SectionLabel>Tipo de tasa</SectionLabel>
                  <Chips options={RATE_CONVENTIONS} value={form.rateConvention} onChange={(rateConvention) => set({ rateConvention })} />
                </>
              )}
              {rateBaseApplies(form) && (
                <>
                  <SectionLabel>Cómo se aplica el interés</SectionLabel>
                  <Chips options={RATE_BASES} value={form.rateBase} onChange={(rateBase) => set({ rateBase })} />
                </>
              )}

              {/* D18: desgravamen, % mensual sobre el saldo; baja con él. */}
              <Field
                label="Desgravamen (% mensual sobre saldo)"
                value={form.insuranceMonthlyPercent}
                onChangeText={(insuranceMonthlyPercent) => set({ insuranceMonthlyPercent })}
                keyboardType="decimal-pad"
                placeholder="Vacío = sin seguro"
              />

              {/* D18: otros cargos — por cuota, en la primera cuota o descontados del desembolso. */}
              <SectionLabel>⚙ Otros cargos</SectionLabel>
              {form.charges.map((c) => (
                <View key={c.id} style={styles.chargeCard}>
                  <Field label="Descripción" value={c.label} onChangeText={(label) => setCharge(c.id, { label })} placeholder="Comisión, gastos…" />
                  <Chips options={CHARGE_KIND_OPTIONS} value={c.kind} onChange={(kind) => setCharge(c.id, { kind })} />
                  <Field
                    label={c.kind.endsWith('percent') ? 'Valor (%)' : 'Valor (Bs)'}
                    value={c.value}
                    onChangeText={(value) => setCharge(c.id, { value })}
                    keyboardType="decimal-pad"
                    placeholder="0"
                  />
                  <Pressable onPress={() => set({ charges: form.charges.filter((x) => x.id !== c.id) })} accessibilityRole="button">
                    <Text style={styles.remove}>Quitar cargo</Text>
                  </Pressable>
                </View>
              ))}
              <Pressable onPress={addCharge} accessibilityRole="button" style={{ paddingVertical: SPACING.xs }}>
                <Text style={styles.link}>+ Agregar cargo</Text>
              </Pressable>
              </>
              )}
            </View>
          )}
      </>

      {picker && <DateTimePicker value={new Date(`${form.firstDueDate}T12:00:00Z`)} mode="date" onChange={onDate} />}
    </View>
  );
}

/**
 * Cuota · Total a cobrar · Ganancia, los avisos del motor y el acceso al plan. Mientras falten datos
 * no se muestran errores —el cobrador todavía no terminó de tipear—, sólo qué falta.
 */
export function CreditQuotePanel({ state, currency, onShowPlan }: { state: CreditFormState; currency: string; onShowPlan?: () => void }) {
  const quote = state.calculation.quote;
  const schedule = state.missing.length === 0 ? state.calculation.schedule : null;
  return (
    <View style={styles.panel}>
      {state.missing.length > 0 || !quote ? (
        <Text style={styles.hint}>Completá los datos para ver la cuota y el plan de pagos.</Text>
      ) : (
        <>
          <PanelRow label={quote.installmentVaries ? 'Primera cuota' : 'Cuota'} value={money(quote.installment, currency)} strong />
          <PanelRow label="Total a cobrar" value={quote.total != null ? money(quote.total, currency) : '—'} />
          <PanelRow label="Ganancia" value={quote.profit != null ? money(quote.profit, currency) : '—'} />
          {/* D18: lo que no es ganancia pero sí se cobra, y lo que recibe el cliente si hay descuentos. */}
          {!!quote.extras?.insuranceTotal && <PanelRow label="Desgravamen" value={money(quote.extras.insuranceTotal, currency)} />}
          {!!quote.extras?.chargesTotal && <PanelRow label="Otros cargos" value={money(quote.extras.chargesTotal, currency)} />}
          {!!quote.extras?.deducted && (
            <>
              <PanelRow label="Descontado" value={money(quote.extras.deducted, currency)} />
              <PanelRow label="Monto a entregar" value={money(quote.extras.netDisbursement, currency)} />
            </>
          )}
          {quote.total == null && <Text style={styles.hint}>Préstamo abierto: sin número de cuotas no hay total ni plan de pagos.</Text>}
        </>
      )}
      {state.issues.map((i) => (
        <Text key={i.code} style={i.severity === 'error' ? styles.error : styles.warn}>
          {TERMS_ISSUE[i.code]}
        </Text>
      ))}
      {onShowPlan && schedule && schedule.length > 0 && (
        <Pressable onPress={onShowPlan} accessibilityRole="button" style={{ paddingTop: SPACING.xs }}>
          <Text style={styles.link}>Ver plan de pagos ({schedule.length} cuotas)</Text>
        </Pressable>
      )}
    </View>
  );
}

/** El plan de pagos en una hoja inferior: cuota, fecha, capital, interés, total y saldo de capital. */
export function PlanSheet({
  visible,
  onClose,
  rows,
  currency,
  paidInstallments = 0,
  hint,
}: {
  visible: boolean;
  onClose: () => void;
  rows: CreditScheduleRow[];
  currency: string;
  /** Las primeras N ya estaban pagadas al registrarlo: se marcan. */
  paidInstallments?: number;
  hint?: string;
}) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Plan de pagos">
      {!!hint && <Text style={[styles.hint, { marginBottom: SPACING.sm }]}>{hint}</Text>}
      <ScrollView style={{ maxHeight: 420 }}>
        {rows.map((r) => (
          <View key={r.number} style={[styles.planRow, r.number <= paidInstallments && styles.planRowPaid]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.planTitle}>
                {`Cuota ${r.number} · ${prettyDay(r.dueDate)}`}
                {r.number <= paidInstallments ? ' · pagada' : ''}
              </Text>
              <Text style={styles.planSub}>
                {`Capital ${money(r.principal, currency)} · Interés ${money(r.interest, currency)}`}
                {r.insurance !== undefined ? ` · Seguro ${money(r.insurance, currency)} · Cargos ${money(r.charges ?? 0, currency)}` : ''}
                {` · Saldo ${money(r.principalBalance, currency)}`}
              </Text>
            </View>
            <Text style={styles.planAmount}>{money(r.amount, currency)}</Text>
          </View>
        ))}
      </ScrollView>
      {/*
        Compartir el plan en CSV (el mismo de la web, `paymentPlanCsv`). Va como texto por la hoja de
        compartir del teléfono: guardarlo como archivo pide expo-file-system + expo-sharing (nativos).
      */}
      <Pressable
        onPress={() => void Share.share({ title: 'Plan de pagos', message: paymentPlanCsv(rows).replace(/^﻿/, '') })}
        accessibilityRole="button"
        style={{ paddingTop: SPACING.md }}
      >
        <Text style={styles.link}>Compartir plan de pagos (CSV)</Text>
      </Pressable>
    </BottomSheet>
  );
}

/**
 * «Ya está en curso» (D13). La regla (`registeredState`) es la misma que aplica la API al guardar.
 *
 *  · **Con plan** (`situation`): sólo cuántas de las primeras cuotas ya estaban pagadas (sin huecos, hasta
 *    n − 1). Saldo, próxima cuota y mora salen de ahí (D20: la mora desde la primera cuota impaga).
 *  · **Préstamo abierto** (sin plan): no hay cuotas que marcar; saldo y días de mora se cargan a mano.
 */
export function InitialStateFields({
  value,
  onChange,
  registered,
  currency,
  situation,
  total,
}: {
  value: InitialStateForm;
  onChange: (v: InitialStateForm) => void;
  registered: RegisteredStateResult | null;
  currency: string;
  /** Cómo queda con esas cuotas pagadas (con plan). */
  situation?: RegistrationSituation | null;
  /** Número de cuotas del plan; ausente = préstamo abierto. */
  total?: number;
}) {
  const set = (p: Partial<InitialStateForm>) => onChange({ ...value, ...p });

  if (total !== undefined) {
    const typed = Number(value.paidInstallments) || 0;
    return (
      <View style={{ gap: SPACING.xs }}>
        <Field
          label={`Cuotas ya pagadas (de ${total}, máximo ${total - 1})`}
          value={value.paidInstallments}
          // Sólo el número: el saldo y la mora se derivan (se borran los manuales).
          onChangeText={(paidInstallments) => onChange({ paidInstallments, outstandingBalance: '', daysPastDue: '' })}
          keyboardType="number-pad"
          placeholder="0"
        />
        {typed >= total ? (
          <Text style={styles.error}>{INITIAL_STATE_ISSUE.PAID_INSTALLMENTS_TOO_MANY}</Text>
        ) : situation ? (
          <Text style={styles.hint}>
            {`${situation.paid} de ${situation.total} pagadas · saldo ${money(situation.outstanding, currency)} · próxima cuota N.º ${situation.next.number} (${prettyDay(situation.next.dueDate)})`}
            {situation.daysPastDue > 0
              ? ` · ${situation.daysPastDue} días de mora desde ${prettyDay(situation.arrearsSince)}`
              : ' · al día'}
          </Text>
        ) : (
          <Text style={registered && !registered.ok ? styles.error : styles.hint}>
            {registered && !registered.ok ? INITIAL_STATE_ISSUE[registered.code] : INITIAL_STATE_ISSUE.TERMS_INVALID}
          </Text>
        )}
      </View>
    );
  }

  return (
    <View style={{ gap: SPACING.xs }}>
      <Field label="Cuotas ya pagadas" value={value.paidInstallments} onChangeText={(paidInstallments) => set({ paidInstallments })} keyboardType="number-pad" placeholder="0" />
      <SectionLabel>Saldo pendiente</SectionLabel>
      <AmountInput
        value={value.outstandingBalance}
        onChangeText={(outstandingBalance) => set({ outstandingBalance })}
        currencySymbol={currency}
        // Vacío = que se derive del plan; el placeholder muestra cuánto daría.
        placeholder={registered?.ok && registered.balanceDerived ? String(registered.outstandingBalance) : '0'}
        accessibilityLabel="Saldo pendiente"
      />
      <Field label="Días de mora" value={value.daysPastDue} onChangeText={(daysPastDue) => set({ daysPastDue })} keyboardType="number-pad" placeholder="0" />
      <Text style={registered && !registered.ok ? styles.error : styles.hint}>
        {registered === null
          ? INITIAL_STATE_ISSUE.TERMS_INVALID
          : registered.ok
            ? `Queda con saldo ${money(registered.outstandingBalance, currency)} y próximo cobro el ${prettyDay(registered.nextDueDate)}.`
            : INITIAL_STATE_ISSUE[registered.code]}
      </Text>
    </View>
  );
}

function PanelRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.panelRow}>
      <Text style={styles.panelLabel}>{label}</Text>
      <Text style={[styles.panelValue, strong && styles.panelValueStrong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { ...TYPE.secondary, color: COLORS.text2 },
  error: { ...TYPE.secondary, color: COLORS.danger },
  warn: { ...TYPE.secondary, color: COLORS.warningText, backgroundColor: COLORS.warningBg, padding: SPACING.sm, borderRadius: RADIUS.input },
  link: { ...TYPE.body, color: COLORS.periwinkle, fontWeight: '600' },
  chargeCard: { gap: SPACING.xs, padding: SPACING.sm, borderRadius: RADIUS.input, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.white },
  remove: { ...TYPE.secondary, color: COLORS.danger, fontWeight: '600' },
  collapse: { ...TYPE.body, color: COLORS.navy, fontWeight: '600' },
  dateBtn: { height: 48, borderRadius: RADIUS.input, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.white, justifyContent: 'center', paddingHorizontal: SPACING.md },
  dateText: { ...TYPE.body, color: COLORS.navy },
  panel: { backgroundColor: COLORS.white, borderRadius: RADIUS.card, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, gap: SPACING.sm, marginTop: SPACING.sm },
  panelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  panelLabel: { ...TYPE.secondary, color: COLORS.text2 },
  panelValue: { ...TYPE.body, color: COLORS.navy, fontWeight: '600' },
  panelValueStrong: { ...TYPE.h2, color: COLORS.navy },
  planRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  planRowPaid: { opacity: 0.55 },
  planTitle: { ...TYPE.body, color: COLORS.text },
  planSub: { ...TYPE.caption, color: COLORS.text2 },
  planAmount: { ...TYPE.body, color: COLORS.navy, fontWeight: '600' },
});
