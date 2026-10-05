import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Permission, type CreditNote, type MoraCreditDetail, type MoraEpisode, type MoraPromise, type RecoveryMetrics } from '@kobrax/shared';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { ActionBtn, DataRow, EmptyState, Header, PRIORITY_LABEL, priorityTone, ProgressBar, SectionLabel, situationBadge, StatusBadge } from '@/ui';
import { money } from '@/agenda-form';
import { clientContext, type AgendaClientContext } from '@/agenda.service';
import { listCreditPayments, type PaymentItem } from '@/payments.service';
import { getMora, getMoraMetrics, listMoraEpisodes, listMoraNotes, listMoraPromises, listTeamNames } from '@/mora.service';
import { authService } from '@/auth-service';
import { activityLine, moraCardProps, staleLine, toMoraRows } from '@/mora';
import {
  activePromiseText,
  lastActionText,
  moraSinceText,
  nameResolver,
  paidPercent,
  situationDetail,
  sourceBadge,
} from '@/mora-ficha';
import { ActivityTimeline, EpisodesSection, Fact, MetricsSection, NotesSection, PaymentsSection, PromisesSection, PsfNotice } from '@/mora-sections';
import { submitMoraActivity, submitMoraNote, submitNoteDelete, submitNoteEdit } from '@/mora-actions';
import { PaySheet } from '@/pay-sheet';
import { submitPayment } from '@/payment-submit';
import { GestionSheet, prettyDate } from '@/gestion-sheet';
import { NoteSheet, type NoteDraft } from '@/note-sheet';
import { prettyDay } from '@/credit-terms-view';
import { onlyDigits } from '@/ficha';
import { registrarRastro } from '@/trace';
import { nuevoId } from '@/ids';

type Load = 'loading' | 'ok' | 'offline' | 'error';

/**
 * Ficha de recuperación de un crédito en mora (`GET /mora/:creditId`).
 *
 * Es por **crédito**, esté o no en mora (no hay caso que abrir). Todo lo que se escribe acá (gestión con promesa, pago, nota) se puede hacer sin señal: queda en el
 * teléfono con su id y sube solo. Qué es mora, cuánto se debe y el estado de cada promesa lo calcula el servidor.
 */
