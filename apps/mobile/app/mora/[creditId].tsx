import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import type { CreditNote, MoraCreditDetail, MoraPromise } from '@kobrax/shared';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { ActionBtn, DataRow, EmptyState, Header, SectionLabel, StatusBadge } from '@/ui';
import { money } from '@/agenda-form';
import { clientContext, type AgendaClientContext } from '@/agenda.service';
import { listCreditPayments, type PaymentItem } from '@/payments.service';
import { getMora, listMoraNotes, listMoraPromises } from '@/mora.service';
import { activityLine, moraCardProps, NOTE_KIND_LABEL, PROMISE_STATUS_META, staleLine, toMoraRows } from '@/mora';
import { MORA_OUTCOMES, submitMoraActivity, submitMoraNote } from '@/mora-actions';
import { PaySheet } from '@/pay-sheet';
import { submitPayment } from '@/payment-submit';
import { GestionSheet, prettyDate } from '@/gestion-sheet';
import { NoteSheet } from '@/note-sheet';
import { prettyDay } from '@/credit-terms-view';
import { onlyDigits } from '@/ficha';
import { registrarRastro } from '@/trace';
import { nuevoId } from '@/ids';

type Load = 'loading' | 'ok' | 'offline' | 'error';

/**
 * Ficha de recuperación de un crédito en mora (`GET /mora/:creditId`).
 *
 * Es por **crédito**, con o sin caso abierto: registrar una gestión sobre un crédito sin caso lo abre el
 * servidor. Todo lo que se escribe acá (gestión con promesa, pago, nota) se puede hacer sin señal: queda en el
 * teléfono con su id y sube solo. Qué es mora, cuánto se debe y el estado de cada promesa lo calcula el servidor.
 */
