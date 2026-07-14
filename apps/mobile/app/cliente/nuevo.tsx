import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { Header, SectionLabel } from '@/ui';
import { Button, ErrorBanner, Field } from '@/components';
import { buildClientePayload, canSubmitCliente, initialCliente, type ClienteForm } from '@/cliente-form';
import { createClient } from '@/clients.service';
import { uploadImage } from '@/uploads.service';

/** V1 — Registro de cliente (§5.1): identificación + contacto + ubicación, alta atómica, CTA doble. */
export default function NuevoClienteScreen() {
  const [form, setForm] = useState<ClienteForm>(initialCliente);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = useCallback((patch: Partial<ClienteForm>) => setForm((s) => ({ ...s, ...patch })), []);

  const captureGps = useCallback(async () => {
    setLocating(true);
    setError(null);
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setLocating(false);
      setError('Sin permiso de ubicación — podés asignarla después.');
      return;
    }
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    set({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
    setLocating(false);
  }, [set]);

  const capturePhoto = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setError('Sin permiso de cámara — la foto es opcional.');
      return;
    }
    const r = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    if (r.canceled || !r.assets[0]) return;
    setUploading(true);
    setError(null);
    const up = await uploadImage(r.assets[0].uri, r.assets[0].mimeType);
    setUploading(false);
    if (up.status === 'ok') set({ photoUrl: up.url });
    else setError(up.status === 'offline' ? 'Sin conexión — la foto se puede agregar después.' : 'No se pudo subir la foto.');
  }, [set]);

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

  const disabled = saving || uploading || !canSubmitCliente(form);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Header title="Nuevo cliente" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <ErrorBanner message={error} />

        <SectionLabel>Identificación</SectionLabel>
        <Field label="Nombre" value={form.firstName} onChangeText={(t) => set({ firstName: t })} autoCapitalize="words" placeholder="Juan" />
        <Field label="Apellido" value={form.lastName} onChangeText={(t) => set({ lastName: t })} autoCapitalize="words" placeholder="Pérez" />
        <Field label="Documento (CI)" value={form.nationalId} onChangeText={(t) => set({ nationalId: t })} placeholder="Opcional" />

        <SectionLabel>Contacto</SectionLabel>
        <Field label="Teléfono" value={form.phone} onChangeText={(t) => set({ phone: t })} keyboardType="phone-pad" placeholder="70000000" />
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Tiene WhatsApp</Text>
          <Switch
            value={form.hasWhatsapp}
            onValueChange={(v) => set({ hasWhatsapp: v })}
            trackColor={{ true: COLORS.purple, false: COLORS.border }}
          />
        </View>

        <SectionLabel>Ubicación</SectionLabel>
        <Field label="Dirección" value={form.address} onChangeText={(t) => set({ address: t })} placeholder="Opcional" />
        <Field label="Zona / Barrio" value={form.zone} onChangeText={(t) => set({ zone: t })} placeholder="Opcional" />
        <Field label="Referencia" value={form.reference} onChangeText={(t) => set({ reference: t })} placeholder="Portón verde frente a la cancha" />

        <View style={styles.captureRow}>
          <Pressable style={styles.capture} onPress={captureGps} accessibilityRole="button">
            <Text style={styles.captureText}>{locating ? 'Ubicando…' : form.latitude != null ? '📍 GPS capturado' : '📍 Capturar GPS aquí'}</Text>
          </Pressable>
          <Pressable style={styles.capture} onPress={capturePhoto} accessibilityRole="button" disabled={uploading}>
            <Text style={styles.captureText}>{uploading ? 'Subiendo…' : form.photoUrl ? '📷 Foto lista' : '📷 Foto de fachada'}</Text>
          </Pressable>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button label="Guardar y agregar préstamo" onPress={() => submit(true)} loading={saving} disabled={disabled} />
        <Button label="Solo guardar cliente" variant="ghost" onPress={() => submit(false)} disabled={disabled} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: SPACING.lg, paddingBottom: SPACING.xxl, gap: SPACING.xs },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: SPACING.sm },
  switchLabel: { ...TYPE.body, color: COLORS.text },
  captureRow: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm },
  capture: {
    flex: 1, alignItems: 'center', justifyContent: 'center', height: 48,
    borderRadius: RADIUS.input, borderWidth: 1, borderColor: COLORS.periwinkle, backgroundColor: COLORS.highlight,
  },
  captureText: { ...TYPE.secondary, color: COLORS.navy, fontWeight: '600' },
  footer: { padding: SPACING.lg, gap: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.white },
});
