/**
 * La hoja «Nota del crédito»: lo que el cobrador quiere dejar dicho (que sólo contesta de noche, que el garante
 * vive al lado…). La nota no tiene resultado ni promesa. El largo máximo es el del contrato compartido: el
 * servidor y la base lo vuelven a validar.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MORA_NOTE_KINDS, MORA_NOTE_MAX_LENGTH, type MoraNoteKind, type NewCreditNote } from '@kobrax/shared';
import { COLORS, SPACING, TYPE } from '@/theme';
import { BottomSheet, Chips, SectionLabel } from '@/ui';
import { Button, ErrorBanner, Field } from '@/components';
import { NOTE_KIND_LABEL } from '@/mora';

const KINDS = MORA_NOTE_KINDS.map((k) => ({ value: k, label: NOTE_KIND_LABEL[k] }));

export function NoteSheet({
  visible,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  /** `null` = guardada (o en cola); un texto = lo que hay que mostrar. */
  onSubmit: (note: NewCreditNote) => Promise<string | null>;
}) {
  const [kind, setKind] = useState<MoraNoteKind>('INFO');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setKind('INFO');
      setBody('');
      setError(null);
    }
  }, [visible]);

  const text = body.trim();
  const valid = text.length > 0 && text.length <= MORA_NOTE_MAX_LENGTH;

  async function submit() {
    setSaving(true);
    setError(null);
    const err = await onSubmit({ kind, body: text });
    setSaving(false);
    if (err) setError(err);
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Nota del crédito">
      <ErrorBanner message={error} />
      <SectionLabel>Tipo</SectionLabel>
      <Chips options={KINDS} value={kind} onChange={setKind} />
      <SectionLabel>Nota</SectionLabel>
      <Field label="" value={body} onChangeText={setBody} placeholder="Escribí lo que querés dejar dicho" multiline />
      <View style={styles.counter}>
        <Text style={[styles.count, text.length > MORA_NOTE_MAX_LENGTH && { color: COLORS.danger }]}>
          {text.length}/{MORA_NOTE_MAX_LENGTH}
        </Text>
      </View>
      <View style={{ marginTop: SPACING.md }}>
        <Button label="Guardar nota" onPress={submit} loading={saving} disabled={saving || !valid} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  counter: { alignItems: 'flex-end', marginTop: SPACING.xs },
  count: { ...TYPE.caption, color: COLORS.muted },
});
