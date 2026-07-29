import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { COLORS, SPACING } from '@/theme';
import { Header } from '@/ui';
import { Button, ErrorBanner } from '@/components';
import { ClienteFormView } from '@/cliente-form-view';
import { buildClientePayload, canSubmitCliente, clienteEnPunto, initialCliente, type ClienteForm } from '@/cliente-form';
import { createClient } from '@/clients.service';

/**
 * V1 — Alta de cliente (§5.1). El formulario es `ClienteFormView`, **el mismo que usa la edición**:
 * acá sólo vive el guardar. Si llega `lat`/`lng` (alta desde el mapa de Rutas, S2), la primera
 * ubicación arranca con el punto marcado.
 */
export default function NuevoClienteScreen() {
  const { lat, lng } = useLocalSearchParams<{ lat?: string; lng?: string }>();
  const [form, setForm] = useState<ClienteForm>(() => {
    const point = { latitude: Number(lat), longitude: Number(lng) };
    return Number.isFinite(point.latitude) && Number.isFinite(point.longitude) ? clienteEnPunto(point) : initialCliente();
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (thenLoan: boolean) => {
      setSaving(true);
      setError(null);
      const res = await createClient(buildClientePayload(form));
      setSaving(false);
      if (res.status === 'ok') {
        const name = [form.firstName, form.lastName].filter(Boolean).join(' ').trim();
        if (thenLoan) router.replace({ pathname: '/prestamo/nuevo', params: { clientId: res.data.id, name } });
        else router.back();
        return;
      }
      if (res.status === 'unauthenticated') return setError('Tu sesión venció. Volvé a iniciar sesión.');
      if (res.status === 'offline') return setError('Sin conexión — no se guardó. Reintentá.');
      setError(res.message); // "Ya existe un cliente con ese documento" en duplicado (§5.1)
    },
    [form],
  );

  const disabled = saving || !canSubmitCliente(form);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Header title="Nuevo cliente" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <ErrorBanner message={error} />
        <ClienteFormView form={form} setForm={setForm} onError={setError} />
      </ScrollView>

      <View style={styles.footer}>
        <Button label="Guardar y agregar préstamo" onPress={() => submit(true)} loading={saving} disabled={disabled} />
        <Button label="Solo guardar cliente" variant="ghost" onPress={() => submit(false)} disabled={disabled} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: SPACING.md, paddingBottom: SPACING.xxl, gap: SPACING.md },
  footer: { padding: SPACING.lg, gap: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.white },
});
