/**
 * Fotos de la cola, en un lugar que **no se borra solo**.
 *
 * `expo-image-picker` deja la foto en la carpeta de caché de la app (`cacheDirectory`), que Android puede
 * vaciar cuando le falta espacio y que se limpia al actualizar. Una visita o un cobro encolado sin señal puede
 * esperar horas: si la foto desaparece antes de subir, se pierde la evidencia de que el cobrador estuvo ahí.
 * Por eso, al encolar, se COPIA a `documentDirectory/queue-photos/` y se encola esa ruta.
 *
 * Reglas:
 *  · la copia se borra cuando la foto subió bien o cuando el cobrador descarta el ítem — nunca antes;
 *  · si la copia falla (disco lleno, URI que no se deja copiar) se encola la ruta original: peor es no encolar;
 *  · al enviar, `photoExists` decide si la foto sigue ahí. Si no, el fallo es **explícito** (ver `queue.ts`).
 */
import * as FileSystem from 'expo-file-system';
import { nuevoId } from './ids';

/** Una foto todavía en el teléfono. Se sube al drenar; **se guarda la ruta, no los bytes**. */
export interface PendingPhoto {
  uri: string;
  mimeType?: string;
}

const DIR_NAME = 'queue-photos/';

function queueDir(): string | null {
  const base = FileSystem.documentDirectory;
  return base ? `${base}${DIR_NAME}` : null;
}

/** ¿Esta ruta ya es una copia durable de la cola? */
export function isQueuePhoto(uri: string): boolean {
  const dir = queueDir();
  return !!dir && uri.startsWith(dir);
}

function extensionOf(photo: PendingPhoto): string {
  const m = /\.([A-Za-z0-9]{2,5})(?:\?.*)?$/.exec(photo.uri);
  if (m) return m[1]!.toLowerCase();
  return photo.mimeType === 'image/png' ? 'png' : 'jpg';
}

/** Copia la foto a la carpeta durable. Devuelve la foto con la ruta nueva (o la original si no se pudo copiar). */
export async function persistPhoto(photo: PendingPhoto): Promise<PendingPhoto> {
  const dir = queueDir();
  if (!dir || isQueuePhoto(photo.uri)) return photo;
  try {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    const to = `${dir}${nuevoId()}.${extensionOf(photo)}`;
    await FileSystem.copyAsync({ from: photo.uri, to });
    return { ...photo, uri: to };
  } catch {
    return photo;
  }
}

/**
 * Cuánto ocupan las fotos pendientes de subir (D-9). Mide la carpeta de la cola: no hay otro lugar donde lo pendiente
 * guarde fotos. Nunca lanza: si el sistema de archivos falla devuelve 0 (y no se bloquea al cobrador por un diagnóstico).
 */
export async function queuePhotosUsage(): Promise<{ count: number; bytes: number }> {
  const dir = queueDir();
  if (!dir) return { count: 0, bytes: 0 };
  try {
    const names = await FileSystem.readDirectoryAsync(dir);
    let bytes = 0;
    for (const name of names) {
      const info = await FileSystem.getInfoAsync(`${dir}${name}`, { size: true });
      if (info.exists && 'size' in info && typeof info.size === 'number') bytes += info.size;
    }
    return { count: names.length, bytes };
  } catch {
    return { count: 0, bytes: 0 };
  }
}

/** ¿El archivo sigue en el teléfono? Una excepción del sistema de archivos cuenta como «no está». */
export async function photoExists(uri: string): Promise<boolean> {
  try {
    return (await FileSystem.getInfoAsync(uri)).exists;
  } catch {
    return false;
  }
}

/** Borra la copia durable. **Sólo toca archivos de la carpeta de la cola**: jamás la foto original del usuario. */
export async function deleteQueuePhoto(uri: string | undefined): Promise<void> {
  if (!uri || !isQueuePhoto(uri)) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // Un archivo huérfano pesa poco y no es dato del cobrador: no se hace fallar un envío por esto.
  }
}