export default function MoraFichaScreen() {
  const { creditId } = useLocalSearchParams<{ creditId: string }>();
  const [load, setLoad] = useState<Load>('loading');
  const [detail, setDetail] = useState<MoraCreditDetail | null>(null);
  const [localAt, setLocalAt] = useState<number | null | undefined>(undefined);
  const [ctx, setCtx] = useState<AgendaClientContext | null>(null);
  // `null` = no se pudo leer (sin señal y sin copia): la sección lo dice y la ficha sigue entera.
  const [promises, setPromises] = useState<MoraPromise[] | null>(null);
  const [notes, setNotes] = useState<CreditNote[] | null>(null);
  const [payments, setPayments] = useState<PaymentItem[] | null>(null);
  const [episodes, setEpisodes] = useState<MoraEpisode[] | null>(null);
  const [metrics, setMetrics] = useState<RecoveryMetrics | null>(null);
  const [team, setTeam] = useState<Parameters<typeof nameResolver>[0]>([]);
  const [me, setMe] = useState<{ userId?: string; canAssign: boolean }>({ canAssign: false });
  const [editNote, setEditNote] = useState<CreditNote | null>(null);
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
    const [c, pr, nt, pay, ep, mt, tm, who] = await Promise.all([
      clientContext(main.data.clientId),
      listMoraPromises(creditId),
      listMoraNotes(creditId),
      listCreditPayments(creditId),
      listMoraEpisodes(creditId),
      getMoraMetrics(creditId),
      listTeamNames(), // 403 para el cobrador: entonces «alguien del equipo»
      authService.me(),
    ]);
    if (c.status === 'ok') setCtx(c.data);
    if (pr.status === 'ok') setPromises(pr.data);
    if (nt.status === 'ok') setNotes(nt.data);
    if (pay.status === 'ok') setPayments(pay.data);
    if (ep.status === 'ok') setEpisodes(ep.data);
    if (mt.status === 'ok') setMetrics(mt.data);
    if (tm.status === 'ok') setTeam(tm.data);
    if (who.status === 'ok') setMe({ userId: who.me.userId, canAssign: who.me.permissions.includes(Permission.ASSIGNMENT_WRITE) });
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

  const nameOf = useMemo(() => nameResolver(team, me.userId), [team, me.userId]);

  const phone = useMemo(() => onlyDigits(ctx?.contacts.find((c) => c.isPrimary)?.value ?? ctx?.contacts[0]?.value), [ctx]);

  /** Llamar / WhatsApp: abre la app y deja el rastro en el crédito (sin señal se encola). No espera ni bloquea. */
  const contact = useCallback(
    (kind: 'call' | 'whatsapp') => {
      if (!phone || !detail) return;
      void Linking.openURL(kind === 'call' ? `tel:${phone}` : `https://wa.me/${phone}`);
      void registrarRastro(detail.creditId, kind);
    },
    [phone, detail],
  );

  const removeNote = useCallback(
    (n: CreditNote) => {
      Alert.alert('¿Borrar la nota?', 'La nota deja de verse en la ficha. Queda registrada en la auditoría.', [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Borrar',
          style: 'destructive',
          onPress: async () => {
            const err = await submitNoteDelete(creditId, n.id);
            if (err) Alert.alert('No se pudo borrar', err);
            else await loadAll();
          },
        },
      ]);
    },
    [creditId, loadAll],
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
  const situation = situationDetail(detail);
  const pct = paidPercent(detail.principalAmount, detail.balance);

  return (
    <View style={styles.root}>
      <Header title="Ficha de mora" onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.xxl * 2, gap: SPACING.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.navy} />}
      >
        {stale && <Text style={styles.stale}>{stale}</Text>}
        <PsfNotice externalSource={detail.externalSource} syncStatus={detail.syncStatus} absentSince={detail.absentSince} reportedAsOf={detail.reportedAsOf} reportedStale={detail.reportedStale} />

        <View>
          <View style={styles.headRow}>
            <Text style={styles.name}>{card.name}</Text>
          </View>
          <View style={styles.chipRow}>
            <StatusBadge {...situationBadge(detail.situation, false)} />
            {detail.writtenOff && <StatusBadge label="Castigado" tone="neutral" />}
            {detail.category && <StatusBadge label={`Categoría ${detail.category.code}`} tone="info" />}
            {detail.priority && <StatusBadge label={`Prioridad ${PRIORITY_LABEL[detail.priority] ?? detail.priority}`} tone={priorityTone(detail.priority)} />}
            <StatusBadge label={sourceBadge(detail.externalSource)} tone="neutral" />
          </View>
          {situation ? <Text style={styles.sub}>{situation}</Text> : null}
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

        <View style={styles.card}>
          <SectionLabel>Resumen</SectionLabel>
          {detail.balance !== undefined && <DataRow label="Saldo" value={money(detail.balance, currency)} />}
          {detail.principalAmount !== undefined && <DataRow label="Monto original" value={money(detail.principalAmount, currency)} />}
          {pct !== undefined && (
            <View style={{ marginVertical: SPACING.xs }}>
              <ProgressBar percent={pct} tone="navy" />
              <Text style={styles.hint}>{pct} % del capital ya pagado</Text>
            </View>
          )}
          {detail.overdueAmount !== undefined && <DataRow label="Vencido" value={money(detail.overdueAmount, currency)} />}
          {detail.installmentAmount !== undefined && <DataRow label="Cuota" value={money(detail.installmentAmount, currency)} />}
          <DataRow label="Días de mora" value={String(detail.daysPastDue)} />
          <Fact label="Inicio de la mora" value={moraSinceText(detail, episodes ?? [])} />
          <DataRow label="Próx. vencimiento" value={detail.nextDueDate ? prettyDay(detail.nextDueDate) : 'Sin fecha'} />
          <DataRow label="Último pago" value={detail.lastPaymentAt ? prettyDay(detail.lastPaymentAt) : 'Sin pagos'} />
          {detail.reportedAsOf && <DataRow label="Números al corte del" value={prettyDay(detail.reportedAsOf)} />}
          {detail.branchName ? <Fact label="Agencia" value={detail.branchName} /> : null}
          {/* Datos sueltos, no estados del crédito (F4/08 · D1). */}
          <Fact label="Última gestión" value={lastActionText(detail, activityLine)} />
          <Fact label="Promesa vigente" value={promises === null ? '—' : activePromiseText(promises, currency)} />
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

        <MetricsSection metrics={metrics} currency={currency} />
        <ActivityTimeline activities={detail.activities} />
        <PromisesSection promises={promises} currency={currency} nameOf={nameOf} />
        <NotesSection notes={notes} nameOf={nameOf} userId={me.userId} canAssign={me.canAssign} onEdit={setEditNote} onDelete={removeNote} />
        <PaymentsSection payments={payments} currency={currency} external={external} nameOf={nameOf} />
        <EpisodesSection episodes={episodes} currency={currency} />
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
        onSubmit={async (note: NoteDraft) => {
          const err = await submitMoraNote(detail.creditId, { ...note, id: noteId.current });
          if (err) return err;
          setNoteSheet(false);
          await loadAll();
          return null;
        }}
      />

      <NoteSheet
        visible={editNote !== null}
        initial={editNote ? { kind: editNote.kind, body: editNote.body, color: editNote.color } : undefined}
        onClose={() => setEditNote(null)}
        onSubmit={async (draft: NoteDraft) => {
          if (!editNote) return null;
          const err = await submitNoteEdit(detail.creditId, editNote.id, { kind: draft.kind, body: draft.body, color: draft.color });
          if (err) return err;
          setEditNote(null);
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
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginTop: SPACING.xs },
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
