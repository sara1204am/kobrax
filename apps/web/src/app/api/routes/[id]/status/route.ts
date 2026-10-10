import type { NextResponse } from 'next/server';
import { proxyMutation } from '@/lib/proxy';

/**
 * Iniciar, completar o cancelar una ruta (F4/12).
 *
 * El cuerpo es `{ status, reason? }`. **La API es la autoridad**: valida la transición, pide el motivo cuando hace
 * falta (cancelar, completar con paradas sin gestionar, o cambiar la ruta de otra persona) y rechaza lo que quien
 * pide no puede. Acá solo se reenvía: repetir las reglas en el navegador es repartir la misma regla en dos lugares.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  return proxyMutation(req, `/routes/${params.id}`, 'PATCH');
}
