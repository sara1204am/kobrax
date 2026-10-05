/**
 * Las secciones de la ficha de mora, a nivel del panel pero en versión de campo (delgada): historial de mora,
 * métricas de recuperación, gestiones como tarjetas, promesas, pagos, notas y avisos de la fuente. Todas son
 * presentacionales: reciben el dato ya leído y delegan el formato en `mora-ficha.ts` / `mora.ts` (probados aparte).
 *
 * `null` en una lista es «no se pudo leer»: la sección lo dice y la ficha sigue entera.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CreditNote, MoraActivityItem, MoraEpisode, MoraPromise, PaymentItem, RecoveryMetrics } from '@kobrax/shared';
import { COLORS, RADIUS, SPACING, TYPE } from '@/theme';
import { SectionLabel, StatusBadge } from '@/ui';
import { money } from '@/agenda-form';
import { activityLook, activityTypeLabel, LOOK_COLORS, PROMISE_STATUS_META, promiseSummaryLines, resultLabel, type LookTone, NOTE_KIND_LABEL } from '@/mora';
import {
  canEditNoteText,
  dayText,
  episodeView,
  metricsView,
  NOTE_COLORS,
  NOTE_KIND_TONE,
  paymentsSummary,
  paymentView,
  psfNotice,
  sortNotes,
} from '@/mora-ficha';

const UNAVAILABLE = (what: string) => `No se pudo cargar ${what}.`;

/** Una sección con su título. */
export function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <SectionLabel>{count === undefined ? title : `${title} (${count})`}</SectionLabel>
      {children}
    </View>
  );
}

/** El cuadro redondeado con el icono, del color de su tono (`ToneTile` del panel). */
export function ToneTile({ tone, icon }: { tone: LookTone; icon: string }) {
  const c = LOOK_COLORS[tone];
  return (
    <View style={[styles.tile, { backgroundColor: c.bg }]} accessibilityElementsHidden importantForAccessibility="no">
      <Text style={styles.tileIcon}>{icon}</Text>
    </View>
  );
}

/** Aviso de la fuente (PSF): ausente del reporte o dato viejo. Nunca dice «pagado». No bloquea nada. */
export function PsfNotice(props: Parameters<typeof psfNotice>[0]) {
  const text = psfNotice(props);
  if (!text) return null;
  return (
    <Text style={styles.warn} accessibilityRole="alert">
      {text}
    </Text>
  );
}

