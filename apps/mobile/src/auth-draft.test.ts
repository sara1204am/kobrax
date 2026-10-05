import { resendSecondsLeft, RESEND_SECONDS } from './auth-draft';

describe('resendSecondsLeft (reloj absoluto)', () => {
  const t = 1_000_000;
  it('sin envío no hay espera', () => expect(resendSecondsLeft(null, t)).toBe(0));
  it('recién enviado: la espera completa', () => expect(resendSecondsLeft(t, t)).toBe(RESEND_SECONDS));
  it('descuenta el tiempo real transcurrido', () => expect(resendSecondsLeft(t, t + 5_000)).toBe(25));
  it('redondea hacia arriba (no muestra 0 antes de tiempo)', () => expect(resendSecondsLeft(t, t + 29_100)).toBe(1));
  it('vencido → 0', () => expect(resendSecondsLeft(t, t + 31_000)).toBe(0));
  it('reloj hacia atrás no pasa del máximo', () => expect(resendSecondsLeft(t, t - 60_000)).toBe(RESEND_SECONDS));
});
