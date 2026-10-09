import { act, render, fireEvent, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';

jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { LinearGradient: View };
});
const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void mockStore.delete(k)),
}));
jest.mock('expo-router', () => ({ router: { replace: jest.fn(), push: jest.fn() } }));
jest.mock('@/auth-service', () => ({ authService: { forgotPassword: jest.fn() } }));

// Vive en `src/` y no junto a la pantalla: todo archivo bajo `app/` lo bundlea expo-router como
// ruta (su require.context sólo excluye `+api`/`+html`), así que un `.test.tsx` ahí adentro
// ejecutaba `jest.mock()` en Hermes → "Property 'jest' doesn't exist" al arrancar la app.
import { authService } from '@/auth-service';
import { DRAFT_TTL_MS, loadForgotDraft, saveForgotDraft } from '@/auth-draft';
import ForgotPasswordScreen from '../app/(auth)/forgot-password';

const mockForgot = authService.forgotPassword as jest.Mock;

// Fake timers: la confirmación monta un countdown con setTimeout recursivo que, con
// timers reales, impide a RNTL estabilizar `findBy`.
let appStateListener: ((s: string) => void) | undefined;
beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  appStateListener = undefined;
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, cb: (s: string) => void) => {
    appStateListener = cb;
    return { remove: jest.fn() };
  }) as never);
  jest.useFakeTimers();
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('ForgotPasswordScreen (mobile)', () => {
  it('envía el correo (normalizado) y muestra confirmación con el email enmascarado', async () => {
    mockForgot.mockResolvedValue({ ok: true });
    render(<ForgotPasswordScreen />);

    fireEvent.changeText(screen.getByPlaceholderText('tu@empresa.com'), 'Ana@Kobrax.demo');
    fireEvent.press(screen.getByText('Enviar enlace'));

    expect(await screen.findByText('Revisa tu correo')).toBeTruthy();
    expect(mockForgot).toHaveBeenCalledWith('ana@kobrax.demo'); // trim + lowercase
    expect(screen.getByText('a***@kobrax.demo')).toBeTruthy(); // email parcial (§6)
  });

  it('muestra el error del backend sin avanzar a la confirmación', async () => {
    mockForgot.mockResolvedValue({ error: 'Demasiados intentos. Espera una hora antes de reintentar.' });
    render(<ForgotPasswordScreen />);

    fireEvent.changeText(screen.getByPlaceholderText('tu@empresa.com'), 'ana@kobrax.demo');
    fireEvent.press(screen.getByText('Enviar enlace'));

    expect(await screen.findByText(/demasiados intentos/i)).toBeTruthy();
    expect(screen.queryByText('Revisa tu correo')).toBeNull();
  });
});

describe('ForgotPasswordScreen · sobrevive a que la app pase al fondo (M-FOR-29)', () => {
  it('restaura "Revisa tu correo" con la cuenta según el reloj absoluto (20s → ~15s tras 5s)', async () => {
    const t0 = Date.now();
    await saveForgotDraft('ana@kobrax.demo', t0 - 15_000); // enviado hace 15 s → faltan 15
    render(<ForgotPasswordScreen />);
    expect(await screen.findByText('Revisa tu correo')).toBeTruthy();
    expect(screen.getByText(/Reenviar en (14|15)s/)).toBeTruthy();
    expect(screen.getByText('a***@kobrax.demo')).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(5_000);
    });
    expect(await screen.findByText(/Reenviar en (9|10)s/)).toBeTruthy();
    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    expect(await screen.findByText('Reenviar enlace')).toBeTruthy();
  });

  it('al volver a primer plano recalcula de inmediato aunque los timers estuvieron congelados', async () => {
    mockForgot.mockResolvedValue({ ok: true });
    render(<ForgotPasswordScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('tu@empresa.com'), 'ana@kobrax.demo');
    fireEvent.press(screen.getByText('Enviar enlace'));
    expect(await screen.findByText('Reenviar en 30s')).toBeTruthy();

    // El reloj avanza 12 s sin que corra ningún timer (app en el fondo).
    jest.setSystemTime(Date.now() + 12_000);
    act(() => {
      appStateListener?.('active');
    });
    expect(await screen.findByText(/Reenviar en (17|18)s/)).toBeTruthy();
  });

  it('guarda el envío para poder restaurarlo y "Volver a iniciar sesión" lo borra', async () => {
    mockForgot.mockResolvedValue({ ok: true });
    render(<ForgotPasswordScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('tu@empresa.com'), 'ana@kobrax.demo');
    fireEvent.press(screen.getByText('Enviar enlace'));
    await screen.findByText('Revisa tu correo');
    const saved = await loadForgotDraft();
    expect(saved?.email).toBe('ana@kobrax.demo');
    expect(saved?.sentAt).not.toBeNull();

    fireEvent.press(screen.getByText('Volver a iniciar sesión'));
    expect(await loadForgotDraft()).toBeNull();
  });

  it('un borrador vencido no se restaura', async () => {
    await saveForgotDraft('ana@kobrax.demo', Date.now() - 1000, Date.now() - DRAFT_TTL_MS - 1000);
    render(<ForgotPasswordScreen />);
    expect(await screen.findByText('Recuperar contraseña')).toBeTruthy();
  });
});
