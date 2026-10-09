import type { NextResponse } from 'next/server';
import { proxyMutation } from '@/lib/proxy';

/**
 * La vista previa de una ruta que todavía no se publicó: recorrido, distancia, duración, hora de llegada y orden
 * sugerido, **sin guardar nada** (F4/12). Es lo que deja revisar antes de «Confirmar y publicar».
 */
export async function POST(req: Request): Promise<NextResponse> {
  return proxyMutation(req, '/routes/plan-preview');
}
