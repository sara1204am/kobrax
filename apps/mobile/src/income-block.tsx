/**
 * Perfil de ingreso del cliente (F4/13 · E3): de qué vive y cuándo le llega el dinero.
 *
 * Solo pinta. Qué es válido y qué se manda lo deciden `income-profile.ts` y `buildClientePayload`, en `shared` (la web
 * usa las mismas reglas). Todo es opcional.
 *
 * Los catálogos (`INCOME_SOURCE`, `OCCUPATION`) salen del respaldo local sin señal. Si el de rubros no existe, ese
 * selector no se dibuja y el resto sigue funcionando.
 *
 * Dos comodidades que no obligan a nada: al elegir un rubro se **proponen** su fuente y su ciclo si todavía no hay; y
 * el rubro se filtra por la fuente, pero si la fuente no se conoce se ofrecen todos.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  CatalogType,
  INCOME_CYCLES,
  INCOME_NOTES_MAX_LENGTH,
  INCOME_SOURCE_CODES,
  cycleHasDay,
  dayRangeOf,
  incomeFormError,
  type IncomeProfile,
  type IncomeProfileForm,
} from '@kobrax/shared';
import { listCatalogCached, type CatalogOption } from './catalogs.service';
import { COLORS, SPACING, TYPE } from './theme';
import { Chips, SectionLabel } from './ui';
import { Field } from './components';

const SOURCE_DEFAULT: Record<(typeof INCOME_SOURCE_CODES)[number], string> = {
  EMPLOYEE: 'Asalariado o profesional',
  BUSINESS: 'Comerciante o productivo',
  OTHER: 'Otro',
};
const CYCLE_LABEL: Record<string, string> = {
  DAILY: 'Todos los días',
  WEEKLY: 'Cada semana',
  BIWEEKLY: 'Cada quincena',
  MONTHLY: 'Cada mes',
  QUARTERLY: 'Cada tres meses',
  SEASONAL: 'Por temporada',
  IRREGULAR: 'Sin ritmo fijo',
};
const WEEKDAY = [
  { value: '1', label: 'Lun' },
  { value: '2', label: 'Mar' },
  { value: '3', label: 'Mié' },
  { value: '4', label: 'Jue' },
  { value: '5', label: 'Vie' },
  { value: '6', label: 'Sáb' },
  { value: '7', label: 'Dom' },
];
const WEEKDAY_LONG: Record<number, string> = { 1: 'lunes', 2: 'martes', 3: 'miércoles', 4: 'jueves', 5: 'viernes', 6: 'sábado', 7: 'domingo' };

function useCatalog(type: CatalogType): CatalogOption[] {
  const [options, setOptions] = useState<CatalogOption[]>([]);
  useEffect(() => {
    let vivo = true;
    void listCatalogCached(type).then((r) => {
      if (vivo && r.status === 'ok') setOptions(r.data);
    });
    return () => {
      vivo = false;
    };
  }, [type]);
  return options;
}

/** Código → rótulo de un catálogo. Vacío mientras carga o si no existe. */
export function useCatalogLabels(type: CatalogType): Map<string, string> {
  const options = useCatalog(type);
  return new Map(options.map((o) => [o.code, o.label]));
}

/**
 * El perfil en líneas legibles para la ficha: «Funcionario público · cobra cada tres meses (día 15)».
 * Vacío si el cliente no tiene perfil.
 */
export function describeIncome(
  profile: IncomeProfile | null | undefined,
  labels?: { sources?: Map<string, string>; occupations?: Map<string, string> },
): string {
  if (!profile) return '';
  const parts: string[] = [];
  if (profile.occupationCode) parts.push(labels?.occupations?.get(profile.occupationCode) ?? profile.occupationCode);
  else if (profile.incomeSourceCode) parts.push(labels?.sources?.get(profile.incomeSourceCode) ?? SOURCE_DEFAULT[profile.incomeSourceCode] ?? profile.incomeSourceCode);
  if (profile.incomeCycle) {
    let ciclo = CYCLE_LABEL[profile.incomeCycle] ?? profile.incomeCycle;
    if (profile.incomeDay != null) {
      ciclo += profile.incomeCycle === 'WEEKLY' ? ` (${WEEKDAY_LONG[profile.incomeDay] ?? profile.incomeDay})` : ` (día ${profile.incomeDay})`;
    }
    parts.push(ciclo);
  }
  if (profile.notes) parts.push(profile.notes);
  return parts.join(' · ');
}

