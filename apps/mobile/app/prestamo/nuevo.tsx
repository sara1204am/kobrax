import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  buildNewCreditPayload,
  creditFormState,
  initialCreditForm,
  initialStateForm,
  initialStateFromForm,
  registeredState,
  registrationSituation,
  type CreditForm,
  type InitialStateForm,
} from '@kobrax/shared';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { Header } from '@/ui';
import { Button, ErrorBanner, Field } from '@/components';
import { money } from '@/agenda-form';
import { CreditQuotePanel, CreditTermsFormView, InitialStateFields, PlanSheet, prettyDay } from '@/credit-terms-view';
import { createCredit } from '@/credits.service';
import { getAccount, hayLugar } from '@/account.service';
import { nuevoId } from '@/ids';
import { queueForLater } from '@/sync/sync.service';

/** Hoy como día civil en la zona del teléfono: con UTC, Bolivia proponía mañana a partir de las 20:00. */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const CURRENCY = 'BOB';

/**
 * V2 — Registro de préstamo (§5.2), sobre el modelo de F4/06 (Fase 5): cómo se define, sus
 * condiciones, la cotización en vivo y el plan de pagos, **igual que la web**. La vista previa y lo
 * que se guarda salen del mismo motor (`creditFormState` / `buildNewCreditPayload` de shared, y
 * `resolveCreditTerms` en la API).
 *
 * 🔴 **«Ya está en curso» sigue en el alta**, a diferencia de la web: en la calle, sin señal, cargar y
 * después ajustar serían dos operaciones y el préstamo quedaría un rato con el saldo equivocado. Viaja
 * como `initialState` en el mismo alta y la API aplica la misma regla D13 (`registeredState`).
 */
