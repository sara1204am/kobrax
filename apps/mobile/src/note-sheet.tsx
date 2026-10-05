/**
 * La hoja «Nota del crédito»: lo que el cobrador quiere dejar dicho (que sólo contesta de noche, que el garante
 * vive al lado…). La nota no tiene resultado ni promesa. El largo máximo es el del contrato compartido: el
 * servidor y la base lo vuelven a validar.
 *
 * Sirve para **crear** (sin `initial`) y para **corregir** (con `initial`: texto, tipo y color). El color es el del
 * post-it (paleta compartida); el tablero y las secciones ancladas son del panel.
 */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MORA_NOTE_COLORS, MORA_NOTE_KINDS, MORA_NOTE_MAX_LENGTH, type MoraNoteColor, type MoraNoteKind } from '@kobrax/shared';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { BottomSheet, Chips, SectionLabel } from '@/ui';
import { Button, ErrorBanner, Field } from '@/components';
import { NOTE_KIND_LABEL } from '@/mora';
import { NOTE_COLORS, NOTE_COLOR_LABEL, noteBodyValid } from '@/mora-ficha';

const KINDS = MORA_NOTE_KINDS.map((k) => ({ value: k, label: NOTE_KIND_LABEL[k] }));

export interface NoteDraft {
  kind: MoraNoteKind;
  body: string;
  color: MoraNoteColor;
}

export function NoteSheet({
  visible,
  onClose,
  onSubmit,
  initial,
}: {
  visible: boolean;
  onClose: () => void;
  /** `null` = guardada (o en cola); un texto = lo que hay que mostrar. */
  onSubmit: (note: NoteDraft) => Promise<string | null>;
  /** Con valor, la hoja corrige esa nota en vez de crear una. */
  initial?: NoteDraft;
}) {
  const [kind, setKind] = useState<MoraNoteKind>('INFO');
  const [color, setColor] = useState<MoraNoteColor>('YELLOW');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setKind(initial?.kind ?? 'INFO');
      setColor(initial?.color ?? 'YELLOW');
      setBody(initial?.body ?? '');
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const text = body.trim();
  const valid = noteBodyValid(body);

  async function submit() {
    setSaving(true);
    setError(null);
    const err = await onSubmit({ kind, body: text, color });
    setSaving(false);
    if (err) setError(err);
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} title={initial ? 'Editar nota' : 'Nota del crédito'}>
      <ErrorBanner message={error} />
      <SectionLabel>Tipo</SectionLabel>
      <Chips options={KINDS} value={kind} onChange={setKind} />
      <SectionLabel>Color</SectionLabel>
      <View style={styles.colors}>
        {MORA_NOTE_COLORS.map((c) => (
          <Pressable
            key={c}
            onPress={() => setColor(c)}
            accessibilityRole="button"
            accessibilityLabel={NOTE_COLOR_LABEL[c]}
            accessibilityState={{ selected: color === c }}
            style={[styles.swatch, { backgroundColor: NOTE_COLORS[c].head }, color === c && styles.swatchOn]}
          />
        ))}
      </View>
      <SectionLabel>Nota</SectionLabel>
      <Field label="" value={body} onChangeText={setBody} placeholder="Escribí lo que querés dejar dicho" multiline />
      <View style={styles.counter}>
        <Text style={[styles.count, text.length > MORA_NOTE_MAX_LENGTH && { color: COLORS.danger }]}>
          {text.length}/{MORA_NOTE_MAX_LENGTH}
        </Text>
      </View>
      <View style={{ marginTop: SPACING.md }}>
        <Button label={initial ? 'Guardar cambios' : 'Guardar nota'} onPress={submit} loading={saving} disabled={saving || !valid} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  counter: { alignItems: 'flex-end', marginTop: SPACING.xs },
  count: { ...TYPE.caption, color: COLORS.muted },
  colors: { flexDirection: 'row', gap: SPACING.sm },
  swatch: { width: 36, height: 36, borderRadius: RADIUS.pill, borderWidth: 2, borderColor: 'transparent' },
  swatchOn: { borderColor: COLORS.navy },
});
