import { router } from 'expo-router';
import { authService } from './auth-service';
import { shouldOfferBiometricSetup } from './biometric';
import { shouldOfferImport } from './import.service';
import { registerForPush } from './push.service';
import { consumePendingTarget } from './push-pending';

/**
 * Único punto de decisión tras autenticarse (lo usan `goToStep('done')` y el splash).
 * Orden de prioridad:
 *   1. sin sesión válida server-side → login
 *   2. sin red pero sesión local vigente → modo offline (historia 14)
 *   3. cambio de contraseña forzado (historia 12)
 *   4. ofrecer activar biometría, una sola vez (historia 13)
 *   5. ofrecer el import del día, si el tenant lo pidió (§6.7 del plan import)
 *   6. home
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
  // Push remoto: con sesión válida se registra este teléfono. No bloquea el arranque ni puede romperlo.
  void registerForPush().catch(() => undefined);
  if (await shouldOfferBiometricSetup()) {
    router.replace('/(auth)/biometric-setup');
    return;
  }
  // El gate del import va ÚLTIMO: es lo único de esta lista que el usuario puede saltar, así que
  // no debe adelantarse a nada obligatorio. `shouldOfferImport` falla cerrado (si no puede leer
  // la config, no interrumpe el login) — nunca deja al cobrador trabado por una config.
  if (await shouldOfferImport()) {
    router.replace('/import');
    return;
  }
  router.replace('/(tabs)');
  // Si la app se abrió tocando un aviso, ahora que hay sesión se va a su pantalla.
  const pending = consumePendingTarget();
  if (pending) router.push(pending as never);
}
