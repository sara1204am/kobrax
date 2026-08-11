import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { PaymentFrequency } from '@kobrax/shared';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { AmountInput, Chips, Header, SectionLabel } from '@/ui';
import { Button, ErrorBanner, Field } from '@/components';
import { MONTHS } from '@/agenda-form';
import { ClienteFormView } from '@/cliente-form-view';
import { contactPayload, hydrateCliente, locationPayload, relationPayload, type ClienteForm } from '@/cliente-form';
import { diffCliente, hasChanges, type ClienteOps } from '@/cliente-diff';
import {
  addContact,
  addLocation,
  addRelation,
  getClient,
  removeContact,
  removeLocation,
  removeRelation,
  updateClient,
  updateContact,
  updateLocation,
  updateRelation,
} from '@/clients.service';
import { getCredit, updateCredit, type CreditDetail } from '@/credits.service';

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

/**
 * Editar cliente — **el mismo formulario que el alta** (`ClienteFormView`): datos, teléfonos,
 * ubicaciones y garantes con los suyos. Antes esta pantalla tenía un formulario propio, más chico,
 * sin teléfonos ni ubicaciones: una dirección cargada mal no se podía corregir.
 *
 * Guardar manda **sólo la diferencia** (`cliente-diff`), porque cada sub-recurso tiene su endpoint.
 * Si además llega un `creditId`, se sigue editando el financiero del préstamo abajo — es otra
 * entidad y conserva su propia sección.
 */