export default function NuevoPrestamoScreen() {
  const { clientId, name } = useLocalSearchParams<{ clientId?: string; name?: string }>();
  const [form, setForm] = useState<CreditForm>(() => initialCreditForm(todayIso()));
  const [inProgress, setInProgress] = useState(false);
  const [initial, setInitial] = useState<InitialStateForm>(() => initialStateForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState(false);
  const [doneMsg, setDoneMsg] = useState<{ installment: number; nextDueDate: string } | null>(null);

  // D20: el método de mora por defecto de la cuenta (de la caché: funciona sin señal).
  useEffect(() => {
    void getAccount().then((r) => {
      if (r.status === 'ok' && r.data.arrearsMethod) setForm((f) => ({ ...f, arrearsMethod: r.data.arrearsMethod }));
    });
  }, []);

  const state = useMemo(() => creditFormState(form), [form]);
  const registered = useMemo(
    () => (inProgress && state.missing.length === 0 && state.calculation.ok ? registeredState(state.terms, initialStateFromForm(initial)) : null),
    [inProgress, state, initial],
  );
  const schedule = state.missing.length === 0 ? state.calculation.schedule : null;
  const canSubmit = state.canSubmit && (!inProgress || registered?.ok === true);
  // Cómo queda con las cuotas ya pagadas: saldo, próxima cuota y mora (D13/D20), la misma regla que la API.
  const situation = useMemo(
    () =>
      inProgress && schedule && registered?.ok
        ? registrationSituation(state.terms, Number(initial.paidInstallments) || 0, form.arrearsMethod, new Date())
        : null,
    [inProgress, schedule, registered, state, initial, form.arrearsMethod],
  );

  const submit = useCallback(async () => {
    if (!clientId) return;
    const payload = buildNewCreditPayload(form, clientId, inProgress ? initialStateFromForm(initial) : undefined);
    if (!payload) return;
    setSaving(true);
    setError(null);

    // 🔴 El tope del plan se avisa ACÁ, no al sincronizar. Este alta sale con id propio, así que
    // el servidor la acepta aunque el plan esté lleno: si no avisáramos en este momento —con el
    // cobrador todavía frente al deudor y a tiempo de llamar a su jefe— nadie se enteraría hasta
    // que el préstamo apareciera de más en la cartera. Funciona sin señal: el tope viene del
    // último `GET /accounts/me` guardado en el teléfono.
    if (!(await hayLugar('credits'))) {
      setSaving(false);
      return setError('Tu plan llegó al tope de préstamos activos. Avisale a tu administrador antes de cargar este.');
    }

    const input = { id: nuevoId(), ...payload };
    const res = await createCredit(input);
    setSaving(false);

    if (res.status === 'ok' || res.status === 'offline') {
      // Sin señal el préstamo queda guardado y sube solo. Si el cliente también está en la cola,
      // va antes (es FIFO), así que cuando le toque a este su dueño ya existe en el servidor.
      if (res.status === 'offline') {
        const guardado = await queueForLater({ kind: 'credit.create', input });
        if (!guardado) return setError('Sin conexión y no se pudo guardar en el teléfono. Reintentá.');
      }
      setDoneMsg({ installment: payload.installmentAmount, nextDueDate: registered?.ok ? registered.nextDueDate : payload.nextDueDate });
      return;
    }
    if (res.status === 'unauthenticated') return setError('Tu sesión venció. Volvé a iniciar sesión.');
    setError(res.message);
  }, [clientId, form, inProgress, initial, registered]);

  // Un préstamo es siempre de alguien: sin cliente no hay alta posible, y guardar no haría nada.
  if (!clientId) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <Header title="Nuevo préstamo" onBack={() => router.back()} />
        <View style={styles.done}>
          <Text style={styles.doneLine}>Un préstamo se carga desde la ficha de su cliente, o dando de alta al cliente primero.</Text>
          <View style={styles.doneBtns}>
            <Button label="Nuevo cliente" onPress={() => router.replace('/cliente/nuevo')} />
          </View>
        </View>
      </View>
    );
  }

  if (doneMsg) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <Header title="Préstamo registrado" />
        <View style={styles.done}>
          <Text style={styles.doneIcon}>✅</Text>
          <Text style={styles.doneTitle}>{name || 'Cliente'}</Text>
          <Text style={styles.doneLine}>Cuota {money(doneMsg.installment, CURRENCY)} · vence {prettyDay(doneMsg.nextDueDate)}</Text>
          <View style={styles.doneBtns}>
            <Button label="Ver ficha" onPress={() => router.replace(`/cliente/${clientId}`)} />
            <Button
              label="Registrar otro"
              variant="ghost"
              onPress={() => {
                setForm(initialCreditForm(todayIso()));
                setInProgress(false);
                setInitial(initialStateForm());
                setDoneMsg(null);
              }}
            />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Header title="Nuevo préstamo" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <ErrorBanner message={error} />

        {!!name && (
          <View style={styles.clientCard}>
            <Text style={styles.clientName}>{name}</Text>
          </View>
        )}

        <CreditTermsFormView form={form} onChange={setForm} currency="Bs" />
        <CreditQuotePanel state={state} currency={CURRENCY} onShowPlan={() => setPlan(true)} />

        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Este préstamo ya está en curso</Text>
          <Switch value={inProgress} onValueChange={setInProgress} trackColor={{ true: COLORS.purple, false: COLORS.border }} />
        </View>
        {inProgress && <InitialStateFields value={initial} onChange={setInitial} registered={registered} currency="Bs" total={schedule?.length} situation={situation} />}

        <Field label="Nota" value={form.notes} onChangeText={(notes) => setForm((f) => ({ ...f, notes }))} placeholder="Opcional" />
      </ScrollView>

      <View style={styles.footer}>
        <Button label="Crear crédito" onPress={submit} loading={saving} disabled={saving || !canSubmit} />
      </View>

      {schedule && (
        <PlanSheet
          visible={plan}
          onClose={() => setPlan(false)}
          rows={schedule}
          currency={CURRENCY}
          paidInstallments={inProgress && registered?.ok ? initialStateFromForm(initial).paidInstallments : 0}
          hint="Vista previa con las mismas condiciones que se guardan con el crédito."
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: SPACING.lg, paddingBottom: SPACING.xxl, gap: SPACING.xs },
  clientCard: { backgroundColor: COLORS.highlight, borderRadius: RADIUS.card, padding: SPACING.md, marginBottom: SPACING.sm },
  clientName: { ...TYPE.h3, color: COLORS.navy },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: SPACING.sm, marginTop: SPACING.sm },
  switchLabel: { ...TYPE.body, color: COLORS.text, flex: 1 },
  footer: { padding: SPACING.lg, borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.white },
  done: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl, gap: SPACING.md },
  doneIcon: { fontSize: 48 },
  doneTitle: { ...TYPE.h2, color: COLORS.navy },
  doneLine: { ...TYPE.body, color: COLORS.text2, textAlign: 'center' },
  doneBtns: { alignSelf: 'stretch', gap: SPACING.sm, marginTop: SPACING.lg },
});
