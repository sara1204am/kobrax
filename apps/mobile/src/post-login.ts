import { router } from 'expo-router';
import { authService } from './auth-service';
import { shouldOfferBiometricSetup } from './biometric';

/**
 * Único punto de decisión tras autenticarse (lo usan `goToStep('done')` y el splash).
 * Orden de prioridad:
 *   1. sin sesión válida server-side → login
 *   2. sin red pero sesión local vigente → modo offline (historia 14)
 *   3. cambio de contraseña forzado (historia 12)
 *   4. ofrecer activar biometría, una sola vez (historia 13)
 *   5. home
 */
export async function routeAfterAuth(): Promise<void> {
  const res = await authService.me();

  if (res.status === 'unauthenticated') {
    router.replace('/(auth)/login');
    return;
  }
  if (res.status === 'offline') {
    router.replace('/(app)/offline');
    return;
  }
  if (res.me.requiresPasswordChange) {
    router.replace('/(app)/force-password-change');
    return;
  }
  if (await shouldOfferBiometricSetup()) {
    router.replace('/(auth)/biometric-setup');
    return;
  }
  router.replace('/(tabs)');
}
