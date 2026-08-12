import type { NextResponse } from 'next/server';
import { proxyMutation } from '@/lib/proxy';

/**
 * Generar casos en lote para la cartera en mora (`case:assign`).
 *
 * Crea un caso por cada crédito con atraso que todavía no tenga uno abierto, y devuelve
 * `{ created }`. **No hay forma de deshacerlo en bloque**: la pantalla lo dice antes de llamar.
 */
export function POST(req: Request): Promise<NextResponse> {
  return proxyMutation<{ created: number }>(req, '/cases/generate');
}
