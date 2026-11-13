import { NextResponse } from 'next/server';
import type { RoleUpdateResult, UpdateRolePermissionsInput } from '@kobrax/shared';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/**
 * F14 · F7: guarda los permisos de un rol de la cuenta (`PUT /roles/:key/permissions`). Muta, así que valida el origen (CSRF). Las reglas
 * (reservados, dependencias, alcance, versión, motivo) las hace cumplir la API: acá no se repite ninguna.
 */
export async function PUT(req: Request, { params }: { params: { key: string } }): Promise<NextResponse> {
  if (!sameOrigin(req)) return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as Partial<UpdateRolePermissionsInput>;
  const { status, body: res } = await apiCall<RoleUpdateResult>(`/roles/${encodeURIComponent(params.key)}/permissions`, { method: 'PUT', auth: true, body: JSON.stringify(body) });
  if (status !== 200 || !res.data) return apiError(status, res);
  return NextResponse.json(res.data);
}
