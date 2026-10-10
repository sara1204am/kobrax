/**
 * Motivo de no pago, cuándo espera cobrar y quién responde (F4/13 · E4): el contexto opcional de una gestión.
 *
 * Lo usan la hoja «Registrar gestión» de la ficha (`gestion-sheet`) y el registro de la agenda (`agenda-register`): los
 * dos terminan en la misma bitácora y aplican la misma regla (`validateActivityContext`, en `shared`).
 *
 * Todo es opcional y **sin tocarlo la gestión es la de siempre**: lo que no se elige no viaja. Los motivos salen del
 * catálogo de la cuenta (con respaldo local sin señal); sin catálogo el bloque no se dibuja.
 */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { CatalogType, reasonsFor } from '@kobrax/shared';
import { COLORS, RADIUS, SPACING, TYPE } from './theme';
import { Chips, SectionLabel } from './ui';
import { listCatalogCached, type CatalogOption } from './catalogs.service';
import { localToday } from './mora-ficha';

/** Quién responde por el crédito. Mismos valores que `PayerParty` de shared. */
const PAYERS = [
  { value: '', label: 'Sin definir' },
  { value: 'HOLDER', label: 'El titular' },
  { value: 'GUARANTOR', label: 'El garante' },
  { value: 'CODEBTOR', label: 'El codeudor' },
  { value: 'BENEFICIARY', label: 'Para quien se sacó' },
  { value: 'NOT_LOCATED', label: 'No se lo ubica' },
];

export interface ReasonContext {
  reasonCode: string;
  /** `YYYY-MM-DD` o vacío. */
  incomeDate: string;
  payerParty: string;
}

export const emptyReasonContext = (): ReasonContext => ({ reasonCode: '', incomeDate: '', payerParty: '' });

/** Los motivos de la cuenta (con respaldo local). Vacío mientras carga o si no hay catálogo. */
export function useReasons(active: boolean): CatalogOption[] {
  const [reasons, setReasons] = useState<CatalogOption[]>([]);
  useEffect(() => {
    if (!active) return;
    let vivo = true;
    void listCatalogCached(CatalogType.NO_PAYMENT_REASON).then((r) => {
      if (vivo && r.status === 'ok') setReasons(r.data);
    });
    return () => {
      vivo = false;
    };
  }, [active]);
  return reasons;
}

/**
 * Lo que viaja con la gestión: solo lo que se eligió. La fecha solo con un motivo que la pide, y nada si el bloque no
 * está habilitado (una nota no lleva contexto).
 */
export function contextPayload(
  ctx: ReasonContext,
  reasons: CatalogOption[],
  enabled: boolean,
): { reasonCode?: string; expectedIncomeDate?: string; payerParty?: string } {
  if (!enabled) return {};
  const asks = reasons.find((r) => r.code === ctx.reasonCode)?.metadata?.asksExpectedIncomeDate === true;
  return {
    ...(ctx.reasonCode ? { reasonCode: ctx.reasonCode } : {}),
    ...(ctx.reasonCode && asks && ctx.incomeDate ? { expectedIncomeDate: ctx.incomeDate } : {}),
    ...(ctx.payerParty ? { payerParty: ctx.payerParty } : {}),
  };
}

export function ReasonBlock({
  reasons,
  incomeSource,
  value,
  onChange,
  prettyDate,
}: {
  reasons: CatalogOption[];
  /** Fuente de ingreso del cliente: filtra los motivos. Desconocida = se ofrecen todos. */
  incomeSource?: string;
  value: ReasonContext;
  onChange: (next: ReasonContext) => void;
  /** Cómo se escribe la fecha elegida (la hoja de gestión ya tiene el suyo). */
  prettyDate: (iso: string) => string;
}) {
  const [picker, setPicker] = useState(false);
  if (reasons.length === 0) return null;

  const options = reasonsFor(reasons, incomeSource);
  const selected = reasons.find((r) => r.code === value.reasonCode);
  const asksIncomeDate = selected?.metadata?.asksExpectedIncomeDate === true;
  const suggestion = typeof selected?.metadata?.suggestion === 'string' ? selected.metadata.suggestion : null;

  const onDate = (e: DateTimePickerEvent, d?: Date) => {
    setPicker(false);
    if (e.type === 'set' && d) onChange({ ...value, incomeDate: localToday(d) });
  };

  return (
    <>
      <SectionLabel>Motivo de no pago (opcional)</SectionLabel>
      <Chips
        options={[{ value: '', label: 'Sin motivo' }, ...options.map((r) => ({ value: r.code, label: r.label }))]}
        value={value.reasonCode}
        // Cambiar de motivo limpia la fecha: era del anterior y el nuevo puede no pedirla.
        onChange={(reasonCode) => onChange({ ...value, reasonCode, incomeDate: '' })}
      />
      {suggestion && <Text style={styles.hint}>{suggestion}</Text>}

      {asksIncomeDate && (
        <>
          <SectionLabel>Cuándo espera cobrar</SectionLabel>
          <Pressable style={styles.dateBtn} onPress={() => setPicker(true)} accessibilityRole="button" accessibilityLabel="Cuándo espera cobrar">
            <Text style={styles.dateText}>{value.incomeDate ? prettyDate(value.incomeDate) : 'Elegir fecha'}</Text>
          </Pressable>
        </>
      )}

      <SectionLabel>Quién responde por el crédito</SectionLabel>
      <Chips options={PAYERS} value={value.payerParty} onChange={(payerParty) => onChange({ ...value, payerParty })} />

      {picker && <DateTimePicker value={new Date(`${value.incomeDate || localToday()}T12:00:00`)} mode="date" minimumDate={new Date()} onChange={onDate} />}
    </>
  );
}

const styles = StyleSheet.create({
  dateBtn: { height: 48, borderRadius: RADIUS.input, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.white, justifyContent: 'center', paddingHorizontal: SPACING.md },
  dateText: { ...TYPE.body, color: COLORS.navy, textTransform: 'capitalize' },
  hint: { ...TYPE.caption, color: COLORS.text2, marginTop: SPACING.xs },
});