/** Un dato suelto «etiqueta · valor» (sin forzar mayúsculas, a diferencia de `DataRow`). */
export function Fact({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={[styles.factValue, danger && { color: COLORS.danger }]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

// ── Historial de mora ───────────────────────────────────────────────────────────────────────────────────────

export function EpisodesSection({ episodes, currency }: { episodes: MoraEpisode[] | null; currency: string }) {
  return (
    <Section title="Historial de mora" count={episodes?.length}>
      {episodes === null ? (
        <Text style={styles.line}>{UNAVAILABLE('el historial de mora')}</Text>
      ) : episodes.length === 0 ? (
        <Text style={styles.line}>Este crédito no tiene periodos de mora registrados todavía.</Text>
      ) : (
        episodes.map((e) => {
          const v = episodeView(e, currency);
          return (
            <View key={v.id} style={styles.item}>
              <View style={styles.rowBetween}>
                <Text style={styles.rowTitle}>{v.title}</Text>
                <View style={styles.badges}>
                  {v.badge && <StatusBadge label={v.badge.label} tone={v.badge.tone} />}
                  {v.reconstructed && <StatusBadge label="Reconstruido" tone="neutral" />}
                </View>
              </View>
              <Text style={styles.rowSub}>{v.range}</Text>
              {v.hint && <Text style={styles.rowDate}>{v.hint}</Text>}
              <View style={styles.grid}>
                {v.items.map((i) => (
                  <View key={i.label} style={styles.gridCell}>
                    <Text style={styles.cellLabel}>{i.label}</Text>
                    <Text style={styles.cellValue}>{i.value}</Text>
                  </View>
                ))}
                <View style={styles.gridCell}>
                  <Text style={styles.cellLabel}>Origen de la mora</Text>
                  <Text style={styles.cellValue}>{v.source}</Text>
                </View>
              </View>
            </View>
          );
        })
      )}
    </Section>
  );
}

// ── Métricas de recuperación ────────────────────────────────────────────────────────────────────────────────

export function MetricsSection({ metrics, currency }: { metrics: RecoveryMetrics | null; currency: string }) {
  if (metrics === null) {
    return (
      <Section title="Recuperación">
        <Text style={styles.line}>{UNAVAILABLE('las métricas de recuperación')}</Text>
      </Section>
    );
  }
  const v = metricsView(metrics, currency);
  return (
    <Section title="Recuperación">
      <Text style={styles.rowSub}>{v.intro}</Text>
      {v.untracked && <Text style={[styles.warn, { marginTop: SPACING.sm }]}>{v.untracked}</Text>}
      <View style={styles.grid}>
        {v.cards.map((c) => (
          <View key={c.label} style={styles.metric}>
            <Text style={styles.cellLabel}>{c.label}</Text>
            <Text style={styles.metricValue}>{c.value}</Text>
            {c.hint ? <Text style={styles.rowDate}>{c.hint}</Text> : null}
          </View>
        ))}
      </View>
    </Section>
  );
}

// ── Gestiones (tarjeta con icono y tono) ────────────────────────────────────────────────────────────────────

export function ActivityTimeline({ activities }: { activities: MoraActivityItem[] }) {
  return (
    <Section title="Gestiones">
      {activities.length === 0 ? (
        <Text style={styles.line}>Todavía no hay gestiones registradas.</Text>
      ) : (
        activities.map((a) => {
          const look = activityLook(a.type, a.result);
          return (
            <View key={a.id} style={styles.activity}>
              <ToneTile tone={look.tone} icon={look.icon} />
              <View style={{ flex: 1 }}>
                <View style={styles.rowBetween}>
                  <Text style={styles.rowTitle}>{activityTypeLabel(a.type)}</Text>
                  <Text style={styles.rowDate}>{new Date(a.createdAt).toLocaleDateString('es')}</Text>
                </View>
                {a.result ? (
                  <Text style={styles.rowSub}>
                    <Text style={styles.resultKey}>Resultado:</Text> {resultLabel(a.result)}
                  </Text>
                ) : null}
                {a.notes && a.type !== 'ASSIGNMENT' ? <Text style={styles.noteText}>{a.notes}</Text> : null}
              </View>
            </View>
          );
        })
      )}
    </Section>
  );
}

// ── Promesas ────────────────────────────────────────────────────────────────────────────────────────────────

export function PromisesSection({
  promises,
  currency,
  nameOf,
}: {
  promises: MoraPromise[] | null;
  currency: string;
  nameOf: (id?: string) => string;
}) {
  const s = promises && promises.length > 0 ? promiseSummaryLines(promises) : undefined;
  return (
    <Section title="Promesas de pago" count={promises?.length}>
      {promises === null ? (
        <Text style={styles.line}>{UNAVAILABLE('las promesas')}</Text>
      ) : promises.length === 0 ? (
        <Text style={styles.line}>No hay promesas de pago registradas.</Text>
      ) : (
        <>
          <Text style={styles.rowSub}>
            {s!.summary} · <Text style={styles.strong}>{s!.compliance}</Text>
          </Text>
          {s!.unresolved && <Text style={[styles.rowSub, { color: COLORS.warningText }]}>{s!.unresolved}</Text>}
          {promises.map((p) => {
            const meta = PROMISE_STATUS_META[p.status];
            return (
              <View key={p.id} style={styles.listRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>
                    {p.amount !== undefined ? money(p.amount, currency) : '—'} · para el {dayText(p.promiseDate)}
                  </Text>
                  {p.assigneeId || p.observations ? (
                    <Text style={styles.rowSub}>
                      {[p.assigneeId ? nameOf(p.assigneeId) : undefined, p.observations].filter(Boolean).join(' · ')}
                    </Text>
                  ) : null}
                </View>
                <StatusBadge label={meta.label} tone={meta.tone} />
              </View>
            );
          })}
        </>
      )}
    </Section>
  );
}

// ── Pagos ───────────────────────────────────────────────────────────────────────────────────────────────────

export function PaymentsSection({
  payments,
  currency,
  external,
  nameOf,
}: {
  payments: PaymentItem[] | null;
  currency: string;
  external: boolean;
  nameOf: (id?: string) => string;
}) {
  return (
    <Section title="Pagos" count={payments?.length}>
      {payments === null ? (
        <Text style={styles.line}>{UNAVAILABLE('los pagos')}</Text>
      ) : payments.length === 0 ? (
        <Text style={styles.line}>Todavía no hay pagos registrados.</Text>
      ) : (
        <>
          <Text style={[styles.rowSub, styles.strong]}>{paymentsSummary(payments, currency)}</Text>
          {payments.map((p) => {
            const v = paymentView(p, currency, nameOf);
            return (
              <View key={v.id} style={styles.activity}>
                <ToneTile tone={v.look.tone} icon={v.look.icon} />
                <View style={{ flex: 1 }}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.rowTitle}>{v.amount}</Text>
                    <Text style={styles.rowDate}>{v.date}</Text>
                  </View>
                  <View style={styles.badges}>
                    <Text style={styles.rowSub}>{v.method}</Text>
                    {v.channel && <StatusBadge label={v.channel} tone="neutral" />}
                  </View>
                  {v.receipt || v.by ? <Text style={styles.rowDate}>{[v.receipt, v.by].filter(Boolean).join(' · ')}</Text> : null}
                  {v.notes ? <Text style={styles.noteText}>{v.notes}</Text> : null}
                </View>
              </View>
            );
          })}
        </>
      )}
      {external && (
        <Text style={[styles.rowDate, { marginTop: SPACING.sm }]}>
          Un pago sobre una operación de PSF cuenta como recuperado, pero no cambia el saldo ni la mora que reportó el archivo: esos números se actualizan con el próximo reporte.
        </Text>
      )}
    </Section>
  );
}

// ── Notas (post-its de color) ───────────────────────────────────────────────────────────────────────────────

export function NotesSection({
  notes,
  nameOf,
  userId,
  canAssign,
  onEdit,
  onDelete,
}: {
  notes: CreditNote[] | null;
  nameOf: (id?: string) => string;
  userId?: string;
  /** `assignment:write`: puede corregir y borrar notas ajenas. */
  canAssign: boolean;
  onEdit: (note: CreditNote) => void;
  onDelete: (note: CreditNote) => void;
}) {
  return (
    <Section title="Notas" count={notes?.length}>
      {notes === null ? (
        <Text style={styles.line}>{UNAVAILABLE('las notas')}</Text>
      ) : notes.length === 0 ? (
        <Text style={styles.line}>Todavía no hay notas.</Text>
      ) : (
        sortNotes(notes).map((n) => {
          const c = NOTE_COLORS[n.color] ?? NOTE_COLORS.YELLOW;
          const mine = canEditNoteText(n, userId, canAssign);
          return (
            <View key={n.id} style={[styles.postit, { backgroundColor: c.bg }]}>
              <View style={styles.rowBetween}>
                <StatusBadge label={NOTE_KIND_LABEL[n.kind]} tone={NOTE_KIND_TONE[n.kind]} />
                {mine && (
                  <View style={styles.badges}>
                    <Pressable onPress={() => onEdit(n)} accessibilityRole="button" accessibilityLabel="Editar nota" hitSlop={8} style={styles.iconBtn}>
                      <Text>✏️</Text>
                    </Pressable>
                    <Pressable onPress={() => onDelete(n)} accessibilityRole="button" accessibilityLabel="Borrar nota" hitSlop={8} style={styles.iconBtn}>
                      <Text>🗑</Text>
                    </Pressable>
                  </View>
                )}
              </View>
              <Text style={[styles.postitBody, { color: c.ink }]}>{n.body}</Text>
              <Text style={[styles.rowDate, { color: c.ink, opacity: 0.7 }]}>
                {nameOf(n.authorId)} · {new Date(n.createdAt).toLocaleDateString('es')}
              </Text>
            </View>
          );
        })
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: COLORS.white, borderRadius: RADIUS.card, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.lg },
  line: { ...TYPE.body, color: COLORS.text, paddingVertical: 4 },
  warn: { ...TYPE.caption, color: COLORS.warningText, backgroundColor: COLORS.warningBg, padding: SPACING.sm, borderRadius: RADIUS.input },
  strong: { fontWeight: '600', color: COLORS.navy },
  fact: { flexDirection: 'row', justifyContent: 'space-between', gap: SPACING.md, paddingVertical: 4 },
  factLabel: { ...TYPE.secondary, color: COLORS.text2 },
  factValue: { ...TYPE.secondary, color: COLORS.navy, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  item: { paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border, gap: 2 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.sm },
  badges: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, flexWrap: 'wrap' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginTop: SPACING.sm },
  gridCell: { width: '47%' },
  cellLabel: { ...TYPE.caption, color: COLORS.periwinkle },
  cellValue: { ...TYPE.secondary, color: COLORS.navy, fontWeight: '600' },
  metric: { width: '47%', backgroundColor: COLORS.bg, borderRadius: RADIUS.input, padding: SPACING.sm },
  metricValue: { ...TYPE.h3, color: COLORS.navy },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  activity: { flexDirection: 'row', gap: SPACING.md, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  tile: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tileIcon: { fontSize: 18 },
  rowTitle: { ...TYPE.body, color: COLORS.navy, fontWeight: '600', flexShrink: 1 },
  rowSub: { ...TYPE.secondary, color: COLORS.text2 },
  rowDate: { ...TYPE.caption, color: COLORS.muted, marginTop: 2 },
  resultKey: { color: COLORS.periwinkle },
  noteText: { ...TYPE.secondary, color: COLORS.text, marginTop: 2 },
  postit: { borderRadius: 10, padding: SPACING.md, gap: SPACING.xs, marginTop: SPACING.sm },
  postitBody: { ...TYPE.body },
  iconBtn: { paddingHorizontal: SPACING.xs },
});
