import type { NextResponse } from 'next/server';
import type { CaseListItem } from '@kobrax/shared';
import { proxyMutation } from '@/lib/proxy';

/**
 * Asignar el caso a un cobrador (`case:assign`).
 *
 * El cuerpo lleva `collectorId`, o `auto: true` para que el servidor elija **al menos cargado**.
 * Quién es el menos cargado lo cuenta la API sobre los casos abiertos: la pantalla no lo adivina.
 */
export function POST(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  return proxyMutation<CaseListItem>(req, `/cases/${params.id}/assign`);
}
