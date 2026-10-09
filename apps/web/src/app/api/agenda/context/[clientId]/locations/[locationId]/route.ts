import { NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { proxyMutation } from '@/lib/proxy';

/**
 * Marcarle el punto en el mapa a una dirección que ya estaba cargada, desde el alta de una gestión.
 *
 * Existe porque una visita exige la dirección CON ubicación (F4/11) y las que llegan de una importación son solo texto: sin esto
 * la única salida era tipear una dirección nueva y dejar la importada sin punto. Se corrige la que existe en vez de crear una
 * segunda —el mapa dibuja la primaria— y va por la puerta de la agenda (`agenda:write`), la misma del alta de direcciones.
 */
export function PATCH(req: Request, { params }: { params: { clientId: string; locationId: string } }): Promise<NextResponse> | NextResponse {
  if (!isUuid(params.clientId) || !isUuid(params.locationId)) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Dirección no encontrada' } }, { status: 404 });
  }
  return proxyMutation(req, `/agenda/clients/${params.clientId}/locations/${params.locationId}`, 'PATCH');
}
