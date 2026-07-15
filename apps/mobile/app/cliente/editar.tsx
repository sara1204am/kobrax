import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { PaymentFrequency } from '@kobrax/shared';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { AmountInput, Chips, Header, SectionLabel } from '@/ui';
import { Button, ErrorBanner, Field } from '@/components';
import { MONTHS } from '@/agenda-form';
import { getClient, updateClient, type ClientDetail } from '@/clients.service';
import { getCredit, updateCredit, type CreditDetail } from '@/credits.service';

const GENDER = [{ value: '', label: 'Sin especificar' }, { value: 'M', label: 'Masculino' }, { value: 'F', label: 'Femenino' }, { value: 'O', label: 'Otro' }];
const CLIENT_TYPE = [{ value: 'PERSON', label: 'Persona' }, { value: 'COMPANY', label: 'Empresa' }] as const;
const RISK = [{ value: '', label: '—' }, { value: 'LOW', label: 'Bajo' }, { value: 'MEDIUM', label: 'Medio' }, { value: 'HIGH', label: 'Alto' }];
const STATUS = [{ value: 'ACTIVE', label: 'Activo' }, { value: 'INACTIVE', label: 'Inactivo' }, { value: 'BLOCKED', label: 'Bloqueado' }] as const;
const FREQ: { value: PaymentFrequency; label: string }[] = [
  { value: PaymentFrequency.DAILY, label: 'Diario' },
  { value: PaymentFrequency.WEEKLY, label: 'Semanal' },
  { value: PaymentFrequency.BIWEEKLY, label: 'Quincenal' },
  { value: PaymentFrequency.MONTHLY, label: 'Mensual' },
];

