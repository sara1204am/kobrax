# Design System Kobrax — Especificación vinculante

> **Fuente de verdad única** de la identidad visual. La definen
> `packages/shared/src/design/tokens.ts`; web (`tailwind.config`) y mobile
> (NativeWind config) **importan de ahí**, no redefinen valores.
> Vinculante para toda pantalla generada (auth, dashboard, mobile).

## 1. Filosofía
Fintech para entidades financieras, cooperativas y cobradores en campo:
**confianza institucional** (navy profundo), **modernidad** (periwinkle/purple como
acento, no base), **claridad operacional** (inputs grandes, botones altos),
**seguridad visible** (badge TLS, candados). Navy es el único color dominante;
todo lo demás es acento o estado. El cobrador usa guantes: touch targets ≥ 48px.

## 2. Tokens de color (`packages/shared/src/design/tokens.ts`)

```typescript
export const KOBRAX_TOKENS = {
  // Primarios — identidad
  navy:        '#1A3A52', // hero, btn primary, sidebar, header, splash
  slate:       '#2B5A7D', // gradiente mid, hover activo
  periwinkle:  '#5B7DBE', // gradiente fin, focus ring, info
  lightBlueBg: '#D8E5F2', // borders, inputs default, fondos claros
  // Acentos purple
  purpleAccent:   '#7B68D6', // links, MFA, iconos activos
  softPeriw:      '#8B9FD6',
  veryLightPurp:  '#E0D8F2',
  purpleHighlight:'#F0ECFF', // btn ghost bg, badges info
  // Estados operativos (NUNCA para decoración)
  success:   '#27AE60', successBg: '#E8F8F0',
  danger:    '#DC3545', dangerBg:  '#FCE8E8',
  warning:   '#F59E0B', warningBg: '#FFF3CD', warningText: '#7A5C00',
  // Neutros
  textPrimary:   '#1A2B3E',
  textSecondary: '#5B7795',
  textMuted:     '#8FA3B8',
  bgLight:       '#F8F9FB',
  bgWhite:       '#FAFBFD',
  borderLight:   '#D8E5F2',
} as const;

// Gradiente hero — DOS representaciones (web ≠ mobile):
export const KOBRAX_GRADIENT = {
  // Web: string CSS para background.
  heroCss: 'linear-gradient(160deg, #1A3A52 0%, #2B5A7D 60%, #5B7DBE 100%)',
  // Mobile: array de colores para <LinearGradient> (expo-linear-gradient).
  // ⚠️ React Native NO soporta gradientes CSS en StyleSheet.
  heroColors: ['#1A3A52', '#2B5A7D', '#5B7DBE'] as const,
  heroStart: { x: 0, y: 0 },
  heroEnd:   { x: 1, y: 1 }, // ~160°
} as const;
```

**Reglas de color:** navy → primary/sidebar/hero. purple → links/MFA/activo.
success/danger/warning **solo** estados. Nunca color fuera de la paleta (si falta,
se agrega aquí primero). Contraste objetivo WCAG AA (texto blanco sobre hero >7:1 ✅).

## 3. Tipografía
**Web:** Inter. **Mobile:** SF Pro (iOS) / Roboto (Android).

| Token | Size (web/mobile) | Weight | Color | Uso |
|-------|-------------------|--------|-------|-----|
| `heading-hero` | 28 / 24 | 600 | #FFFFFF | H1 sobre hero |
| `heading-1` | 24 | 600 | navy | títulos de página |
| `heading-2` | 20 | 600 | navy | secciones |
| `heading-3` | 17 | 500 | textPrimary | subsecciones/cards |
| `body` | 15 | 400 | textPrimary | contenido |
| `body-sm` | 13 | 400 | textSecondary | helpers |
| `caption` | 11 | 400 | textMuted | legales/footers |
| `label` | 11 | 600 | textPrimary | labels (uppercase) |
| `link` | 13 | 500 | purpleAccent | links |
| `mono` | 13 | 400 | textPrimary | códigos TOTP/hashes |

Mínimo mobile 11px; body mobile **nunca < 15px** (luz solar/campo). Peso máx 600.
Links siempre `purpleAccent`, nunca azul de browser.

## 4. Espaciado (grid 4px) y radios
`4/8/12/16/20/24/28/32/40/48`. Radios: pills 4 · inputs 6/10 · botones 10 ·
cards 12/16 · modales/bottom-sheet 24 · hero wave 28.

## 5. Componentes de auth (specs)
- **Hero:** gradiente (token) + wave blanca radius 36 arriba. Web `padding 48 24 60`.
  Mobile: `<LinearGradient colors={KOBRAX_GRADIENT.heroColors} ...>`.
- **Btn primary:** h 48 (web) / 52 (mobile), bg navy, radius 10, weight 500.
  hover→slate, active→scale .98, disabled→opacity .5. Loading: spinner blanco 20px
  (nunca disabled sin feedback).
- **Input:** h 48/52, border 1.5px lightBlueBg radius 10, padding-left 42 (icono).
  focus→periwinkle + ring `rgba(91,125,190,.15)`. error→danger + ring rojo.
- **Btn alterno (huella/authenticator):** h 48, bg blanco, border lightBlueBg, icono 18 + texto 13 textSecondary.
- **OTP input (MFA):** 44×52, mono 20/600, filled→border navy bg bgLight, error→shake.
- **Banner error:** bg dangerBg, border-left 3px danger, `role="alert"`.
- **Banner offline:** bg warningBg, texto warningText 11px.
- **Footer seguridad:** "🔒 Conexión cifrada TLS 1.3" — **siempre visible** (trust fintech).

## 6. Iconografía
Tabler (web) / Ionicons (mobile). user, lock, eye/eye-off, fingerprint, shield-lock,
wifi-off, alert-circle, circle-check, face-id. Tamaños 14–18px, color textMuted/textSecondary.

## 7. Animaciones (respetan `prefers-reduced-motion` / Reduce Motion)
fade página 200ms · btn hover 150ms · active scale .98 100ms · input focus 150ms ·
error shake ±4px ×3 300ms · OTP auto-avance inmediato · spinner 800ms · toast slideUp+fade 300ms.
**Si el usuario pide reduce-motion:** sin shake/scale/slide; solo opacidad o cambios instantáneos.
Mobile: el prompt biométrico usa la animación nativa del OS (no animar).

## 8. DoD visual por pantalla
- [ ] Colores solo de `KOBRAX_TOKENS`; gradiente solo en hero/splash.
- [ ] Tipografía según escala (§3); touch targets ≥ 48px mobile.
- [ ] Btn primary 48/52 navy; inputs 1.5px + icono; hero con wave.
- [ ] Todos los estados: idle/loading/error/success.
- [ ] `role="alert"` en errores; focus ring visible (teclado); contraste AA.
- [ ] `prefers-reduced-motion` respetado.
- [ ] Footer de seguridad y banner offline (si aplica) visibles.
- [ ] Spinner en loading (nunca disabled sin feedback).
