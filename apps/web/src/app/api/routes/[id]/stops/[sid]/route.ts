import type { NextResponse } from 'next/server';
import { proxyMutation } from '@/lib/proxy';

/**
 * Mover o sacar una parada del recorrido.
 *
 * 🔴 **La regla de qué se puede tocar vive en la API, no acá**: una parada ya gestionada no se
 * mueve ni se quita (`ROUTE_STOP_DONE`), porque es historia de la jornada — el cobrador estuvo ahí.
 * La pantalla esconde los controles de esas paradas, pero **la guarda real es del servidor**: sin
 * ella, bastaría con un `DELETE` a mano para borrar la prueba de una visita.
 *
 * `PATCH` mueve (`sequenceOrder`) y también cambia el estado; el servidor **reordena la lista
 * entera** al mover, porque escribir el número a secas chocaría con `unique(routeId, sequenceOrder)`.
 */
export async function PATCH(req: Request, { params }: { params: { id: string; sid: string } }): Promise<NextResponse> {
  return proxyMutation(req, `/routes/${params.id}/stops/${params.sid}`, 'PATCH');
}

export async function DELETE(req: Request, { params }: { params: { id: string; sid: string } }): Promise<NextResponse> {
  return proxyMutation(req, `/routes/${params.id}/stops/${params.sid}`, 'DELETE');
}
