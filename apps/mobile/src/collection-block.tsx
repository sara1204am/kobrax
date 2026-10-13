/**
 * «Cómo cobrarle» en un lugar (F4/13 · E2): cobrar todos los días en el negocio, recoger la cuota porque no tiene
 * tiempo, la franja, quién entrega. Es lo que hoy vive en la memoria del cobrador.
 *
 * Solo pinta. Qué es válido y qué se manda lo deciden `collection-profile.ts` y `buildClientePayload`, en `shared`
 * (la web usa las mismas reglas). Todo es opcional: dejarlo en blanco no es un error.
 *
 * Sin señal el catálogo de modalidades sale del respaldo local (`listCatalog` → `cachedList`); si no hay ninguno, el
 * selector de modalidad no se dibuja y el resto sigue funcionando.
 */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  COLLECTION_FREQUENCIES,
  COLLECTION_NOTE_MAX_LENGTH,
  CatalogType,
  HANDOVER_PARTIES,
  collectionFormError,
  type CollectionProfile,
  type CollectionProfileForm,
} from '@kobrax/shared';
import { listCatalogCached, type CatalogOption } from './catalogs.service';
import { COLORS, RADIUS, SPACING, TYPE } from './theme';
import { Chips, SectionLabel } from './ui';
import { Field } from './components';

const FREQUENCY_LABEL: Record<(typeof COLLECTION_FREQUENCIES)[number], string> = {
  DAILY: 'Todos los días',
  WEEKLY: 'Una vez por semana',
  PER_INSTALLMENT: 'Según las cuotas',
};
const HANDOVER_LABEL: Record<(typeof HANDOVER_PARTIES)[number], string> = {
  HOLDER: 'El titular',
  FAMILY: 'Un familiar',
  EMPLOYEE: 'Un empleado',
};
/** Lunes a domingo, ISO (1–7): la misma numeración que valida `shared`. */
const DAYS = [
  { n: 1, label: 'L' },
  { n: 2, label: 'M' },
  { n: 3, label: 'X' },
  { n: 4, label: 'J' },
  { n: 5, label: 'V' },
  { n: 6, label: 'S' },
  { n: 7, label: 'D' },
] as const;

/** Código → rótulo de las modalidades de la cuenta. Vacío mientras carga o si no hay catálogo. */
export function useModalityLabels(): Map<string, string> {
  const [labels, setLabels] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let vivo = true;
    void listCatalogCached(CatalogType.COLLECTION_MODALITY).then((r) => {
      if (vivo && r.status === 'ok') setLabels(new Map(r.data.map((o) => [o.code, o.label])));
    });
    return () => {
      vivo = false;
    };
  }, []);
  return labels;
}

/**
 * El perfil en una línea para la ficha: «Recoger la cuota · Todos los días · 08:00–10:00 · Lun a Sáb».
 * Vacío si el lugar no tiene perfil: una dirección antigua no muestra nada de más.
 */
export function describeCollection(profile: CollectionProfile | null | undefined, modalityLabels?: Map<string, string>): string {
  if (!profile) return '';
  const parts: string[] = [];
  if (profile.modality) parts.push(modalityLabels?.get(profile.modality) ?? profile.modality);
  if (profile.frequency) parts.push(FREQUENCY_LABEL[profile.frequency]);
  if (profile.window) parts.push(`${profile.window.from}–${profile.window.to}`);
  if (profile.days && profile.days.length > 0 && profile.days.length < 7) {
    parts.push(profile.days.map((d) => DAYS.find((x) => x.n === d)?.label ?? '').filter(Boolean).join(' '));
  }
  if (profile.handoverBy) parts.push(HANDOVER_LABEL[profile.handoverBy]);
  return parts.join(' · ');
}

