import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

/**
 * Biometría (EPIC-F2b historia 13). PRINCIPIO DE SEGURIDAD: la biometría **solo
 * desbloquea el token local** ya guardado en SecureStore; NUNCA autentica contra la
 * API ni sustituye el login. Si la biometría falla, se cae a re-login con contraseña.
 *
 * Flags persistidos:
 * - `k_biometric_enabled`: el usuario activó el desbloqueo biométrico.
 * - `k_biometric_prompt_shown`: ya se le ofreció una vez (no volver a insistir).
 */
const KEY = {
  enabled: 'k_biometric_enabled',
  promptShown: 'k_biometric_prompt_shown',
} as const;

/** Hay hardware biométrico Y el usuario tiene huellas/rostro registrados en el SO. */
export async function hasBiometricHardware(): Promise<boolean> {
  const [hasHardware, isEnrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ]);
  return hasHardware && isEnrolled;
}

/** Etiqueta legible del método disponible (para los textos de UI). */
export async function biometricLabel(): Promise<string> {
  const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return 'Face ID';
  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return 'huella digital';
  if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) return 'reconocimiento de iris';
  return 'biometría';
}

export async function isBiometricEnabled(): Promise<boolean> {
  return (await SecureStore.getItemAsync(KEY.enabled)) === '1';
}

export async function setBiometricEnabled(on: boolean): Promise<void> {
  if (on) await SecureStore.setItemAsync(KEY.enabled, '1');
  else await SecureStore.deleteItemAsync(KEY.enabled);
}

export async function wasBiometricPromptShown(): Promise<boolean> {
  return (await SecureStore.getItemAsync(KEY.promptShown)) === '1';
}

export async function markBiometricPromptShown(): Promise<void> {
  await SecureStore.setItemAsync(KEY.promptShown, '1');
}

/** Limpia los flags biométricos (lo llama el logout junto a `clearSession`). */
export async function clearBiometric(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(KEY.enabled),
    SecureStore.deleteItemAsync(KEY.promptShown),
  ]);
}

/** Lanza el prompt biométrico del SO. Devuelve true solo si el usuario se autenticó. */
export async function authenticateBiometric(reason: string): Promise<boolean> {
  const res = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    cancelLabel: 'Usar contraseña',
    disableDeviceFallback: false, // permite PIN del dispositivo como respaldo
  });
  return res.success;
}

/**
 * ¿Ofrecer activar la biometría tras el login? Solo una vez, si hay hardware
 * enrolado y aún no está activada.
 */
export async function shouldOfferBiometricSetup(): Promise<boolean> {
  if (await isBiometricEnabled()) return false;
  if (await wasBiometricPromptShown()) return false;
  return hasBiometricHardware();
}
