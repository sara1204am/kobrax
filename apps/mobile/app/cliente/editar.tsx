import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import {
  creditFormFromCredit,
  creditFormState,
  creditRedefinition,
  initialStateForm,
  initialStateFromForm,
  registeredState,
  termsEditBlock,
  type CreditForm,
  type InitialStateForm,
  type UpdateCreditPatch,
} from '@kobrax/shared';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { Header, SectionLabel } from '@/ui';
import { Button, ErrorBanner, Field } from '@/components';
import { MONTHS } from '@/agenda-form';
import { ClienteFormView } from '@/cliente-form-view';
import { collateralPayload, contactPayload, hydrateCliente, locationPayload, relationPayload, type ClienteForm } from '@/cliente-form';
import { diffCliente, hasChanges, type ClienteOps } from '@/cliente-diff';
import {
  addCollateral,
  addContact,
  addLocation,
  addRelation,
  getClient,
  removeCollateral,
  removeContact,
  removeLocation,
  removeRelation,
  updateClient,
  updateCollateral,
  updateContact,
  updateLocation,
  updateRelation,
} from '@/clients.service';
import { getCredit, listClientCredits, updateCredit, type CreditDetail, type CreditOption } from '@/credits.service';
import { CreditQuotePanel, CreditTermsFormView, InitialStateFields, PlanSheet } from '@/credit-terms-view';

