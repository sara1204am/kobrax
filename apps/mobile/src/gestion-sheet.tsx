/**
 * La hoja «Registrar gestión» (§5.4). Vivía dentro de `cliente/[id].tsx`; se extrajo para que la
 * ficha del deudor y la ficha de mora usen la misma. Lo único que se agregó es `outcomes`: cada
 * pantalla dice qué resultados ofrece (la mora usa los del contrato compartido).
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { AmountInput, BottomSheet, Chips, SectionLabel } from '@/ui';
import { Button, ErrorBanner, Field } from '@/components';
import { MONTHS } from '@/agenda-form';
import { promiseReady } from '@/ficha';
import type { PaymentMethod } from '@/payments.service';
import { METHODS } from '@/pay-sheet';

// Catálogo de resultado de gestión (§5.4). type = CaseActivityType, result = VisitOutcome.
/** Un resultado que ofrece la hoja. `type` es el tipo de gestión; `result`, cómo salió. */
export interface Outcome {
  key: string;
  label: string;
  type: 'CALL' | 'VISIT' | 'NOTE' | 'MESSAGE';
  result: string;
  promise?: boolean;
}

/** Los de la ficha del deudor (los de siempre). */
export const CLIENTE_OUTCOMES: Outcome[] = [
  { key: 'no_contact', label: 'No contesta', type: 'CALL', result: 'NO_CONTACT' },
  { key: 'visit', label: 'Visita', type: 'VISIT', result: 'CONTACTED' },
  { key: 'not_found', label: 'Inubicable', type: 'VISIT', result: 'NOT_FOUND' },
  { key: 'promise', label: 'Promesa de pago', type: 'NOTE', result: 'PROMISE_TO_PAY', promise: true },
];

export function todayIso(): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())).toISOString().slice(0, 10);
}
export function prettyDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Hoja Registrar gestión (§5.4). */
export function GestionSheet({
  visible, onClose, currency, onSubmit, outcomes = CLIENTE_OUTCOMES,
}: {
  visible: boolean; onClose: () => void; currency: string;
  /** Qué resultados se ofrecen; el primero es el que arranca elegido. */
  outcomes?: Outcome[];
  onSubmit: (payload: { type: 'NOTE' | 'CALL' | 'VISIT' | 'MESSAGE'; result: string; notes?: string; promise?: { amount: number; promiseDate: string; paymentMethodCode: string } }) => Promise<string | null>;
}) {
  const [outcome, setOutcome] = useState(outcomes[0].key);
  const [notes, setNotes] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayIso());
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) { setOutcome(outcomes[0].key); setNotes(''); setAmount(''); setDate(todayIso()); setMethod('CASH'); setError(null); }
  }, [visible]);

  const oc = outcomes.find((o) => o.key === outcome) ?? outcomes[0];
  const isPromise = !!oc.promise;
  const promise = { amount: Number(amount), promiseDate: date, paymentMethodCode: method };
  const valid = !isPromise || promiseReady(promise);

  const onDate = useCallback((e: DateTimePickerEvent, d?: Date) => {
    setShowPicker(false);
    if (e.type === 'set' && d) setDate(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10));
  }, []);

  const submit = useCallback(async () => {
    setSaving(true);
    setError(null);
    const err = await onSubmit({
      type: oc.type,
      result: oc.result,
      notes: notes.trim() || undefined,
      promise: isPromise ? promise : undefined,
    });
    setSaving(false);
    if (err) setError(err);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oc, notes, isPromise, amount, date, method, onSubmit]);

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Registrar gestión">
      <ErrorBanner message={error} />
      <SectionLabel>Resultado</SectionLabel>
      <Chips options={outcomes.map((o) => ({ value: o.key, label: o.label }))} value={outcome} onChange={setOutcome} />
      {isPromise && (
        <>
          <SectionLabel>Monto prometido</SectionLabel>
          <AmountInput value={amount} onChangeText={setAmount} currencySymbol={currency} accessibilityLabel="Monto prometido" />
          <SectionLabel>Pagará el</SectionLabel>
          <Pressable style={styles.dateBtn} onPress={() => setShowPicker(true)} accessibilityRole="button">
            <Text style={styles.dateText}>{prettyDate(date)}</Text>
          </Pressable>
          <SectionLabel>Medio de pago</SectionLabel>
          <Chips options={METHODS} value={method} onChange={setMethod} />
        </>
      )}
      <SectionLabel>Nota</SectionLabel>
      <Field label="" value={notes} onChangeText={setNotes} placeholder="Opcional" />
      <View style={{ marginTop: SPACING.md }}>
        <Button label="Guardar gestión" onPress={submit} loading={saving} disabled={saving || !valid} />
      </View>
      {showPicker && <DateTimePicker value={new Date(date)} mode="date" onChange={onDate} />}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  dateBtn: { height: 48, borderRadius: RADIUS.input, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.white, justifyContent: 'center', paddingHorizontal: SPACING.md },
  dateText: { ...TYPE.body, color: COLORS.navy, textTransform: 'capitalize' },
});
