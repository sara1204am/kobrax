import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { portfolioStatus } from '@kobrax/shared';
import { choosePhoto } from '@/photo';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { AmountInput, BottomSheet, Chips, EmptyState, Header, PORTFOLIO_STATUS_META, SectionLabel, StatusBadge } from '@/ui';
import { Button, ErrorBanner, Field } from '@/components';
import { money, MONTHS, timeSlotRange } from '@/agenda-form';
import { MiniMapCard, type MiniMapPoint } from '@/maps/MiniMapCard';
import { clientContext, type AgendaClientContext, type CreditOption } from '@/agenda.service';
import { clientDisplayName, getClient, type ClientDetail } from '@/clients.service';
import { addActivity, getCase, type CaseDetail } from '@/cases.service';
import { createPayment, listPayments, type PaymentItem, type PaymentMethod } from '@/payments.service';
import { uploadImage } from '@/uploads.service';
import { MiQrCobro } from '@/qr-cobro';
import { queueForLater } from '@/sync/sync.service';
import { buildTimeline, promiseReady, recovered, type TimelineEntry } from '@/ficha';

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'CASH', label: 'Efectivo' },
  { value: 'TRANSFER', label: 'Transferencia' },
  { value: 'QR', label: 'QR' },
];
// Catálogo de resultado de gestión (§5.4). type = CaseActivityType, result = VisitOutcome.
const OUTCOMES: { key: string; label: string; type: 'CALL' | 'VISIT' | 'NOTE'; result: string; promise?: boolean }[] = [
  { key: 'no_contact', label: 'No contesta', type: 'CALL', result: 'NO_CONTACT' },
  { key: 'visit', label: 'Visita', type: 'VISIT', result: 'CONTACTED' },
  { key: 'not_found', label: 'Inubicable', type: 'VISIT', result: 'NOT_FOUND' },
  { key: 'promise', label: 'Promesa de pago', type: 'NOTE', result: 'PROMISE_TO_PAY', promise: true },
];
const METHOD_LABEL: Record<string, string> = { CASH: 'Efectivo', TRANSFER: 'Transferencia', QR: 'QR', CARD: 'Tarjeta', MOBILE_PAYMENT: 'Pago móvil' };

function todayIso(): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())).toISOString().slice(0, 10);
}
function prettyDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
function onlyDigits(s?: string | null): string {
  return (s ?? '').replace(/[^0-9]/g, '');
}

