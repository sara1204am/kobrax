import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';

jest.mock('expo-router', () => ({ router: { replace: jest.fn(), push: jest.fn() } }));
jest.mock('@/route-step', () => ({ goToStep: jest.fn() }));
jest.mock('@/session', () => ({ getSession: jest.fn(async () => null), isSessionValid: jest.fn(() => false) }));
jest.mock('@/biometric', () => ({ biometricLabel: jest.fn(), isBiometricEnabled: jest.fn(async () => false) }));
jest.mock('@/auth-service', () => ({ authService: { login: jest.fn() } }));

import { authService } from '@/auth-service';
import { goToStep } from '@/route-step';
import LoginScreen from '../app/(auth)/login';

const mockLogin = authService.login as jest.Mock;
const EMAIL = 'ejemplo@empresa.com';
const PASS = 'Ingresa tu contraseña';

beforeEach(() => jest.clearAllMocks());

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
