import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { InterestBase, PaymentFrequency } from '@kobrax/shared';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { AmountInput, Chips, Header, SectionLabel } from '@/ui';
import { Button, ErrorBanner, Field } from '@/components';
import { money, MONTHS } from '@/agenda-form';
import {
  buildPrestamoPayload,
  canSubmitPrestamo,
  currentInstallment,
  initialPrestamo,
  quoteFor,
  totalBelowCapital,
  type PrestamoForm,
} from '@/prestamo-form';
import { createCredit } from '@/credits.service';
import { nuevoId } from '@/ids';
import { queueForLater } from '@/sync/sync.service';

const FREQ: { value: PaymentFrequency; label: string }[] = [
  { value: PaymentFrequency.DAILY, label: 'Diario' },
  { value: PaymentFrequency.WEEKLY, label: 'Semanal' },
  { value: PaymentFrequency.BIWEEKLY, label: 'Quincenal' },
  { value: PaymentFrequency.MONTHLY, label: 'Mensual' },
];
const BASE: { value: InterestBase; label: string }[] = [
  { value: InterestBase.PER_PERIOD, label: '% por período' },
  { value: InterestBase.TOTAL, label: '% total' },
];
const MODE: { value: 'A' | 'B'; label: string }[] = [
  { value: 'A', label: 'Cuota directa' },
  { value: 'B', label: 'Calcular cuota' },
];

