/**
 * Elegir una foto (cámara o galería). En Expo Go sobre Android de gama baja, `launchCameraAsync` abre la
 * cámara en otra activity y el SO puede **recrear la activity de Expo Go** por presión de memoria → la app
 * "se reinicia" al volver. La galería no dispara ese camino, así que se ofrece como alternativa estable.
 * En un dev build propio la cámara es confiable.
 */
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

export interface PickedImage {
  uri: string;
  mimeType?: string;
}

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
  return { uri: r.assets[0].uri, mimeType: r.assets[0].mimeType };
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
