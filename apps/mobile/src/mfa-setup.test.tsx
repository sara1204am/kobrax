import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';

jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { LinearGradient: View };
});
const mockParams: { authed?: string } = {};
jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/route-step', () => ({ goToStep: jest.fn() }));
jest.mock('@/auth-service', () => ({
  authService: {
    mfaSetupStart: jest.fn(),
    mfaEnroll: jest.fn(),
    mfaSetupSkip: jest.fn(),
    mfaSetupVerify: jest.fn(),
    mfaVerify: jest.fn(),
  },
}));

import { authService } from '@/auth-service';
import { goToStep } from '@/route-step';
import MfaSetupScreen from '../app/(auth)/mfa-setup';

const svc = authService as unknown as Record<string, jest.Mock>;

beforeEach(() => {
  jest.clearAllMocks();
  delete mockParams.authed;
  svc.mfaSetupStart.mockResolvedValue({ secret: 'ABCD', otpauthUrl: 'otpauth://totp/Kobrax:a?secret=ABCD' });
  svc.mfaEnroll.mockResolvedValue({ secret: 'ABCD', otpauthUrl: 'otpauth://totp/Kobrax:a?secret=ABCD' });
});

describe('MfaSetupScreen · Lo hago después (M-LOG-53)', () => {
  it('durante el login muestra el botón y al tocarlo salta el MFA y sigue el paso que dice la API', async () => {
    svc.mfaSetupSkip.mockResolvedValue({ step: 'select_account' });
    render(<MfaSetupScreen />);
    fireEvent.press(await screen.findByText('Lo hago después'));
    await waitFor(() => expect(goToStep).toHaveBeenCalledWith('select_account'));
    expect(svc.mfaSetupSkip).toHaveBeenCalledTimes(1);
  });

  it('con sesión (?authed=1) no ofrece postergar: ofrece Volver', async () => {
    mockParams.authed = '1';
    render(<MfaSetupScreen />);
    expect(await screen.findByText('Volver')).toBeTruthy();
    expect(screen.queryByText('Lo hago después')).toBeNull();
  });

  it('si el skip falla muestra el error y no navega', async () => {
    svc.mfaSetupSkip.mockResolvedValue({ error: 'Sesión de login expirada' });
    render(<MfaSetupScreen />);
    fireEvent.press(await screen.findByText('Lo hago después'));
    expect(await screen.findByText('Sesión de login expirada')).toBeTruthy();
    expect(goToStep).not.toHaveBeenCalled();
  });
});
