/**
 * La hoja «Registrar gestión» (§5.4). Vivía dentro de `cliente/[id].tsx`; se extrajo para que la
 * ficha del deudor y la ficha de mora usen la misma, por crédito y con los resultados del contrato compartido
 * (`MORA_OUTCOMES`: cada par tipo/resultado lo acepta el validador del servidor).
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { AmountInput, BottomSheet, Chips, SectionLabel } from '@/ui';
import { Button, ErrorBanner, Field } from '@/components';
import { MONTHS } from '@/agenda-form';
import { CatalogType } from '@kobrax/shared';
import { listCatalogCached } from '@/catalogs.service';
import { gestionError, localToday } from '@/mora-ficha';
import { METHODS } from '@/pay-sheet';
import { MORA_OUTCOMES } from '@/mora-actions';

/** Un resultado que ofrece la hoja. `type` es el tipo de gestión; `result`, cómo salió (contrato de shared). */
export interface Outcome {
  key: string;
  label: string;
  type: 'CALL' | 'VISIT' | 'NOTE' | 'MESSAGE';
  result: string;
  promise?: boolean;
}

export function todayIso(): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())).toISOString().slice(0, 10);
}
export function prettyDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Un medio de pago que ofrece la hoja: el del catálogo del tenant, o los de siempre si no lo cargó. */
interface MethodOption {
  value: string;
  label: string;
  requiresBank: boolean;
}
const FALLBACK_METHOD_OPTIONS: MethodOption[] = METHODS.map((m) => ({ value: m.value, label: m.label, requiresBank: false }));

/** Hoja Registrar gestión (§5.4). */
export function GestionSheet({
  visible, onClose, currency, onSubmit, outcomes = MORA_OUTCOMES,
}: {
  visible: boolean; onClose: () => void; currency: string;
  /** Qué resultados se ofrecen; el primero es el que arranca elegido. Por defecto los del contrato de gestiones (`MORA_OUTCOMES`). */
  outcomes?: Outcome[];
  onSubmit: (payload: {
    type: 'NOTE' | 'CALL' | 'VISIT' | 'MESSAGE';
    result: string;
    notes?: string;
    promise?: { amount: number; promiseDate: string; paymentMethodCode: string; bankCode?: string };
  }) => Promise<string | null>;
}) {
  const [outcome, setOutcome] = useState(outcomes[0].key);
  const [notes, setNotes] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(localToday());
  const [methods, setMethods] = useState<MethodOption[]>(FALLBACK_METHOD_OPTIONS);
  const [banks, setBanks] = useState<{ value: string; label: string }[]>([]);
  const [method, setMethod] = useState<string>(FALLBACK_METHOD_OPTIONS[0]!.value);
  const [bank, setBank] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setOutcome(outcomes[0].key); setNotes(''); setAmount(''); setDate(localToday()); setMethod(FALLBACK_METHOD_OPTIONS[0]!.value); setBank(''); setError(null);
    // Los catálogos del tenant (con respaldo local): sin ellos se ofrecen los medios de siempre y no se pide banco.
    void Promise.all([listCatalogCached(CatalogType.PAYMENT_METHOD), listCatalogCached(CatalogType.BANK)]).then(([pm, bk]) => {
      if (pm.status === 'ok' && pm.data.length > 0) {
        const opts = pm.data.map((o) => ({ value: o.code, label: o.label, requiresBank: !!o.metadata?.requiresBank }));
        setMethods(opts);
        setMethod(opts[0]!.value);
      }
      if (bk.status === 'ok') setBanks(bk.data.map((o) => ({ value: o.code, label: o.label })));
    });
  }, [visible]);

  const oc = outcomes.find((o) => o.key === outcome) ?? outcomes[0];
  const isPromise = !!oc.promise;
  // El banco sólo se pide si el medio lo exige (`requiresBank`) y el tenant tiene bancos cargados.
  const bankRequired = isPromise && banks.length > 0 && !!methods.find((m) => m.value === method)?.requiresBank;
  const promise = { amount: Number(amount.replace(',', '.')), promiseDate: date, paymentMethodCode: method, ...(bankRequired && bank ? { bankCode: bank } : {}) };

  const onDate = useCallback((e: DateTimePickerEvent, d?: Date) => {
    setShowPicker(false);
    if (e.type === 'set' && d) setDate(localToday(d));
  }, []);

  const submit = useCallback(async () => {
    const payload = { type: oc.type, result: oc.result, notes: notes.trim() || undefined, promise: isPromise ? promise : undefined };
    // La misma regla que la API y el panel, ANTES de encolar: una promesa con fecha pasada no tiene que quedar en la cola
    // para ser rechazada horas después, cuando el cobrador ya no puede corregirla.
    const invalid = gestionError(payload, localToday(), { bankRequired });
    if (invalid) return setError(invalid);
    setSaving(true);
    setError(null);
    const err = await onSubmit(payload);
    setSaving(false);
    if (err) setError(err);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oc, notes, isPromise, amount, date, method, bank, bankRequired, onSubmit]);

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
          <Chips options={methods} value={method} onChange={(v) => { setMethod(v); setBank(''); }} />
          {bankRequired && (
            <>
              <SectionLabel>Banco</SectionLabel>
              <Chips options={banks} value={bank} onChange={setBank} />
            </>
          )}
        </>
      )}
      <SectionLabel>Nota</SectionLabel>
      <Field label="" value={notes} onChangeText={setNotes} placeholder="Opcional" />
      <View style={{ marginTop: SPACING.md }}>
        <Button label="Guardar gestión" onPress={submit} loading={saving} disabled={saving} />
      </View>
      {showPicker && <DateTimePicker value={new Date(`${date}T12:00:00`)} mode="date" minimumDate={new Date()} onChange={onDate} />}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  dateBtn: { height: 48, borderRadius: RADIUS.input, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.white, justifyContent: 'center', paddingHorizontal: SPACING.md },
  dateText: { ...TYPE.body, color: COLORS.navy, textTransform: 'capitalize' },
});
