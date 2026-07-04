import { NextResponse } from 'next/server';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

type Body = {
  action?: 'enroll' | 'verify' | 'disable' | 'regenerate';
  code?: string;
  password?: string;
};

/** Self-service MFA (Bearer): enroll / verify / disable / regenerar backup codes. */
export async function POST(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });

  const { action, code, password } = (await req.json().catch(() => ({}))) as Body;

  const routes: Record<string, { path: string; payload?: unknown }> = {
    enroll: { path: '/auth/mfa/enroll' },
    verify: { path: '/auth/mfa/verify', payload: { code } },
    disable: { path: '/auth/mfa/disable', payload: { password, code } },
    regenerate: { path: '/auth/mfa/backup-codes/regenerate' },
  };
  const route = action ? routes[action] : undefined;
  if (!route) return NextResponse.json({ error: { code: 'VALIDATION', message: 'Acción inválida' } }, { status: 400 });

  const { status, body } = await apiCall(route.path, {
    method: 'POST',
    auth: true,
    body: JSON.stringify(route.payload ?? {}),
  });
  if (status !== 200 && status !== 204) return apiError(status, body);
  return NextResponse.json(body.data ?? { ok: true });
}
