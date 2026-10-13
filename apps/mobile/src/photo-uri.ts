/** La URL absoluta de una foto guardada como ruta `/api/uploads/…` (o ya absoluta). Sin React: la usan servicios y pantallas. */
import { API_BASE } from './api';
import { attachmentUri } from './cliente-legajo';

export const photoUri = (fileUrl: string | undefined): string | null => attachmentUri(fileUrl, API_BASE);
