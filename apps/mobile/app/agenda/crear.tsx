/**
 * Agenda S2 — "Nueva gestión" (Figma `65:724` y hermanos): elegir tipo, buscar cliente, completar
 * los campos propios del tipo, programar y guardar. La lógica del formulario vive en `agenda-form.ts`
 * (reducer puro); acá sólo se despacha y se pinta.
 *
 * **Modo edición (S5)**: con `?id=<agendaItemId>` la misma pantalla edita en vez de crear — hidrata el
 * reducer desde el agendado, fija el deudor (es el ancla, no se cambia editando) y **bloquea la fecha**:
 * mover el día es *reagendar* y deja rastro (`plans/agenda/editar-eliminar.md` D5).
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { currentLocation } from '@/location';
import { MapPicker } from '@/maps/MapPicker';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { AgendaItemType, AgendaTimeSlot, CatalogType, ScheduleTimeMode, locationTypeChoices } from '@kobrax/shared';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { Button, ErrorBanner } from '@/components';
// `SelectRow` y `PickerSheet` nacieron en esta pantalla y subieron a `ui.tsx` con su 2º consumidor (S6).
import { AGENDA_TYPE_META, BottomSheet, Header, PickerSheet, SectionLabel, SelectRow } from '@/ui';
import {
  buildPatch,
  buildPayload,
  canSubmit,
  formReducer,
  formatLongDate,
  hydrateForm,
  initialForm,
  money,
  TIME_SLOT_LABEL,
  toHHmm,
  toISO,
  toLocalDate,
  todayISO,
  type TimeMode,
  type TimeSlot,
} from '@/agenda-form';
import {
  addClientContact,
  addClientLocation,
  updateClientLocation,
  clientContext,
  createItem,
  creditSituationLabel,
  getItem,
  updateItem,
  type AgendaClientContext,
  type ClientLocationType,
  type ContactOption,
  type LocationOption,
  type PhoneContactType,
} from '@/agenda.service';
import { nuevoId } from '@/ids';
import { LOCAL_ID_PREFIX } from '@/sync/queue';
import { clientDisplayName, type ClientHit } from '@/clients.service';
import { useClientSearch } from '@/use-client-search';
import { queueForLater } from '@/sync/sync.service';
import { listCatalog, type CatalogOption } from '@/catalogs.service';

const TYPES: AgendaItemType[] = [
  AgendaItemType.CALL,
  AgendaItemType.VISIT,
  AgendaItemType.WHATSAPP,
  AgendaItemType.REMINDER,
  AgendaItemType.PROMISE_TO_PAY,
];

const SLOTS: TimeSlot[] = Object.values(AgendaTimeSlot);
/** `RANGE` queda fuera del núcleo (ver plans/agenda/crear.md §3). */
const TIME_MODES: TimeMode[] = [ScheduleTimeMode.FIXED, ScheduleTimeMode.LAPSE];

type Sheet = 'contact' | 'location' | 'credit' | 'method' | 'bank' | 'newPhone' | 'newLocation' | 'pinLocation';
type PickerKind = 'date' | 'time' | 'promiseDate';

const PHONE_TYPES: { key: PhoneContactType; label: string }[] = [
  { key: 'PHONE', label: 'Teléfono' },
  { key: 'WHATSAPP', label: 'WhatsApp' },
];

/**
 * Los tipos que se ofrecen al **agregar** una dirección desde acá.
 *
 * La lista sale de `shared` y no de una copia: acá siempre es una dirección nueva, así que no hay
 * nada viejo que respetar. `GUARANTOR` ya no está —la dirección del garante es la del garante, que
 * es un contacto con sus propias direcciones—; el rótulo lo pone esta pantalla porque es suyo
 * («Domicilio», no «Casa»).
 */
const LOCATION_LABEL: Record<string, string> = { HOME: 'Domicilio', WORK: 'Trabajo', FAMILY: 'Familiar', OTHER: 'Otro' };
const LOCATION_TYPES: { key: ClientLocationType; label: string }[] = locationTypeChoices().map((key) => ({
  key: key as ClientLocationType,
  label: LOCATION_LABEL[key] ?? key,
}));

