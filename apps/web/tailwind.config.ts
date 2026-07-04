import type { Config } from 'tailwindcss';

/** Tokens Kobrax (única fuente: packages/shared/src/design/tokens.ts + design-system.md). */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'k-navy': '#1A3A52',
        'k-slate': '#2B5A7D',
        'k-periwinkle': '#5B7DBE',
        'k-light-bg': '#D8E5F2',
        'k-purple': '#7B68D6',
        'k-soft-periw': '#8B9FD6',
        'k-highlight': '#F0ECFF',
        'k-very-light-purp': '#E0D8F2',
        'k-bg': '#F8F9FB',
        'k-white': '#FAFBFD',
        'k-text': '#1A2B3E',
        'k-text-2': '#5B7795',
        'k-muted': '#8FA3B8',
        'k-border': '#D8E5F2',
        'k-success': '#27AE60',
        'k-success-bg': '#E8F8F0',
        'k-danger': '#DC3545',
        'k-danger-bg': '#FCE8E8',
        'k-warning': '#F59E0B',
        'k-warning-bg': '#FFF3CD',
        'k-warning-text': '#7A5C00',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      backgroundImage: {
        'k-hero': 'linear-gradient(160deg, #1A3A52 0%, #2B5A7D 60%, #5B7DBE 100%)',
      },
      boxShadow: {
        'k-focus': '0 0 0 3px rgba(91,125,190,.15)',
        'k-focus-error': '0 0 0 3px rgba(220,53,69,.15)',
        'k-card': '0 8px 30px rgba(26,58,82,.08)',
      },
    },
  },
  plugins: [],
};

export default config;
