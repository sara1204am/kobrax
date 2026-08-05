import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { COLORS, SPACING, TYPE } from '@/theme';
import { Header, OfflineIndicator, PickerSheet, SectionLabel, SelectRow } from '@/ui';
import { Button, ErrorBanner, Field } from '@/components';
import { useNetStore } from '@/store/net';
import { authService } from '@/auth-service';
import { getAccount, updateAccount } from '@/account.service';
import {
  COUNTRY_OPTIONS,
  diffAccount,
  findCountry,
  hasChanges,
  validateAccount,
  type AccountForm,
} from '@/account-form';

const EMPTY: AccountForm = { businessName: '', taxId: '', countryCode: '', currencyCode: '' };

/**
 * Datos del negocio (CUENTA S1). País y moneda son **un solo selector** (S1-D1): están
 * acoplados en el producto y dos listas sueltas invitan a Bolivia + peso mexicano.
 *
 * La zona horaria se muestra y no se edita (S1-D2): el endpoint la acepta, pero un
 * selector de husos es la pieza más pesada para el caso menos frecuente.
 */
export default function DatosCuentaScreen() {
  const [before, setBefore] = useState<AccountForm>(EMPTY);
  const [form, setForm] = useState<AccountForm>(EMPTY);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [puedeEditar, setPuedeEditar] = useState(false);
  const online = useNetStore((s) => s.isConnected);

  const load = useCallback(async () => {
    const [res, meRes] = await Promise.all([getAccount(), authService.me()]);
    if (res.status === 'ok') {
      const f: AccountForm = {
        businessName: res.data.businessName,
        taxId: res.data.taxId ?? '',
        countryCode: res.data.countryCode,
        currencyCode: res.data.currencyCode,
      };
      setBefore(f);
      setForm(f);
      setTimezone(res.data.timezone);
      setError(null);
    } else if (res.status === 'offline') setError('Sin conexión. Los datos se leen y se guardan en línea.');
    else if (res.status === 'error') setError(res.message);
    if (meRes.status === 'ok') setPuedeEditar(meRes.me.permissions.includes('account:write'));
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useEffect(() => setOk(false), [form]);

  const patch = diffAccount(before, form);
  const invalido = validateAccount(form);
  const pais = findCountry(form.countryCode);

  async function guardar() {
    const msg = validateAccount(form);
    if (msg) {
      setError(msg);
      return;
    }
    setSaving(true);
    // El PATCH lleva sólo lo que cambió: la API corre con forbidNonWhitelisted y
    // reenviar el objeto del GET (planCode, maxUsers, memberCount…) sería un 400.
    const res = await updateAccount(patch);
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

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Header title="Datos de la cuenta" onBack={() => router.back()} />
      <OfflineIndicator />
      <ScrollView contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.md }}>
        <ErrorBanner message={error} />
        {ok && <Text style={styles.ok}>Guardado.</Text>}

        {!loading && !puedeEditar && (
          <Text style={styles.readonly}>
            Tu rol permite ver estos datos, no editarlos. Pedíselo a un administrador.
          </Text>
        )}

        <Field
          label="Nombre del negocio"
          value={form.businessName}
          onChangeText={(businessName) => setForm((f) => ({ ...f, businessName }))}
          editable={puedeEditar}
          placeholder="Cobranzas Pérez"
        />
        <Field
          label="NIT / RUC (opcional)"
          value={form.taxId}
          onChangeText={(taxId) => setForm((f) => ({ ...f, taxId }))}
          editable={puedeEditar}
          keyboardType="number-pad"
          placeholder="1234567890"
        />

        <SectionLabel>País y moneda</SectionLabel>
        <SelectRow
          icon="🌎"
          value={pais?.label}
          placeholder="Elegí tu país"
          disabled={!puedeEditar}
          onPress={() => setSheet(true)}
        />

        <SectionLabel>Zona horaria</SectionLabel>
        <Text style={styles.readonlyValue}>{timezone ?? 'Sin definir'}</Text>
        <Text style={styles.hint}>Se configura desde la web.</Text>
      </ScrollView>

      {puedeEditar && (
        <View style={styles.footer}>
          <Button
            label={online ? 'Guardar' : 'Sin conexión'}
            onPress={() => void guardar()}
            loading={saving}
            disabled={!online || !hasChanges(patch) || !!invalido}
          />
        </View>
      )}

      <PickerSheet
        visible={sheet}
        onClose={() => setSheet(false)}
        title="País y moneda"
        options={COUNTRY_OPTIONS.map((c) => ({ key: c.code, label: c.label, hint: c.currency }))}
        onPick={(code) => {
          const elegido = findCountry(code);
          if (elegido) setForm((f) => ({ ...f, countryCode: elegido.code, currencyCode: elegido.currency }));
        }}
      />
    </View>
  );
}

const styles = {
  ok: { ...TYPE.secondary, color: COLORS.success, fontWeight: '600' as const },
  readonly: { ...TYPE.secondary, color: COLORS.text2 },
  readonlyValue: { ...TYPE.body, fontWeight: '600' as const, color: COLORS.text },
  hint: { ...TYPE.caption },
  footer: {
    backgroundColor: COLORS.white,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
};