function todayIso(): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())).toISOString().slice(0, 10);
}
function prettyDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** V2 — Registro de préstamo (§5.2): Modo A/B con panel en vivo, cuota congelada, éxito con accesos. */
export default function NuevoPrestamoScreen() {
  const { clientId, name } = useLocalSearchParams<{ clientId: string; name?: string }>();
  const [form, setForm] = useState<PrestamoForm>(() => initialPrestamo(todayIso()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [doneMsg, setDoneMsg] = useState<{ installment: number; nextDueDate: string } | null>(null);

  const set = useCallback((patch: Partial<PrestamoForm>) => setForm((s) => ({ ...s, ...patch })), []);
  const quote = useMemo(() => quoteFor(form), [form]);

  const onDate = useCallback(
    (e: DateTimePickerEvent, d?: Date) => {
      setShowPicker(false);
      if (e.type === 'set' && d) set({ nextDueDate: new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10) });
    },
    [set],
  );

  const submit = useCallback(async () => {
    if (!clientId) return;
    setSaving(true);
    setError(null);
    const input = { id: nuevoId(), ...buildPrestamoPayload(form, clientId) };
    const res = await createCredit(input);
    setSaving(false);

    if (res.status === 'ok' || res.status === 'offline') {
      // Sin señal el préstamo queda guardado y sube solo. Si el cliente también está en la cola,
      // va antes (es FIFO), así que cuando le toque a este su dueño ya existe en el servidor.
      if (res.status === 'offline') {
        const guardado = await queueForLater({ kind: 'credit.create', input });
        if (!guardado) return setError('Sin conexión y no se pudo guardar en el teléfono. Reintentá.');
      }
      setDoneMsg({ installment: currentInstallment(form), nextDueDate: form.nextDueDate });
      return;
    }
    if (res.status === 'unauthenticated') return setError('Tu sesión venció. Volvé a iniciar sesión.');
    setError(res.message);
  }, [clientId, form]);

  if (doneMsg) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <Header title="Préstamo registrado" />
        <View style={styles.done}>
          <Text style={styles.doneIcon}>✅</Text>
          <Text style={styles.doneTitle}>{name || 'Cliente'}</Text>
          <Text style={styles.doneLine}>Cuota {money(doneMsg.installment, 'BOB')} · vence {prettyDate(doneMsg.nextDueDate)}</Text>
          <View style={styles.doneBtns}>
            <Button label="Ver ficha" onPress={() => router.replace(`/cliente/${clientId}`)} />
            <Button
              label="Registrar otro"
              variant="ghost"
              onPress={() => {
                setForm(initialPrestamo(todayIso()));
                setDoneMsg(null);
              }}
            />
          </View>
        </View>
      </View>
    );
  }

  const isB = form.mode === 'B';
  const disabled = saving || !canSubmitPrestamo(form);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Header title="Nuevo préstamo" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <ErrorBanner message={error} />

        {!!name && (
          <View style={styles.clientCard}>
            <Text style={styles.clientName}>{name}</Text>
          </View>
        )}

        <Chips options={MODE} value={form.mode} onChange={(v) => set({ mode: v })} />

        <SectionLabel>Capital prestado</SectionLabel>
        <AmountInput value={form.principal} onChangeText={(t) => set({ principal: t })} accessibilityLabel="Capital" />

        {isB ? (
          <>
            <SectionLabel>Interés</SectionLabel>
            <Field label="Interés (%)" value={form.interestPercent} onChangeText={(t) => set({ interestPercent: t, installmentEdited: false })} keyboardType="decimal-pad" placeholder="10" />
            <Chips options={BASE} value={form.base} onChange={(v) => set({ base: v, installmentEdited: false })} />
            <Field label="Número de cuotas" value={form.installmentsCount} onChangeText={(t) => set({ installmentsCount: t, installmentEdited: false })} keyboardType="number-pad" placeholder="5" />

            <View style={styles.panel}>
              <PanelRow label="Cuota" value={money(quote.installment, 'BOB')} strong />
              <PanelRow label="Total a cobrar" value={money(quote.total, 'BOB')} />
              <PanelRow label="Ganancia" value={money(quote.profit, 'BOB')} />
            </View>
            <SectionLabel>Cuota (editable para redondeo)</SectionLabel>
            <AmountInput
              value={form.installmentEdited ? form.installment : String(quote.installment)}
              onChangeText={(t) => set({ installment: t, installmentEdited: true })}
              accessibilityLabel="Cuota"
            />
          </>
        ) : (
          <>
            <SectionLabel>Cuota</SectionLabel>
            <AmountInput value={form.installment} onChangeText={(t) => set({ installment: t })} accessibilityLabel="Cuota" />
            <Field label="Número de cuotas (vacío = préstamo abierto)" value={form.installmentsCount} onChangeText={(t) => set({ installmentsCount: t })} keyboardType="number-pad" placeholder="Opcional" />
          </>
        )}

        {totalBelowCapital(form) && (
          <Text style={styles.warn}>⚠️ El total a cobrar es menor que el capital.</Text>
        )}

        <SectionLabel>Frecuencia</SectionLabel>
        <Chips options={FREQ} value={form.frequency} onChange={(v) => set({ frequency: v })} />

        <SectionLabel>Próxima fecha de pago</SectionLabel>
        <Pressable style={styles.dateBtn} onPress={() => setShowPicker(true)} accessibilityRole="button">
          <Text style={styles.dateText}>{prettyDate(form.nextDueDate)}</Text>
        </Pressable>

        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Este préstamo ya está en curso</Text>
          <Switch value={form.inProgress} onValueChange={(v) => set({ inProgress: v })} trackColor={{ true: COLORS.purple, false: COLORS.border }} />
        </View>
        {form.inProgress && (
          <>
            <SectionLabel>Saldo actual</SectionLabel>
            <AmountInput value={form.outstandingBalance} onChangeText={(t) => set({ outstandingBalance: t })} accessibilityLabel="Saldo actual" />
            <Field label="Días de mora" value={form.daysPastDue} onChangeText={(t) => set({ daysPastDue: t })} keyboardType="number-pad" placeholder="0" />
          </>
        )}

        <Field label="Nota" value={form.notes} onChangeText={(t) => set({ notes: t })} placeholder="Opcional" />
      </ScrollView>

      <View style={styles.footer}>
        <Button label="Guardar préstamo" onPress={submit} loading={saving} disabled={disabled} />
      </View>

      {showPicker && (
        <DateTimePicker value={new Date(form.nextDueDate)} mode="date" onChange={onDate} />
      )}
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
  body: { padding: SPACING.lg, paddingBottom: SPACING.xxl, gap: SPACING.xs },
  clientCard: { backgroundColor: COLORS.highlight, borderRadius: RADIUS.card, padding: SPACING.md, marginBottom: SPACING.sm },
  clientName: { ...TYPE.h3, color: COLORS.navy },
  panel: { backgroundColor: COLORS.white, borderRadius: RADIUS.card, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, gap: SPACING.sm, marginTop: SPACING.sm },
  panelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  panelLabel: { ...TYPE.secondary, color: COLORS.text2 },
  panelValue: { ...TYPE.body, color: COLORS.navy, fontWeight: '600' },
  panelValueStrong: { ...TYPE.h2, color: COLORS.navy },
  warn: { ...TYPE.secondary, color: COLORS.warningText, backgroundColor: COLORS.warningBg, padding: SPACING.sm, borderRadius: RADIUS.input, marginTop: SPACING.sm },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: SPACING.sm, marginTop: SPACING.sm },
  switchLabel: { ...TYPE.body, color: COLORS.text, flex: 1 },
  dateBtn: { height: 48, borderRadius: RADIUS.input, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.white, justifyContent: 'center', paddingHorizontal: SPACING.md },
  dateText: { ...TYPE.body, color: COLORS.navy, textTransform: 'capitalize' },
  footer: { padding: SPACING.lg, borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.white },
  done: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl, gap: SPACING.md },
  doneIcon: { fontSize: 48 },
  doneTitle: { ...TYPE.h2, color: COLORS.navy },
  doneLine: { ...TYPE.body, color: COLORS.text2, textAlign: 'center' },
  doneBtns: { alignSelf: 'stretch', gap: SPACING.sm, marginTop: SPACING.lg },
});
