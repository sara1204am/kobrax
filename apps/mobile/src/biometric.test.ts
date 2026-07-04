/** In-memory SecureStore (los flags biométricos se guardan aquí). */
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    getItemAsync: jest.fn(async (k: string) => (store.has(k) ? store.get(k)! : null)),
    setItemAsync: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    deleteItemAsync: jest.fn(async (k: string) => void store.delete(k)),
  };
});

jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(),
  isEnrolledAsync: jest.fn(),
  supportedAuthenticationTypesAsync: jest.fn(async () => []),
  authenticateAsync: jest.fn(),
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 },
}));

import * as LA from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import {
  authenticateBiometric,
  hasBiometricHardware,
  isBiometricEnabled,
  markBiometricPromptShown,
  setBiometricEnabled,
  shouldOfferBiometricSetup,
} from './biometric';

const mockLA = LA as jest.Mocked<typeof LA>;

beforeEach(() => {
  jest.clearAllMocks();
  (SecureStore as unknown as { __store: Map<string, string> }).__store.clear();
});

describe('hasBiometricHardware', () => {
  it('true solo si hay hardware Y huellas/rostro enrolados en el SO', async () => {
    mockLA.hasHardwareAsync.mockResolvedValue(true);
    mockLA.isEnrolledAsync.mockResolvedValue(true);
    expect(await hasBiometricHardware()).toBe(true);

    mockLA.isEnrolledAsync.mockResolvedValue(false);
    expect(await hasBiometricHardware()).toBe(false);
  });
});

describe('flags de biometría', () => {
  it('setBiometricEnabled persiste y se puede leer; false lo limpia', async () => {
    expect(await isBiometricEnabled()).toBe(false);
    await setBiometricEnabled(true);
    expect(await isBiometricEnabled()).toBe(true);
    await setBiometricEnabled(false);
    expect(await isBiometricEnabled()).toBe(false);
  });
});

describe('shouldOfferBiometricSetup (oferta única)', () => {
  it('no ofrece si ya está activada', async () => {
    await setBiometricEnabled(true);
    expect(await shouldOfferBiometricSetup()).toBe(false);
  });

  it('no ofrece si ya se mostró el prompt antes', async () => {
    mockLA.hasHardwareAsync.mockResolvedValue(true);
    mockLA.isEnrolledAsync.mockResolvedValue(true);
    await markBiometricPromptShown();
    expect(await shouldOfferBiometricSetup()).toBe(false);
  });

  it('ofrece cuando hay hardware enrolado, sin activar y sin haberlo mostrado', async () => {
    mockLA.hasHardwareAsync.mockResolvedValue(true);
    mockLA.isEnrolledAsync.mockResolvedValue(true);
    expect(await shouldOfferBiometricSetup()).toBe(true);
  });
});

describe('authenticateBiometric', () => {
  it('refleja el resultado del prompt del SO', async () => {
    mockLA.authenticateAsync.mockResolvedValue({ success: true } as never);
    expect(await authenticateBiometric('Desbloquea')).toBe(true);
    mockLA.authenticateAsync.mockResolvedValue({ success: false, error: 'user_cancel' } as never);
    expect(await authenticateBiometric('Desbloquea')).toBe(false);
  });
});
