/**
 * Elegir un archivo del dispositivo para importar.
 *
 * Vive en su propio módulo, y no dentro de `import.service.ts`, por una razón concreta:
 * `expo-document-picker` toca su módulo nativo apenas se lo importa, y `post-login.ts` importa
 * `import.service` en el camino del login. Un módulo nativo que falle ahí no rompe la pantalla
 * del picker — deja la app entera clavada en el splash.
 *
 * Lo usan la pantalla del archivo del día y la del archivo de muestra de Ajustes. Antes estaba
 * copiado en las dos, y la copia de Ajustes se había quedado sin el filtro de tipo.
 */
import * as DocumentPicker from 'expo-document-picker';
import type { PickedFile } from '@/import.service';

/** El motor lee las dos formas (§4.1); el tipo real lo valida el backend, esto sólo acota el picker. */
const IMPORT_MIME = ['application/pdf', 'text/csv', 'text/comma-separated-values', 'text/plain'];

/** `null` = el usuario canceló. */
export async function pickImportFile(): Promise<PickedFile | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: IMPORT_MIME, copyToCacheDirectory: true });
  if (res.canceled || !res.assets?.[0]) return null;
  const a = res.assets[0];
  return { uri: a.uri, name: a.name, mimeType: a.mimeType };
}