export default function CrearGestionScreen() {
  /** Con `?id=` la pantalla edita ese agendado; sin él, crea uno nuevo. */
  const { id: editId } = useLocalSearchParams<{ id?: string }>();
  const editing = Boolean(editId);
  const [form, dispatch] = useReducer(formReducer, undefined, () => initialForm(todayISO()));
  const [query, setQuery] = useState('');
  const [ctx, setCtx] = useState<AgendaClientContext | null>(null);
  const [loadingCtx, setLoadingCtx] = useState(false);
  /** Modo edición: hasta que la hidratación termina no hay nada que pintar. */
  const [loadingItem, setLoadingItem] = useState(editing);
  const [methods, setMethods] = useState<CatalogOption[]>([]);
  const [banks, setBanks] = useState<CatalogOption[]>([]);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [picker, setPicker] = useState<PickerKind | null>(null);
  const [saving, setSaving] = useState(false);
  // 🔴 El id del agendado se fija al ABRIR la pantalla, no en cada intento: si el server lo guardó pero la
  // respuesta se perdió (timeout), el reintento —o el doble toque— lleva el MISMO id y no crea otro (ni otro recordatorio).
  const createId = useRef(nuevoId());
  const [error, setError] = useState<string | null>(null);
  /** Lo que el usuario tipeó en el monto; `details.amount` guarda el número derivado. */
  const [amountText, setAmountText] = useState('');
  /** Alta de un teléfono que el cliente no tenía cargado. */
  const [newPhone, setNewPhone] = useState<{ value: string; notes: string; contactType: PhoneContactType }>({
    value: '',
    notes: '',
    contactType: 'PHONE',
  });
  const [savingPhone, setSavingPhone] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  /** Alta de una dirección: el pin del mapa es opcional, la dirección escrita no. */
  const [newLoc, setNewLoc] = useState<{
    address: string;
    zone: string;
    referenceNotes: string;
    locationType: ClientLocationType;
    latitude?: number;
    longitude?: number;
  }>({ address: '', zone: '', referenceNotes: '', locationType: 'HOME' });
  const [savingLoc, setSavingLoc] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const details = form.details as Record<string, string | number | undefined>;
  const isPromise = form.type === AgendaItemType.PROMISE_TO_PAY;

  const onAmountChange = useCallback((text: string) => {
    const clean = text.replace(',', '.');
    setAmountText(clean);
    const n = Number(clean);
    dispatch({ t: 'details', patch: { amount: clean === '' || Number.isNaN(n) ? undefined : n } });
  }, []);

  // Buscador con debounce (compartido con la cartera): en gama baja, una request por tecla mata la lista.
  const hits = useClientSearch(query, { enabled: !form.clientId });

  /**
   * Modo edición: trae el agendado, hidrata el formulario y recarga el contexto del deudor para que
   * los selectores (teléfonos, direcciones, créditos) tengan de dónde elegir. Dos lecturas que ya
   * existen (S3 y S2); ningún endpoint nuevo.
   */
  useEffect(() => {
    if (!editId) return;
    void (async () => {
      const res = await getItem(editId);
      if (res.status !== 'ok') {
        setLoadingItem(false);
        setError(
          res.status === 'offline'
            ? 'Sin conexión — no se pudo abrir la gestión.'
            : res.status === 'unauthenticated'
              ? 'Tu sesión venció — volvé a entrar.'
              : res.message,
        );
        return;
      }
      const { item } = res.data;
      dispatch({ t: 'hydrate', state: hydrateForm(item) });
      // El monto se pinta desde su texto (el número es el derivado, no al revés — lección de S2).
      const amount = (item.details as { amount?: number }).amount;
      if (amount != null) setAmountText(String(amount));

      const ctxRes = await clientContext(item.clientId);
      setLoadingItem(false);
      if (ctxRes.status === 'ok') setCtx(ctxRes.data);
      else setError(ctxRes.status === 'offline' ? 'Sin conexión — faltan los datos del cliente.' : 'No se pudieron cargar los datos del cliente.');
    })();
  }, [editId]);

  // Catálogos de la promesa: sólo cuando el tipo los pide, y una sola vez.
  useEffect(() => {
    if (!isPromise || methods.length > 0) return;
    void (async () => {
      const [m, b] = await Promise.all([listCatalog(CatalogType.PAYMENT_METHOD), listCatalog(CatalogType.BANK)]);
      if (m.status === 'ok') setMethods(m.data);
      if (b.status === 'ok') setBanks(b.data);
    })();
  }, [isPromise, methods.length]);

  const pickClient = useCallback(async (hit: ClientHit) => {
    Keyboard.dismiss();
    setError(null);
    setLoadingCtx(true);
    dispatch({ t: 'client', clientId: hit.id });
    const res = await clientContext(hit.id);
    setLoadingCtx(false);
    if (res.status !== 'ok') {
      dispatch({ t: 'clearClient' });
      // `unauthenticated` no puede quedar mudo: sin mensaje el cobrador reintenta a ciegas.
      setError(
        res.status === 'offline'
          ? 'Sin conexión — no se pudo cargar el cliente.'
          : res.status === 'unauthenticated'
            ? 'Tu sesión venció — volvé a entrar.'
            : res.message,
      );
      return;
    }
    setCtx(res.data);
    setQuery('');
    // Con un solo crédito no hay nada que elegir.
    if (res.data.credits.length === 1) {
      const only = res.data.credits[0]!;
      dispatch({ t: 'credit', creditId: only.creditId });
    }
  }, []);

  const clearClient = useCallback(() => {
    dispatch({ t: 'clearClient' });
    setCtx(null);
    setError(null);
  }, []);

  /** Guarda el teléfono, lo suma al contexto en memoria y lo deja elegido — sin refetch ni salir del form. */
  const savePhone = useCallback(async () => {
    if (!ctx || !newPhone.value.trim()) return;
    setSavingPhone(true);
    setPhoneError(null);
    const res = await addClientContact(ctx.client.id, {
      contactType: newPhone.contactType,
      value: newPhone.value.trim(),
      notes: newPhone.notes.trim() || undefined,
    });
    if (res.status === 'offline') {
      // Sin señal el teléfono se guarda en el teléfono y sube solo. Se ofrece ya, con un id provisional
      // (`local:…`): el agendado que lo cite lo traduce al id real cuando suba (ver `sync/queue`).
      const localId = LOCAL_ID_PREFIX + nuevoId();
      const input = { contactType: newPhone.contactType, value: newPhone.value.trim(), notes: newPhone.notes.trim() || undefined };
      const guardada = await queueForLater({ kind: 'client.contact', clientId: ctx.client.id, op: 'add', localId, input });
      setSavingPhone(false);
      if (!guardada) return setPhoneError('Sin conexión y no se pudo guardar en el teléfono. Reintentá.');
      const option: ContactOption = { id: localId, contactType: input.contactType, value: input.value, isPrimary: false };
      setCtx({ ...ctx, contacts: [...ctx.contacts, option] });
      dispatch({ t: 'details', patch: { contactId: localId } });
      setNewPhone({ value: '', notes: '', contactType: 'PHONE' });
      setSheet(null);
      return;
    }
    setSavingPhone(false);
    if (res.status !== 'ok') {
      setPhoneError(
        res.status === 'unauthenticated'
          ? 'Tu sesión venció — volvé a entrar.'
          : res.message,
      );
      return;
    }
    setCtx({ ...ctx, contacts: [...ctx.contacts, res.data] });
    dispatch({ t: 'details', patch: { contactId: res.data.id } }); // queda seleccionado, como pidió el flujo
    setNewPhone({ value: '', notes: '', contactType: 'PHONE' });
    setSheet(null);
  }, [ctx, newPhone]);

  /** Fija el pin; el `MapPicker` re-encuadra la cámara al recibir el nuevo punto por props. */
  const setPin = useCallback((latitude: number, longitude: number) => {
    setNewLoc((p) => ({ ...p, latitude, longitude }));
  }, []);

  /**
   * GPS del dispositivo. El cobrador suele estar parado en la puerta del deudor, así que esto da un
   * punto más exacto que arrastrar el pin a ojo. Si niega el permiso, la dirección se carga igual.
   */
  const useMyLocation = useCallback(async () => {
    setLocating(true);
    setLocError(null);
    const res = await currentLocation();
    setLocating(false);
    if (res.status !== 'ok') {
      setLocError(
        res.status === 'denied'
          ? 'Sin permiso de ubicación — podés marcar el punto tocando el mapa.'
          : 'No se pudo obtener tu ubicación — podés marcar el punto tocando el mapa.',
      );
      return;
    }
    setPin(res.coords.latitude, res.coords.longitude);
  }, [setPin]);

  /**
   * Le marca el punto a una dirección que ya estaba cargada (las importadas llegan como texto, sin coordenadas). Se corrige LA
   * dirección, no se crea otra. Necesita señal: el punto tiene que quedar en el servidor para que la ruta lo use.
   */
  const savePin = useCallback(async () => {
    const location = ctx?.locations.find((l) => l.id === details.locationId);
    if (!ctx || !location || newLoc.latitude == null || newLoc.longitude == null) return;
    setSavingLoc(true);
    setLocError(null);
    const res = await updateClientLocation(ctx.client.id, location.id, {
      ...(location.address ? { address: location.address } : {}),
      latitude: newLoc.latitude,
      longitude: newLoc.longitude,
    });
    setSavingLoc(false);
    if (res.status === 'offline') return setLocError('Necesitas señal para marcar la ubicación: el punto tiene que quedar guardado para la ruta.');
    if (res.status !== 'ok') return setLocError(res.status === 'unauthenticated' ? 'Tu sesión venció — volvé a entrar.' : res.message);
    setCtx({ ...ctx, locations: ctx.locations.map((l) => (l.id === location.id ? { ...l, latitude: newLoc.latitude, longitude: newLoc.longitude } : l)) });
    setNewLoc((p) => ({ ...p, latitude: undefined, longitude: undefined }));
    setSheet(null);
  }, [ctx, details.locationId, newLoc.latitude, newLoc.longitude]);

  /** Guarda la dirección, la suma al contexto en memoria y la deja elegida. */
  const saveLocation = useCallback(async () => {
    if (!ctx || !newLoc.address.trim()) return;
    setSavingLoc(true);
    setLocError(null);
    const res = await addClientLocation(ctx.client.id, {
      locationType: newLoc.locationType,
      address: newLoc.address.trim(),
      zone: newLoc.zone.trim() || undefined,
      referenceNotes: newLoc.referenceNotes.trim() || undefined,
      latitude: newLoc.latitude,
      longitude: newLoc.longitude,
    });
    if (res.status === 'offline') {
      const localId = LOCAL_ID_PREFIX + nuevoId();
      const input = {
        locationType: newLoc.locationType,
        address: newLoc.address.trim(),
        zone: newLoc.zone.trim() || undefined,
        referenceNotes: newLoc.referenceNotes.trim() || undefined,
        latitude: newLoc.latitude,
        longitude: newLoc.longitude,
      };
      const guardada = await queueForLater({ kind: 'client.location', clientId: ctx.client.id, op: 'add', localId, input });
      setSavingLoc(false);
      if (!guardada) return setLocError('Sin conexión y no se pudo guardar en el teléfono. Reintentá.');
      const option: LocationOption = {
        id: localId,
        locationType: input.locationType,
        address: input.address,
        zone: input.zone,
        latitude: input.latitude,
        longitude: input.longitude,
      };
      setCtx({ ...ctx, locations: [...ctx.locations, option] });
      dispatch({ t: 'details', patch: { locationId: localId } });
      setNewLoc({ address: '', zone: '', referenceNotes: '', locationType: 'HOME' });
      setSheet(null);
      return;
    }
    setSavingLoc(false);
    if (res.status !== 'ok') {
      setLocError(
        res.status === 'unauthenticated'
          ? 'Tu sesión venció — volvé a entrar.'
          : res.message,
      );
      return;
    }
    setCtx({ ...ctx, locations: [...ctx.locations, res.data] });
    dispatch({ t: 'details', patch: { locationId: res.data.id } });
    setNewLoc({ address: '', zone: '', referenceNotes: '', locationType: 'HOME' });
    setSheet(null);
  }, [ctx, newLoc]);

  const onPicked = useCallback(
    (event: DateTimePickerEvent, date?: Date) => {
      const kind = picker;
      setPicker(null);
      if (event.type !== 'set' || !date || !kind) return;
      if (kind === 'date') dispatch({ t: 'date', value: toISO(date) });
      else if (kind === 'time') dispatch({ t: 'time', value: toHHmm(date) });
      else dispatch({ t: 'details', patch: { promiseDate: toISO(date) } });
    },
    [picker],
  );

  const save = useCallback(async () => {
    // Editar manda sólo lo editable (sin fecha ni deudor); crear manda el alta completa.
    const patch = editId ? buildPatch(form) : null;
    const base = editId ? null : buildPayload(form);
    const payload = base && { ...base, id: createId.current };
    if (!patch && !payload) return;
    setSaving(true);
    setError(null);
    // Un teléfono o dirección cargados sin señal todavía no existen en el server: el agendado que los cita
    // no se puede mandar ahora (el server rechazaría el id provisional). Va por la cola, que lo traduce al subir.
    const details = (payload?.details ?? {}) as Record<string, unknown>;
    const usaLocal = [details.contactId, details.locationId].some((v) => typeof v === 'string' && v.startsWith(LOCAL_ID_PREFIX));
    const res: Awaited<ReturnType<typeof createItem>> = patch
      ? await updateItem(editId!, patch)
      : usaLocal
        ? { status: 'offline' }
        : await createItem(payload!);
    setSaving(false);
    if (res.status === 'ok') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back(); // la Agenda y el detalle refetchean al recuperar el foco
      return;
    }
    if (res.status === 'offline') {
      // Sin señal, el ALTA se guarda y sube sola: agendar una visita o una promesa parado frente al
      // deudor es el caso más común del módulo, y frenarlo por cobertura es lo que P6 vino a evitar.
      //
      // La EDICIÓN no se encola: es un PATCH sobre algo que vive en el servidor, y encolar cambios
      // parciales de un ítem que pudo cambiar de otro lado es pedir un conflicto. Se reintenta.
      if (payload) {
        const guardada = await queueForLater({ kind: 'agenda.create', input: payload });
        if (guardada) {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          router.back();
          return;
        }
      }
      setError(
        payload
          ? 'Sin conexión y no se pudo guardar en el teléfono. Reintentá.'
          : 'Sin conexión — los cambios se guardan cuando vuelva la señal. Reintentá.',
      );
      return;
    }
    setError(res.status === 'error' ? res.message : 'Sesión vencida.');
  }, [editId, form]);

  const credit = ctx?.credits.find((c) => c.creditId === form.creditId);
  const contact = ctx?.contacts.find((c) => c.id === details.contactId);
  const location = ctx?.locations.find((l) => l.id === details.locationId);
  /** Una visita exige la dirección CON punto en el mapa (el servidor la rechaza si no): se frena antes y se ofrece marcarlo. */
  const visitaSinPunto = form.type === AgendaItemType.VISIT && !!location && (location.latitude == null || location.longitude == null);
  const method = methods.find((m) => m.code === details.paymentMethodCode);
  const bank = banks.find((b) => b.code === details.bankCode);
  const requiresBank = method?.metadata?.requiresBank === true;

  const phones = useMemo(() => (ctx?.contacts ?? []).filter((c) => c.contactType !== 'EMAIL'), [ctx]);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Header title={editing ? 'Editar gestión' : 'Nueva gestión'} onBack={() => router.back()} />

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <SectionLabel>Tipo de gestión</SectionLabel>
        <View style={styles.typeGrid}>
          {TYPES.map((t) => {
            const meta = AGENDA_TYPE_META[t];
            const active = form.type === t;
            return (
              <Pressable
                key={t}
                onPress={() => {
                  dispatch({ t: 'type', value: t });
                  setAmountText(''); // el reducer limpia `details`; el texto del monto lo acompaña
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[styles.typeChip, active && styles.typeChipActive]}
              >
                <Text style={styles.typeIcon}>{meta.icon}</Text>
                <Text style={[styles.typeLabel, active && styles.typeLabelActive]} numberOfLines={1}>
                  {meta.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <SectionLabel>Cliente</SectionLabel>
        {ctx ? (
          <View style={styles.clientCard}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{ctx.client.displayName.slice(0, 1)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.clientName} numberOfLines={1}>
                {ctx.client.displayName}
              </Text>
              {ctx.client.nationalId && <Text style={styles.clientDoc}>CI {ctx.client.nationalId}</Text>}
            </View>
            {/* Editando no se cambia de deudor: es el ancla del agendado (D1). Para otro, se crea otra. */}
            {!editing && (
              <Pressable onPress={clearClient} hitSlop={12} accessibilityRole="button" accessibilityLabel="Quitar cliente">
                <Text style={styles.remove}>✕</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <>
            <View style={styles.searchBox}>
              <Text style={styles.searchIcon}>🔍</Text>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Buscar por nombre o CI…"
                placeholderTextColor={COLORS.muted}
                style={styles.searchInput}
                autoCorrect={false}
              />
              {loadingCtx && <ActivityIndicator color={COLORS.navy} />}
            </View>
            {hits.map((h) => (
              <Pressable key={h.id} onPress={() => void pickClient(h)} style={styles.hit} accessibilityRole="button">
                <Text style={styles.hitName}>{clientDisplayName(h)}</Text>
                {h.nationalId && <Text style={styles.hitDoc}>CI {h.nationalId}</Text>}
              </Pressable>
            ))}
          </>
        )}

        {/* Con un solo crédito ya quedó elegido; el selector aparece recién a partir de dos. */}
        {ctx && ctx.credits.length > 1 && (
          <>
            <SectionLabel>Crédito</SectionLabel>
            <SelectRow
              icon="💳"
              value={credit ? `${credit.code ?? 'Crédito'} · ${money(credit.outstandingBalance, credit.currency)} · ${creditSituationLabel(credit.daysPastDue)}` : undefined}
              placeholder="Elegí el crédito"
              onPress={() => setSheet('credit')}
            />
          </>
        )}

        {ctx && (
          <>
            {(form.type === AgendaItemType.CALL || form.type === AgendaItemType.WHATSAPP) && (
              <>
                <SectionLabel>Teléfono</SectionLabel>
                <SelectRow icon="📞" value={contact?.value ?? undefined} placeholder="Elegí un teléfono" onPress={() => setSheet('contact')} />
              </>
            )}

            {form.type === AgendaItemType.WHATSAPP && (
              <>
                <SectionLabel>Mensaje inicial</SectionLabel>
                <Multiline
                  value={(details.message as string) ?? ''}
                  onChangeText={(v) => dispatch({ t: 'details', patch: { message: v } })}
                  placeholder="Escriba el mensaje…"
                />
              </>
            )}

            {form.type === AgendaItemType.VISIT && (
              <>
                <SectionLabel>Dirección</SectionLabel>
                <SelectRow icon="📍" value={location?.address ?? undefined} placeholder="Elegí una dirección" onPress={() => setSheet('location')} />
                {visitaSinPunto && (
                  <>
                    <Text style={styles.hint}>Esta dirección no tiene ubicación en el mapa. Sin ella no se puede agendar la visita ni armar la ruta.</Text>
                    <Button
                      label="Marcar la ubicación en el mapa"
                      variant="ghost"
                      onPress={() => {
                        setNewLoc((p) => ({ ...p, latitude: undefined, longitude: undefined }));
                        setLocError(null);
                        setSheet('pinLocation');
                      }}
                    />
                  </>
                )}
              </>
            )}

            {form.type === AgendaItemType.REMINDER && (
              <>
                <SectionLabel>Descripción (requerido)</SectionLabel>
                <TextInput
                  value={(details.description as string) ?? ''}
                  onChangeText={(v) => dispatch({ t: 'details', patch: { description: v } })}
                  placeholder="¿Qué hay que recordar?"
                  placeholderTextColor={COLORS.muted}
                  style={styles.input}
                />
              </>
            )}

            {isPromise && (
              <>
                <SectionLabel>Monto prometido *</SectionLabel>
                <TextInput
                  // El texto tipeado es la fuente de verdad, no el número: re-stringificar el parseado
                  // borraría el `.` apenas se escribe y los centavos serían inalcanzables (150.50 → 15050).
                  value={amountText}
                  onChangeText={onAmountChange}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={COLORS.muted}
                  style={styles.input}
                />
                {/* Referencia de solo lectura: el cobrador negocia el monto mirando estos dos números. */}
                {credit && (
                  <>
                    <SectionLabel>Capital</SectionLabel>
                    <ReadOnlyField value={money(credit.principalAmount, credit.currency)} />
                    <SectionLabel>Cuota en mora</SectionLabel>
                    <ReadOnlyField value={money(credit.overdueAmount, credit.currency)} />
                    <Text style={styles.hint}>Saldo pendiente: {money(credit.outstandingBalance, credit.currency)}</Text>
                  </>
                )}

                <SectionLabel>El cliente pagará el *</SectionLabel>
                <SelectRow
                  icon="📅"
                  value={details.promiseDate ? formatLongDate(details.promiseDate as string) : undefined}
                  placeholder="Elegí la fecha"
                  onPress={() => setPicker('promiseDate')}
                />

                <SectionLabel>Medio de pago</SectionLabel>
                <View style={styles.chipWrap}>
                  {methods.map((m) => {
                    const active = m.code === details.paymentMethodCode;
                    return (
                      <Pressable
                        key={m.id}
                        onPress={() => dispatch({ t: 'details', patch: { paymentMethodCode: m.code, bankCode: undefined } })}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        style={[styles.chip, active && styles.chipActive]}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>{m.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                {requiresBank && (
                  <>
                    <SectionLabel>Banco *</SectionLabel>
                    <SelectRow icon="🏦" value={bank?.label} placeholder="Elegí el banco" onPress={() => setSheet('bank')} />
                  </>
                )}
              </>
            )}

            <SectionLabel>Notas (opcional)</SectionLabel>
            <Multiline
              value={form.observations}
              onChangeText={(v) => dispatch({ t: 'observations', value: v })}
              placeholder="Escriba observaciones aquí…"
            />

            <SectionLabel>{isPromise ? 'Programación recordatorio' : 'Programación'}</SectionLabel>
            {/* Editando, la fecha no se toca: mover el día es reagendar y deja rastro (D5). */}
            <SelectRow
              icon="📅"
              value={formatLongDate(form.scheduledDate)}
              onPress={() => setPicker('date')}
              disabled={editing}
            />
            {editing && <Text style={styles.hint}>Para moverla de día, usá Reagendar.</Text>}

            <View style={styles.toggle}>
              {TIME_MODES.map((mode) => {
                const active = form.timeMode === mode;
                return (
                  <Pressable
                    key={mode}
                    onPress={() => dispatch({ t: 'timeMode', value: mode })}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={[styles.toggleItem, active && styles.toggleItemActive]}
                  >
                    <Text style={[styles.toggleText, active && styles.toggleTextActive]}>
                      {mode === ScheduleTimeMode.FIXED ? 'Hora fija' : 'Lapso (AM/PM)'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {form.timeMode === ScheduleTimeMode.FIXED ? (
              <SelectRow icon="🕐" value={form.scheduledTime || undefined} placeholder="Elegí la hora" onPress={() => setPicker('time')} />
            ) : (
              <View style={styles.chipWrap}>
                {SLOTS.map((slot) => {
                  const active = form.timeSlot === slot;
                  return (
                    <Pressable
                      key={slot}
                      onPress={() => dispatch({ t: 'slot', value: slot })}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      style={[styles.chip, active && styles.chipActive]}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{TIME_SLOT_LABEL[slot]}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </>
        )}

        {error && (
          <View style={{ marginTop: SPACING.md }}>
            <ErrorBanner message={error} />
          </View>
        )}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <Button
          label={editing ? 'Guardar cambios' : 'Guardar gestión'}
          onPress={() => void save()}
          loading={saving}
          disabled={loadingItem || !canSubmit(form, requiresBank) || visitaSinPunto}
        />
      </SafeAreaView>

      <PickerSheet
        visible={sheet === 'credit'}
        onClose={() => setSheet(null)}
        title="Elegí el crédito"
        options={(ctx?.credits ?? []).map((c) => ({
          key: c.creditId,
          label: c.code ?? 'Crédito',
          hint: `${money(c.outstandingBalance, c.currency)} · ${creditSituationLabel(c.daysPastDue)}`,
        }))}
        onPick={(key) => {
          const c = ctx!.credits.find((x) => x.creditId === key)!;
          dispatch({ t: 'credit', creditId: c.creditId });
        }}
      />
      <PickerSheet
        visible={sheet === 'contact'}
        onClose={() => setSheet(null)}
        title="Elegí un teléfono"
        options={phones.map((c) => ({ key: c.id, label: c.value ?? '—', hint: c.isPrimary ? 'Principal' : undefined }))}
        onPick={(key) => dispatch({ t: 'details', patch: { contactId: key } })}
        addLabel="＋  Agregar teléfono"
        onAdd={() => {
          setPhoneError(null);
          setSheet('newPhone');
        }}
      />

      {/* Alta de teléfono sin salir del formulario: al guardar queda elegido. */}
      <BottomSheet visible={sheet === 'newPhone'} onClose={() => setSheet(null)} title="Agregar teléfono">
        <View style={styles.chipWrap}>
          {PHONE_TYPES.map((t) => {
            const active = newPhone.contactType === t.key;
            return (
              <Pressable
                key={t.key}
                onPress={() => setNewPhone((p) => ({ ...p, contactType: t.key }))}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <TextInput
          value={newPhone.value}
          onChangeText={(v) => setNewPhone((p) => ({ ...p, value: v }))}
          placeholder="Número"
          placeholderTextColor={COLORS.muted}
          keyboardType="phone-pad"
          style={styles.input}
        />
        <TextInput
          value={newPhone.notes}
          onChangeText={(v) => setNewPhone((p) => ({ ...p, notes: v }))}
          placeholder="Etiqueta (Celular, Trabajo…)"
          placeholderTextColor={COLORS.muted}
          style={styles.input}
        />
        <ErrorBanner message={phoneError} />
        <Button
          label="Guardar teléfono"
          onPress={() => void savePhone()}
          loading={savingPhone}
          disabled={!newPhone.value.trim()}
        />
      </BottomSheet>
      <PickerSheet
        visible={sheet === 'location'}
        onClose={() => setSheet(null)}
        title="Elegí una dirección"
        options={(ctx?.locations ?? []).map((l) => ({ key: l.id, label: l.address ?? '—', hint: l.zone }))}
        onPick={(key) => dispatch({ t: 'details', patch: { locationId: key } })}
        addLabel="＋  Agregar dirección"
        onAdd={() => {
          setLocError(null);
          setSheet('newLocation');
        }}
      />

      {/* Alta de dirección con mapa: tocar o arrastrar fija el pin; el GPS lo pone donde estás parado. */}
      <BottomSheet visible={sheet === 'newLocation'} onClose={() => setSheet(null)} title="Agregar dirección">
        <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 460 }} contentContainerStyle={{ gap: SPACING.md }}>
          <View style={styles.chipWrap}>
            {LOCATION_TYPES.map((t) => {
              const active = newLoc.locationType === t.key;
              return (
                <Pressable
                  key={t.key}
                  onPress={() => setNewLoc((p) => ({ ...p, locationType: t.key }))}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{t.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <TextInput
            value={newLoc.address}
            onChangeText={(v) => setNewLoc((p) => ({ ...p, address: v }))}
            placeholder="Dirección"
            placeholderTextColor={COLORS.muted}
            style={styles.input}
          />
          <TextInput
            value={newLoc.zone}
            onChangeText={(v) => setNewLoc((p) => ({ ...p, zone: v }))}
            placeholder="Zona (opcional)"
            placeholderTextColor={COLORS.muted}
            style={styles.input}
          />
          <TextInput
            value={newLoc.referenceNotes}
            onChangeText={(v) => setNewLoc((p) => ({ ...p, referenceNotes: v }))}
            placeholder="Referencia (portón verde, frente a la cancha…)"
            placeholderTextColor={COLORS.muted}
            style={styles.input}
          />

          <MapPicker
            style={styles.mapBox}
            latitude={newLoc.latitude}
            longitude={newLoc.longitude}
            onChange={({ latitude, longitude }) => setPin(latitude, longitude)}
          />

          <Text style={styles.hint}>
            {newLoc.latitude != null
              ? `Punto marcado: ${newLoc.latitude.toFixed(5)}, ${newLoc.longitude!.toFixed(5)}`
              : 'Tocá el mapa para marcar el punto (opcional).'}
          </Text>

          <Button label="Usar mi ubicación actual" variant="ghost" onPress={() => void useMyLocation()} loading={locating} />
          <ErrorBanner message={locError} />
          <Button
            label="Guardar dirección"
            onPress={() => void saveLocation()}
            loading={savingLoc}
            disabled={!newLoc.address.trim()}
          />
        </ScrollView>
      </BottomSheet>
      {/* Marcar el punto de una dirección que ya existe: el mismo mapa de «Nueva dirección», sin sus campos. */}
      <BottomSheet visible={sheet === 'pinLocation'} onClose={() => setSheet(null)} title="Marcar la ubicación">
        <MapPicker
          style={styles.mapBox}
          latitude={newLoc.latitude}
          longitude={newLoc.longitude}
          onChange={({ latitude, longitude }) => setPin(latitude, longitude)}
        />
        <Text style={styles.hint}>
          {newLoc.latitude != null ? `Punto marcado: ${newLoc.latitude.toFixed(5)}, ${newLoc.longitude!.toFixed(5)}` : 'Toca el mapa para marcar el punto.'}
        </Text>
        <Button label="Usar mi ubicación actual" variant="ghost" onPress={() => void useMyLocation()} loading={locating} />
        <ErrorBanner message={locError} />
        <Button label="Guardar ubicación" onPress={() => void savePin()} loading={savingLoc} disabled={newLoc.latitude == null} />
      </BottomSheet>
      <PickerSheet
        visible={sheet === 'bank'}
        onClose={() => setSheet(null)}
        title="Elegí el banco"
        options={banks.map((b) => ({ key: b.code, label: b.label }))}
        onPick={(key) => dispatch({ t: 'details', patch: { bankCode: key } })}
      />

      {picker && (
        <DateTimePicker
          value={
            picker === 'time'
              ? new Date(`1970-01-01T${form.scheduledTime || '09:00'}:00`)
              : toLocalDate(picker === 'date' ? form.scheduledDate : ((details.promiseDate as string) ?? todayISO()))
          }
          mode={picker === 'time' ? 'time' : 'date'}
          minimumDate={picker === 'time' ? undefined : toLocalDate(todayISO())}
          onChange={onPicked}
        />
      )}
    </View>
  );
}

/**
 * Campo deshabilitado: dato del crédito que el cobrador consulta pero no edita. Es un `Text`, no un
 * `TextInput` inerte — no toma foco ni abre teclado, y el lector de pantalla no lo anuncia como editable.
 */
function ReadOnlyField({ value }: { value: string }) {
  return (
    <View style={[styles.input, styles.readOnly]}>
      <Text style={styles.readOnlyText} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/** Caja de texto multilínea (notas, mensaje de WhatsApp). `Field` de components.tsx es de una línea. */
function Multiline({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={COLORS.muted}
      multiline
      textAlignVertical="top"
      style={[styles.input, styles.multiline]}
    />
  );
}

const styles = StyleSheet.create({
  body: { padding: SPACING.lg, paddingBottom: SPACING.xxl },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  typeChip: {
    flexGrow: 1,
    flexBasis: '30%',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: SPACING.md,
  },
  typeChipActive: { backgroundColor: COLORS.purple, borderColor: COLORS.purple },
  typeIcon: { fontSize: 20 },
  typeLabel: { ...TYPE.caption, fontWeight: '600', color: COLORS.text2 },
  typeLabelActive: { color: COLORS.white },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    height: 52,
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.input,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
  },
  searchIcon: { fontSize: 16 },
  searchInput: { flex: 1, ...TYPE.body },
  hit: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.input,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    marginTop: SPACING.sm,
  },
  hitName: { ...TYPE.body, fontWeight: '600', color: COLORS.navy },
  hitDoc: { ...TYPE.caption },
  clientCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    backgroundColor: COLORS.highlight,
    borderRadius: RADIUS.card,
    padding: SPACING.md,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.purple, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: COLORS.white, fontSize: 17, fontWeight: '700' },
  clientName: { ...TYPE.body, fontWeight: '700', color: COLORS.navy },
  clientDoc: { ...TYPE.caption },
  remove: { color: COLORS.danger, fontSize: 18, fontWeight: '700' },
  input: {
    minHeight: 52,
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.input,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    ...TYPE.body,
  },
  multiline: { minHeight: 96 },
  readOnly: { backgroundColor: COLORS.lightBg, borderColor: COLORS.border, justifyContent: 'center' },
  readOnlyText: { ...TYPE.body, fontWeight: '600', color: COLORS.text2 },
  hint: { ...TYPE.caption, marginTop: SPACING.xs },
  toggle: {
    flexDirection: 'row',
    backgroundColor: COLORS.lightBg,
    borderRadius: RADIUS.input,
    padding: 3,
    marginTop: SPACING.sm,
  },
  toggleItem: { flex: 1, alignItems: 'center', paddingVertical: SPACING.sm, borderRadius: 8 },
  toggleItemActive: { backgroundColor: COLORS.navy },
  toggleText: { ...TYPE.secondary, fontWeight: '600' },
  toggleTextActive: { color: COLORS.white },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  chip: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.pill,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
  chipActive: { backgroundColor: COLORS.purple, borderColor: COLORS.purple },
  chipText: { ...TYPE.secondary, fontWeight: '600' },
  chipTextActive: { color: COLORS.white },
  footer: {
    backgroundColor: COLORS.white,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
  },
  mapBox: { height: 200, borderRadius: RADIUS.card, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border },
});
