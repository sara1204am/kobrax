import { cache } from 'react';
import type { AccountInfo } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';

/**
 * La cuenta, una sola vez por request: el layout la pide para el encabezado y la pestaña para
 * sus formularios, y `cache` evita el segundo viaje a la API.
 */
export const getAccount = cache(() => apiCall<AccountInfo>('/accounts/me', { method: 'GET', auth: true }));
