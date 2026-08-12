import type { NextResponse } from 'next/server';
import type { RouteItem } from '@kobrax/shared';
import { proxyMutation } from '@/lib/proxy';

/**
 * Cambiar el estado de una ruta.
 *
 * ⚠️ El endpoint declara `@Roles(ROUTE_READ)` y **eso no dice quién puede**: la puerta de todo el
 * módulo de rutas es mínima a propósito (el cobrador arma la suya y no tiene `ROUTE_WRITE`), y el
 * alcance real lo decide el service por capacidad. Una ruta ajena responde 404, no 403.
 */
export function PATCH(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  return proxyMutation<RouteItem>(req, `/routes/${params.id}`, 'PATCH');
}