export function CollectionBlock({ value, onChange }: { value: CollectionProfileForm; onChange: (next: CollectionProfileForm) => void }) {
  const [modalities, setModalities] = useState<CatalogOption[]>([]);
  useEffect(() => {
    let vivo = true;
    void listCatalogCached(CatalogType.COLLECTION_MODALITY).then((r) => {
      if (vivo && r.status === 'ok') setModalities(r.data);
    });
    return () => {
      vivo = false;
    };
  }, []);

  const set = (patch: Partial<CollectionProfileForm>) => onChange({ ...value, ...patch });
  const error = collectionFormError(value);

  // Conserva una modalidad ya guardada que la cuenta sacó del catálogo: mostrarla vacía y guardar la borraría.
  const known = modalities.map((m) => ({ value: m.code, label: m.label }));
  const options = [
    { value: '', label: 'Sin definir' },
    ...known,
    ...(value.modality && !known.some((m) => m.value === value.modality) ? [{ value: value.modality, label: value.modality }] : []),
  ];
  const toggleDay = (n: number) => set({ days: value.days.includes(n) ? value.days.filter((d) => d !== n) : [...value.days, n].sort((a, b) => a - b) });

  return (
    <View style={styles.box}>
      <Text style={styles.title}>Cómo cobrarle</Text>
      <Text style={styles.hint}>Opcional. Lo que el cobrador necesita saber antes de llegar.</Text>

      {known.length > 0 && (
        <>
          <SectionLabel>Modalidad</SectionLabel>
          <Chips options={options} value={value.modality} onChange={(v) => set({ modality: v })} />
        </>
      )}

      <SectionLabel>Frecuencia</SectionLabel>
      <Chips
        options={[{ value: '', label: 'Sin definir' }, ...COLLECTION_FREQUENCIES.map((f) => ({ value: f as string, label: FREQUENCY_LABEL[f] }))]}
        value={value.frequency}
        onChange={(v) => set({ frequency: v })}
      />

      <SectionLabel>Franja del día</SectionLabel>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Field label="Desde (HH:mm)" value={value.windowFrom} onChangeText={(t) => set({ windowFrom: t })} placeholder="08:00" keyboardType="numbers-and-punctuation" maxLength={5} error={error === 'WINDOW_INVALID'} />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Hasta (HH:mm)" value={value.windowTo} onChangeText={(t) => set({ windowTo: t })} placeholder="10:00" keyboardType="numbers-and-punctuation" maxLength={5} error={error === 'WINDOW_INVALID'} />
        </View>
      </View>
      {error === 'WINDOW_INVALID' && <Text style={styles.error}>La franja necesita las dos horas, y «hasta» tiene que ser después de «desde».</Text>}

      <SectionLabel>Días</SectionLabel>
      <View style={styles.row}>
        {DAYS.map((d) => {
          const on = value.days.includes(d.n);
          return (
            <Pressable key={d.n} onPress={() => toggleDay(d.n)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.day, on && styles.dayOn]}>
              <Text style={[styles.dayText, on && styles.dayTextOn]}>{d.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <SectionLabel>Quién entrega</SectionLabel>
      <Chips
        options={[{ value: '', label: 'Sin definir' }, ...HANDOVER_PARTIES.map((h) => ({ value: h as string, label: HANDOVER_LABEL[h] }))]}
        value={value.handoverBy}
        onChange={(v) => set({ handoverBy: v })}
      />

      <Field label="Indicación" value={value.note} onChangeText={(t) => set({ note: t })} placeholder="Ej.: tocar el portón verde" maxLength={COLLECTION_NOTE_MAX_LENGTH} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginTop: SPACING.md, padding: SPACING.md, borderRadius: RADIUS.input, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.white },
  title: { ...TYPE.h3, color: COLORS.navy },
  hint: { ...TYPE.caption, color: COLORS.muted, marginBottom: SPACING.sm },
  row: { flexDirection: 'row', gap: SPACING.sm, flexWrap: 'wrap' },
  error: { ...TYPE.caption, color: COLORS.danger, marginTop: SPACING.xs },
  day: { minWidth: 40, height: 40, borderRadius: RADIUS.input, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.white },
  dayOn: { borderColor: COLORS.purple, backgroundColor: COLORS.highlight },
  dayText: { ...TYPE.body, color: COLORS.text2 },
  dayTextOn: { color: COLORS.navy, fontWeight: '600' },
});
