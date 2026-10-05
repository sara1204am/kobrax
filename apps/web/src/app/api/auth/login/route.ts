import { NextResponse } from 'next/server';
import type { LoginResult } from '@kobrax/shared';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError, stepResponse } from '@/lib/auth-flow';

export async function POST(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });

  // Sin pre-chequeo propio: la API aplica LoginDto (mismas reglas que el formulario) y devuelve el
  // detalle por campo en `error.details`, que apiError() reenvía tal cual.
  const { email, password } = (await req.json().catch(() => ({}))) as { email?: string; password?: string };

  const { status, body } = await apiCall<LoginResult>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (status !== 200 || !body.data) return apiError(status, body);
  return stepResponse(body.data);
}
