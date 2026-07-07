/**
 * Tema Kobrax para mobile. Los colores reflejan `packages/shared/src/design/tokens.ts`
 * (se inlinean para no depender de la resolución del workspace en runtime de Metro).
 * El gradiente hero usa `heroColors` (RN no soporta gradientes CSS).
 */
export const COLORS = {
  navy: '#1A3A52',
  slate: '#2B5A7D',
  periwinkle: '#5B7DBE',
  lightBg: '#D8E5F2',
  purple: '#7B68D6',
  highlight: '#F0ECFF',
  bg: '#F8F9FB',
  // Divergencia intencional (P0 D2): shared define `bgWhite:#FAFBFD`, pero en campo usamos
  // blanco puro para máximo contraste de cards bajo el sol (regla §3.3.1). No es un olvido de parity.
  white: '#FFFFFF',
  text: '#1A2B3E',
  text2: '#5B7795',
  muted: '#8FA3B8',
  border: '#D8E5F2',
  success: '#27AE60',
  successBg: '#E8F8F0',
  danger: '#DC3545',
  dangerBg: '#FCE8E8',
  warning: '#F59E0B',
  warningBg: '#FFF3CD',
  warningText: '#7A5C00',
} as const;

/** Gradiente hero (array para <LinearGradient>). */
export const HERO_GRADIENT = ['#1A3A52', '#2B5A7D', '#5B7DBE'] as const;

/** Escala tipográfica mobile (§3 — body nunca < 15). */
export const TYPE = {
  h1: { fontSize: 24, fontWeight: '600' as const, color: COLORS.navy },
  h2: { fontSize: 20, fontWeight: '600' as const, color: COLORS.navy },
  h3: { fontSize: 17, fontWeight: '600' as const, color: COLORS.text },
  body: { fontSize: 15, fontWeight: '400' as const, color: COLORS.text },
  secondary: { fontSize: 13, fontWeight: '400' as const, color: COLORS.text2 },
  caption: { fontSize: 12, fontWeight: '400' as const, color: COLORS.muted },
  link: { fontSize: 13, fontWeight: '500' as const, color: COLORS.purple },
} as const;

export const SPACING = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const RADIUS = { input: 10, button: 10, card: 16, pill: 999 } as const;
