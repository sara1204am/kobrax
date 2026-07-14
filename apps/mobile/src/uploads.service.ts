/**
 * Subida de imágenes (foto de fachada §5.1, comprobante §5.4). Multipart, así que NO pasa por
 * `apiMutate` (que serializa JSON): tiene su propio POST con `FormData` + refresh 401→retry una vez.
 * El server calcula el SHA-256 del buffer original y devuelve `{ url, hash }`.
 */
import { API_BASE } from './api';
import { refreshSession } from './api-client';
import { getSession } from './session';

export type UploadResult =
  | { status: 'ok'; url: string; hash: string }
  | { status: 'offline' }
  | { status: 'unauthenticated' }
  | { status: 'error'; message: string };

/** Sube una imagen local (uri de `expo-image-picker`) a `POST /api/uploads`. */
export async function uploadImage(uri: string, mimeType = 'image/jpeg'): Promise<UploadResult> {
  const session = await getSession();
  if (!session) return { status: 'unauthenticated' };

  const name = uri.split('/').pop() || `foto.${mimeType === 'image/png' ? 'png' : 'jpg'}`;
  const post = (token: string) => {
    const form = new FormData();
    // En React Native el file part es { uri, name, type } (no un Blob).
    form.append('file', { uri, name, type: mimeType } as unknown as Blob);
    return fetch(`${API_BASE}/uploads`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'x-client-type': 'mobile' },
      body: form,
    });
  };

  try {
    let res = await post(session.accessToken);
    if (res.status === 401) {
      const refreshed = await refreshSession();
      if (!refreshed) return { status: 'unauthenticated' };
      res = await post(refreshed.accessToken);
    }
    const json = (await res.json().catch(() => ({ data: null, error: null }))) as {
      data: { url: string; hash: string } | null;
      error: { message: string } | null;
    };
    if ((res.status === 200 || res.status === 201) && json.data) {
      return { status: 'ok', url: json.data.url, hash: json.data.hash };
    }
    if (res.status === 401) return { status: 'unauthenticated' };
    return { status: 'error', message: json.error?.message ?? 'No se pudo subir la foto' };
  } catch {
    return { status: 'offline' };
  }
}
