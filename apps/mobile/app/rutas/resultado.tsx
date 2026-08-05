import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { AgendaItemType, AgendaTimeSlot, CatalogType, ScheduleTimeMode } from '@kobrax/shared';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { AmountInput, Chips, Header, SectionLabel } from '@/ui';
import { Button, ErrorBanner } from '@/components';
import { choosePhoto } from '@/photo';
import { uploadImage } from '@/uploads.service';
import { money, todayISO } from '@/agenda-form';
import { listCatalogCached, type CatalogOption } from '@/catalogs.service';
import { createItem } from '@/agenda.service';
import { createPayment, type PaymentMethod } from '@/payments.service';
import { getRoute, type RouteStopItem } from '@/routes.service';
import { addVisitEvidence, createVisit, resolveVisitCoords } from '@/field.service';
import {
  buildDetails,
  canSubmitResult,
  initialResult,
  paymentOutcome,
  postVisitWarning,
  VISIT_VARIANTS,
  variantMeta,
  type ResultForm,
  type VariantKey,
} from '@/visit-result';

/**
 * RT-6 · Registrar el resultado de la parada (Rutas S5). Las 6 variantes del mockup en una pantalla:
 * el cobrador elige qué pasó y la variante pide sólo lo suyo.
 *
 * **Todas terminan en una visita** (`POST /visits`), que es lo que marca la parada como visitada y
 * deja la gestión en la bitácora. Cobrado y Promesa además escriben en pagos y en la agenda.
 */