export default function EditarScreen() {
  const { clientId, creditId } = useLocalSearchParams<{ clientId: string; creditId?: string }>();
  const [load, setLoad] = useState<'loading' | 'ok' | 'offline' | 'error'>('loading');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  /** Lo que trajo el server: contra esto se compara al guardar. */
  const [original, setOriginal] = useState<ClienteForm | null>(null);
  const [form, setForm] = useState<ClienteForm | null>(null);

  const [cr, setCr] = useState<CreditDetail | null>(null);
  const [principal, setPrincipal] = useState('');
  const [interest, setInterest] = useState('');
  const [installment, setInstallment] = useState('');

  useEffect(() => {
    void (async () => {
      // `reveal`: teléfonos y direcciones en claro. Sin esto se editaría la máscara.
      const [c, k] = await Promise.all([getClient(clientId, true), creditId ? getCredit(creditId) : Promise.resolve(null)]);
      if (c.status === 'offline' || k?.status === 'offline') return setLoad('offline');
      if (c.status !== 'ok') return setLoad('error');
      const hydrated = hydrateCliente(c.data);
      setOriginal(hydrated);
      setForm(hydrated);
      if (k?.status === 'ok') {
        setCr(k.data);
        setPrincipal(String(k.data.principalAmount ?? ''));
        setInterest(String(k.data.interestRate ?? ''));
        setInstallment(k.data.installmentAmount != null ? String(k.data.installmentAmount) : '');
      }
      setLoad('ok');
    })();
  }, [clientId, creditId]);

  const onDate = useCallback((e: DateTimePickerEvent, d?: Date) => {
    setShowPicker(false);
    if (e.type === 'set' && d) {
      setCr((s) => (s ? { ...s, nextDueDate: new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10) } : s));
    }
  }, []);

  const save = useCallback(async () => {
    if (!form || !original) return;
    setSaving(true);
    setError(null);

    const ops = diffCliente(original, form);
    if (hasChanges(ops)) {
      const failure = await applyOps(clientId, ops);
      if (failure) {
        setSaving(false);
        return setError(failure);
      }
    }

    if (cr && creditId && !cr.locked) {
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
  }, [form, original, cr, creditId, clientId, principal, interest, installment]);

  if (load !== 'ok' || !form) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <Header title="Editar cliente" onBack={() => router.back()} />
        <View style={styles.center}>
          {load === 'loading' ? (
            <ActivityIndicator color={COLORS.navy} />
          ) : (
            <Text style={styles.msg}>{load === 'offline' ? 'Sin conexión.' : 'No se pudo cargar.'}</Text>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Header title="Editar cliente" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <ErrorBanner message={error} />
        <ClienteFormView form={form} setForm={setForm as (u: (s: ClienteForm) => ClienteForm) => void} onError={setError} />

        {cr && (
          <View style={styles.creditCard}>
            <Text style={styles.creditTitle}>💳 Datos del crédito</Text>
            {cr.locked ? (
              <Text style={styles.locked}>
                🔒 Crédito importado ({cr.origin}). Los datos financieros no se editan; se actualizan con una nueva importación (§4.3).
              </Text>
            ) : (
              <>
                <SectionLabel>Capital</SectionLabel>
                <AmountInput value={principal} onChangeText={setPrincipal} currencySymbol={cr.currency} accessibilityLabel="Capital" />
                <SectionLabel>Cuota</SectionLabel>
                <AmountInput value={installment} onChangeText={setInstallment} currencySymbol={cr.currency} accessibilityLabel="Cuota" />
                <Field label="Interés (%)" value={interest} onChangeText={setInterest} keyboardType="decimal-pad" placeholder="Informativo" />
                <SectionLabel>Frecuencia</SectionLabel>
                <Chips options={FREQ} value={cr.frequency ?? PaymentFrequency.MONTHLY} onChange={(v) => setCr((s) => (s ? { ...s, frequency: v } : s))} />
                <SectionLabel>Próxima fecha de pago</SectionLabel>
                <Pressable style={styles.dateBtn} onPress={() => setShowPicker(true)} accessibilityRole="button">
                  <Text style={styles.dateText}>{prettyDate(cr.nextDueDate)}</Text>
                </Pressable>
                <Field label="Nota" value={cr.notes ?? ''} onChangeText={(t) => setCr((s) => (s ? { ...s, notes: t } : s))} placeholder="Opcional" />
              </>
            )}
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Button label="Guardar cambios" onPress={() => void save()} loading={saving} disabled={saving} />
      </View>

      {showPicker && cr && <DateTimePicker value={cr.nextDueDate ? new Date(cr.nextDueDate) : new Date()} mode="date" onChange={onDate} />}
    </View>
  );
}

/**
 * Aplica la diferencia en orden: primero lo que se borra, después lo nuevo y lo cambiado. Devuelve el
 * mensaje de error de la primera llamada que falla, o `null` si salió todo.
 */
async function applyOps(clientId: string, ops: ClienteOps): Promise<string | null> {
  const fail = (r: { status: string; message?: string }): string | null =>
    r.status === 'ok'
      ? null
      : r.status === 'offline'
        ? 'Sin conexión: los cambios de la ficha se guardan en línea. Volvé cuando haya señal.'
        : r.status === 'unauthenticated'
          ? 'Tu sesión venció. Volvé a iniciar sesión.'
          : (r.message ?? 'No se pudo guardar');

  const run = async (calls: Promise<{ status: string; message?: string }>[]): Promise<string | null> => {
    for (const call of calls) {
      const e = fail(await call);
      if (e) return e;
    }
    return null;
  };

  return (
    (ops.client ? fail(await updateClient(clientId, ops.client)) : null) ??
    (await run(ops.contacts.removeIds.map((id) => removeContact(clientId, id)))) ??
    (await run(ops.locations.removeIds.map((id) => removeLocation(clientId, id)))) ??
    (await run(ops.relations.removeIds.map((id) => removeRelation(clientId, id)))) ??
    (await run(ops.contacts.add.map((c) => addContact(clientId, contactPayload(c))))) ??
    (await run(ops.contacts.update.map((c) => updateContact(clientId, c.serverId!, contactPayload(c))))) ??
    (await run(ops.locations.add.map((l) => addLocation(clientId, locationPayload(l))))) ??
    (await run(ops.locations.update.map((l) => updateLocation(clientId, l.serverId!, locationPayload(l))))) ??
    (await run(ops.relations.add.map((r) => addRelation(clientId, relationPayload(r))))) ??
    (await run(
      ops.relations.update.map((r) => {
        // Los sub-recursos de un garante que ya existe van por su propia ruta, no en su PATCH.
        const { contacts: _c, locations: _l, ...campos } = relationPayload(r);
        return updateRelation(clientId, r.serverId!, campos);
      }),
    )) ??
    (await run(ops.relationContacts.removeIds.map((id) => removeContact(clientId, id)))) ??
    (await run(ops.relationLocations.removeIds.map((id) => removeLocation(clientId, id)))) ??
    (await run(ops.relationContacts.add.map((c) => addContact(clientId, { ...contactPayload(c), relationId: c.relationId })))) ??
    (await run(ops.relationContacts.update.map((c) => updateContact(clientId, c.serverId!, contactPayload(c))))) ??
    (await run(ops.relationLocations.add.map((l) => addLocation(clientId, { ...locationPayload(l), relationId: l.relationId })))) ??
    (await run(ops.relationLocations.update.map((l) => updateLocation(clientId, l.serverId!, locationPayload(l)))))
  );
}

const styles = StyleSheet.create({
  body: { padding: SPACING.md, paddingBottom: SPACING.xxl, gap: SPACING.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  msg: { ...TYPE.body, color: COLORS.text2 },
  creditCard: { backgroundColor: COLORS.white, borderRadius: RADIUS.card, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, gap: SPACING.xs },
  creditTitle: { ...TYPE.h3, color: COLORS.navy },
  locked: { ...TYPE.secondary, color: COLORS.text2 },
  dateBtn: { height: 46, justifyContent: 'center', paddingHorizontal: SPACING.md, borderRadius: RADIUS.input, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.white },
  dateText: { ...TYPE.body, color: COLORS.text },
  footer: { padding: SPACING.lg, borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.white },
});