export function IncomeBlock({ value, onChange }: { value: IncomeProfileForm; onChange: (next: IncomeProfileForm) => void }) {
  const sources = useCatalog(CatalogType.INCOME_SOURCE);
  const occupations = useCatalog(CatalogType.OCCUPATION);
  const set = (patch: Partial<IncomeProfileForm>) => onChange({ ...value, ...patch });
  const error = incomeFormError(value);
  const range = dayRangeOf(value.incomeCycle);

  const sourceOptions = [
    { value: '', label: 'Sin definir' },
    ...(sources.length > 0 ? sources.map((s) => ({ value: s.code, label: s.label })) : INCOME_SOURCE_CODES.map((c) => ({ value: c as string, label: SOURCE_DEFAULT[c] }))),
  ];

  // El rubro se filtra por la fuente, pero conserva el ya guardado aunque la cuenta lo haya sacado del catálogo.
  const visible = value.incomeSourceCode
    ? occupations.filter((o) => !o.metadata?.incomeSource || o.metadata.incomeSource === value.incomeSourceCode || o.code === value.occupationCode)
    : occupations;
  const occupationOptions = [
    { value: '', label: 'Sin definir' },
    ...visible.map((o) => ({ value: o.code, label: o.label })),
    ...(value.occupationCode && !visible.some((o) => o.code === value.occupationCode) ? [{ value: value.occupationCode, label: value.occupationCode }] : []),
  ];

  function pickOccupation(code: string) {
    const meta = occupations.find((o) => o.code === code)?.metadata ?? null;
    const patch: Partial<IncomeProfileForm> = { occupationCode: code };
    if (code && !value.incomeSourceCode && meta?.incomeSource) patch.incomeSourceCode = meta.incomeSource;
    if (code && !value.incomeCycle && meta?.defaultCycle) patch.incomeCycle = meta.defaultCycle;
    set(patch);
  }

  // El día que ya no corresponde se va con el ciclo: un «15» huérfano en «diario» lo rechazaría el servidor.
  const pickCycle = (cycle: string) => set({ incomeCycle: cycle, ...(cycleHasDay(cycle) ? {} : { incomeDay: '' }) });

  return (
    <View style={styles.box}>
      <Text style={styles.hint}>Opcional. De qué vive y cuándo le llega el dinero: con eso no se le insiste antes de que cobre.</Text>

      <SectionLabel>Fuente de ingreso</SectionLabel>
      <Chips options={sourceOptions} value={value.incomeSourceCode} onChange={(v) => set({ incomeSourceCode: v })} />

      {occupations.length > 0 && (
        <>
          <SectionLabel>Rubro</SectionLabel>
          <Chips options={occupationOptions} value={value.occupationCode} onChange={pickOccupation} />
        </>
      )}

      <SectionLabel>Cada cuánto le llega el dinero</SectionLabel>
      <Chips
        options={[{ value: '', label: 'Sin definir' }, ...INCOME_CYCLES.map((c) => ({ value: c as string, label: CYCLE_LABEL[c] ?? c }))]}
        value={value.incomeCycle}
        onChange={pickCycle}
      />

      {range && value.incomeCycle === 'WEEKLY' && (
        <>
          <SectionLabel>Día de la semana</SectionLabel>
          <Chips options={[{ value: '', label: '—' }, ...WEEKDAY]} value={value.incomeDay} onChange={(v) => set({ incomeDay: v })} />
        </>
      )}
      {range && value.incomeCycle !== 'WEEKLY' && (
        <Field
          label="Día del mes"
          value={value.incomeDay}
          onChangeText={(t) => set({ incomeDay: t.replace(/\D/g, '').slice(0, 2) })}
          keyboardType="number-pad"
          placeholder="15"
          maxLength={2}
          error={error === 'DAY_INVALID'}
        />
      )}
      {error === 'DAY_INVALID' && <Text style={styles.error}>El día no corresponde al ciclo elegido.</Text>}

      <Field label="Detalle" value={value.notes} onChangeText={(t) => set({ notes: t })} placeholder="Ej.: cobra en la alcaldía, le atrasan el flete" maxLength={INCOME_NOTES_MAX_LENGTH} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: SPACING.xs },
  hint: { ...TYPE.caption, color: COLORS.muted, marginBottom: SPACING.xs },
  error: { ...TYPE.caption, color: COLORS.danger },
});