export default function ResultadoScreen() {
  const { routeId, stopId } = useLocalSearchParams<{ routeId: string; stopId: string }>();
  const [stop, setStop] = useState<RouteStopItem | null>(null);
  const [key, setKey] = useState<VariantKey>('PAID');
  const [form, setForm] = useState<ResultForm>(() => initialResult(todayISO()));
  const [categories, setCategories] = useState<CatalogOption[]>([]);
  const [showDate, setShowDate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * La visita ya está creada en el server. Bloquea reenviarla —repetir duplicaría la parada
   * visitada— y cambia el botón por uno de salida, para que un aviso de "el pago no se guardó"
   * se pueda leer sin que la pantalla se vaya sola.
   */
  const [registered, setRegistered] = useState(false);

  const set = useCallback((patch: Partial<ResultForm>) => setForm((f) => ({ ...f, ...patch })), []);
  const meta = variantMeta(key);

  useEffect(() => {
    void (async () => {
      const res = await getRoute(routeId);
      if (res.status === 'ok') setStop((res.data.stops ?? []).find((s) => s.id === stopId) ?? null);
      const cats = await listCatalogCached(CatalogType.SPECIAL_CATEGORY);
      if (cats.status === 'ok') setCategories(cats.data);
    })();
  }, [routeId, stopId]);

  const outstanding = stop?.overdueAmount;
  const currency = stop?.currency ?? 'BOB';
  const valid = useMemo(() => canSubmitResult(key, form, outstanding), [key, form, outstanding]);

  const onDate = useCallback(
    (e: DateTimePickerEvent, d?: Date) => {
      setShowDate(false);
      if (e.type === 'set' && d) {
        set({ promiseDate: new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10) });
      }
    },
    [set],
  );

  const capture = useCallback(async () => {
    const pick = await choosePhoto();
    if (!pick) return;
    setBusy(true);
    const up = await uploadImage(pick.uri, pick.mimeType);
    setBusy(false);
    if (up.status === 'ok') set({ photo: { url: up.url, hash: up.hash } });
    else setError('No se pudo subir la foto.');
  }, [set]);

  const submit = useCallback(async () => {
    if (!stop) return;
    setBusy(true);
    setError(null);

    // Las coordenadas nunca bloquean: sin GPS se usa la ubicación de la parada, marcada como estimada.
    const coords = await resolveVisitCoords(stop);
    if (!coords) {
      setBusy(false);
      return setError('No se pudo obtener la ubicación y la parada no tiene una cargada. Activá el GPS para registrar.');
    }

    const amount = Number(form.amount);
    const outcome = key === 'PAID' ? paymentOutcome(amount, outstanding) : meta.outcome;

    const visit = await createVisit({
      routeStopId: stop.id,
      caseId: stop.caseId,
      lat: coords.latitude,
      lng: coords.longitude,
      accuracy: coords.accuracy,
      gpsFallback: coords.gpsFallback,
      outcome,
      notes: form.notes.trim() || undefined,
      details: buildDetails(key, form),
    });
    if (visit.status !== 'ok') {
      setBusy(false);
      return setError(
        visit.status === 'offline'
          ? 'Sin conexión: no se pudo registrar.'
          : visit.status === 'error'
            ? visit.message
            : 'Tu sesión venció. Volvé a entrar.',
      );
    }

    setRegistered(true);

    // Lo que falle de acá en adelante se ACUMULA y se muestra sin navegar. Antes cada uno hacía
    // `setError` y abajo se llamaba a `router.replace` igual: la pantalla se desmontaba antes de
    // pintar el banner, así que un pago que no se guardó se perdía sin que el cobrador se enterara.
    const pendientes: string[] = [];

    // La foto se sella contra la visita ya creada. Si falla, la visita YA quedó: se avisa y no se
    // reintenta sola — repetir el registro duplicaría la parada visitada.
    if (form.photo) {
      const ev = await addVisitEvidence(visit.data.id, { type: 'PHOTO', fileUrl: form.photo.url, fileHash: form.photo.hash });
      if (ev.status !== 'ok') pendientes.push('la foto no se pudo adjuntar');
    }

    if (key === 'PAID' && stop.creditId) {
      const pay = await createPayment(
        {
          creditId: stop.creditId,
          caseId: stop.caseId,
          amount,
          method: form.paymentMethodCode as PaymentMethod,
          receiptUrl: form.photo?.url,
          receiptHash: form.photo?.hash,
        },
        // Anti doble cobro si el cobrador reintenta con señal mala: la llave sale de la visita, que
        // el server creó una sola vez, así que reintentar no puede cobrarle dos veces al deudor.
        `visit-${visit.data.id}`,
      );
      if (pay.status !== 'ok') pendientes.push(`el pago de ${money(amount, currency)} NO se guardó`);
    }

    if (key === 'PROMISE' && stop.caseId && stop.creditId) {
      // La promesa vive en la agenda (patrón cartera/agenda), y el server le agrega su recordatorio.
      const prom = await createItem({
        caseId: stop.caseId,
        creditId: stop.creditId,
        type: AgendaItemType.PROMISE_TO_PAY,
        scheduledDate: form.promiseDate,
        timeMode: ScheduleTimeMode.LAPSE,
        timeSlot: AgendaTimeSlot.MORNING,
        details: { amount, promiseDate: form.promiseDate, paymentMethodCode: form.paymentMethodCode },
      });
      if (prom.status !== 'ok') pendientes.push('la promesa no se pudo agendar');
    }

    setBusy(false);
    const aviso = postVisitWarning(pendientes);
    if (aviso) {
      // Se queda en la pantalla a propósito: es lo único que hace que el cobrador lo lea.
      setError(aviso);
      return;
    }
    router.replace(`/rutas/mapa?routeId=${routeId}`);
  }, [stop, key, form, outstanding, meta, routeId, currency]);

  return (
    <View style={styles.screen}>
      <Header title="Registrar resultado" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={TYPE.secondary} numberOfLines={1}>
          {stop?.clientName ?? 'Cliente'}
          {outstanding != null ? ` · debe ${money(outstanding, currency)}` : ''}
        </Text>

        <SectionLabel>¿Qué pasó?</SectionLabel>
        <View style={styles.variants}>
          {VISIT_VARIANTS.map((v) => (
            <Pressable
              key={v.key}
              onPress={() => setKey(v.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: v.key === key }}
              style={[styles.variant, v.key === key && styles.variantOn]}
            >
              <Text style={styles.variantIcon}>{v.icon}</Text>
              <Text style={[styles.variantLabel, v.key === key && styles.variantLabelOn]} numberOfLines={2}>
                {v.title}
              </Text>
            </Pressable>
          ))}
        </View>

        <ErrorBanner message={error} />

        {(key === 'PAID' || key === 'PROMISE') && (
          <>
            <SectionLabel>{key === 'PAID' ? 'Monto cobrado' : 'Monto prometido'}</SectionLabel>
            <AmountInput
              value={form.amount}
              onChangeText={(v) => set({ amount: v })}
              currencySymbol={currency}
              accessibilityLabel={key === 'PAID' ? 'Monto cobrado' : 'Monto prometido'}
            />
          </>
        )}

        {key === 'PAID' && (
          <>
            <SectionLabel>Método de pago</SectionLabel>
            <Chips
              options={PAY_METHODS}
              value={form.paymentMethodCode as (typeof PAY_METHODS)[number]['value']}
              onChange={(v) => set({ paymentMethodCode: v })}
            />
            {/*
              El mockup pide un "número de recibo" escrito a mano, pero `payments.receipt_number` es
              un entero del sistema, no un texto libre: no hay dónde guardarlo. Se usa la foto del
              comprobante, que el pago sí soporta punta a punta (`receipt_url` + hash del original).
            */}
            <Pressable style={styles.photoBtn} onPress={capture} accessibilityRole="button">
              <Text style={styles.photoText}>{form.photo ? '📷 Comprobante listo' : '📷 Foto del comprobante'}</Text>
            </Pressable>
          </>
        )}

        {key === 'PROMISE' && (
          <>
            <SectionLabel>Fecha de compromiso</SectionLabel>
            <Pressable style={styles.input} onPress={() => setShowDate(true)} accessibilityRole="button">
              <Text style={TYPE.body}>{form.promiseDate}</Text>
            </Pressable>
            {showDate && <DateTimePicker value={new Date(`${form.promiseDate}T12:00:00Z`)} mode="date" onChange={onDate} />}
            <Text style={styles.aviso}>Se agendará un recordatorio el día anterior.</Text>
          </>
        )}

        {key === 'NO_ANSWER' && (
          <>
            <SectionLabel>Canal intentado</SectionLabel>
            <Chips options={CHANNELS} value={form.channel} onChange={(v) => set({ channel: v })} />
          </>
        )}

        {key === 'NO_CONTACT_VISIT' && (
          <>
            <View style={styles.switchRow}>
              <Switch value={form.noticeLeft} onValueChange={(v) => set({ noticeLeft: v })} />
              <Text style={TYPE.body}>Aviso de cobro dejado</Text>
            </View>
            <Pressable style={styles.photoBtn} onPress={capture} accessibilityRole="button">
              <Text style={styles.photoText}>{form.photo ? '📷 Foto lista' : '📷 Subir foto del domicilio'}</Text>
            </Pressable>
          </>
        )}

        {key === 'SPECIAL' && (
          <>
            <SectionLabel>Categoría</SectionLabel>
            <View style={styles.cats}>
              {categories.map((c) => (
                <Pressable
                  key={c.code}
                  onPress={() => set({ categoryCode: c.code })}
                  accessibilityRole="button"
                  style={[styles.cat, form.categoryCode === c.code && styles.catOn]}
                >
                  <Text style={form.categoryCode === c.code ? styles.catLabelOn : styles.catLabel}>{c.label}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        <SectionLabel>{key === 'WRONG_ADDRESS' ? 'Observación (obligatoria)' : 'Observación'}</SectionLabel>
        <TextInput
          style={[styles.input, styles.textarea]}
          value={form.notes}
          onChangeText={(v) => set({ notes: v })}
          placeholder={PLACEHOLDER[key]}
          placeholderTextColor={COLORS.text2}
          multiline
        />
      </ScrollView>

      <View style={styles.footer}>
        {registered ? (
          <Button label="Volver a la ruta" onPress={() => router.replace(`/rutas/mapa?routeId=${routeId}`)} />
        ) : (
          <Button label={meta.cta} onPress={submit} loading={busy} disabled={busy || !valid || !stop} />
        )}
      </View>
    </View>
  );
}

const PAY_METHODS = [
  { value: 'CASH' as const, label: 'Efectivo' },
  { value: 'QR' as const, label: 'QR' },
  { value: 'TRANSFER' as const, label: 'Transf.' },
];
const CHANNELS = [
  { value: 'CALL' as const, label: 'Llamada' },
  { value: 'DOOR' as const, label: 'Puerta' },
];
const PLACEHOLDER: Record<VariantKey, string> = {
  PAID: 'Algo que aclarar del cobro…',
  PROMISE: 'Qué acordaron…',
  NO_ANSWER: 'Ej: No atiende el teléfono tras 3 intentos…',
  NO_CONTACT_VISIT: 'Ej: Local cerrado…',
  WRONG_ADDRESS: 'Ej: El edificio ya no existe o el cliente se mudó…',
  SPECIAL: 'Detalle la situación especial aquí…',
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  body: { padding: SPACING.lg, gap: SPACING.sm, paddingBottom: SPACING.xxl },
  variants: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  variant: {
    width: '31%',
    alignItems: 'center',
    gap: 4,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  variantOn: { borderColor: COLORS.navy, backgroundColor: COLORS.highlight },
  variantIcon: { fontSize: 22 },
  variantLabel: { ...TYPE.caption, textAlign: 'center' },
  variantLabelOn: { color: COLORS.navy, fontWeight: '700' },
  input: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    minHeight: 52,
    ...TYPE.body,
  },
  textarea: { minHeight: 90, textAlignVertical: 'top' },
  aviso: { ...TYPE.caption, color: COLORS.text2 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.sm },
  photoBtn: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: COLORS.border,
    borderRadius: RADIUS.card,
    paddingVertical: SPACING.lg,
    alignItems: 'center',
  },
  photoText: { ...TYPE.secondary, color: COLORS.navy, fontWeight: '600' },
  cats: { gap: SPACING.xs },
  cat: { padding: SPACING.md, backgroundColor: COLORS.white, borderRadius: RADIUS.card, borderWidth: 1, borderColor: COLORS.border },
  catOn: { borderColor: COLORS.navy, backgroundColor: COLORS.highlight },
  catLabel: { ...TYPE.body },
  catLabelOn: { ...TYPE.body, color: COLORS.navy, fontWeight: '700' },
  footer: { padding: SPACING.lg, borderTopWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.white },
});