export default function MoraFichaScreen() {
  const { creditId } = useLocalSearchParams<{ creditId: string }>();
  const [load, setLoad] = useState<Load>('loading');
  const [detail, setDetail] = useState<MoraCreditDetail | null>(null);
  const [localAt, setLocalAt] = useState<number | null | undefined>(undefined);
  const [ctx, setCtx] = useState<AgendaClientContext | null>(null);
  const [promises, setPromises] = useState<MoraPromise[]>([]);
  const [notes, setNotes] = useState<CreditNote[]>([]);
  const [payments, setPayments] = useState<PaymentItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [paySheet, setPaySheet] = useState(false);
  const [gestSheet, setGestSheet] = useState(false);
  const [noteSheet, setNoteSheet] = useState(false);
  // 🔴 El id de la gestión y de la nota se fija al ABRIR la hoja, no en cada intento: si el servidor la guardó
  // pero la respuesta llegó como error, el cobrador toca «Guardar» otra vez y ese segundo intento lleva el MISMO
  // id, así que el servidor devuelve lo ya guardado en vez de crear una segunda gestión (con su promesa).
  const activityId = useRef(nuevoId());
  const noteId = useRef(nuevoId());

  const loadAll = useCallback(async () => {
    const main = await getMora(creditId);
    if (main.status === 'offline') return setLoad((p) => (p === 'ok' ? p : 'offline'));
    if (main.status !== 'ok') return setLoad((p) => (p === 'ok' ? p : 'error'));
    setDetail(main.data);
    setLocalAt(main.localAt);
    setLoad('ok');
    // Lo demás es complemento: si una parte falla, la ficha se muestra igual con lo que haya.
    const [c, pr, nt, pay] = await Promise.all([
      clientContext(main.data.clientId),
      listMoraPromises(creditId),
      listMoraNotes(creditId),
      listCreditPayments(creditId),
    ]);
    if (c.status === 'ok') setCtx(c.data);
    if (pr.status === 'ok') setPromises(pr.data);
    if (nt.status === 'ok') setNotes(nt.data);
    if (pay.status === 'ok') setPayments(pay.data);
  }, [creditId]);

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

  const phone = useMemo(() => onlyDigits(ctx?.contacts.find((c) => c.isPrimary)?.value ?? ctx?.contacts[0]?.value), [ctx]);

  /** Llamar / WhatsApp: abre la app y, si hay caso, deja el rastro (sin señal se encola). No espera ni bloquea. */
  const contact = useCallback(
    (kind: 'call' | 'whatsapp') => {
      if (!phone || !detail) return;
      void Linking.openURL(kind === 'call' ? `tel:${phone}` : `https://wa.me/${phone}`);
      if (detail.case) {
        void registrarRastro(detail.case.id, { type: kind === 'call' ? 'CALL' : 'MESSAGE', notes: kind === 'call' ? 'Llamada' : 'WhatsApp' });
      }
    },
    [phone, detail],
  );

  if (load === 'loading') {
    return (
      <View style={styles.root}>
        <Header title="Ficha de mora" onBack={() => router.back()} />
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.navy} />
        </View>
      </View>
    );
  }
  if (load !== 'ok' || !detail) {
    return (
      <View style={styles.root}>
        <Header title="Ficha de mora" onBack={() => router.back()} />
        {load === 'offline' ? (
          <EmptyState icon="📴" title="Sin conexión" hint="La ficha aparecerá cuando vuelva la red." />
        ) : (
          <EmptyState icon="⚠️" title="No se pudo cargar" hint="Reintentá en un momento." />
        )}
      </View>
    );
  }

  const card = moraCardProps(toMoraRows([detail])[0]);
  const currency = detail.currency;
  const external = !!detail.externalSource;
  const stale = staleLine(localAt);
  const address = ctx?.locations.find((l) => l.address)?.address;

  return (
    <View style={styles.root}>
      <Header title="Ficha de mora" onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.xxl * 2, gap: SPACING.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.navy} />}
      >
        {stale && <Text style={styles.stale}>{stale}</Text>}

        <View>
          <View style={styles.headRow}>
            <Text style={styles.name}>{card.name}</Text>
            <StatusBadge label={card.badge.label} tone={card.badge.tone} />
          </View>
          <Text style={styles.sub}>{card.caption}</Text>
          {card.amount && <Text style={styles.debt}>{card.amount}</Text>}
          <Text style={styles.sub}>{card.subtitle}</Text>
        </View>

        <View style={styles.actions}>
          <ActionBtn label="Llamar" icon="📞" onPress={() => contact('call')} />
          <ActionBtn label="WhatsApp" icon="💬" onPress={() => contact('whatsapp')} />
          <ActionBtn label="Gestión" icon="📝" onPress={() => { activityId.current = nuevoId(); setGestSheet(true); }} />
          <ActionBtn label="Pago" icon="💵" onPress={() => setPaySheet(true)} />
          <ActionBtn label="Nota" icon="🗒️" onPress={() => { noteId.current = nuevoId(); setNoteSheet(true); }} />
        </View>
        {!phone && <Text style={styles.hint}>Sin teléfono registrado: llamar y WhatsApp no están disponibles.</Text>}
        {!detail.case && <Text style={styles.hint}>Este crédito no tiene caso abierto: al registrar una gestión se abre uno.</Text>}

        <View style={styles.card}>
          <SectionLabel>Resumen</SectionLabel>
          {detail.balance !== undefined && <DataRow label="Saldo" value={money(detail.balance, currency)} />}
          {detail.overdueAmount !== undefined && <DataRow label="Vencido" value={money(detail.overdueAmount, currency)} />}
          {detail.installmentAmount !== undefined && <DataRow label="Cuota" value={money(detail.installmentAmount, currency)} />}
          <DataRow label="Días de mora" value={String(detail.daysPastDue)} />
          <DataRow label="Próx. vencimiento" value={detail.nextDueDate ? prettyDay(detail.nextDueDate) : 'Sin fecha'} />
          <DataRow label="Último pago" value={detail.lastPaymentAt ? prettyDay(detail.lastPaymentAt) : 'Sin pagos'} />
          {detail.reportedAsOf && <DataRow label="Números al corte del" value={prettyDay(detail.reportedAsOf)} />}
          {external && <Text style={styles.hint}>Operación de {detail.externalSource}: un pago no cambia el saldo hasta el próximo reporte.</Text>}
        </View>

        {(phone || address) && (
          <View style={styles.card}>
            <SectionLabel>Cómo ubicarlo</SectionLabel>
            {ctx?.contacts.map((c) => (
              <Text key={c.id} style={styles.line}>
                {c.value ?? '—'}
                {c.isPrimary ? ' · principal' : ''}
              </Text>
            ))}
            {ctx?.locations.map((l) => (
              <Text key={l.id} style={styles.line}>
                {l.address ?? 'Sin dirección'}
                {l.zone ? ` · ${l.zone}` : ''}
              </Text>
            ))}
          </View>
        )}

        <View style={styles.card}>
          <SectionLabel>Promesas de pago</SectionLabel>
          {promises.length === 0 ? (
            <Text style={styles.line}>Sin promesas.</Text>
          ) : (
            promises.map((p) => (
              <View key={p.id} style={styles.listRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>
                    {p.amount !== undefined ? money(p.amount, currency) : 'Sin monto'} · {prettyDate(p.promiseDate)}
                  </Text>
                  {p.observations ? <Text style={styles.rowSub}>{p.observations}</Text> : null}
                </View>
                <StatusBadge label={PROMISE_STATUS_META[p.status].label} tone={PROMISE_STATUS_META[p.status].tone} />
              </View>
            ))
          )}
        </View>

        <View style={styles.card}>
          <SectionLabel>Gestiones</SectionLabel>
          {detail.activities.length === 0 ? (
            <Text style={styles.line}>Sin gestiones todavía.</Text>
          ) : (
            detail.activities.map((a) => (
              <View key={a.id} style={styles.listRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{activityLine(a)}</Text>
                  {a.notes ? <Text style={styles.rowSub}>{a.notes}</Text> : null}
                  <Text style={styles.rowDate}>{new Date(a.createdAt).toLocaleDateString('es')}</Text>
                </View>
              </View>
            ))
          )}
        </View>

        <View style={styles.card}>
          <SectionLabel>Notas</SectionLabel>
          {notes.length === 0 ? (
            <Text style={styles.line}>Sin notas.</Text>
          ) : (
            notes.map((n) => (
              <View key={n.id} style={styles.listRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{n.body}</Text>
                  <Text style={styles.rowDate}>
                    {NOTE_KIND_LABEL[n.kind]} · {new Date(n.createdAt).toLocaleDateString('es')}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>

        <View style={styles.card}>
          <SectionLabel>Pagos</SectionLabel>
          {payments.length === 0 ? (
            <Text style={styles.line}>Sin pagos registrados.</Text>
          ) : (
            payments.map((p) => (
              <View key={p.id} style={styles.listRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{money(p.amount, currency)}</Text>
                  <Text style={styles.rowDate}>{new Date(p.paymentDate ?? p.createdAt).toLocaleDateString('es')}</Text>
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <PaySheet
        visible={paySheet}
        onClose={() => setPaySheet(false)}
        currency={currency}
        defaultAmount={detail.suggestedPaymentAmount ?? detail.installmentAmount}
        external={external}
        // Importado: el saldo es el del último reporte y el pago no lo toca (D3); topearlo rechazaría un cobro real.
        maxAmount={external ? Number.POSITIVE_INFINITY : (detail.balance ?? Number.POSITIVE_INFINITY)}
        onSubmit={async (amount, method, receipt, idemKey, channel) => {
          const err = await submitPayment(
            {
              creditId: detail.creditId,
              ...(detail.case ? { caseId: detail.case.id } : {}),
              amount,
              method,
              receiptUrl: receipt?.url,
              receiptHash: receipt?.hash,
              ...(channel !== 'KOBRAX_COLLECTED' ? { channel } : {}),
              // La hora del cobro, no la de la sincronización: si queda en la cola, viaja con ella.
              paymentDate: new Date().toISOString(),
            },
            idemKey,
            receipt,
          );
          if (err) return err;
          setPaySheet(false);
          await loadAll();
          return null;
        }}
      />

      <GestionSheet
        visible={gestSheet}
        onClose={() => setGestSheet(false)}
        currency={currency}
        outcomes={MORA_OUTCOMES}
        onSubmit={async (payload) => {
          const err = await submitMoraActivity(detail.creditId, { ...payload, id: activityId.current });
          if (err) return err;
          setGestSheet(false);
          await loadAll();
          return null;
        }}
      />

      <NoteSheet
        visible={noteSheet}
        onClose={() => setNoteSheet(false)}
        onSubmit={async (note) => {
          const err = await submitMoraNote(detail.creditId, { ...note, id: noteId.current });
          if (err) return err;
          setNoteSheet(false);
          await loadAll();
          return null;
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stale: { ...TYPE.caption, color: COLORS.warningText, backgroundColor: COLORS.warningBg, padding: SPACING.sm, borderRadius: RADIUS.input },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  name: { ...TYPE.h2, color: COLORS.navy, flex: 1 },
  sub: { ...TYPE.secondary, color: COLORS.text2, marginTop: 2 },
  debt: { fontSize: 30, fontWeight: '700', color: COLORS.danger, marginTop: SPACING.sm },
  actions: { flexDirection: 'row', gap: SPACING.sm },
  hint: { ...TYPE.caption, color: COLORS.text2 },
  card: { backgroundColor: COLORS.white, borderRadius: RADIUS.card, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.lg },
  line: { ...TYPE.body, color: COLORS.text, paddingVertical: 4 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  rowTitle: { ...TYPE.body, color: COLORS.navy, fontWeight: '600' },
  rowSub: { ...TYPE.secondary, color: COLORS.text2 },
  rowDate: { ...TYPE.caption, color: COLORS.muted, marginTop: 2 },
});