/** Hoy como día civil en la zona del teléfono. */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Por qué las condiciones no se pueden cambiar (el mismo criterio que la API y la web). */
const BLOCK_TEXT = {
  locked: '🔒 Crédito importado: sus condiciones las manda el archivo y se actualizan con una nueva importación.',
  payments: 'Ya tiene pagos registrados: las condiciones no se cambian, porque reescribirían lo cobrado. Sí se puede mover la próxima fecha.',
  schedule: 'Tiene un cronograma guardado: sus condiciones se podrán redefinir más adelante. Sí se puede mover la próxima fecha.',
} as const;

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

  /** Los préstamos del cliente, para vincular garantes y garantías. */
  const [credits, setCredits] = useState<CreditOption[]>([]);
  /**
   * El crédito (F4/06 · Fase 5): se edita **redefiniendo sus condiciones**, igual que en la web. Se
   * compara contra cómo se abrió (`crOpened`), no contra las columnas: guardar sólo una nota no lo
   * redefine.
   */
  const [cr, setCr] = useState<CreditDetail | null>(null);
  const [crOpened, setCrOpened] = useState<{ form: CreditForm; initial: InitialStateForm } | null>(null);
  const [crDraft, setCrDraft] = useState<{ form: CreditForm; initial: InitialStateForm } | null>(null);
  const [crNext, setCrNext] = useState<string | undefined>(undefined);
  const [planOpen, setPlanOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      // `reveal`: teléfonos y direcciones en claro. Sin esto se editaría la máscara.
      const [c, k, cs] = await Promise.all([
        getClient(clientId, true),
        creditId ? getCredit(creditId) : Promise.resolve(null),
        listClientCredits(clientId),
      ]);
      if (c.status === 'offline' || k?.status === 'offline') return setLoad('offline');
      if (c.status !== 'ok') return setLoad('error');
      const hydrated = hydrateCliente(c.data);
      setOriginal(hydrated);
      setForm(hydrated);
      // La lista de préstamos es para vincular garantes y garantías: si no llega, el formulario se
      // dibuja igual y lo dice. Sin ella no se puede vincular, pero sí corregir todo lo demás.
      if (cs.status === 'ok') setCredits(cs.data);
      if (k?.status === 'ok') {
        setCr(k.data);
        const opened = { form: creditFormFromCredit(k.data, todayIso()), initial: initialStateForm(k.data.initialState) };
        setCrOpened(opened);
        setCrDraft(opened);
        setCrNext(k.data.nextDueDate?.slice(0, 10));
      }
      setLoad('ok');
    })();
  }, [clientId, creditId]);

  const onDate = useCallback((e: DateTimePickerEvent, d?: Date) => {
    setShowPicker(false);
    if (e.type === 'set' && d) setCrNext(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10));
  }, []);

  const block = cr ? termsEditBlock(cr) : null;
  const crState = useMemo(() => (crDraft ? creditFormState(crDraft.form) : null), [crDraft]);
  const crRegistered = useMemo(
    () =>
      crDraft && crState && crState.missing.length === 0 && crState.calculation.ok
        ? registeredState(crState.terms, initialStateFromForm(crDraft.initial))
        : null,
    [crDraft, crState],
  );

  /** Qué mandarle a `PATCH /credits/:id`: sólo lo que cambió. */
  const crPatch = useMemo((): UpdateCreditPatch => {
    if (!cr || !crOpened || !crDraft || cr.locked) return {};
    const patch: UpdateCreditPatch = block === null ? creditRedefinition(crOpened, crDraft) : {};
    if (crDraft.form.notes !== (cr.notes ?? '')) patch.notes = crDraft.form.notes;
    // Al redefinir, la próxima fecha la deriva la API (D13): sólo se mueve a mano con pagos.
    if (block !== null && crNext && crNext !== cr.nextDueDate?.slice(0, 10)) patch.nextDueDate = crNext;
    return patch;
  }, [cr, crOpened, crDraft, crNext, block]);
  const crRedefining = Boolean(crPatch.terms || crPatch.initialState);
  const crValid = !crRedefining || Boolean(crState?.canSubmit && crRegistered?.ok);

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

    if (cr && creditId && Object.keys(crPatch).length > 0) {
      const rk = await updateCredit(creditId, crPatch);
      if (rk.status !== 'ok') {
        setSaving(false);
        return setError(rk.status === 'offline' ? 'El cliente se guardó, pero el crédito no (sin conexión).' : rk.status === 'unauthenticated' ? 'Tu sesión venció.' : rk.message);
      }
    }
    setSaving(false);
    router.back();
  }, [form, original, cr, creditId, clientId, crPatch]);

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
        <ClienteFormView form={form} setForm={setForm as (u: (s: ClienteForm) => ClienteForm) => void} onError={setError} credits={credits} />

        {cr && (
          <View style={styles.creditCard}>
            <Text style={styles.creditTitle}>💳 Datos del crédito</Text>
            {block !== null && <Text style={styles.locked}>{BLOCK_TEXT[block]}</Text>}
            {block === null && crDraft && crState && (
              <>
                <CreditTermsFormView form={crDraft.form} onChange={(f) => setCrDraft((d) => (d ? { ...d, form: f } : d))} currency="Bs" />
                <CreditQuotePanel state={crState} currency={cr.currency} onShowPlan={() => setPlanOpen(true)} />
                <SectionLabel>Estado al registrar</SectionLabel>
                <Text style={styles.locked}>Para un préstamo que ya venía corriendo. Se ajusta mientras no haya pagos registrados.</Text>
                <InitialStateFields
                  value={crDraft.initial}
                  onChange={(i) => setCrDraft((d) => (d ? { ...d, initial: i } : d))}
                  registered={crRegistered}
                  currency="Bs"
                />
              </>
            )}
            {(block === 'payments' || block === 'schedule') && (
              <>
                <SectionLabel>Próxima fecha de pago</SectionLabel>
                <Pressable style={styles.dateBtn} onPress={() => setShowPicker(true)} accessibilityRole="button">
                  <Text style={styles.dateText}>{prettyDate(crNext)}</Text>
                </Pressable>
              </>
            )}
            {!cr.locked && crDraft && (
              <Field
                label="Nota"
                value={crDraft.form.notes}
                onChangeText={(t) => setCrDraft((d) => (d ? { ...d, form: { ...d.form, notes: t } } : d))}
                placeholder="Opcional"
              />
            )}
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Button label="Guardar cambios" onPress={() => void save()} loading={saving} disabled={saving || !crValid} />
      </View>

      {showPicker && cr && <DateTimePicker value={crNext ? new Date(`${crNext}T12:00:00Z`) : new Date()} mode="date" onChange={onDate} />}
      {crState?.missing.length === 0 && crState.calculation.schedule && cr && (
        <PlanSheet
          visible={planOpen}
          onClose={() => setPlanOpen(false)}
          rows={crState.calculation.schedule}
          currency={cr.currency}
          paidInstallments={crRegistered?.ok && crDraft ? initialStateFromForm(crDraft.initial).paidInstallments : 0}
        />
      )}
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
    (await run(ops.relationLocations.update.map((l) => updateLocation(clientId, l.serverId!, locationPayload(l))))) ??
    // Las garantías: una fila y nada más, sin sub-recursos que ordenar.
    (await run(ops.collaterals.removeIds.map((id) => removeCollateral(clientId, id)))) ??
    (await run(ops.collaterals.add.map((g) => addCollateral(clientId, collateralPayload(g))))) ??
    (await run(ops.collaterals.update.map((g) => updateCollateral(clientId, g.serverId!, collateralPayload(g)))))
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
