import { NextResponse } from 'next/server';
import type { AuthTokens } from '@kobrax/shared';
import { apiCall, sameOrigin, setAuthCookies } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/**
 * Cambio de empresa desde adentro del panel.
 *
 * El primo de `select-account`, pero para una sesión ya iniciada: la identidad no viaja en un
 * pre-auth token sino en la cookie de acceso, que `apiCall({ auth: true })` adjunta.
 *
 * La API revoca la sesión anterior, así que acá **hay que pisar las dos cookies**: si
 * quedaran las viejas, el próximo request llevaría un refresh token ya revocado y el
 * middleware mandaría al login.
 */
export async function POST(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }

  const { accountId } = (await req.json().catch(() => ({}))) as { accountId?: string };
  if (!accountId) {
    return NextResponse.json({ error: { code: 'VALIDATION', message: 'Empresa requerida' } }, { status: 400 });
  }

  const { status, body } = await apiCall<AuthTokens>('/auth/switch-account', {
    method: 'POST',
    auth: true,
    body: JSON.stringify({ accountId }),
  });
  if (status !== 200 || !body.data) return apiError(status, body);

  const res = NextResponse.json({ ok: true });
  setAuthCookies(res, body.data);
  return res;
}
