import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { addPeriods, calculateCredit, isUnknownField, PaymentFrequency, portfolioStatus, RatePeriod, type MoraCreditDetail } from '@kobrax/shared';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { ActionBtn, AmountInput, BottomSheet, Chips, DataRow, EmptyState, Header, PORTFOLIO_STATUS_META, SectionLabel, StatusBadge } from '@/ui';
import { Button, ErrorBanner, Field } from '@/components';
import { money, timeSlotRange } from '@/agenda-form';
import { MiniMapCard, type MiniMapPoint } from '@/maps/MiniMapCard';
import { clientContext, type AgendaClientContext, type CreditOption } from '@/agenda.service';
import { clientDisplayName, getClient, type ClientDetail } from '@/clients.service';
import { getMora } from '@/mora.service';
import { submitMoraActivity } from '@/mora-actions';
import { listCreditPayments, type PaymentItem } from '@/payments.service';
import { clearArrears, getCredit, markArrears, type CreditDetail } from '@/credits.service';
import { PlanSheet, prettyDay } from '@/credit-terms-view';
import { DEFINITION_LABEL, FREQUENCY_LABEL, IMPORT_FIELD_LABEL, ORIGIN_LABEL, RATE_PERIOD_LABEL, UNKNOWN } from '@/credit-labels';
import { pendingActions, type QueuedAction } from '@/sync/queue';
import { getUserId } from '@/session';
import { queueForLater } from '@/sync/sync.service';
import { buildTimeline, onlyDigits, queuedPayments, recovery, type TimelineEntry } from '@/ficha';
import { PaySheet } from '@/pay-sheet';
import { submitPayment } from '@/payment-submit';
import { registrarRastro } from '@/trace';
import { GestionSheet, prettyDate } from '@/gestion-sheet';
import { nuevoId } from '@/ids';

/** Las dos acciones de mora, ya en la forma en la que viajan por la cola. */
type QueuedArrears = Extract<QueuedAction, { kind: 'arrears.mark' | 'arrears.clear' }>;


/** Los pagos de este crédito que esperan señal en el teléfono (para mostrarlos en el historial ya). */
async function queuedFor(creditId: string): Promise<PaymentItem[]> {
  const userId = await getUserId();
  return userId ? queuedPayments(creditId, await pendingActions(userId)) : [];
}
const METHOD_LABEL: Record<string, string> = { CASH: 'Efectivo', TRANSFER: 'Transferencia', QR: 'QR', CARD: 'Tarjeta', MOBILE_PAYMENT: 'Pago móvil' };


/**
 * V4 — Ficha de cobranza (§5.4): detalle + acciones + pago + gestión + timeline. **Todo por crédito** (F4/08): la
 * ficha lee el crédito (`GET /mora/:creditId`), sus pagos (`/payments?creditId=`) y escribe gestiones y pagos con
 * `creditId`. No hace falta que el crédito esté en mora: una acción preventiva sobre uno al día funciona igual.
 */