/** V4 — Ficha de cobranza (§5.4): detalle + acciones + pago + gestión + timeline. */
export default function ClienteFichaScreen() {
  // `routeId` presente = la ficha se abrió desde el mapa de una ruta (RT-5, Rutas S4).
  const { id: clientId, routeId } = useLocalSearchParams<{ id: string; routeId?: string }>();
  const fromRoute = !!routeId;
  const [ctx, setCtx] = useState<AgendaClientContext | null>(null);
  const [load, setLoad] = useState<'loading' | 'ok' | 'offline' | 'error' | 'sin-creditos'>('loading');
  /** Identidad mínima cuando no hay contexto de cobranza que mostrar (ver `loadAll`). */
  const [basic, setBasic] = useState<ClientDetail | null>(null);
  const [creditId, setCreditId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [payments, setPayments] = useState<PaymentItem[]>([]);
  const [showData, setShowData] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [paySheet, setPaySheet] = useState(false);
  const [gestSheet, setGestSheet] = useState(false);

  const selected = useMemo(() => ctx?.credits.find((c) => c.creditId === creditId) ?? ctx?.credits[0], [ctx, creditId]);

  /**
   * Los garantes con punto en el mapa (RT-5). `GUARANTOR` es un `LocationType`, no una entidad
   * aparte: ya vienen en el contexto del cliente, sin pedir nada más.
   */
  const garantes = useMemo<MiniMapPoint[]>(
    () =>
      (ctx?.locations ?? [])
        .filter((l) => l.locationType === 'GUARANTOR' && l.latitude != null && l.longitude != null)
        .map((l) => ({ id: l.id, latitude: Number(l.latitude), longitude: Number(l.longitude), tone: 'nearby' })),
    [ctx],
  );
  /** El deudor, para que el mini-mapa muestre a quién están cerca los garantes. */
  const deudorPoint = useMemo<MiniMapPoint | undefined>(() => {
    const l = (ctx?.locations ?? []).find((x) => x.locationType !== 'GUARANTOR' && x.latitude != null && x.longitude != null);
    return l ? { id: l.id, latitude: Number(l.latitude), longitude: Number(l.longitude), tone: 'primary' } : undefined;
  }, [ctx]);

  const loadCase = useCallback(async (caseId: string) => {
    const [c, p] = await Promise.all([getCase(caseId), listPayments(caseId)]);
    if (c.status === 'ok') setDetail(c.data);
    if (p.status === 'ok') setPayments(p.data);
  }, []);

  const loadAll = useCallback(async () => {
    const res = await clientContext(clientId);
    if (res.status === 'offline') return setLoad('offline');
    if (res.status === 'unauthenticated') return setLoad('error');
    // Un cliente sin préstamos asignados a mí NO es un error: la búsqueda global (S4) lo encuentra y
    // `clientContext` responde AGENDA_002. Antes caía en "No se pudo cargar", que era mentira y un
    // callejón sin salida. Se degrada a la identidad, que `client:read` sí puede leer sin caso.
    if (res.status !== 'ok' || res.data.credits.length === 0) {
      const only = await getClient(clientId);
      if (only.status === 'offline') return setLoad('offline');
      if (only.status !== 'ok') return setLoad('error');
      setBasic(only.data);
      return setLoad('sin-creditos');
    }
    setCtx(res.data);
    setLoad('ok');
    const first = res.data.credits.find((c) => c.creditId === creditId) ?? res.data.credits[0];
    if (first) {
      setCreditId(first.creditId);
      await loadCase(first.caseId);
    }
  }, [clientId, creditId, loadCase]);

  // Recarga al entrar y al VOLVER (p. ej. de la edición) → la ficha refleja los cambios.
  useFocusEffect(
    useCallback(() => {
      void loadAll();
    }, [loadAll]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  }, [loadAll]);

  const selectCredit = useCallback(
    async (c: CreditOption) => {
      setCreditId(c.creditId);
      setDetail(null);
      setPayments([]);
      await loadCase(c.caseId);
    },
    [loadCase],
  );

  // Barra de acciones: deep-link + auto-log (§5.4/§7). El log no bloquea el link.
  const doAction = useCallback(
    (kind: 'call' | 'whatsapp' | 'navigate') => {
      if (!selected) return;
      const phone = onlyDigits(ctx?.contacts.find((c) => c.isPrimary)?.value ?? ctx?.contacts[0]?.value);
      const loc = ctx?.locations.find((l) => l.latitude != null);
      let url: string | null = null;
      let type: 'CALL' | 'MESSAGE' | 'NOTE' = 'CALL';
      // Navegar NO sale de la app: abre el mapa de Kobrax centrado en la dirección (el mismo mapa de
      // la ruta, que además anda offline con los packs). Google Maps dejaba al cobrador afuera.
      if (kind === 'navigate') {
        router.push(`/cliente/mapa?clientId=${clientId}&locationId=${loc?.id ?? ''}&name=${encodeURIComponent(ctx?.client.displayName ?? '')}`);
        void addActivity(selected.caseId, { type: 'NOTE', notes: 'Navegación' });
        return;
      }
      if (kind === 'call' && phone) { url = `tel:${phone}`; type = 'CALL'; }
      else if (kind === 'whatsapp' && phone) { url = `https://wa.me/${phone}`; type = 'MESSAGE'; }
      if (!url) return;
      void Linking.openURL(url);
      void addActivity(selected.caseId, { type, notes: kind === 'call' ? 'Llamada' : 'WhatsApp' });
    },
    [selected, ctx, clientId],
  );

  if (load === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <Header title="Ficha" onBack={() => router.back()} />
        <View style={styles.center}><ActivityIndicator color={COLORS.navy} /></View>
      </View>
    );
  }
  if (load === 'sin-creditos' && basic) {
    const name = clientDisplayName(basic);
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <Header title="Ficha" onBack={() => router.back()} />
        <View style={{ padding: SPACING.lg }}>
          <Text style={[styles.name, { flex: 0 }]}>{name}</Text>
          <Text style={styles.sub}>{basic.nationalId ?? '—'}</Text>
        </View>
        <EmptyState
          icon="📄"
          title="Sin préstamos registrados"
          hint="Este cliente está en el sistema, pero todavía no tiene un préstamo con vos."
        />
        <View style={{ padding: SPACING.lg }}>
          <Button
            label="Registrar préstamo"
            onPress={() => router.push({ pathname: '/prestamo/nuevo', params: { clientId, name } })}
          />
        </View>
      </View>
    );
  }

  if (load !== 'ok' || !ctx || !selected) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <Header title="Ficha" onBack={() => router.back()} />
        {load === 'offline'
          ? <EmptyState icon="📴" title="Sin conexión" hint="La ficha aparecerá cuando vuelva la red." />
          : <EmptyState icon="⚠️" title="No se pudo cargar" hint="Reintentá en un momento." />}
      </View>
    );
  }

  const totalDebt = ctx.credits.reduce((s, c) => s + c.outstandingBalance, 0);
  const currency = selected.currency;
  const zone = ctx.locations.find((l) => l.zone)?.zone;
  const status = portfolioStatus({ outstandingBalance: selected.outstandingBalance, daysPastDue: selected.daysPastDue, nextDueDate: detail?.nextDueDate ?? null });
  const meta = PORTFOLIO_STATUS_META[status];
  const timeline = buildTimeline(detail?.activities ?? [], payments);
  const rec = recovered(selected.principalAmount, selected.outstandingBalance);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Header title="Ficha de cobranza" onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.xxl * 2, gap: SPACING.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.navy} />}
      >
        {/* Cabecera */}
        <View>
          <View style={styles.headRow}>
            <Text style={styles.name}>{ctx.client.displayName}</Text>
            <Pressable
              onPress={() => router.push({ pathname: '/cliente/editar', params: { clientId, creditId: selected.creditId } })}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Editar cliente y crédito"
              style={styles.editBtn}
            >
              <Text style={styles.editIcon}>✏️</Text>
            </Pressable>
            <StatusBadge label={meta.label} tone={meta.tone} />
          </View>
          <Text style={styles.sub}>{[ctx.client.nationalId, zone].filter(Boolean).join(' · ') || '—'}</Text>
          <Text style={[styles.debt, selected.daysPastDue > 0 && { color: COLORS.danger }]}>{money(totalDebt, currency)}</Text>
          {detail?.locked && (
            <Text style={styles.locked}>🔒 Importado · {detail.origin} — actualizá con una nueva importación</Text>
          )}
        </View>

        {/* Barra de acciones */}
        <View style={styles.actions}>
          <ActionBtn label="Llamar" icon="📞" onPress={() => doAction('call')} />
          <ActionBtn label="WhatsApp" icon="💬" onPress={() => doAction('whatsapp')} />
          <ActionBtn label="Navegar" icon="🧭" onPress={() => doAction('navigate')} />
        </View>

        {/* Próximo pago */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Próximo pago</Text>
          <Text style={styles.cardBig}>
            {detail?.installmentAmount != null ? money(detail.installmentAmount, currency) : money(selected.outstandingBalance, currency)}
          </Text>
          <Text style={styles.cardSub}>
            {detail?.nextDueDate ? `Vence ${prettyDate(detail.nextDueDate)}` : 'Sin fecha'}
            {selected.daysPastDue > 0 ? ` · ${selected.daysPastDue} días de mora` : ''}
          </Text>
          <View style={{ gap: SPACING.sm, marginTop: SPACING.sm }}>
            <Button label="Registrar pago" onPress={() => setPaySheet(true)} />
            <Button label="Registrar gestión" variant="ghost" onPress={() => setGestSheet(true)} />
          </View>
        </View>

        {/* Progreso */}
        <View>
          <Text style={styles.progressLabel}>Recuperado {money(rec, currency)} de {money(selected.principalAmount, currency)}</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${selected.principalAmount > 0 ? Math.round((rec / selected.principalAmount) * 100) : 0}%` }]} />
          </View>
        </View>

        {/* Selector de crédito */}
        {ctx.credits.length > 1 && (
          <View>
            <SectionLabel>{`Préstamos (${ctx.credits.length})`}</SectionLabel>
            <Chips
              options={ctx.credits.map((c) => ({ value: c.creditId, label: `${c.code ?? 'Crédito'} · ${money(c.outstandingBalance, c.currency)}` }))}
              value={selected.creditId}
              onChange={(v) => { const c = ctx.credits.find((x) => x.creditId === v); if (c) void selectCredit(c); }}
            />
          </View>
        )}

        {/* Datos del préstamo (colapsable) */}
        <Pressable onPress={() => setShowData((v) => !v)} accessibilityRole="button">
          <Text style={styles.collapse}>{showData ? '▾' : '▸'} Datos del préstamo</Text>
        </Pressable>
        {showData && detail && (
          <View style={styles.card}>
            <DataRow label="Capital" value={money(selected.principalAmount, currency)} />
            <DataRow label="Frecuencia" value={detail.frequency ?? '—'} />
            <DataRow label="Próxima fecha" value={prettyDate(detail.nextDueDate)} />
            <DataRow label="Origen" value={detail.origin ?? 'manual'} />
          </View>
        )}

        {/*
          RT-5 (Rutas S4): sólo cuando la ficha se abre DESDE una ruta. Abierta desde cartera es la
          misma ficha de siempre — el cobrador parado en la puerta necesita esto; el de escritorio no.
        */}
        {fromRoute && (
          <View style={{ gap: SPACING.sm }}>
            {ctx.contactHint && (
              <View style={styles.hint}>
                <Text style={styles.hintTitle}>
                  🕘 Hora recomendada · {timeSlotRange(ctx.contactHint.timeSlot)}
                </Text>
                {/* Se dice en qué se basa: una recomendación sin respaldo no se puede juzgar. */}
                <Text style={TYPE.caption}>
                  {`Es la franja en la que lo contactaste ${ctx.contactHint.basedOn} veces.`}
                </Text>
              </View>
            )}
            {garantes.length > 0 && (
              <View style={{ gap: SPACING.xs }}>
                <SectionLabel>{`Garantes cerca (${garantes.length})`}</SectionLabel>
                <MiniMapCard center={deudorPoint ?? garantes[0]!} points={[...(deudorPoint ? [deudorPoint] : []), ...garantes]} />
              </View>
            )}
          </View>
        )}

        {/* Contactos y ubicación (read-only en S3; "+ agregar" queda como follow-up) */}
        <View>
          <SectionLabel>Contactos y ubicación</SectionLabel>
          {ctx.contacts.map((c) => (
            <Text key={c.id} style={styles.line}>📱 {c.value ?? '—'}{c.isPrimary ? ' · principal' : ''}</Text>
          ))}
          {ctx.locations.map((l) => (
            <Text key={l.id} style={styles.line}>📍 {[l.address, l.zone].filter(Boolean).join(' · ') || 'Sin dirección'}</Text>
          ))}
        </View>

        {/* Timeline */}
        <View>
          <SectionLabel>Historial</SectionLabel>
          {timeline.length === 0 ? (
            <Text style={styles.line}>Sin movimientos todavía.</Text>
          ) : (
            timeline.map((e) => <TimelineRow key={`${e.kind}-${e.id}`} e={e} currency={currency} />)
          )}
        </View>
      </ScrollView>

      <PaySheet
        visible={paySheet}
        onClose={() => setPaySheet(false)}
        currency={currency}
        defaultAmount={detail?.installmentAmount ?? selected.outstandingBalance}
        maxAmount={selected.outstandingBalance}
        onSubmit={async (amount, method, receiptUrl, receiptHash, idemKey) => {
          const input = { creditId: selected.creditId, caseId: selected.caseId, amount, method, receiptUrl, receiptHash };
          const res = await createPayment(input, idemKey);
          if (res.status === 'ok') { setPaySheet(false); await loadCase(selected.caseId); return null; }
          if (res.status === 'offline') {
            // El cobro se guarda en el teléfono y sube solo. La clave de idempotencia es la que ya
            // generó el sheet, así que cuando salga no puede cobrarle dos veces al deudor.
            const guardado = await queueForLater({ kind: 'payment', input, idempotencyKey: idemKey });
            if (!guardado) return 'Sin conexión y no se pudo guardar en el teléfono. Reintentá.';
            setPaySheet(false);
            await loadCase(selected.caseId);
            return null;
          }
          if (res.status === 'unauthenticated') return 'Tu sesión venció.';
          return res.message;
        }}
      />

      <GestionSheet
        visible={gestSheet}
        onClose={() => setGestSheet(false)}
        currency={currency}
        onSubmit={async (payload) => {
          const res = await addActivity(selected.caseId, payload);
          if (res.status === 'ok') { setGestSheet(false); await loadCase(selected.caseId); return null; }
          if (res.status === 'offline') return 'Sin conexión — no se registró. Reintentá.';
          if (res.status === 'unauthenticated') return 'Tu sesión venció.';
          return res.message;
        }}
      />
    </View>
  );
}

function ActionBtn({ label, icon, onPress }: { label: string; icon: string; onPress: () => void }) {
  return (
    <Pressable style={styles.action} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <Text style={styles.actionIcon}>{icon}</Text>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}
function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.dataRow}>
      <Text style={styles.dataLabel}>{label}</Text>
      <Text style={styles.dataValue}>{value}</Text>
    </View>
  );
}
function TimelineRow({ e, currency }: { e: TimelineEntry; currency: string }) {
  const isPay = e.kind === 'payment';
  return (
    <View style={styles.tlRow}>
      <Text style={styles.tlIcon}>{isPay ? '💵' : '📝'}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.tlTitle}>
          {isPay ? `Pago ${money(e.amount, currency)} · ${METHOD_LABEL[e.method] ?? e.method}` : (e.result ?? e.type)}
          {isPay && e.receiptUrl ? '  📎' : ''}
        </Text>
        {!isPay && e.notes ? <Text style={styles.tlSub}>{e.notes}</Text> : null}
        <Text style={styles.tlDate}>{new Date(e.at).toLocaleDateString('es')}</Text>
      </View>
    </View>
  );
}

/** Hoja Registrar pago (§5.4). */
function PaySheet({
  visible, onClose, currency, defaultAmount, maxAmount, onSubmit,
}: {
  visible: boolean; onClose: () => void; currency: string; defaultAmount: number; maxAmount: number;
  onSubmit: (amount: number, method: PaymentMethod, receiptUrl: string | undefined, receiptHash: string | undefined, idemKey: string) => Promise<string | null>;
}) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [receipt, setReceipt] = useState<{ url: string; hash: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idemRef = useRef<string>('');

  useEffect(() => {
    if (visible) {
      setAmount(String(defaultAmount));
      setMethod('CASH');
      setReceipt(null);
      setError(null);
      idemRef.current = `pay-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    }
  }, [visible, defaultAmount]);

  const capture = useCallback(async () => {
    const pick = await choosePhoto();
    if (!pick) return;
    setUploading(true);
    const up = await uploadImage(pick.uri, pick.mimeType);
    setUploading(false);
    if (up.status === 'ok') setReceipt({ url: up.url, hash: up.hash });
    else setError('No se pudo subir el comprobante.');
  }, []);

  const num = Number(amount);
  const valid = num > 0 && num <= maxAmount + 0.005;

  const submit = useCallback(async () => {
    setSaving(true);
    setError(null);
    const err = await onSubmit(num, method, receipt?.url, receipt?.hash, idemRef.current);
    setSaving(false);
    if (err) setError(err);
  }, [num, method, receipt, onSubmit]);

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Registrar pago">
      <ErrorBanner message={error} />
      <SectionLabel>Monto</SectionLabel>
      <AmountInput value={amount} onChangeText={setAmount} currencySymbol={currency} accessibilityLabel="Monto del pago" />
      <SectionLabel>Método</SectionLabel>
      <Chips options={METHODS} value={method} onChange={setMethod} />
      {method === 'QR' && <MiQrCobro />}
      <Pressable style={styles.receiptBtn} onPress={capture} disabled={uploading} accessibilityRole="button">
        <Text style={styles.receiptText}>{uploading ? 'Subiendo…' : receipt ? '📷 Comprobante listo' : '📷 Foto de comprobante'}</Text>
      </Pressable>
      <View style={{ marginTop: SPACING.md }}>
        <Button label="Confirmar pago" onPress={submit} loading={saving} disabled={saving || uploading || !valid} />
      </View>
    </BottomSheet>
  );
}

