/**
 * Agenda S3 — "Detalle de gestión" (Figma `64:425`): qué hay que hacer, con quién, cuánto debe,
 * y el historial de gestiones del caso. Desde acá el cobrador llama o navega con un toque.
 * Un solo fetch (`GET /agenda/:id`); la pantalla no encadena llamadas.
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { AgendaItemStatus, AgendaItemType } from '@kobrax/shared';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { AGENDA_STATUS_LABEL, AGENDA_TYPE_META, EmptyState, Header, SectionLabel, StatusBadge } from '@/ui';
import { MONTHS, TIME_SLOT_LABEL, formatLongDate, money, type TimeSlot } from '@/agenda-form';
import { actionLinks, getItem, whatsappLink, type AgendaHistoryEntry, type AgendaItemDetail, type AgendaListItem } from '@/agenda.service';
import { RegisterSheet } from '@/agenda-register';

type Load =
  | { status: 'loading' }
  | { status: 'offline' }
  | { status: 'error' }
  | { status: 'ok'; detail: AgendaItemDetail };

/** `2026-07-10T00:00:00.000Z` → `Hoy` o `Viernes, 10 de julio`. */
function dayLabel(isoDate: string): string {
  const date = isoDate.slice(0, 10);
  return date === new Date().toISOString().slice(0, 10) ? 'Hoy' : formatLongDate(date);
}

