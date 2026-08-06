import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { ROLE_LABEL, type RoleType } from '@kobrax/shared';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { Header, OfflineIndicator, SectionLabel } from '@/ui';
import { Button, ErrorBanner, Field } from '@/components';
import { useNetStore } from '@/store/net';
import { authService } from '@/auth-service';
import { choosePhoto } from '@/photo';
import { uploadImage } from '@/uploads.service';
import { getMyProfile, updateMyProfile } from '@/account.service';
import { diffProfile, hasChanges, validateProfile, type ProfileForm } from '@/account-form';

const EMPTY: ProfileForm = { firstName: '', lastName: '', phone: '', photoUrl: '', paymentQrUrl: '' };

/**
 * Mi perfil (CUENTA S1). **Sin gating por permiso** (S1-D4): es de uno mismo, y exigir
 * `user:write` dejaría al cobrador sin poder corregirse el teléfono. El endpoint tampoco
 * lo pide.
 *
 * El email y el rol se muestran y no se editan: cambiar el email es cambiar la identidad
 * de login, y el rol lo asigna un administrador desde Miembros (S2).
 */
export default function PerfilScreen() {
  const [before, setBefore] = useState<ProfileForm>(EMPTY);
  const [form, setForm] = useState<ProfileForm>(EMPTY);
  const [email, setEmail] = useState('');
  const [rol, setRol] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [subiendoQr, setSubiendoQr] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const online = useNetStore((s) => s.isConnected);

  const load = useCallback(async () => {
    const [res, meRes] = await Promise.all([getMyProfile(), authService.me()]);
    if (res.status === 'ok') {
      const f: ProfileForm = {
        firstName: res.data.firstName ?? '',
        lastName: res.data.lastName ?? '',
        phone: res.data.phone ?? '',
        photoUrl: res.data.photoUrl ?? '',
        paymentQrUrl: res.data.paymentQrUrl ?? '',
      };
      setBefore(f);
      setForm(f);
      setEmail(res.data.email);
      setError(null);
    } else if (res.status === 'offline') setError('Sin conexión. El perfil se lee y se guarda en línea.');
    else if (res.status === 'error') setError(res.message);
    if (meRes.status === 'ok') setRol(ROLE_LABEL[meRes.me.role as RoleType] ?? meRes.me.role);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useEffect(() => setOk(false), [form]);

  const patch = diffProfile(before, form);
  const invalido = validateProfile(form);

  /** `photo.ts` ofrece Galería además de Cámara: en gama baja la cámara puede recrear Expo Go. */
  async function cambiarFoto() {
    const picked = await choosePhoto();
    if (!picked) return;
    setSubiendo(true);
    const res = await uploadImage(picked.uri, picked.mimeType);
    setSubiendo(false);
    if (res.status === 'ok') setForm((f) => ({ ...f, photoUrl: res.url }));
    else setError(res.status === 'offline' ? 'Sin conexión: la foto no se subió.' : 'No se pudo subir la foto.');
  }

  /** Mismo camino que la foto: la captura del QR del banco sale de la galería o de la cámara. */
  async function cambiarQr() {
    const picked = await choosePhoto();
    if (!picked) return;
    setSubiendoQr(true);
    const res = await uploadImage(picked.uri, picked.mimeType);
    setSubiendoQr(false);
    if (res.status === 'ok') setForm((f) => ({ ...f, paymentQrUrl: res.url }));
    else setError(res.status === 'offline' ? 'Sin conexión: el QR no se subió.' : 'No se pudo subir el QR.');
  }

  async function guardar() {
    const msg = validateProfile(form);
    if (msg) {
      setError(msg);
      return;
    }
    setSaving(true);
    const res = await updateMyProfile(patch);
    setSaving(false);
    if (res.status === 'ok') {
      setBefore(form);
      setError(null);
      setOk(true);
    } else {
      setError(
        res.status === 'offline'
          ? 'Sin conexión: no se guardó.'
          : res.status === 'error'
            ? res.message
            : 'Tu sesión venció.',
      );
    }
  }

  const iniciales = `${form.firstName[0] ?? ''}${form.lastName[0] ?? ''}`.toUpperCase() || '?';

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Header title="Mi perfil" onBack={() => router.back()} />
      <OfflineIndicator />
      <ScrollView contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.md }}>
        <ErrorBanner message={error} />
        {ok && <Text style={styles.ok}>Guardado.</Text>}

        <View style={styles.avatarWrap}>
          <Pressable onPress={() => void cambiarFoto()} accessibilityRole="button" disabled={subiendo}>
            {form.photoUrl ? (
              <Image source={{ uri: form.photoUrl }} style={styles.avatar} accessibilityLabel="Tu foto" />
            ) : (
              <View style={[styles.avatar, styles.avatarEmpty]}>
                <Text style={styles.iniciales}>{iniciales}</Text>
              </View>
            )}
          </Pressable>
          <Text style={styles.hint}>{subiendo ? 'Subiendo…' : 'Tocá la foto para cambiarla'}</Text>
        </View>

        <Field
          label="Nombre"
          value={form.firstName}
          onChangeText={(firstName) => setForm((f) => ({ ...f, firstName }))}
          placeholder="Ana"
        />
        <Field
          label="Apellido"
          value={form.lastName}
          onChangeText={(lastName) => setForm((f) => ({ ...f, lastName }))}
          placeholder="Gómez"
        />
        <Field
          label="Teléfono"
          value={form.phone}
          onChangeText={(phone) => setForm((f) => ({ ...f, phone }))}
          keyboardType="phone-pad"
          placeholder="77712345"
        />

        <SectionLabel>Mi QR de cobro</SectionLabel>
        <Text style={styles.hint}>
          Subí la foto del QR de tu cuenta bancaria. Se lo mostrás al deudor, él paga desde su banco
          y vos registrás el pago con método QR.
        </Text>
        <View style={styles.qrWrap}>
          <Pressable onPress={() => void cambiarQr()} accessibilityRole="button" disabled={subiendoQr}>
            {form.paymentQrUrl ? (
              <Image source={{ uri: form.paymentQrUrl }} style={styles.qr} accessibilityLabel="Tu QR de cobro" />
            ) : (
              <View style={[styles.qr, styles.qrEmpty]}>
                <Text style={styles.qrIcon}>⬛</Text>
                <Text style={styles.hint}>Sin QR cargado</Text>
              </View>
            )}
          </Pressable>
          {subiendoQr ? (
            <Text style={styles.hint}>Subiendo…</Text>
          ) : form.paymentQrUrl ? (
            <Pressable
              onPress={() => setForm((f) => ({ ...f, paymentQrUrl: '' }))}
              hitSlop={8}
              accessibilityRole="button"
            >
              <Text style={styles.quitar}>Quitar</Text>
            </Pressable>
          ) : (
            <Text style={styles.hint}>Tocá el cuadro para cargarlo</Text>
          )}
        </View>

        <SectionLabel>Sesión</SectionLabel>
        <Text style={styles.readonlyValue}>{email}</Text>
        <Text style={styles.hint}>{rol ? `Tu rol: ${rol}` : ''}</Text>
        <Text style={styles.hint}>El email y el rol no se cambian desde acá.</Text>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label={online ? 'Guardar' : 'Sin conexión'}
          onPress={() => void guardar()}
          loading={saving}
          disabled={!online || !hasChanges(patch) || !!invalido}
        />
      </View>
    </View>
  );
}

const styles = {
  ok: { ...TYPE.secondary, color: COLORS.success, fontWeight: '600' as const },
  avatarWrap: { alignItems: 'center' as const, gap: SPACING.sm, paddingVertical: SPACING.md },
  avatar: { width: 96, height: 96, borderRadius: 48 },
  avatarEmpty: {
    backgroundColor: COLORS.lightBg,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 1.5,
    borderColor: COLORS.border,
  },
  iniciales: { ...TYPE.h1, color: COLORS.navy },
  qrWrap: { alignItems: 'center' as const, gap: SPACING.sm },
  qr: { width: 160, height: 160, borderRadius: RADIUS.card },
  qrEmpty: {
    backgroundColor: COLORS.lightBg,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: SPACING.sm,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderStyle: 'dashed' as const,
  },
  qrIcon: { fontSize: 32, color: COLORS.muted },
  quitar: { ...TYPE.secondary, color: COLORS.danger, fontWeight: '600' as const },
  readonlyValue: { ...TYPE.body, fontWeight: '600' as const, color: COLORS.text },
  hint: { ...TYPE.caption },
  footer: {
    backgroundColor: COLORS.white,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderTopLeftRadius: RADIUS.card,
    borderTopRightRadius: RADIUS.card,
  },
};
