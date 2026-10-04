import type { NextResponse } from 'next/server';
import { proxyMutation } from '@/lib/proxy';

/**
 * Abrir el caso de un crédito en mora que todavía no tiene uno (`case:write`).
 *
 * El cuerpo es `{ creditId }`. La API deja **un solo caso abierto por crédito**: abrir otro responde
 * con el error de duplicado en vez de crear uno de más.
 */
export function POST(req: Request): Promise<NextResponse> {
  return proxyMutation<unknown>(req, '/cases');
}
