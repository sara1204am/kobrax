import { NextResponse } from 'next/server';
import type { AssignableRole } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/**
 * Los roles que esta persona puede asignar al invitar (`GET /roles`). Los pide el diálogo de invitar cuando se abre desde otra
 * pantalla —el selector de responsable de una oficina— y no trae los roles ya cargados. El `GET` no tiene efecto: va sin `sameOrigin`.
 */
export async function GET(): Promise<NextResponse> {
  const { status, body } = await apiCall<AssignableRole[]>('/roles', { method: 'GET', auth: true });
  if (status !== 200 || !body.data) return apiError(status, body);
  return NextResponse.json({ data: body.data });
}