function prettyDate(iso?: string): string {
  if (!iso) return 'Sin fecha';
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Editar los datos del cliente y del crédito (§5.4). Financiero bloqueado si el crédito es importado (§4.3). */
export default function EditarScreen() {
  const { clientId, creditId } = useLocalSearchParams<{ clientId: string; creditId: string }>();
  const [load, setLoad] = useState<'loading' | 'ok' | 'offline' | 'error'>('loading');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  const [cli, setCli] = useState<ClientDetail | null>(null);
  const [cr, setCr] = useState<CreditDetail | null>(null);
  // Campos numéricos del crédito como texto (fuente de verdad; se parsean al guardar).
  const [principal, setPrincipal] = useState('');
  const [interest, setInterest] = useState('');
  const [installment, setInstallment] = useState('');

  useEffect(() => {
    void (async () => {
      const [c, k] = await Promise.all([getClient(clientId), getCredit(creditId)]);
      if (c.status === 'offline' || k.status === 'offline') return setLoad('offline');
      if (c.status !== 'ok' || k.status !== 'ok') return setLoad('error');
      setCli(c.data);
      setCr(k.data);
      setPrincipal(String(k.data.principalAmount ?? ''));
      setInterest(String(k.data.interestRate ?? ''));
      setInstallment(k.data.installmentAmount != null ? String(k.data.installmentAmount) : '');
      setLoad('ok');
    })();
  }, [clientId, creditId]);

  const setClient = (patch: Partial<ClientDetail>) => setCli((s) => (s ? { ...s, ...patch } : s));
  const setCredit = (patch: Partial<CreditDetail>) => setCr((s) => (s ? { ...s, ...patch } : s));

  const onDate = useCallback((e: DateTimePickerEvent, d?: Date) => {
    setShowPicker(false);
    if (e.type === 'set' && d) setCredit({ nextDueDate: new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10) });
  }, []);

  const save = useCallback(async () => {
    if (!cli || !cr) return;
    setSaving(true);
    setError(null);
    const isCompany = cli.clientType === 'COMPANY';
    // 1) Cliente (identidad).
    const rc = await updateClient(clientId, {
      firstName: isCompany ? undefined : cli.firstName,
      lastName: isCompany ? undefined : cli.lastName,
      businessName: isCompany ? cli.businessName : undefined,
      gender: cli.gender,
      riskSegment: cli.riskSegment,
      status: cli.status,
    });
    if (rc.status !== 'ok') {
      setSaving(false);
      return setError(rc.status === 'offline' ? 'Sin conexión — no se guardó.' : rc.status === 'unauthenticated' ? 'Tu sesión venció.' : rc.message);
    }
    // 2) Crédito (financiero) — solo si NO está bloqueado (importado).
    if (!cr.locked) {
      const rk = await updateCredit(creditId, {
        principalAmount: principal.trim() ? Number(principal) : undefined,
        interestRate: interest.trim() ? Number(interest) : undefined,
        installmentAmount: installment.trim() ? Number(installment) : undefined,
        frequency: cr.frequency,
        nextDueDate: cr.nextDueDate,
        notes: cr.notes,
      });
      if (rk.status !== 'ok') {
        setSaving(false);
        return setError(rk.status === 'offline' ? 'El cliente se guardó, pero el crédito no (sin conexión).' : rk.status === 'unauthenticated' ? 'Tu sesión venció.' : rk.message);
      }
    }
    setSaving(false);
    router.back();
  }, [cli, cr, clientId, creditId, principal, interest, installment]);

  if (load !== 'ok' || !cli || !cr) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <Header title="Editar" onBack={() => router.back()} />
        <View style={styles.center}>
          {load === 'loading' ? <ActivityIndicator color={COLORS.navy} /> : <Text style={styles.msg}>{load === 'offline' ? 'Sin conexión.' : 'No se pudo cargar.'}</Text>}
        </View>
      </View>
    );
  }

  const isCompany = cli.clientType === 'COMPANY';

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Header title="Editar" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <ErrorBanner message={error} />

        <Text style={styles.card}>👤 Datos del cliente</Text>
        <SectionLabel>Tipo de cliente</SectionLabel>
        <Chips options={CLIENT_TYPE} value={cli.clientType} onChange={(v) => setClient({ clientType: v })} />
        <Field label={isCompany ? 'Razón social' : 'Nombre'} value={(isCompany ? cli.businessName : cli.firstName) ?? ''} onChangeText={(t) => setClient(isCompany ? { businessName: t } : { firstName: t })} autoCapitalize="words" />
        {!isCompany && <Field label="Apellido" value={cli.lastName ?? ''} onChangeText={(t) => setClient({ lastName: t })} autoCapitalize="words" />}
        <Field label="Documento (solo lectura)" value={cli.nationalId ?? '—'} editable={false} />
        <SectionLabel>Género</SectionLabel>
        <Chips options={GENDER} value={cli.gender ?? ''} onChange={(v) => setClient({ gender: v })} />
        <SectionLabel>Segmento de riesgo</SectionLabel>
        <Chips options={RISK} value={cli.riskSegment ?? ''} onChange={(v) => setClient({ riskSegment: v })} />
        <SectionLabel>Estado</SectionLabel>
        <Chips options={STATUS} value={cli.status} onChange={(v) => setClient({ status: v })} />

        <Text style={[styles.card, { marginTop: SPACING.lg }]}>💳 Datos del crédito</Text>
        {cr.locked ? (
          <Text style={styles.locked}>🔒 Crédito importado ({cr.origin}). Los datos financieros no se editan; se actualizan con una nueva importación (§4.3).</Text>
        ) : (
          <>
            <SectionLabel>Capital</SectionLabel>
            <AmountInput value={principal} onChangeText={setPrincipal} currencySymbol={cr.currency} accessibilityLabel="Capital" />
            <SectionLabel>Cuota</SectionLabel>
            <AmountInput value={installment} onChangeText={setInstallment} currencySymbol={cr.currency} accessibilityLabel="Cuota" />
            <Field label="Interés (%)" value={interest} onChangeText={setInterest} keyboardType="decimal-pad" placeholder="Informativo" />
            <SectionLabel>Frecuencia</SectionLabel>
            <Chips options={FREQ} value={cr.frequency ?? PaymentFrequency.MONTHLY} onChange={(v) => setCredit({ frequency: v })} />
            <SectionLabel>Próxima fecha de pago</SectionLabel>
            <Pressable style={styles.dateBtn} onPress={() => setShowPicker(true)} accessibilityRole="button">
              <Text style={styles.dateText}>{prettyDate(cr.nextDueDate)}</Text>
            </Pressable>
            <Field label="Nota" value={cr.notes ?? ''} onChangeText={(t) => setCredit({ notes: t })} placeholder="Opcional" />
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Button label="Guardar cambios" onPress={save} loading={saving} disabled={saving} />
      </View>

      {showPicker && <DateTimePicker value={new Date(cr.nextDueDate ?? new Date().toISOString().slice(0, 10))} mode="date" onChange={onDate} />}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  msg: { ...TYPE.body, color: COLORS.text2 },
  body: { padding: SPACING.lg, paddingBottom: SPACING.xxl, gap: SPACING.xs },
  card: { ...TYPE.h3, color: COLORS.navy, marginBottom: SPACING.xs },
  locked: { ...TYPE.secondary, color: COLORS.warningText, backgroundColor: COLORS.warningBg, padding: SPACING.md, borderRadius: RADIUS.input },
  dateBtn: { height: 48, borderRadius: RADIUS.input, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.white, justifyContent: 'center', paddingHorizontal: SPACING.md },
  dateText: { ...TYPE.body, color: COLORS.navy, textTransform: 'capitalize' },
  footer: { padding: SPACING.lg, borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.white },
});
