/**
 * Fundación UI de campo (F10 Slice 0). Componentes reusables sobre tokens,
 * hermanos de `components.tsx` (auth). StyleSheet + tokens, sin librerías pesadas.
 * El TabBar lo cubre el `Tabs` nativo de expo-router (ver app/(tabs)/_layout.tsx).
 */
import { type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AgendaItemStatus, AgendaItemType, AgendaOutcome, CasePriority, CaseStatus, PortfolioStatus } from '@kobrax/shared';
import { useNetStore } from './store/net';
import { COLORS, RADIUS, SPACING, TYPE } from './theme';

/** App bar navy: título + back opcional + acción derecha opcional. */
export function Header({
  title,
  onBack,
  right,
}: {
  title: string;
  onBack?: () => void;
  right?: ReactNode;
}) {
  return (
    <SafeAreaView edges={['top']} style={styles.headerSafe}>
      <View style={styles.header}>
        <View style={styles.headerSide}>
          {onBack && (
            <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Volver">
              <Text style={styles.headerBack}>‹</Text>
            </Pressable>
          )}
        </View>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        <View style={[styles.headerSide, { alignItems: 'flex-end' }]}>{right}</View>
      </View>
    </SafeAreaView>
  );
}

export type BadgeTone = 'neutral' | 'info' | 'success' | 'danger' | 'warning';

const TONES: Record<BadgeTone, { bg: string; fg: string }> = {
  neutral: { bg: COLORS.lightBg, fg: COLORS.text2 },
  info: { bg: COLORS.highlight, fg: COLORS.purple },
  success: { bg: COLORS.successBg, fg: COLORS.success },
  danger: { bg: COLORS.dangerBg, fg: COLORS.danger },
  warning: { bg: COLORS.warningBg, fg: COLORS.warningText },
};

/** Pill de estado (CaseStatus/VisitOutcome/CasePriority → tone al mapear cada pantalla). */
export function StatusBadge({ label, tone = 'neutral' }: { label: string; tone?: BadgeTone }) {
  const c = TONES[tone];
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={[styles.badgeText, { color: c.fg }]}>{label}</Text>
    </View>
  );
}

/** Fila de lista pulsable (base de CaseCard/StopRow/ClientRow; se monta en FlashList luego). */
export function ListRow({
  title,
  subtitle,
  right,
  onPress,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, pressed && onPress && styles.rowPressed]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle && (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      {right}
      {onPress && <Text style={styles.rowChevron}>›</Text>}
    </Pressable>
  );
}

/**
 * Mapeo presentacional `CaseStatus` → tono de badge. El enum es dominio (shared); el color
 * es UI y vive acá. Un caso vencido pinta `danger` sin importar el estado (lo decide la pantalla).
 */
export function caseStatusTone(status: CaseStatus): BadgeTone {
  switch (status) {
    case CaseStatus.PAID:
    case CaseStatus.CLOSED:
      return 'success';
    case CaseStatus.ACTIVE:
    case CaseStatus.PROMISE_TO_PAY:
      return 'info';
    case CaseStatus.IN_NEGOTIATION:
      return 'warning';
    case CaseStatus.WRITTEN_OFF:
      return 'danger';
    case CaseStatus.PENDING:
    default:
      return 'neutral';
  }
}

/** Etiqueta corta en español para cada estado de caso. */
export const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  [CaseStatus.PENDING]: 'Pendiente',
  [CaseStatus.ACTIVE]: 'Activo',
  [CaseStatus.IN_NEGOTIATION]: 'En negociación',
  [CaseStatus.PROMISE_TO_PAY]: 'Promesa de pago',
  [CaseStatus.PAID]: 'Pagado',
  [CaseStatus.CLOSED]: 'Cerrado',
  [CaseStatus.WRITTEN_OFF]: 'Incobrable',
};

/** Etiqueta corta en español para cada prioridad de caso. */
export const CASE_PRIORITY_LABEL: Record<CasePriority, string> = {
  [CasePriority.LOW]: 'Baja',
  [CasePriority.MEDIUM]: 'Media',
  [CasePriority.HIGH]: 'Alta',
  [CasePriority.CRITICAL]: 'Crítica',
};

/**
 * Tile de KPI del Home (label + valor grande + tono opcional). Sol→contraste: el valor va en
 * `navy`; el label en `muted`. Reusado en Home (P1) y resumen de jornada (P3).
 */
