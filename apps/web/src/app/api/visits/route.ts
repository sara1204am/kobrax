import type { NextResponse } from 'next/server';
import { proxyMutation } from '@/lib/proxy';

/**
 * Registrar una gestión desde el panel (F4/12 · decisión 2): quien armó la ruta o quien administra rutas la carga a
 * nombre del cobrador (se olvidó, no tenía señal, se quedó sin batería). La API la marca con quién la cargó y la
 * guarda con el GPS estimado. Una visita no se edita: la corrección es una nueva que dice cuál corrige.
 */
export async function POST(req: Request): Promise<NextResponse> {
  return proxyMutation(req, '/visits');
}
