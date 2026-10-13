/**
 * Push remoto (FCM directo, Android) — D-4. El teléfono le da a la API su token de registro y la API le avisa: ruta asignada,
 * pedido de cambio y su respuesta, gestión asignada o cambiada, promesa por vencer.
 *
 * Reglas:
 *  · **Nunca rompe la app.** Sin Firebase configurado en el build, sin permiso o sin red, simplemente no hay push; todo lo
 *    demás (avisos locales, bandeja, cola) sigue igual.
 *  · **Idempotente.** Registrar el mismo `installationId` renueva la fila; se llama en cada arranque y cuando FCM rota el token.
 *  · **Al cerrar sesión se revoca** (mejor esfuerzo: sin red no se puede, y ahí cubre el `uid` del aviso, ver `push-target.ts`).
 *  · El permiso se pide **una sola vez** (`ensureNotificationPermission`): insistir después de un «no» desinstala la app.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { apiMutate } from './api-client';
import { appVersion } from './api';
import { ensureNotificationPermission } from './agenda-notifications';
import { nuevoId } from './ids';
import { getUserId } from './session';
import { isForUser, pushTarget, readPushData } from './push-target';

/** Debe coincidir con `PUSH_CHANNEL_ID` del servidor: es el canal de Android en el que FCM entrega el aviso. */
export const PUSH_CHANNEL_ID = 'kobrax-avisos';
const INSTALLATION_KEY = 'push.installationId';

export type RegisterOutcome = 'registered' | 'denied' | 'unavailable' | 'offline' | 'error';

/** Identidad estable de esta instalación. Se genera una vez y sobrevive a los cierres de sesión. */
export async function installationId(): Promise<string> {
  const saved = await SecureStore.getItemAsync(INSTALLATION_KEY);
  if (saved) return saved;
  const fresh = nuevoId();
  await SecureStore.setItemAsync(INSTALLATION_KEY, fresh);
  return fresh;
}

/** El canal de Android de los push remotos. Antes de pedir permiso: en Android 13+ el diálogo exige un canal creado. */
export async function configurePushChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(PUSH_CHANNEL_ID, {
    name: 'Avisos de Kobrax',
    importance: Notifications.AndroidImportance.HIGH,
  }).catch(() => undefined);
}

async function sendToken(token: string): Promise<RegisterOutcome> {
  const res = await apiMutate('/notifications/devices', 'POST', {
    installationId: await installationId(),
    token,
    platform: 'android',
    appVersion: appVersion(),
    deviceName: typeof Platform.constants === 'object' ? String((Platform.constants as { Model?: string }).Model ?? '').slice(0, 80) || undefined : undefined,
  });
  if (res.status === 'ok') return 'registered';
  if (res.status === 'offline') return 'offline';
  return 'error';
}

/**
 * Pide permiso (una vez), obtiene el token nativo de FCM y se lo da a la API. Se llama tras autenticarse; **no bloquea** el
 * arranque: quien la usa no la espera.
 */
export async function registerForPush(): Promise<RegisterOutcome> {
  if (Platform.OS !== 'android') return 'unavailable';
  try {
    await configurePushChannel();
    if (!(await ensureNotificationPermission())) return 'denied';
    // Token **nativo** de FCM (no el de Expo): no dependemos del servicio de push de Expo ni de EAS.
    const native = await Notifications.getDevicePushTokenAsync();
    const token = typeof native.data === 'string' ? native.data : '';
    if (!token) return 'unavailable';
    return await sendToken(token);
  } catch {
    // Sin google-services.json en el build, Firebase no inicializa: no hay token y no es un error del usuario.
    return 'unavailable';
  }
}

/** FCM rota el token de vez en cuando: se vuelve a registrar sin esperar al próximo arranque. */
export function listenPushTokenRefresh(): () => void {
  if (Platform.OS !== 'android') return () => undefined;
  const sub = Notifications.addPushTokenListener((t) => {
    if (typeof t.data === 'string' && t.data) void sendToken(t.data).catch(() => undefined);
  });
  return () => sub.remove();
}

/** Da de baja este teléfono. Mejor esfuerzo, **antes** de borrar la sesión (hace falta el token de acceso). */
export async function revokePushDevice(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await apiMutate(`/notifications/devices/${await installationId()}`, 'DELETE');
  } catch {
    /* sin red: cubre el `uid` del aviso y la reasignación del token en el próximo registro */
  }
}

/**
 * Cómo se muestra un push con la app abierta, y a quién: el aviso de OTRA persona (el teléfono cambió de usuario) no se
 * muestra. Se instala **una** vez; reemplaza al handler de avisos locales manteniendo su comportamiento.
 */
export function pushNotificationHandler(): Notifications.NotificationHandler {
  return {
    handleNotification: async (n) => {
      const data = readPushData(n.request.content.data);
      // Un aviso local de agenda no trae `uid`: sigue mostrándose como siempre.
      if (!data) return { shouldShowAlert: true, shouldPlaySound: false, shouldSetBadge: false };
      const mine = isForUser(data, await getUserId());
      return { shouldShowAlert: mine, shouldPlaySound: false, shouldSetBadge: false };
    },
  };
}

/** A dónde navegar al tocar una notificación, o `null` si no es un push propio o es de otra persona. */
export async function targetOfResponse(response: Notifications.NotificationResponse): Promise<string | null> {
  const data = readPushData(response.notification.request.content.data);
  if (!data) return null;
  if (!isForUser(data, await getUserId())) return null;
  return pushTarget(data);
}
