import { type ReactNode, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { checkPassword } from '@kobrax/shared';
import { COLORS, HERO_GRADIENT, RADIUS, SPACING, TYPE } from './theme';

/** Botón primario navy, alto 52 (cobrador con guantes). */
export function Button({
  label,
  onPress,
  loading,
  disabled,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'ghost';
}) {
  const isPrimary = variant === 'primary';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        isPrimary ? styles.buttonPrimary : styles.buttonGhost,
        pressed && !disabled && styles.buttonPressed,
        (disabled || loading) && styles.buttonDisabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? COLORS.white : COLORS.navy} />
      ) : (
        <Text style={[styles.buttonLabel, isPrimary ? styles.buttonLabelPrimary : styles.buttonLabelGhost]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/** Input con label (alto 52, borde 1.5px). Los campos `secureTextEntry` traen toggle ver/ocultar. */
export function Field({
  label,
  error,
  secureTextEntry,
  ...props
}: TextInputProps & { label: string; error?: boolean }) {
  const [reveal, setReveal] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.input, styles.inputRow, error && styles.inputError]}>
        <TextInput
          placeholderTextColor={COLORS.muted}
          style={styles.inputControl}
          secureTextEntry={secureTextEntry && !reveal}
          {...props}
        />
        {secureTextEntry && (
          <Pressable
            onPress={() => setReveal((r) => !r)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={reveal ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          >
            <Text style={styles.reveal}>{reveal ? '🙈' : '👁️'}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

/** Banner de error accesible. */
export function ErrorBanner({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <View accessibilityRole="alert" style={styles.errorBanner}>
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

/** Hero con gradiente (token) — RN usa LinearGradient, no CSS. */
export function Hero({ subtitle }: { subtitle?: string }) {
  return (
    <LinearGradient colors={[...HERO_GRADIENT]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
      <Text style={styles.heroBrand}>KOBRAX</Text>
      {subtitle && <Text style={styles.heroSubtitle}>{subtitle}</Text>}
    </LinearGradient>
  );
}

/** Card blanca contenedora del paso. */
export function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

/** Footer de confianza fintech — siempre visible. */
export function SecurityFooter() {
  return <Text style={styles.footer}>🔒 Conexión cifrada TLS 1.3</Text>;
}

/** Link de texto (acciones secundarias: "Olvidé mi contraseña", "Volver", etc.). */
export function TextLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Text style={styles.link} onPress={onPress} accessibilityRole="link">
      {label}
    </Text>
  );
}

/** Checklist de política de contraseña en vivo (fuente única: `checkPassword` de shared). */
export function PasswordChecklist({ password }: { password: string }) {
  if (!password) return null;
  return (
    <View style={{ gap: SPACING.xs }}>
      {checkPassword(password).map((rule) => (
        <View key={rule.id} style={styles.ruleRow}>
          <Text style={[styles.ruleIcon, { color: rule.passed ? COLORS.success : COLORS.muted }]}>
            {rule.passed ? '✓' : '○'}
          </Text>
          <Text style={[styles.ruleLabel, rule.passed && { color: COLORS.text }]}>{rule.label}</Text>
        </View>
      ))}
    </View>
  );
}

export const styles = StyleSheet.create({
  button: {
    height: 52,
    borderRadius: RADIUS.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPrimary: { backgroundColor: COLORS.navy },
  buttonGhost: { backgroundColor: COLORS.white, borderWidth: 1.5, borderColor: COLORS.border },
  buttonPressed: { transform: [{ scale: 0.98 }], backgroundColor: COLORS.slate },
  buttonDisabled: { opacity: 0.5 },
  buttonLabel: { fontSize: 15, fontWeight: '600' },
  buttonLabelPrimary: { color: COLORS.white },
  buttonLabelGhost: { color: COLORS.text2 },
  field: { gap: SPACING.xs },
  label: { fontSize: 11, fontWeight: '600', color: COLORS.text, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    height: 52,
    borderRadius: RADIUS.input,
    borderWidth: 1.5,
    borderColor: COLORS.lightBg,
    backgroundColor: COLORS.white,
    paddingHorizontal: SPACING.md,
  },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  inputControl: { flex: 1, height: '100%', fontSize: 15, color: COLORS.text },
  reveal: { fontSize: 18 },
  inputError: { borderColor: COLORS.danger, backgroundColor: COLORS.dangerBg },
  errorBanner: {
    backgroundColor: COLORS.dangerBg,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.danger,
    borderRadius: 6,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },
  errorText: { color: COLORS.danger, fontSize: 13 },
  hero: { paddingTop: 64, paddingBottom: 56, paddingHorizontal: SPACING.xl, alignItems: 'center' },
  heroBrand: { fontSize: 26, fontWeight: '700', color: COLORS.white, letterSpacing: 1 },
  heroSubtitle: { marginTop: 4, fontSize: 13, color: 'rgba(255,255,255,0.75)' },
  card: {
    marginTop: -24,
    marginHorizontal: SPACING.lg,
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.xl,
    gap: SPACING.lg,
  },
  footer: { textAlign: 'center', color: COLORS.muted, fontSize: 11, marginTop: SPACING.xl },
  title: TYPE.h1,
  subtitle: { ...TYPE.secondary, marginTop: 4 },
  link: { ...TYPE.link, textAlign: 'center' },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  ruleIcon: { fontSize: 13, width: 16, textAlign: 'center' },
  ruleLabel: { ...TYPE.secondary },
});
