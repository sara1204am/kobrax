import { useState } from 'react';
import { router } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { Button } from '@/components';
import { Header, SectionLabel } from '@/ui';

/** Tipos de gestión (mapean a CaseActivityType: CALL / VISIT / MESSAGE). */
const TYPES = [
  { key: 'CALL', label: 'Llamada', icon: '📞' },
  { key: 'VISIT', label: 'Visita', icon: '📍' },
  { key: 'MESSAGE', label: 'WhatsApp', icon: '💬' },
];

/**
 * Nueva gestión (Figma). Alta de una gestión sobre un caso (`POST /cases/:id/activities`).
 * ponytail: SCAFFOLD navegable de P1 — la escritura real (elegir caso + guardar en la cola
 * offline) es P2. El "Guardar" avisa hasta que P2 lo cablee.
 */
export default function NuevaGestionScreen() {
  const [type, setType] = useState('CALL');
  const [notes, setNotes] = useState('');

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Header title="Nueva gestión" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.md }}>
        <SectionLabel>Tipo de gestión</SectionLabel>
        <View style={styles.typeRow}>
          {TYPES.map((t) => {
            const active = t.key === type;
            return (
              <Pressable
                key={t.key}
                onPress={() => setType(t.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[styles.type, active && styles.typeActive]}
              >
                <Text style={styles.typeIcon}>{t.icon}</Text>
                <Text style={[styles.typeLabel, { color: active ? COLORS.white : COLORS.text2 }]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <SectionLabel>Cliente</SectionLabel>
        <Pressable
          style={styles.field}
          onPress={() => Alert.alert('Seleccionar cliente', 'El buscador de clientes llega con la escritura (P2).')}
        >
          <Text style={{ ...TYPE.body, color: COLORS.muted }}>Seleccioná un cliente…</Text>
        </Pressable>

        <SectionLabel>Notas</SectionLabel>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Detalle de la gestión…"
          placeholderTextColor={COLORS.muted}
          multiline
          style={[styles.field, styles.notes]}
        />

        <SectionLabel>Próximo contacto</SectionLabel>
        <Pressable
          style={styles.field}
          onPress={() => Alert.alert('Próximo contacto', 'El selector de fecha/hora llega con la escritura (P2).')}
        >
          <Text style={{ ...TYPE.body, color: COLORS.muted }}>Programar fecha y hora…</Text>
        </Pressable>

        <View style={{ height: SPACING.md }} />
        <Button
          label="Guardar gestión"
          onPress={() =>
            Alert.alert('Nueva gestión', 'El guardado (con cola offline) se habilita en la próxima etapa (P2).')
          }
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  typeRow: { flexDirection: 'row', gap: SPACING.sm },
  type: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: SPACING.md,
  },
  typeActive: { backgroundColor: COLORS.purple, borderColor: COLORS.purple },
  typeIcon: { fontSize: 20 },
  typeLabel: { ...TYPE.secondary, fontWeight: '600' },
  field: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.input,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    minHeight: 48,
    justifyContent: 'center',
  },
  notes: { minHeight: 100, textAlignVertical: 'top', ...TYPE.body },
});
