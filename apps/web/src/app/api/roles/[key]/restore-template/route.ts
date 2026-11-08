import { NextResponse } from 'next/server';
import type { RestoreRoleTemplateInput, RoleUpdateResult } from '@kobrax/shared';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/** F14 · F7: devuelve un rol a los permisos de su plantilla (`POST /roles/:key/restore-template`). Muta: valida el origen (CSRF). */
export async function POST(req: Request, { params }: { params: { key: string } }): Promise<NextResponse> {
  if (!sameOrigin(req)) return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as Partial<RestoreRoleTemplateInput>;
  const { status, body: res } = await apiCall<RoleUpdateResult>(`/roles/${encodeURIComponent(params.key)}/restore-template`, { method: 'POST', auth: true, body: JSON.stringify(body) });
  if (status !== 200 || !res.data) return apiError(status, res);
  return NextResponse.json(res.data);
}