export default function ClienteFichaScreen() {
  // `routeId` presente = la ficha se abrió desde el mapa de una ruta (RT-5, Rutas S4).
  const { id: clientId, routeId } = useLocalSearchParams<{ id: string; routeId?: string }>();
  const fromRoute = !!routeId;
  const [ctx, setCtx] = useState<AgendaClientContext | null>(null);
  const [load, setLoad] = useState<'loading' | 'ok' | 'offline' | 'error' | 'sin-creditos'>('loading');
  /** Identidad mínima cuando no hay contexto de cobranza que mostrar (ver `loadAll`). */
  const [basic, setBasic] = useState<ClientDetail | null>(null);
  const [creditId, setCreditId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MoraCreditDetail | null>(null);
  /** El crédito elegido: condiciones, base del saldo y total por cobrar (F4/06). `null` mientras carga o sin red. */
  const [credit, setCredit] = useState<CreditDetail | null>(null);
  const [planSheet, setPlanSheet] = useState(false);
  const [payments, setPayments] = useState<PaymentItem[]>([]);
  const [showData, setShowData] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [paySheet, setPaySheet] = useState(false);
  const [gestSheet, setGestSheet] = useState(false);
  const [moraSheet, setMoraSheet] = useState<'mark' | 'clear' | null>(null);

  const gestId = useRef(nuevoId());

  const selected = useMemo(() => ctx?.credits.find((c) => c.creditId === creditId) ?? ctx?.credits[0], [ctx, creditId]);
  /**
   * Un préstamo dado de alta sin señal que todavía no subió (fila provisional de `sync/optimistic`): el server no
   * lo conoce, así que cobrar o registrar una gestión daría 404 o iría a una cola que no puede entregarse. Se
   * ofrecen cuando el alta se confirme.
   */
  const provisional = !!(selected as { pending?: boolean } | undefined)?.pending;

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

  const loadCredit = useCallback(async (creditId: string) => {
    const [c, p, k, q] = await Promise.all([getMora(creditId), listCreditPayments(creditId), getCredit(creditId), queuedFor(creditId)]);
    if (c.status === 'ok') setDetail(c.data);
    // Lo que espera señal va arriba de lo confirmado: el cobrador ve su cobro aunque no haya red.
    if (p.status === 'ok') setPayments([...q, ...p.data]);
    else if (q.length > 0) setPayments(q);
    setCredit(k.status === 'ok' ? k.data : null);
  }, []);

  const loadAll = useCallback(async () => {
    const res = await clientContext(clientId);
    if (res.status === 'offline') return setLoad('offline');
    if (res.status === 'unauthenticated') return setLoad('error');
    // Un cliente sin créditos a mi cargo (ni como responsable, reemplazo o apoyo) NO es un error: la búsqueda
    // global (S4) lo encuentra y `clientContext` responde AGENDA_002. Se degrada a la identidad, que
    // `client:read` sí puede leer. Un crédito AL DÍA ya no cae acá: el contexto lista todos los del alcance.
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
      await loadCredit(first.creditId);
    }
  }, [clientId, creditId, loadCredit]);

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
      setCredit(null);
      setPayments([]);
      await loadCredit(c.creditId);
    },
    [loadCredit],
  );

  // Barra de acciones: deep-link + auto-log (§5.4/§7). El log no bloquea el link.
  const doAction = useCallback(
    (kind: 'call' | 'whatsapp' | 'navigate') => {
      if (!selected) return;
      const phone = onlyDigits(ctx?.contacts.find((c) => c.isPrimary)?.value ?? ctx?.contacts[0]?.value);
      const loc = ctx?.locations.find((l) => l.latitude != null);
      let url: string | null = null;
      // Navegar NO sale de la app: abre el mapa de Kobrax centrado en la dirección (el mismo mapa de
      // la ruta, que además anda offline con los packs). Google Maps dejaba al cobrador afuera.
      if (kind === 'navigate') {
        router.push(`/cliente/mapa?clientId=${clientId}&locationId=${loc?.id ?? ''}&name=${encodeURIComponent(ctx?.client.displayName ?? '')}`);
        if (!provisional) void registrarRastro(selected.creditId, 'navigate');
        return;
      }
      if (kind === 'call' && phone) url = `tel:${phone}`;
      else if (kind === 'whatsapp' && phone) url = `https://wa.me/${phone}`;
      if (!url) return;
      void Linking.openURL(url);
      if (!provisional) void registrarRastro(selected.creditId, kind);
    },
    [selected, ctx, clientId, provisional],
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
  // «Recuperado X de Y» contra lo que representa el saldo (D15); con el crédito todavía sin cargar, contra el capital.
  const rec = recovery(credit ?? { outstandingBalance: selected.outstandingBalance, principalAmount: selected.principalAmount });
  const planRows = credit?.terms ? calculateCredit(credit.terms).schedule : null;
  const unknown = (f: Parameters<typeof isUnknownField>[1]) => (credit ? isUnknownField(credit, f) : false);

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
          {/* Situación, categoría y castigo: condiciones separadas del crédito (F4/08 · D1), no un estado único. */}
          {(detail?.writtenOff || detail?.category) && (
            <View style={styles.tags}>
              {detail.writtenOff && <StatusBadge label="Castigado" tone="neutral" />}
              {detail.category && <StatusBadge label={`Categoría ${detail.category.code}`} tone={selected.daysPastDue > 0 ? 'danger' : 'neutral'} />}
            </View>
          )}
          <Text style={[styles.debt, selected.daysPastDue > 0 && { color: COLORS.danger }]}>{money(totalDebt, currency)}</Text>
          {detail?.locked && (
            <Text style={styles.locked}>🔒 Importado · {detail.origin} — actualizá con una nueva importación</Text>
          )}
          {/*
           * D4/D9: el saldo y la mora de un PSF son los del reporte. Si la operación ya no viene, no es
           * «pagó» ni «al día»; si el dato está viejo, no es el de hoy. El cobrador lo tiene que saber
           * antes de tocar la puerta.
           */}
          {credit?.externalSource && credit.syncStatus === 'ABSENT' && (
            <Text style={styles.locked}>
              {`⚠️ Ya no viene en el reporte ${credit.externalSource}${credit.absentSince ? ` desde el ${prettyDay(credit.absentSince)}` : ''}: el saldo es el último informado.`}
            </Text>
          )}
          {credit?.externalSource && credit.syncStatus !== 'ABSENT' && credit.reportedStale && (
            <Text style={styles.locked}>
              {`⚠️ Dato desactualizado: saldo y mora son del corte del ${credit.reportedAsOf ? prettyDay(credit.reportedAsOf) : '—'}.`}
            </Text>
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
            {/* D20: desde cuándo corre la mora (con el método bancario puede ser antes de la cuota a cobrar). */}
            {selected.daysPastDue > 0 && credit?.arrearsSince ? ` desde ${prettyDay(credit.arrearsSince)}` : ''}
          </Text>
          {selected.daysPastDue > 0 && credit?.oldestUnpaid && (
            <Text style={styles.cardSub}>
              {credit.oldestUnpaid.number
                ? `Cuota a reclamar: N.º ${credit.oldestUnpaid.number} (venció ${prettyDay(credit.oldestUnpaid.dueDate)})`
                : `Cuota a reclamar: venció ${prettyDay(credit.oldestUnpaid.dueDate)}`}
            </Text>
          )}
          <View style={{ gap: SPACING.sm, marginTop: SPACING.sm }}>
            {provisional ? (
              <Text style={styles.locked}>
                ⏳ Este préstamo todavía no subió al servidor. Podrás cobrar y registrar gestiones cuando se confirme el alta.
              </Text>
            ) : (
              <>
                <Button label="Registrar pago" onPress={() => setPaySheet(true)} />
                <Button
                  label="Registrar gestión"
                  variant="ghost"
                  onPress={() => {
                    // El id de la gestión se fija al ABRIR la hoja: un reintento o doble toque reusa el mismo.
                    gestId.current = nuevoId();
                    setGestSheet(true);
                  }}
                />
              </>
            )}
            {/*
             * 🔴 **Marcar en mora es para el préstamo sin cronograma.** Sin fecha que se venza sola,
             * el trabajo diario del servidor no tiene de dónde sacar la mora y ese préstamo nunca
             * entra a cobranza: lo tiene que decir quien lo prestó. Poner al día mueve la fecha —no
             * baja un número—, o el servidor lo vuelve a marcar esta misma noche.
             *
             * No se ofrecen sobre un préstamo importado: su mora la manda el archivo.
             */}
            {!provisional && !detail?.locked &&
              (selected.daysPastDue > 0 ? (
                <Button label="Poner al día" variant="ghost" onPress={() => setMoraSheet('clear')} />
              ) : (
                <Button label="Marcar en mora" variant="ghost" onPress={() => setMoraSheet('mark')} />
              ))}
          </View>
        </View>

        {/* Progreso: sin un total conocido no hay barra — una vacía diría «no pagó nada» (D15). */}
        {rec && (
          <View>
            <Text style={styles.progressLabel}>Recuperado {money(rec.recovered, currency)} de {money(rec.of, currency)}</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${rec.percent}%` }]} />
            </View>
          </View>
        )}

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
        {/*
          Estado actual y condiciones (F4/06 · Fase 5). Del importado, lo que el archivo no trajo dice
          «No registrado» y no el 0 de relleno de la columna (D9).
        */}
        {showData && detail && (
          <View style={styles.card}>
            <DataRow label="Saldo pendiente" value={unknown('outstandingBalance') ? UNKNOWN : money(selected.outstandingBalance, currency)} />
            <DataRow
              label="Total a cobrar"
              value={credit?.totalToCollect != null ? money(credit.totalToCollect, currency) : UNKNOWN}
            />
            <DataRow label="Capital" value={unknown('principalAmount') ? UNKNOWN : money(selected.principalAmount, currency)} />
            {credit?.terms && <DataRow label="Definición" value={DEFINITION_LABEL[credit.terms.definition]} />}
            {/* D17: la tasa como se pactó («18 % anual»), no convertida. */}
            {credit?.terms?.definition === 'calculated' && (
              <DataRow label="Interés" value={`${credit.terms.ratePercent} % ${RATE_PERIOD_LABEL[credit.terms.ratePeriod ?? RatePeriod.PER_INSTALLMENT]}`} />
            )}
            <DataRow
              label="Cuotas"
              value={credit?.installmentsCount === undefined ? UNKNOWN : credit.installmentsCount ? String(credit.installmentsCount) : 'Préstamo abierto'}
            />
            <DataRow label="Frecuencia" value={credit?.frequency ? FREQUENCY_LABEL[credit.frequency] : UNKNOWN} />
            <DataRow label="Próxima fecha" value={detail.nextDueDate ? prettyDay(detail.nextDueDate) : unknown('nextDueDate') ? UNKNOWN : 'Sin fecha'} />
            {!!credit?.initialState?.paidInstallments && (
              <DataRow label="Cargado en curso" value={`${credit.initialState.paidInstallments} cuotas ya pagadas`} />
            )}
            <DataRow label="Origen" value={ORIGIN_LABEL[detail.origin ?? 'manual'] ?? detail.origin ?? 'manual'} />
            {credit?.externalSource && (
              <DataRow label="Operación" value={`${credit.externalSource} ${credit.externalId ?? ''}`.trim()} />
            )}
            {credit?.externalSource && credit.reportedAsOf && (
              <DataRow label="Números al corte del" value={prettyDay(credit.reportedAsOf)} />
            )}
            {!!credit?.unknownFields?.length && (
              <DataRow label="No registrados" value={credit.unknownFields.map((f) => IMPORT_FIELD_LABEL[f]).join(', ')} />
            )}
            {planRows && planRows.length > 0 && (
              <Pressable onPress={() => setPlanSheet(true)} accessibilityRole="button" style={{ paddingTop: SPACING.sm }}>
                <Text style={styles.planLink}>Ver plan de pagos ({planRows.length} cuotas)</Text>
              </Pressable>
            )}
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

      {planRows && credit && (
        <PlanSheet
          visible={planSheet}
          onClose={() => setPlanSheet(false)}
          rows={planRows}
          currency={currency}
          paidInstallments={credit.initialState?.paidInstallments ?? 0}
          hint="Calculado con las mismas condiciones con que se guardó el préstamo."
        />
      )}

      <PaySheet
        visible={paySheet}
        onClose={() => setPaySheet(false)}
        currency={currency}
        // El monto sugerido (`suggestedPaymentAmount`): en PSF la mora reportada, nunca el saldo entero.
        defaultAmount={detail?.suggestedPaymentAmount ?? detail?.installmentAmount}
        external={detail?.locked}
        // Importado (PSF): el saldo es el del último reporte y el pago no lo toca (D3). Topearlo
        // rechazaría un cobro real cuando el reporte va atrasado.
        maxAmount={detail?.locked ? Number.POSITIVE_INFINITY : selected.outstandingBalance}
        onSubmit={async (amount, method, receipt, idemKey, channel) => {
          const input = {
            creditId: selected.creditId,
            amount,
            method,
            receiptUrl: receipt?.url,
            receiptHash: receipt?.hash,
            ...(channel !== 'KOBRAX_COLLECTED' ? { channel } : {}),
            // La hora del cobro, no la de la sincronización: si queda en la cola, viaja con ella.
            paymentDate: new Date().toISOString(),
          };
          const err = await submitPayment(input, idemKey, receipt);
          if (err) return err;
          setPaySheet(false);
          await loadCredit(selected.creditId);
          return null;
        }}
      />

      <GestionSheet
        visible={gestSheet}
        onClose={() => setGestSheet(false)}
        currency={currency}
        onSubmit={async (payload) => {
          // `submitMoraActivity` intenta con señal y, sin ella, encola `mora.activity` con el MISMO id (el de la
          // hoja, fijado al abrirla): si la respuesta se perdió, el reintento no duplica la gestión ni su promesa.
          const err = await submitMoraActivity(selected.creditId, { ...payload, id: gestId.current });
          if (err) return err;
          setGestSheet(false);
          await loadCredit(selected.creditId);
          return null;
        }}
      />

      <MoraSheet
        mode={moraSheet}
        onClose={() => setMoraSheet(null)}
        daysPastDue={selected.daysPastDue}
        nextDueDate={detail?.nextDueDate}
        frequency={detail?.frequency}
        onSubmit={async (accion) => {
          const res =
            accion.kind === 'arrears.mark'
              ? await markArrears(accion.creditId, accion.days)
              : await clearArrears(accion.creditId, accion.input);
          if (res.status === 'ok') { setMoraSheet(null); await onRefresh(); return null; }
          if (res.status === 'offline') {
            /*
             * Se guarda y sube sola. Marcar es idempotente (escribe la misma fecha de arranque);
             * poner al día viaja con la **fecha ya resuelta**, nunca con «siguiente período», que
             * reintentado correría el vencimiento dos veces.
             */
            const guardada = await queueForLater(accion);
            if (!guardada) return 'Sin conexión y no se pudo guardar en el teléfono. Reintentá.';
            setMoraSheet(null);
            return null;
          }
          if (res.status === 'unauthenticated') return 'Tu sesión venció.';
          return res.message;
        }}
        creditId={selected.creditId}
      />
    </View>
  );
}

/**
 * Marcar en mora / poner al día.
 *
 * 🔴 **«Poner al día» resuelve la fecha ACÁ, no manda el modo.** El servidor entiende
 * `next_period`, pero ese modo avanza un período *desde donde esté*: si la acción se encola sin
 * señal y se reintenta, el vencimiento se corre dos veces y el deudor se gana un mes. Se calcula con
 * `addPeriods` —la misma función que usa el servidor— y viaja como fecha fija.
 */
function MoraSheet({
  mode,
  onClose,
  creditId,
  daysPastDue,
  nextDueDate,
  frequency,
  onSubmit,
}: {
  mode: 'mark' | 'clear' | null;
  onClose: () => void;
  creditId: string;
  daysPastDue: number;
  nextDueDate?: string;
  frequency?: PaymentFrequency;
  onSubmit: (accion: QueuedArrears) => Promise<string | null>;
}) {
  const [days, setDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hoy = new Date();
  // Desde la fecha que tenía si todavía no venció; si no, desde hoy — avanzar sobre una vencida de
  // hace meses dejaría la nueva también vencida.
  const base = nextDueDate && new Date(nextDueDate) > hoy ? new Date(nextDueDate) : hoy;
  const proxima = addPeriods(base, 1, frequency ?? PaymentFrequency.MONTHLY).toISOString().slice(0, 10);

  async function enviar(accion: QueuedArrears) {
    setError(null);
    setBusy(true);
    const msg = await onSubmit(accion);
    setBusy(false);
    if (msg) setError(msg);
    else setDays('');
  }

  return (
    <BottomSheet visible={mode !== null} onClose={onClose} title={mode === 'clear' ? 'Poner al día' : 'Marcar en mora'}>
      <ErrorBanner message={error} />
      {mode === 'clear' ? (
        <View style={{ gap: SPACING.sm }}>
          <Text style={styles.cardSub}>{`Hoy figura con ${daysPastDue} días de mora.`}</Text>
          <Button
            label={`Corre al ${prettyDate(proxima)}`}
            disabled={busy}
            onPress={() => void enviar({ kind: 'arrears.clear', creditId, input: { mode: 'date', date: proxima } })}
          />
          <Button
            label="Sin fecha de vencimiento"
            variant="ghost"
            disabled={busy}
            onPress={() => void enviar({ kind: 'arrears.clear', creditId, input: { mode: 'none' } })}
          />
        </View>
      ) : (
        <View style={{ gap: SPACING.sm }}>
          <Text style={styles.cardSub}>Se abre la cobranza y el préstamo entra a Mora.</Text>
          <Field label="Días que lleva en mora (opcional)">
            <AmountInput value={days} onChangeText={setDays} placeholder="0" />
          </Field>
          <Button
            label="Marcar en mora"
            disabled={busy}
            onPress={() => void enviar({ kind: 'arrears.mark', creditId, days: Number(days) || 0 })}
          />
        </View>
      )}
    </BottomSheet>
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
        {isPay && e.pending ? <Text style={styles.tlSub}>Guardado en el teléfono · se sube con señal</Text> : null}
        {!isPay && e.notes ? <Text style={styles.tlSub}>{e.notes}</Text> : null}
        <Text style={styles.tlDate}>{new Date(e.at).toLocaleDateString('es')}</Text>
      </View>
    </View>
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
  planLink: { ...TYPE.body, color: COLORS.periwinkle, fontWeight: '600' },
  locked: { ...TYPE.caption, color: COLORS.warningText, backgroundColor: COLORS.warningBg, padding: SPACING.sm, borderRadius: RADIUS.input, marginTop: SPACING.sm },
  // Chip de hora recomendada (RT-5). Highlight y no warning: es una ayuda, no una alerta.
  tags: { flexDirection: 'row', gap: SPACING.xs, marginTop: SPACING.xs },
  hint: { backgroundColor: COLORS.highlight, borderRadius: RADIUS.card, padding: SPACING.md, gap: 2 },
  hintTitle: { ...TYPE.body, color: COLORS.navy, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: SPACING.sm },
  card: { backgroundColor: COLORS.white, borderRadius: RADIUS.card, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.lg },
  cardTitle: { ...TYPE.caption, color: COLORS.muted, textTransform: 'uppercase', fontWeight: '700' },
  cardBig: { fontSize: 26, fontWeight: '700', color: COLORS.navy, marginTop: 2 },
  cardSub: { ...TYPE.secondary, color: COLORS.text2 },
  progressLabel: { ...TYPE.secondary, color: COLORS.text, marginBottom: SPACING.xs },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: COLORS.lightBg, overflow: 'hidden' },
  progressFill: { height: 8, backgroundColor: COLORS.success },
  collapse: { ...TYPE.body, color: COLORS.navy, fontWeight: '600' },
  line: { ...TYPE.body, color: COLORS.text, paddingVertical: 4 },
  tlRow: { flexDirection: 'row', gap: SPACING.sm, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  tlIcon: { fontSize: 18 },
  tlTitle: { ...TYPE.body, color: COLORS.navy, fontWeight: '600' },
  tlSub: { ...TYPE.secondary, color: COLORS.text2 },
  tlDate: { ...TYPE.caption, color: COLORS.muted, marginTop: 2 },
});
