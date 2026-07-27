import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';

jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { LinearGradient: View };
});
jest.mock('expo-router', () => ({ router: { replace: jest.fn(), push: jest.fn() } }));
jest.mock('@/auth-service', () => ({ authService: { forgotPassword: jest.fn() } }));

// Vive en `src/` y no junto a la pantalla: todo archivo bajo `app/` lo bundlea expo-router como
// ruta (su require.context sólo excluye `+api`/`+html`), así que un `.test.tsx` ahí adentro
// ejecutaba `jest.mock()` en Hermes → "Property 'jest' doesn't exist" al arrancar la app.
import { authService } from '@/auth-service';
import ForgotPasswordScreen from '../app/(auth)/forgot-password';

const mockForgot = authService.forgotPassword as jest.Mock;

// Fake timers: la confirmación monta un countdown con setTimeout recursivo que, con
// timers reales, impide a RNTL estabilizar `findBy`.
beforeEach(() => {
  jest.clearAllMocks();
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
