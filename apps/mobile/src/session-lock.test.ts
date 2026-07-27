/**
 * El guard de re-bloqueo al volver a primer plano. Existe porque la versión sin ventana de gracia
 * rebotaba al cobrador al splash (→ Inicio) al volver del permiso de GPS, la cámara o WhatsApp,
 * borrándole el formulario a medio llenar.
 */
import { LOCK_GRACE_MS, shouldRelock, type StoredSession } from './session';

const session = (validForMs: number): StoredSession => ({
  accessToken: 'a',
  refreshToken: 'r',
  validUntil: Date.now() + validForMs,
});

const vigente = () => session(60 * 60 * 1000);
const vencida = () => session(-1);

describe('shouldRelock', () => {
  it('NO rebota al volver de un diálogo de permisos / cámara (ausencia corta)', () => {
    expect(shouldRelock({ session: vigente(), awayMs: 800, biometricEnabled: true })).toBe(false);
  });

  it('rebota si el usuario estuvo fuera más que la ventana de gracia', () => {
    expect(shouldRelock({ session: vigente(), awayMs: LOCK_GRACE_MS, biometricEnabled: true })).toBe(true);
  });

  it('sin biometría activa no rebota, por larga que sea la ausencia', () => {
    expect(shouldRelock({ session: vigente(), awayMs: 24 * 60 * 60 * 1000, biometricEnabled: false })).toBe(false);
  });

  it('la ventana de inactividad vencida manda sobre la gracia', () => {
    expect(shouldRelock({ session: vencida(), awayMs: 0, biometricEnabled: false })).toBe(true);
  });

  it('sin sesión no rebota: ya está en login', () => {
    expect(shouldRelock({ session: null, awayMs: 999_999, biometricEnabled: true })).toBe(false);
  });
});
