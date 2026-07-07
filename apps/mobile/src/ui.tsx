/**
 * Fundación UI de campo (F10 Slice 0). Componentes reusables sobre tokens,
 * hermanos de `components.tsx` (auth). StyleSheet + tokens, sin librerías pesadas.
 * El TabBar lo cubre el `Tabs` nativo de expo-router (ver app/(tabs)/_layout.tsx).
 */
import { type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
