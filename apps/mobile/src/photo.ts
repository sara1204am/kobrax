/**
 * Elegir una foto (cámara o galería). En Expo Go sobre Android de gama baja, `launchCameraAsync` abre la
 * cámara en otra activity y el SO puede **recrear la activity de Expo Go** por presión de memoria → la app
 * "se reinicia" al volver. La galería no dispara ese camino, así que se ofrece como alternativa estable.
 * En un dev build propio la cámara es confiable.
 */
import { Alert } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { PENDING_PHOTOS_MAX_BYTES, canQueuePhoto } from '@kobrax/shared';
import { fitPhoto, type PhotoOps } from './photo-compress';
import { queuePhotosUsage } from './queue-photos';

export interface PickedImage {
  uri: string;
  mimeType?: string;
}

/** Operaciones nativas de la compresión (photo-compress.ts es la lógica; esto es el teléfono). */
const nativeOps: PhotoOps = {
  render: async (uri, target, quality) => {
    const actions = target.width ? [{ resize: { width: target.width } }] : target.height ? [{ resize: { height: target.height } }] : [];
    const out = await ImageManipulator.manipulateAsync(uri, actions, { compress: quality, format: ImageManipulator.SaveFormat.JPEG });
    return { uri: out.uri };
  },
  sizeOf: async (uri) => {
    const info = await FileSystem.getInfoAsync(uri, { size: true });
    return info.exists && 'size' in info && typeof info.size === 'number' ? info.size : null;
  },
};

async function launch(source: 'camera' | 'library'): Promise<PickedImage | null> {
  const perm =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const r =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync({ quality: 0.5 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.5 });
  if (r.canceled || !r.assets[0]) return null;
  const asset = r.assets[0];

  /*
   * D-9: la foto se reduce ANTES de guardarse o subirse (lado largo 1280 px, ≤ ~800 KB). Es lo que la regla del móvil
   * pedía y nada cumplía: una foto de 12 MP viajaba entera por una conexión de campo. Si la compresión falla por lo que
   * sea, sigue la original: peor que una foto pesada es una visita sin foto.
   */
  let uri = asset.uri;
  let mimeType = asset.mimeType;
  let bytes: number | null = asset.fileSize ?? null;
  try {
    const fitted = await fitPhoto(asset.uri, { width: asset.width, height: asset.height }, nativeOps);
    uri = fitted.uri;
    mimeType = 'image/jpeg';
    bytes = fitted.bytes ?? bytes;
  } catch {
    /* se usa la original */
  }

  // Cupo de pendientes: al tope se bloquea la foto NUEVA con un mensaje claro. Lo ya guardado jamás se borra.
  const usage = await queuePhotosUsage();
  const slot = canQueuePhoto({ pendingBytes: usage.bytes, newBytes: bytes ?? 0 });
  if (!slot.allowed) {
    Alert.alert(
      'Hay muchas fotos sin subir',
      `Tienes ${usage.count} fotos esperando señal (${Math.round(usage.bytes / 1048576)} MB de ${Math.round(PENDING_PHOTOS_MAX_BYTES / 1048576)} MB). Sincroniza antes de sacar más: lo que ya registraste no se pierde.`,
    );
    return null;
  }
  return { uri, mimeType };
}

/** Ofrece Cámara o Galería; resuelve la foto elegida o `null` si se cancela / sin permiso. */
export function choosePhoto(): Promise<PickedImage | null> {
  return new Promise((resolve) => {
    Alert.alert(
      'Agregar foto',
      undefined,
      [
        { text: '📷 Cámara', onPress: () => void launch('camera').then(resolve) },
        { text: '🖼️ Galería', onPress: () => void launch('library').then(resolve) },
        { text: 'Cancelar', style: 'cancel', onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });
}
