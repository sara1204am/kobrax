import type { NextResponse } from 'next/server';
import { proxyMutation } from '@/lib/proxy';

/**
 * Sumar una parada a una ruta que ya existe.
 *
 * El cuerpo lleva el cliente y —si lo tiene— su caso. Las dos guardas que importan son del servidor:
 * que el cliente sea **de este tenant** (la RLS no alcanza: el chequeo de la clave foránea lo hace
 * Postgres por dentro y la saltea) y que el mismo caso no entre dos veces en la misma ruta.
 */
export async function POST(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  return proxyMutation(req, `/routes/${params.id}/stops`);
}
