import type { NextResponse } from 'next/server';
import { proxyMutation } from '@/lib/proxy';

/**
 * El camino por las calles entre dos puntos —de «dónde estoy» a una parada—, para el botón de ubicación de los mapas.
 * No guarda nada: los puntos viajan tal cual a la API, que valida y decide el permiso.
 */
export async function POST(req: Request): Promise<NextResponse> {
  return proxyMutation(req, '/routes/leg');
}
