import type { NextResponse } from 'next/server';
import type { PaymentItem } from '@kobrax/shared';
import { proxyMutation } from '@/lib/proxy';

/**
 * Registrar un pago (`payment:write`).
 *
 * 🔴 **`Idempotency-Key` viaja como HEADER**, no como campo del cuerpo: así lo lee el controller.
 * Si no se reenvía, la clave se pierde acá y **un doble clic registra el pago dos veces** — sobre
 * un ledger que la API no deja corregir ni anular. Es el defecto más caro posible de esta etapa,
 * y por eso tiene su prueba.
 */
export function POST(req: Request): Promise<NextResponse> {
  return proxyMutation<PaymentItem>(req, '/payments', 'POST', ['idempotency-key']);
}
