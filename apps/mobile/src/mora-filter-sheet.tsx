/**
 * La hoja «Filtros» de la lista de mora: rango de días de mora y de saldo, fuente (Kobrax / PSF), categoría de
 * mora (las de la cuenta, de `GET /arrear-categories`), prioridad y castigados. Se suma a los chips de siempre.
 *
 * Los criterios se aplican en el teléfono sobre lo ya bajado (`matchesMoraFilters`): funciona sin señal. Las
 * categorías las configura la cuenta; si la lista no se pudo leer (sin señal y sin copia) el filtro de categoría
 * simplemente no se ofrece, no se inventa.
 */
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { COLLECTION_PRIORITIES } from '@kobrax/shared';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { BottomSheet, Chips, PRIORITY_LABEL, SectionLabel } from '@/ui';
import { Button, Field } from '@/components';
import { EMPTY_MORA_FILTERS, type MoraFilters, type MoraSourceFilter, type MoraWrittenOffFilter } from '@/mora';

export interface CategoryOption {
  code: string;
  name: string;
}

const SOURCES: { value: MoraSourceFilter; label: string }[] = [
  { value: 'ALL', label: 'Todas' },
  { value: 'KOBRAX', label: 'Kobrax' },
  { value: 'PSF', label: 'PSF' },
];

const WRITTEN_OFF: { value: MoraWrittenOffFilter; label: string }[] = [
  { value: 'ALL', label: 'Todos' },
  { value: 'EXCLUDE', label: 'Sin castigados' },
  { value: 'ONLY', label: 'Sólo castigados' },
];

/** Alterna un valor de una lista (selección múltiple). */
export function toggle(list: readonly string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function MultiChips({ options, value, onChange }: { options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <View style={styles.wrap}>
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(toggle(value, o.value))}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[styles.chip, on && styles.chipOn]}
          >
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Dos casillas «Desde / Hasta» numéricas. */
function Range({ label, min, max, onMin, onMax }: { label: string; min: string; max: string; onMin: (v: string) => void; onMax: (v: string) => void }) {
  return (
    <>
      <SectionLabel>{label}</SectionLabel>
      <View style={styles.range}>
        <View style={{ flex: 1 }}>
          <Field label="Desde" value={min} onChangeText={onMin} keyboardType="decimal-pad" placeholder="—" accessibilityLabel={`${label}: desde`} />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Hasta" value={max} onChangeText={onMax} keyboardType="decimal-pad" placeholder="—" accessibilityLabel={`${label}: hasta`} />
        </View>
      </View>
    </>
  );
}

export function MoraFilterSheet({
  visible,
  onClose,
  value,
  onApply,
  categories,
}: {
  visible: boolean;
  onClose: () => void;
  value: MoraFilters;
  onApply: (f: MoraFilters) => void;
  /** Las categorías de la cuenta. Vacío = no se ofrece el filtro. */
  categories: CategoryOption[];
}) {
  const [draft, setDraft] = useState<MoraFilters>(value);
  useEffect(() => {
    if (visible) setDraft(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const set = <K extends keyof MoraFilters>(k: K, v: MoraFilters[K]) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Filtros">
      <ScrollView style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled">
        <Range label="Días de mora" min={draft.dpdMin} max={draft.dpdMax} onMin={(v) => set('dpdMin', v)} onMax={(v) => set('dpdMax', v)} />
        <Range label="Saldo" min={draft.balanceMin} max={draft.balanceMax} onMin={(v) => set('balanceMin', v)} onMax={(v) => set('balanceMax', v)} />
        <SectionLabel>Fuente</SectionLabel>
        <Chips options={SOURCES} value={draft.source} onChange={(v) => set('source', v)} />
        {categories.length > 0 && (
          <>
            <SectionLabel>Categoría de mora</SectionLabel>
            <MultiChips
              options={categories.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))}
              value={draft.categories}
              onChange={(v) => set('categories', v)}
            />
          </>
        )}
        <SectionLabel>Prioridad</SectionLabel>
        <MultiChips
          options={COLLECTION_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
          value={draft.priorities}
          onChange={(v) => set('priorities', v)}
        />
        <SectionLabel>Castigados</SectionLabel>
        <Chips options={WRITTEN_OFF} value={draft.writtenOff} onChange={(v) => set('writtenOff', v)} />
      </ScrollView>
      <View style={styles.actions}>
        <View style={{ flex: 1 }}>
          <Button label="Limpiar" variant="ghost" onPress={() => setDraft(EMPTY_MORA_FILTERS)} />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label="Aplicar"
            onPress={() => {
              onApply(draft);
              onClose();
            }}
          />
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  chip: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.white },
  chipOn: { backgroundColor: COLORS.navy, borderColor: COLORS.navy },
  chipText: { ...TYPE.secondary, color: COLORS.text, fontWeight: '600' },
  chipTextOn: { color: COLORS.white },
  range: { flexDirection: 'row', gap: SPACING.md },
  actions: { flexDirection: 'row', gap: SPACING.md, marginTop: SPACING.md },
});