/** `2026-06-21T…` → `21 jun` (el historial es una columna angosta). */
function shortDate(isoDate: string): string {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00.000Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]!.slice(0, 3)}`;
}

/** Cuándo es la gestión: `Hoy, 11:30` o `Hoy, Mañana` si se agendó por franja. */
function whenLabel(item: AgendaItemDetail['item']): string {
  const time = item.scheduledTime ?? (item.timeSlot ? TIME_SLOT_LABEL[item.timeSlot as TimeSlot] : undefined);
  return [dayLabel(item.scheduledDate), time].filter(Boolean).join(', ');
}

/** El estado que se lee en la pill: un vencido es un pendiente que ya se pasó de fecha. */
function statusLabel(item: AgendaItemDetail['item']): string {
  return item.isOverdue ? 'Vencida' : AGENDA_STATUS_LABEL[item.status];
}

/**
 * Los campos propios del tipo, en filas legibles. `details` es JSONB validado por shared, así que
 * acá sólo se lee; `labels` trae las etiquetas de los `code`s de catálogo de la promesa.
 */
function detailLines(detail: AgendaItemDetail): string[] {
  const { item, labels, credit } = detail;
  const d = item.details;
  switch (item.type) {
    case AgendaItemType.WHATSAPP:
      return [String(d.message ?? '')];
    case AgendaItemType.REMINDER:
      return [String(d.description ?? '')];
    case AgendaItemType.PROMISE_TO_PAY: {
      const amount = typeof d.amount === 'number' ? money(d.amount, credit?.currency ?? 'BOB') : undefined;
      const method = labels?.[String(d.paymentMethodCode)] ?? String(d.paymentMethodCode ?? '');
      const bank = d.bankCode ? (labels?.[String(d.bankCode)] ?? String(d.bankCode)) : undefined;
      return [
        amount && `Promete pagar ${amount}`,
        typeof d.promiseDate === 'string' && `El ${formatLongDate(d.promiseDate)}`,
        [method, bank].filter(Boolean).join(' · '),
      ].filter((l): l is string => Boolean(l));
    }
    default:
      return [];
  }
}

export default function AgendaDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  const reload = useCallback(async () => {
    if (!id) return;
    const res = await getItem(id);
    if (res.status === 'ok') return setLoad({ status: 'ok', detail: res.data });
    // Un bache de red tras registrar no debe borrar el detalle ya cargado (offline-first).
    setLoad((prev) => (prev.status === 'ok' ? prev : { status: res.status === 'offline' ? 'offline' : 'error' }));
  }, [id]);

  /** Aplica el ítem que devolvió la mutación (ejecutar/posponer), sin esperar el refetch. */
  const applyItem = useCallback((item: AgendaListItem) => {
    setLoad((prev) => (prev.status === 'ok' ? { status: 'ok', detail: { ...prev.detail, item } } : prev));
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** El `tel:`/`geo:` ya está en memoria: llamar no depende de la red. */
  const open = useCallback(async (url: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('No se pudo abrir', 'Tu teléfono no tiene una app para esta acción.');
    }
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Header title="Detalle de gestión" onBack={() => router.back()} />

      {load.status === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.navy} />
        </View>
      ) : load.status === 'offline' ? (
        <EmptyState icon="📴" title="Sin conexión" hint="El detalle aparecerá cuando vuelva la red." />
      ) : load.status === 'error' ? (
        <EmptyState icon="⚠️" title="No se pudo cargar" hint="Reintentá en un momento." />
      ) : (
        <Detail detail={load.detail} onOpen={open} onChanged={reload} onItemUpdated={applyItem} />
      )}
    </View>
  );
}

function Detail({
  detail,
  onOpen,
  onChanged,
  onItemUpdated,
}: {
  detail: AgendaItemDetail;
  onOpen: (url: string) => void;
  onChanged: () => void;
  onItemUpdated: (item: AgendaListItem) => void;
}) {
  const { item, client, credit, history } = detail;
  const meta = AGENDA_TYPE_META[item.type];
  const tone = item.isOverdue ? 'danger' : meta.tone;
  const [showRegister, setShowRegister] = useState(false);
  const pending = item.status === AgendaItemStatus.SCHEDULED;
  const { tel, geo } = actionLinks(detail.target, Platform.OS);
  const lines = detailLines(detail);
  // Un agendado de WhatsApp se ejecuta en WhatsApp, con su mensaje: llamar por voz sería otra gestión.
  const wa =
    item.type === AgendaItemType.WHATSAPP && detail.target?.phone
      ? whatsappLink(detail.target.phone, typeof item.details.message === 'string' ? item.details.message : undefined)
      : undefined;

  return (
    <>
      <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.xxl }}>
        <View style={styles.pillRow}>
          <StatusBadge label={`${statusLabel(item)} · ${meta.label}`} tone={tone} />
        </View>

        <View style={styles.card}>
          <View style={styles.gestionHead}>
            <View style={[styles.iconBox, { backgroundColor: COLORS.highlight }]}>
              <Text style={styles.icon}>{meta.icon}</Text>
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.gestionTitle}>{meta.label}</Text>
              <Text style={styles.when}>{whenLabel(item)}</Text>
            </View>
          </View>

          {lines.map((line) => (
            <Text key={line} style={styles.detailLine}>
              {line}
            </Text>
          ))}

          {item.observations && (
            <View style={styles.quote}>
              <Text style={styles.quoteText}>{item.observations}</Text>
            </View>
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.clientHead}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.clientName}>{client.displayName}</Text>
              <Text style={styles.clientMeta}>
                {[client.nationalId && `CI: ${client.nationalId}`, client.zone].filter(Boolean).join(' · ')}
              </Text>
            </View>
            {credit && (
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.debtLabel}>DEUDA TOTAL</Text>
                <Text style={styles.debtAmount}>{money(credit.outstandingBalance, credit.currency)}</Text>
              </View>
            )}
          </View>

          {(wa || tel || geo) && (
            <View style={styles.actions}>
              {wa ? (
                <ActionButton label="WhatsApp" icon="💬" onPress={() => onOpen(wa)} />
              ) : (
                tel && <ActionButton label="Llamar" icon="📞" onPress={() => onOpen(tel)} />
              )}
              {/* Navegar abre el mapa de Kobrax, no el del teléfono: mismo comportamiento que la ficha. */}
              {geo && (
                <ActionButton
                  label="Navegar"
                  icon="🧭"
                  onPress={() => router.push(`/cliente/mapa?clientId=${item.clientId}&name=${encodeURIComponent(item.clientName ?? '')}`)}
                />
              )}
            </View>
          )}
        </View>

        <SectionLabel>Historial de gestiones</SectionLabel>
        <TimelineRow label="Gestión Actual" hint={`${dayLabel(item.scheduledDate)} · ${statusLabel(item)}`} current />
        {history.map((h) => (
          <TimelineRow key={h.id} label={AGENDA_TYPE_META[h.type].label} hint={historyHint(h)} />
        ))}
      </ScrollView>

      {pending && (
        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <Pressable style={styles.registerBtn} accessibilityRole="button" onPress={() => setShowRegister(true)}>
            <Text style={styles.registerText}>Registrar gestión</Text>
          </Pressable>
        </SafeAreaView>
      )}

      <RegisterSheet
        detail={detail}
        visible={showRegister}
        onClose={() => setShowRegister(false)}
        onOpenLink={onOpen}
        onUpdated={(updated) => {
          setShowRegister(false);
          // El server ya devolvió el ítem actualizado: se aplica directo, sin depender del refetch.
          // Un bache de red al recargar el resto (historial) no debe revertir la vista a "pendiente".
          onItemUpdated(updated);
          onChanged();
        }}
      />
    </>
  );
}

function historyHint(h: AgendaHistoryEntry): string {
  const state = h.isOverdue ? 'Vencida' : AGENDA_STATUS_LABEL[h.status];
  return `${shortDate(h.scheduledDate)} · ${state}`;
}

function ActionButton({ label, icon, onPress }: { label: string; icon: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.action, pressed && { opacity: 0.7 }]}
    >
      <Text style={styles.actionIcon}>{icon}</Text>
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

/** Fila del timeline: punto + línea. La gestión abierta va en verde, arriba. */
function TimelineRow({ label, hint, current }: { label: string; hint: string; current?: boolean }) {
  return (
    <View style={styles.timelineRow}>
      <View style={[styles.dot, current && styles.dotCurrent]} />
      <View style={[styles.timelineBody, current && styles.timelineBodyCurrent]}>
        <Text style={[styles.timelineLabel, current && { color: COLORS.success }]}>{label}</Text>
        <Text style={styles.timelineHint}>{hint}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pillRow: { alignItems: 'center', marginBottom: SPACING.lg },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.card,
    padding: SPACING.lg,
    marginBottom: SPACING.lg,
    gap: SPACING.md,
  },
  gestionHead: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  iconBox: { width: 48, height: 48, borderRadius: RADIUS.card, alignItems: 'center', justifyContent: 'center' },
  icon: { fontSize: 22 },
  gestionTitle: { ...TYPE.h3, fontWeight: '700' },
  when: { ...TYPE.secondary },
  detailLine: { ...TYPE.body },
  quote: { backgroundColor: COLORS.bg, borderRadius: RADIUS.input, padding: SPACING.md },
  quoteText: { ...TYPE.secondary, color: COLORS.text, fontStyle: 'italic' },
  clientHead: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.md },
  clientName: { ...TYPE.h3, fontWeight: '700' },
  clientMeta: { ...TYPE.secondary, color: COLORS.muted },
  debtLabel: { ...TYPE.caption, fontWeight: '700', letterSpacing: 0.5 },
  debtAmount: { fontSize: 20, fontWeight: '700', color: COLORS.danger },
  actions: { flexDirection: 'row', gap: SPACING.md },
  action: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    height: 52, // §3.3: el cobrador toca con guantes
    borderRadius: RADIUS.button,
    backgroundColor: COLORS.highlight,
  },
  actionIcon: { fontSize: 16 },
  actionText: { ...TYPE.body, fontWeight: '700', color: COLORS.purple },
  timelineRow: { flexDirection: 'row', gap: SPACING.md, alignItems: 'flex-start' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.muted, marginTop: SPACING.lg },
  dotCurrent: { backgroundColor: COLORS.success, width: 12, height: 12, borderRadius: 6 },
  timelineBody: { flex: 1, paddingVertical: SPACING.md, gap: 2 },
  timelineBodyCurrent: {
    backgroundColor: COLORS.successBg,
    borderRadius: RADIUS.input,
    paddingHorizontal: SPACING.md,
  },
  timelineLabel: { ...TYPE.body, fontWeight: '600' },
  timelineHint: { ...TYPE.caption },
  footer: { backgroundColor: COLORS.bg, paddingHorizontal: SPACING.lg, paddingTop: SPACING.md },
  registerBtn: {
    height: 56,
    borderRadius: RADIUS.button,
    backgroundColor: COLORS.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  registerText: { ...TYPE.body, color: COLORS.white, fontWeight: '700', fontSize: 16 },
});
