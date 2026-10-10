import { TextInput } from 'react-native';
import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';

const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void mockStore.delete(k)),
}));
jest.mock('expo-router', () => ({ router: { replace: jest.fn(), push: jest.fn() } }));
jest.mock('@/route-step', () => ({ goToStep: jest.fn() }));
jest.mock('@/session', () => ({ getSession: jest.fn(async () => null), isSessionValid: jest.fn(() => false) }));
jest.mock('@/biometric', () => ({ biometricLabel: jest.fn(), isBiometricEnabled: jest.fn(async () => false) }));
jest.mock('@/auth-service', () => ({ authService: { login: jest.fn() } }));

import { authService } from '@/auth-service';
import { goToStep } from '@/route-step';
import { router } from 'expo-router';
import { saveForgotDraft } from '@/auth-draft';
import LoginScreen from '../app/(auth)/login';

const mockLogin = authService.login as jest.Mock;
const EMAIL = 'ejemplo@empresa.com';
const PASS = 'Ingresa tu contraseña';

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
});

describe('LoginScreen · validación por campo (M-LOG-18)', () => {
  it('correo sin arroba: mensaje bajo el campo y NO llama a la API', async () => {
    render(<LoginScreen />);
    fireEvent.changeText(screen.getByPlaceholderText(EMAIL), 'collectorkobrax.demo');
    fireEvent.changeText(screen.getByPlaceholderText(PASS), 'Kobrax123!');
    fireEvent.press(screen.getByText('Iniciar sesión'));
    expect(await screen.findByText('El formato del correo no es válido')).toBeTruthy();
    expect(screen.queryByText('Ingresa tu contraseña', { exact: true })).toBeNull();
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('campos vacíos: pide correo y contraseña', async () => {
    render(<LoginScreen />);
    fireEvent.press(screen.getByText('Iniciar sesión'));
    expect(await screen.findByText('Ingresa tu correo electrónico')).toBeTruthy();
    // El placeholder también dice "Ingresa tu contraseña": se busca el aviso por su rol.
    expect(screen.getByRole('alert', { name: 'Ingresa tu contraseña' })).toBeTruthy();
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('corregir el campo borra su aviso', async () => {
    render(<LoginScreen />);
    fireEvent.press(screen.getByText('Iniciar sesión'));
    await screen.findByText('Ingresa tu correo electrónico');
    fireEvent.changeText(screen.getByPlaceholderText(EMAIL), 'a');
    expect(screen.queryByText('Ingresa tu correo electrónico')).toBeNull();
  });

  it('error de la API con campo → aviso bajo el campo, sin banner general', async () => {
    mockLogin.mockResolvedValue({ error: 'Validación fallida', fieldErrors: { email: 'El formato del correo no es válido' } });
    render(<LoginScreen />);
    fireEvent.changeText(screen.getByPlaceholderText(EMAIL), 'a@b.co');
    fireEvent.changeText(screen.getByPlaceholderText(PASS), 'x');
    fireEvent.press(screen.getByText('Iniciar sesión'));
    expect(await screen.findByText('El formato del correo no es válido')).toBeTruthy();
    expect(screen.queryByText('Validación fallida')).toBeNull();
  });

  it('error de servidor sin campos (credenciales) → banner general', async () => {
    mockLogin.mockResolvedValue({ error: 'Credenciales inválidas' });
    render(<LoginScreen />);
    fireEvent.changeText(screen.getByPlaceholderText(EMAIL), 'a@b.co');
    fireEvent.changeText(screen.getByPlaceholderText(PASS), 'x');
    fireEvent.press(screen.getByText('Iniciar sesión'));
    expect(await screen.findByText('Credenciales inválidas')).toBeTruthy();
  });

  it('datos válidos: llama a la API con el correo recortado y avanza', async () => {
    mockLogin.mockResolvedValue({ step: 'done' });
    render(<LoginScreen />);
    fireEvent.changeText(screen.getByPlaceholderText(EMAIL), ' a@b.co ');
    fireEvent.changeText(screen.getByPlaceholderText(PASS), 'x');
    fireEvent.press(screen.getByText('Iniciar sesión'));
    await waitFor(() => expect(goToStep).toHaveBeenCalledWith('done'));
    expect(mockLogin).toHaveBeenCalledWith('a@b.co', 'x');
  });
});

describe('LoginScreen · teclado (M-LOG-04)', () => {
  it('correo: tecla "Siguiente" que no cierra el teclado y enfoca la contraseña', () => {
    render(<LoginScreen />);
    const email = screen.getByPlaceholderText(EMAIL);
    expect(email.props.returnKeyType).toBe('next');
    expect(email.props.blurOnSubmit).toBe(false);
    // El mock de TextInput de jest-expo expone `focus` en el prototipo.
    const focus = jest.spyOn(TextInput.prototype as unknown as { focus: () => void }, 'focus');
    fireEvent(email, 'submitEditing');
    expect(focus).toHaveBeenCalledTimes(1);
    focus.mockRestore();
  });

  it('contraseña: tecla "Ir" que envía el formulario', async () => {
    mockLogin.mockResolvedValue({ step: 'done' });
    render(<LoginScreen />);
    fireEvent.changeText(screen.getByPlaceholderText(EMAIL), 'a@b.co');
    const pass = screen.getByPlaceholderText(PASS);
    fireEvent.changeText(pass, 'x');
    expect(pass.props.returnKeyType).toBe('go');
    fireEvent(pass, 'submitEditing');
    await waitFor(() => expect(mockLogin).toHaveBeenCalledWith('a@b.co', 'x'));
  });
});

describe('LoginScreen · autofill del gestor de contraseñas (M-LOG-39)', () => {
  it('correo = usuario y contraseña = current-password, visibles para el servicio de autofill', () => {
    render(<LoginScreen />);
    const email = screen.getByPlaceholderText(EMAIL);
    const pass = screen.getByPlaceholderText(PASS);
    expect(email.props.autoComplete).toBe('username');
    expect(email.props.textContentType).toBe('username');
    expect(email.props.importantForAutofill).toBe('yes');
    expect(pass.props.autoComplete).toBe('current-password');
    expect(pass.props.textContentType).toBe('password');
    expect(pass.props.importantForAutofill).toBe('yes');
  });
});

describe('LoginScreen · no pierde lo que había al recrearse la app (M-LOG-12 / M-FOR-29)', () => {
  it('guarda el correo mientras se escribe y lo restaura al montar de nuevo', async () => {
    const first = render(<LoginScreen />);
    fireEvent.changeText(screen.getByPlaceholderText(EMAIL), 'ana@kobrax.demo');
    await waitFor(() => expect(mockStore.size).toBe(1));
    first.unmount();

    render(<LoginScreen />);
    await waitFor(() => expect(screen.getByPlaceholderText(EMAIL).props.value).toBe('ana@kobrax.demo'));
    expect(screen.getByPlaceholderText(PASS).props.value).toBe(''); // la contraseña nunca se guarda
  });

  it('si había un "Revisa tu correo" pendiente, vuelve a esa pantalla', async () => {
    await saveForgotDraft('ana@kobrax.demo', Date.now() - 5000);
    render(<LoginScreen />);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/(auth)/forgot-password'));
  });

  it('un borrador de recuperación sin enviar no redirige', async () => {
    await saveForgotDraft('ana@kobrax.demo', null);
    render(<LoginScreen />);
    await waitFor(() => expect(screen.getByPlaceholderText(EMAIL)).toBeTruthy());
    expect(router.push).not.toHaveBeenCalled();
  });

  it('al iniciar sesión se borra el correo guardado', async () => {
    mockLogin.mockResolvedValue({ step: 'done' });
    render(<LoginScreen />);
    fireEvent.changeText(screen.getByPlaceholderText(EMAIL), 'a@b.co');
    fireEvent.changeText(screen.getByPlaceholderText(PASS), 'x');
    await waitFor(() => expect(mockStore.size).toBe(1));
    fireEvent.press(screen.getByText('Iniciar sesión'));
    await waitFor(() => expect(mockStore.size).toBe(0));
  });
});
