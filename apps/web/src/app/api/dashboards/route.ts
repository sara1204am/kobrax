import type { NextResponse } from 'next/server';
import type { DashboardDefinition } from '@kobrax/shared';
import { proxyMutation } from '@/lib/proxy';

/** Crear un tablero. La primera vez que alguien guarda, el tablero por defecto se vuelve una fila. */
export function POST(req: Request): Promise<NextResponse> {
  return proxyMutation<DashboardDefinition>(req, '/dashboards');
}
