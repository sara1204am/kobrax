/**
 * Design tokens de Kobrax — fuente única de verdad (ver docs/design-system.md).
 * Web los consume en tailwind.config; Mobile en la config de NativeWind.
 */
export const KOBRAX_TOKENS = {
  // Primarios — identidad
  navy: '#1A3A52',
  slate: '#2B5A7D',
  periwinkle: '#5B7DBE',
  lightBlueBg: '#D8E5F2',
  // Acentos purple
  purpleAccent: '#7B68D6',
  softPeriw: '#8B9FD6',
  veryLightPurp: '#E0D8F2',
  purpleHighlight: '#F0ECFF',
  // Estados operativos (NUNCA para decoración)
  success: '#27AE60',
  successBg: '#E8F8F0',
  danger: '#DC3545',
  dangerBg: '#FCE8E8',
  warning: '#F59E0B',
  warningBg: '#FFF3CD',
  warningText: '#7A5C00',
  // Neutros
  textPrimary: '#1A2B3E',
  textSecondary: '#5B7795',
  textMuted: '#8FA3B8',
  bgLight: '#F8F9FB',
  bgWhite: '#FAFBFD',
  borderLight: '#D8E5F2',
} as const;

export type KobraxColorToken = keyof typeof KOBRAX_TOKENS;

/**
 * Gradiente hero — DOS representaciones porque React Native NO soporta
 * gradientes CSS en StyleSheet:
 *  - web:    `heroCss` como background.
 *  - mobile: `heroColors` con <LinearGradient> (expo-linear-gradient).
 */
export const KOBRAX_GRADIENT = {
  heroCss: 'linear-gradient(160deg, #1A3A52 0%, #2B5A7D 60%, #5B7DBE 100%)',
  heroColors: ['#1A3A52', '#2B5A7D', '#5B7DBE'] as const,
  heroStart: { x: 0, y: 0 },
  heroEnd: { x: 1, y: 1 },
} as const;
