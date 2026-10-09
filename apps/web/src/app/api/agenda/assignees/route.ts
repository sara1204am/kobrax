import { NextResponse } from 'next/server';
import type { AgendaAssignee } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/**
 * A quién se le puede asignar una gestión (`agenda:assign`): cobradores y supervisores activos del alcance de
 * quien pide, más él mismo. Nombre y rol, sin correo. El `GET` no tiene efecto, así que va sin `sameOrigin`.
 */
export async function GET(): Promise<NextResponse> {
  const { status, body } = await apiCall<AgendaAssignee[]>('/agenda/assignees', { method: 'GET', auth: true });
  if (status !== 200 || !body.data) return apiError(status, body);
  return NextResponse.json({ data: body.data });
}
