import type { NextResponse } from 'next/server';
import type { PaymentRequestItem } from '@kobrax/shared';
import { proxyMutation } from '@/lib/proxy';

/**
 * Pedir un cobro (`payment:write`): devuelve el `qrPayload` y la `url` que se le mandan al deudor.
 *
 * Los arma la API — el panel los muestra y los deja copiar, no los inventa.
 */
export function POST(req: Request): Promise<NextResponse> {
  return proxyMutation<PaymentRequestItem>(req, '/payment-requests');
}