/** Hoja Registrar gestión (§5.4). */
function GestionSheet({
  visible, onClose, currency, onSubmit,
}: {
  visible: boolean; onClose: () => void; currency: string;
  onSubmit: (payload: { type: 'NOTE' | 'CALL' | 'VISIT' | 'MESSAGE'; result: string; notes?: string; promise?: { amount: number; promiseDate: string; paymentMethodCode: string } }) => Promise<string | null>;
}) {
  const [outcome, setOutcome] = useState('no_contact');
  const [notes, setNotes] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayIso());
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) { setOutcome('no_contact'); setNotes(''); setAmount(''); setDate(todayIso()); setMethod('CASH'); setError(null); }
  }, [visible]);

  const oc = OUTCOMES.find((o) => o.key === outcome)!;
  const isPromise = !!oc.promise;
  const promise = { amount: Number(amount), promiseDate: date, paymentMethodCode: method };
  const valid = !isPromise || promiseReady(promise);

  const onDate = useCallback((e: DateTimePickerEvent, d?: Date) => {
    setShowPicker(false);
    if (e.type === 'set' && d) setDate(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10));
  }, []);

  const submit = useCallback(async () => {
    setSaving(true);
    setError(null);
    const err = await onSubmit({
      type: oc.type,
      result: oc.result,
      notes: notes.trim() || undefined,
      promise: isPromise ? promise : undefined,
    });
    setSaving(false);
    if (err) setError(err);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oc, notes, isPromise, amount, date, method, onSubmit]);

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Registrar gestión">
      <ErrorBanner message={error} />
      <SectionLabel>Resultado</SectionLabel>
      <Chips options={OUTCOMES.map((o) => ({ value: o.key, label: o.label }))} value={outcome} onChange={setOutcome} />
      {isPromise && (
        <>
          <SectionLabel>Monto prometido</SectionLabel>
          <AmountInput value={amount} onChangeText={setAmount} currencySymbol={currency} accessibilityLabel="Monto prometido" />
          <SectionLabel>Pagará el</SectionLabel>
          <Pressable style={styles.dateBtn} onPress={() => setShowPicker(true)} accessibilityRole="button">
            <Text style={styles.dateText}>{prettyDate(date)}</Text>
          </Pressable>
          <SectionLabel>Medio de pago</SectionLabel>
          <Chips options={METHODS} value={method} onChange={setMethod} />
        </>
      )}
      <SectionLabel>Nota</SectionLabel>
      <Field label="" value={notes} onChangeText={setNotes} placeholder="Opcional" />
      <View style={{ marginTop: SPACING.md }}>
        <Button label="Guardar gestión" onPress={submit} loading={saving} disabled={saving || !valid} />
      </View>
      {showPicker && <DateTimePicker value={new Date(date)} mode="date" onChange={onDate} />}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  name: { ...TYPE.h2, color: COLORS.navy, flex: 1 },
  editBtn: { width: 34, height: 34, borderRadius: RADIUS.pill, backgroundColor: COLORS.highlight, alignItems: 'center', justifyContent: 'center' },
  editIcon: { fontSize: 16 },
  sub: { ...TYPE.secondary, color: COLORS.text2, marginTop: 2 },
  debt: { fontSize: 30, fontWeight: '700', color: COLORS.navy, marginTop: SPACING.sm },
  locked: { ...TYPE.caption, color: COLORS.warningText, backgroundColor: COLORS.warningBg, padding: SPACING.sm, borderRadius: RADIUS.input, marginTop: SPACING.sm },
  // Chip de hora recomendada (RT-5). Highlight y no warning: es una ayuda, no una alerta.
  hint: { backgroundColor: COLORS.highlight, borderRadius: RADIUS.card, padding: SPACING.md, gap: 2 },
  hintTitle: { ...TYPE.body, color: COLORS.navy, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: SPACING.sm },
  action: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: SPACING.md, backgroundColor: COLORS.white, borderRadius: RADIUS.card, borderWidth: 1, borderColor: COLORS.border },
  actionIcon: { fontSize: 22 },
  actionLabel: { ...TYPE.caption, color: COLORS.navy, fontWeight: '600' },
  card: { backgroundColor: COLORS.white, borderRadius: RADIUS.card, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.lg },
  cardTitle: { ...TYPE.caption, color: COLORS.muted, textTransform: 'uppercase', fontWeight: '700' },
  cardBig: { fontSize: 26, fontWeight: '700', color: COLORS.navy, marginTop: 2 },
  cardSub: { ...TYPE.secondary, color: COLORS.text2 },
  progressLabel: { ...TYPE.secondary, color: COLORS.text, marginBottom: SPACING.xs },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: COLORS.lightBg, overflow: 'hidden' },
  progressFill: { height: 8, backgroundColor: COLORS.success },
  collapse: { ...TYPE.body, color: COLORS.navy, fontWeight: '600' },
  dataRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  dataLabel: { ...TYPE.secondary, color: COLORS.text2 },
  dataValue: { ...TYPE.secondary, color: COLORS.navy, fontWeight: '600', textTransform: 'capitalize' },
  line: { ...TYPE.body, color: COLORS.text, paddingVertical: 4 },
  tlRow: { flexDirection: 'row', gap: SPACING.sm, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  tlIcon: { fontSize: 18 },
  tlTitle: { ...TYPE.body, color: COLORS.navy, fontWeight: '600' },
  tlSub: { ...TYPE.secondary, color: COLORS.text2 },
  tlDate: { ...TYPE.caption, color: COLORS.muted, marginTop: 2 },
  receiptBtn: { marginTop: SPACING.md, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.input, borderWidth: 1, borderColor: COLORS.periwinkle, backgroundColor: COLORS.highlight },
  receiptText: { ...TYPE.secondary, color: COLORS.navy, fontWeight: '600' },
  dateBtn: { height: 48, borderRadius: RADIUS.input, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.white, justifyContent: 'center', paddingHorizontal: SPACING.md },
  dateText: { ...TYPE.body, color: COLORS.navy, textTransform: 'capitalize' },
});