export function StatTile({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'success' | 'danger';
}) {
  const valueColor = tone === 'success' ? COLORS.success : tone === 'danger' ? COLORS.danger : COLORS.navy;
  return (
    <View style={styles.tile}>
      <Text style={[styles.tileValue, { color: valueColor }]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.tileLabel} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

/** Color sólido por tono (para la barra de acento de la tarjeta de caso). */
const TONE_SOLID: Record<BadgeTone, string> = {
  neutral: COLORS.muted,
  info: COLORS.periwinkle,
  success: COLORS.success,
  danger: COLORS.danger,
  warning: COLORS.warning,
};

/**
 * Tarjeta de caso de la Agenda (diseño Figma `81:4`): barra de acento a la izquierda (roja si
 * vencida, si no por estado), nombre del deudor en navy, línea secundaria, y a la derecha el monto
 * (alto contraste) sobre la pill de estado. `action` = botón redondo opcional (llamar/mensaje → P2).
 * Reusada en Agenda (P1), Gestiones (P2) y Rutas (P3).
 */
export function CaseCard({
  name,
  caption,
  subtitle,
  amount,
  amountDanger,
  status,
  overdue,
  badge,
  action,
  onPress,
}: {
  name: string;
  /** Línea muted extra bajo el nombre (cartera §5.3: "Zona Sur · 2 préstamos"). */
  caption?: string;
  subtitle?: string;
  amount?: string;
  /** Monto en rojo: deuda con mora (§5.3, "cifra dominante en rojo si hay mora"). */
  amountDanger?: boolean;
  /** Estado de caso (agenda). Opcional si se pasa `badge` (cartera usa PortfolioStatus). */
  status?: CaseStatus;
  overdue?: boolean;
  /** Badge explícito — override del derivado de `status` (cartera §5.3 pasa el de PortfolioStatus). */
  badge?: { label: string; tone: BadgeTone };
  action?: ReactNode;
  onPress?: () => void;
}) {
  const b: { label: string; tone: BadgeTone } =
    badge ??
    (overdue
      ? { label: 'Vencida', tone: 'danger' }
      : { label: CASE_STATUS_LABEL[status ?? CaseStatus.PENDING], tone: caseStatusTone(status ?? CaseStatus.PENDING) });
  return (
    <View style={styles.caseCard}>
      <View style={[styles.caseAccent, { backgroundColor: TONE_SOLID[b.tone] }]} />
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        style={({ pressed }) => [styles.caseBody, pressed && onPress && styles.rowPressed]}
      >
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={styles.caseName} numberOfLines={1}>
            {name}
          </Text>
          {caption && (
            <Text style={styles.caseCaption} numberOfLines={1}>
              {caption}
            </Text>
          )}
          {subtitle && (
            <Text style={styles.rowSubtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          )}
        </View>
        <View style={styles.caseRight}>
          {amount && (
            <Text style={[styles.caseAmount, amountDanger && { color: COLORS.danger }]} numberOfLines={1}>
              {amount}
            </Text>
          )}
          <StatusBadge label={b.label} tone={b.tone} />
        </View>
      </Pressable>
      {action}
    </View>
  );
}

/**
 * Estado de cartera (§5.3) → etiqueta + tono de badge. El enum es dominio (shared); el color es UI.
 * PROMESA usa `info` (púrpura sobre highlight), el color semántico que pide el §5.3. Lo reusa S3 (ficha).
 */
export const PORTFOLIO_STATUS_META: Record<PortfolioStatus, { label: string; tone: BadgeTone }> = {
  [PortfolioStatus.CURRENT]: { label: 'Al día', tone: 'success' },
  [PortfolioStatus.DUE_SOON]: { label: 'Por vencer', tone: 'warning' },
  [PortfolioStatus.OVERDUE]: { label: 'En mora', tone: 'danger' },
  [PortfolioStatus.PROMISE]: { label: 'Promesa', tone: 'info' },
  [PortfolioStatus.PAID]: { label: 'Pagado', tone: 'neutral' },
};

/**
 * Input de monto con símbolo de moneda y teclado numérico (§4.1, §5.4). El TEXTO es la fuente de verdad
 * (no re-stringifica el número → no pierde centavos, el bug de Agenda); el padre parsea con `Number`.
 * Lo usan el alta de préstamo (V2) y el pago de la ficha (S3).
 */
export function AmountInput({
  value,
  onChangeText,
  currencySymbol = 'Bs',
  placeholder = '0',
  editable = true,
  accessibilityLabel,
}: {
  value: string;
  onChangeText: (t: string) => void;
  currencySymbol?: string;
  placeholder?: string;
  editable?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <View style={[styles.amountBox, !editable && styles.amountBoxDisabled]}>
      <Text style={styles.amountSymbol}>{currencySymbol}</Text>
      <TextInput
        style={styles.amountInput}
        value={value}
        onChangeText={(t) => onChangeText(t.replace(/[^0-9.,]/g, '').replace(',', '.'))}
        keyboardType="decimal-pad"
        placeholder={placeholder}
        placeholderTextColor={COLORS.muted}
        editable={editable}
        accessibilityLabel={accessibilityLabel}
      />
    </View>
  );
}

/** Chips de selección única (frecuencia, base de interés, medio de pago…). Wrap horizontal. */
export function Chips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.chipsWrap}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Encabezado gris de sección (uppercase) para agrupar la lista de la Agenda. */
export function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

/** Ícono + etiqueta + tono por tipo de gestión agendada (Figma). */
export const AGENDA_TYPE_META: Record<AgendaItemType, { icon: string; label: string; tone: BadgeTone }> = {
  [AgendaItemType.CALL]: { icon: '📞', label: 'Llamada', tone: 'info' },
  [AgendaItemType.VISIT]: { icon: '📍', label: 'Visita', tone: 'success' },
  [AgendaItemType.WHATSAPP]: { icon: '💬', label: 'WhatsApp', tone: 'success' },
  [AgendaItemType.REMINDER]: { icon: '🔔', label: 'Recordatorio', tone: 'warning' },
  [AgendaItemType.PROMISE_TO_PAY]: { icon: '🤝', label: 'Promesa de pago', tone: 'info' },
};

/** Etiqueta en español por estado de agendado. */
export const AGENDA_STATUS_LABEL: Record<AgendaItemStatus, string> = {
  [AgendaItemStatus.SCHEDULED]: 'Agendada',
  [AgendaItemStatus.EXECUTED]: 'Completada',
  [AgendaItemStatus.CANCELLED]: 'Cancelada',
  [AgendaItemStatus.RESCHEDULED]: 'Reagendada',
};

/** Etiqueta + tono de cada desenlace al registrar una gestión (S4). */
export const AGENDA_OUTCOME_META: Record<AgendaOutcome, { label: string; tone: BadgeTone }> = {
  [AgendaOutcome.CONTACTED]: { label: 'Contactado', tone: 'success' },
  [AgendaOutcome.NO_ANSWER]: { label: 'Sin respuesta', tone: 'warning' },
  [AgendaOutcome.WRONG_NUMBER]: { label: 'Número equivocado', tone: 'danger' },
  [AgendaOutcome.NOT_FOUND]: { label: 'No se encontró', tone: 'warning' },
  [AgendaOutcome.WRONG_ADDRESS]: { label: 'Dirección equivocada', tone: 'danger' },
  [AgendaOutcome.PROMISE_KEPT]: { label: 'Confirmó pago', tone: 'success' },
  [AgendaOutcome.PROMISE_BROKEN]: { label: 'No pagó', tone: 'danger' },
  [AgendaOutcome.DONE]: { label: 'Realizado', tone: 'success' },
};

/**
 * Tarjeta de gestión agendada (Agenda S1): barra de acento por tipo (roja si vencida), ícono del tipo,
 * nombre del deudor, hora + tipo, y pill de estado. Reusada en las secciones Para hoy/Completados/Vencidos.
 */
export function AgendaCard({
  name,
  icon,
  typeLabel,
  time,
  statusLabel,
  tone,
  overdue,
  onPress,
}: {
  name: string;
  icon: string;
  typeLabel: string;
  time?: string;
  statusLabel: string;
  tone: BadgeTone;
  overdue?: boolean;
  onPress?: () => void;
}) {
  return (
    <View style={styles.caseCard}>
      <View style={[styles.caseAccent, { backgroundColor: TONE_SOLID[overdue ? 'danger' : tone] }]} />
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        style={({ pressed }) => [styles.caseBody, pressed && onPress && styles.rowPressed]}
      >
        <Text style={styles.agendaIcon}>{icon}</Text>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={styles.caseName} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {[time, typeLabel].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <StatusBadge label={statusLabel} tone={overdue ? 'danger' : tone} />
      </Pressable>
    </View>
  );
}

/**
 * Filtro segmentado con contador (diseño Figma de la Agenda: Vencidas · Pendientes · Completadas).
 * El segmento activo se rellena en navy; el resto en blanco con borde. `tone` tiñe el valor.
 */
export function SegmentTabs({
  items,
  value,
  onChange,
}: {
  items: { key: string; label: string; count: number | string; tone?: 'neutral' | 'danger' }[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <View style={styles.segments}>
      {items.map((it) => {
        const active = it.key === value;
        const valueColor = active ? COLORS.white : it.tone === 'danger' ? COLORS.danger : COLORS.navy;
        return (
          <Pressable
            key={it.key}
            onPress={() => onChange(it.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Text style={[styles.segmentCount, { color: valueColor }]}>{it.count}</Text>
            <Text style={[styles.segmentLabel, { color: active ? COLORS.white : COLORS.text2 }]} numberOfLines={1}>
              {it.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Estado vacío/placeholder centrado (loading/empty por pantalla). */
export function EmptyState({ icon, title, hint }: { icon?: string; title: string; hint?: string }) {
  return (
    <View style={styles.empty}>
      {icon && <Text style={styles.emptyIcon}>{icon}</Text>}
      <Text style={styles.emptyTitle}>{title}</Text>
      {hint && <Text style={styles.emptyHint}>{hint}</Text>}
    </View>
  );
}

/**
 * Hoja inferior de acciones. Usa el `Modal` nativo con slide (sin Reanimated en Slice 0);
 * backdrop tap para cerrar. Se enriquece con gesto/Reanimated cuando una pantalla lo pida.
 */
export function BottomSheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Cerrar" />
      <View style={styles.sheet}>
        <View style={styles.sheetGrip} />
        {title && <Text style={styles.sheetTitle}>{title}</Text>}
        {children}
      </View>
    </Modal>
  );
}

/**
 * Banner de conectividad. Informativo, **nunca bloquea** ninguna acción (principio offline-first).
 * Aparece/desaparece según el estado de red; `SafeAreaView` top para no quedar bajo el notch.
 * Se monta una vez sobre las tabs. // ponytail: slide con Reanimated = polish de P1, no bloquea.
 */
export function OfflineIndicator() {
  const isConnected = useNetStore((s) => s.isConnected);
  const pending = useNetStore((s) => s.pendingCount);
  if (isConnected) return null;
  return (
    <SafeAreaView edges={['top']} style={styles.offline} accessibilityRole="alert">
      <Text style={styles.offlineText}>
        Sin conexión{pending > 0 ? ` · ${pending} pendiente${pending === 1 ? '' : 's'} de sync` : ''}
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  headerSafe: { backgroundColor: COLORS.navy },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
  },
  headerSide: { width: 44, justifyContent: 'center' },
  headerBack: { color: COLORS.white, fontSize: 30, lineHeight: 30 },
  headerTitle: { flex: 1, textAlign: 'center', color: COLORS.white, fontSize: 17, fontWeight: '600' },
  badge: { alignSelf: 'flex-start', borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 12, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    minHeight: 56,
  },
  rowPressed: { backgroundColor: COLORS.bg },
  rowTitle: { ...TYPE.body, fontWeight: '600', color: COLORS.text },
  rowSubtitle: { ...TYPE.secondary },
  rowChevron: { color: COLORS.muted, fontSize: 22 },
  tile: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.lg,
    gap: 4,
    minWidth: 0,
  },
  tileValue: { fontSize: 22, fontWeight: '700' },
  tileLabel: { ...TYPE.caption },
  // Tarjeta de caso (Figma 81:4): barra de acento + cuerpo pulsable + acción opcional.
  caseCard: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
    minHeight: 64,
  },
  caseAccent: { width: 4 },
  caseBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  caseName: { ...TYPE.body, fontWeight: '700', color: COLORS.navy },
  caseCaption: { ...TYPE.caption },
  amountBox: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.input,
    paddingHorizontal: SPACING.md, height: 52, backgroundColor: COLORS.white,
  },
  amountBoxDisabled: { backgroundColor: COLORS.lightBg, opacity: 0.7 },
  amountSymbol: { ...TYPE.secondary, color: COLORS.muted, fontWeight: '700' },
  amountInput: { flex: 1, ...TYPE.h3, color: COLORS.navy, padding: 0 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  chip: {
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: RADIUS.pill,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.white,
  },
  chipActive: { backgroundColor: COLORS.purple, borderColor: COLORS.purple },
  chipText: { ...TYPE.secondary, color: COLORS.text2, fontWeight: '600' },
  chipTextActive: { color: COLORS.white },
  agendaIcon: { fontSize: 22 },
  caseRight: { alignItems: 'flex-end', gap: 4 },
  caseAmount: { ...TYPE.body, fontWeight: '700', color: COLORS.navy },
  sectionLabel: {
    ...TYPE.caption,
    fontWeight: '700',
    color: COLORS.muted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: SPACING.sm,
    marginTop: SPACING.md,
  },
  segments: { flexDirection: 'row', gap: SPACING.sm },
  segment: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.sm,
  },
  segmentActive: { backgroundColor: COLORS.navy, borderColor: COLORS.navy },
  segmentCount: { fontSize: 20, fontWeight: '700' },
  segmentLabel: { ...TYPE.caption, fontWeight: '600' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl, gap: SPACING.sm },
  emptyIcon: { fontSize: 40 },
  emptyTitle: { ...TYPE.h3, textAlign: 'center' },
  emptyHint: { ...TYPE.secondary, textAlign: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(26,43,62,0.4)' },
  sheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: SPACING.xl,
    paddingBottom: SPACING.xxl,
    gap: SPACING.md,
  },
  sheetGrip: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.border },
  sheetTitle: { ...TYPE.h3, textAlign: 'center' },
  offline: { backgroundColor: COLORS.warningBg, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  offlineText: { ...TYPE.secondary, color: COLORS.warningText, textAlign: 'center', fontWeight: '600' },
});
