import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { COLORS, SPACING, TYPE } from '@/theme';
import { Header, OfflineIndicator, PickerSheet, SectionLabel, SelectRow } from '@/ui';
import { Button, ErrorBanner, Field } from '@/components';
import { useNetStore } from '@/store/net';
import { roleOptions, validateInvite, type InviteForm } from '@/account-form';
import { CodigoInvitacion } from '@/codigo-invitacion';
import { inviteMember, listRoles, type InvitedMember, type Role } from '@/users.service';

const EMPTY: InviteForm = { firstName: '', lastName: '', email: '', roleId: '' };

/**
 * Invitar a un miembro (CUENTA S2). El nombre lo pone quien invita (S2-D4): así la lista
 * muestra a la persona desde el minuto cero y no un correo suelto.
 *
 * Al terminar **no se vuelve directo**: se muestra el código, que es lo único que hay si el
 * correo no llega (S2-D9). Compartirlo por WhatsApp es el camino real en campo.
 */
export default function InvitarScreen() {
  const [form, setForm] = useState<InviteForm>(EMPTY);
  const [roles, setRoles] = useState<Role[]>([]);
  const [sheet, setSheet] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invitado, setInvitado] = useState<InvitedMember | null>(null);
  const online = useNetStore((s) => s.isConnected);

  useEffect(() => {
    void (async () => {
      const res = await listRoles();
      if (res.status === 'ok') setRoles(res.data);
    })();
  }, []);

  const set = (k: keyof InviteForm) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const opciones = roleOptions(roles);
  const rolElegido = opciones.find((o) => o.key === form.roleId);

  async function enviar() {
    const invalid = validateInvite(form);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    setLoading(true);
    const res = await inviteMember({
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim().toLowerCase(),
      roleId: form.roleId,
    });
    setLoading(false);
    if (res.status === 'ok') {
      setInvitado(res.data);
      return;
    }
    setError(
      res.status === 'offline'
        ? 'Sin conexión. Para invitar necesitás internet.'
        : res.status === 'error'
          ? res.message
          : 'Tu sesión venció.',
    );
  }

  if (invitado) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <Header title="Invitación enviada" onBack={() => router.back()} />
        <ScrollView contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.md }}>
          <Text style={styles.ok}>Le mandamos un correo a {invitado.email}.</Text>
          <Text style={{ ...TYPE.secondary }}>
            Si no le llega —a veces cae en spam— pasale este código. Sirve una sola vez y vence en 7
            días.
          </Text>

          <CodigoInvitacion code={invitado.invitationCode} />
          <Button label="Listo" variant="ghost" onPress={() => router.back()} />
        </ScrollView>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <Header title="Invitar" onBack={() => router.back()} />
        <OfflineIndicator />
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.md }}
        >
          <ErrorBanner message={error} />

          <Field label="Nombre" value={form.firstName} onChangeText={set('firstName')} placeholder="Rosa" />
          <Field label="Apellido" value={form.lastName} onChangeText={set('lastName')} placeholder="Quispe" />
          <Field
            label="Correo electrónico"
            value={form.email}
            onChangeText={set('email')}
            placeholder="rosa@ejemplo.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />

          <SectionLabel>¿Qué va a hacer?</SectionLabel>
          <SelectRow
            icon="👤"
            value={rolElegido?.label}
            placeholder="Elegí su rol"
            onPress={() => setSheet(true)}
          />
          {rolElegido?.hint && <Text style={{ ...TYPE.caption }}>{rolElegido.hint}</Text>}
        </ScrollView>

        <View style={styles.footer}>
          <Button
            label={online ? 'Enviar invitación' : 'Sin conexión'}
            onPress={() => void enviar()}
            loading={loading}
            disabled={!online}
          />
        </View>

        <PickerSheet
          visible={sheet}
          onClose={() => setSheet(false)}
          title="Rol en el equipo"
          options={opciones}
          onPick={(roleId) => setForm((f) => ({ ...f, roleId }))}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = {
  ok: { ...TYPE.body, fontWeight: '600' as const, color: COLORS.success },
  footer: {
    backgroundColor: COLORS.white,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
};
