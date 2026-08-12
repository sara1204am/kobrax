import { NextResponse } from 'next/server';
import type { ConfigScreen, ImportConfig, ImportConfigPatch } from '@kobrax/shared';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/**
 * La configuración del import + todo lo que Ajustes necesita para dibujarse (catálogo de campos,
 * última corrida, candidatos de alcance). Es **una sola llamada** a propósito: la pantalla no
 * sirve de nada con la config sin el catálogo.
 */
export async function GET(): Promise<NextResponse> {
  const { status, body } = await apiCall<ConfigScreen>('/imports/portfolio/config', { auth: true });
  if (status !== 200 || !body.data) return apiError(status, body);

  return NextResponse.json(body.data);
}

/**
 * Guarda un parche de la config. Los 7 invariantes (no importar + obligatorio, obligatorio sin
 * emparejar, `code`/`clientName` bloqueados, la forma que invalida el emparejado, una columna
 * para dos campos, el `ref` del alcance, `calibrated` sólo de mora) **los valida el servidor**:
 * la pantalla no los reimplementa, muestra el error que vuelve.
 *
 * Un campo en `null` lo **quita** del emparejado y `{ reset: true }` vuelve a fábrica — por eso
 * el cuerpo pasa tal cual y no como `Partial<ImportConfig>`.
 */
export async function PATCH(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }

  const patch = (await req.json().catch(() => ({}))) as ImportConfigPatch;
  const { status, body } = await apiCall<{ config: ImportConfig }>('/imports/portfolio/config', {
    method: 'PATCH',
    auth: true,
    body: JSON.stringify(patch),
  });
  if (status !== 200 || !body.data) return apiError(status, body);

  return NextResponse.json(body.data);
}
