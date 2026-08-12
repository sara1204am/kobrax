import type { NextResponse } from 'next/server';
import type { PaymentItem } from '@kobrax/shared';
import { proxyMutation } from '@/lib/proxy';

/**
 * Confirmar que el cobro pedido entró (`payment:approve`).
 *
 * ⚠️ Es un permiso **aparte** de `payment:write`, y no lo tiene todo el mundo: la pantalla mira
 * `ROLE_PERMISSIONS` antes de dibujar el botón, o queda un 403 esperando a que alguien lo toque.
 *
 * Confirmar **crea el pago**, así que hereda la regla del ledger: no se deshace.
 */
export function POST(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  return proxyMutation<PaymentItem>(req, `/payment-requests/${params.id}/confirm`);
}
