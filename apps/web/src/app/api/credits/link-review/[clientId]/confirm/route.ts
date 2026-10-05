import { NextResponse } from 'next/server';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

interface Ctx {
  params: { clientId: string };
}

/** «Es una persona nueva»: cierra la revisión del cliente provisional sin moverlo (D2). */
export async function POST(req: Request, { params }: Ctx): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }

  const { status, body } = await apiCall<{ clientId: string }>(`/credits/link-review/${params.clientId}/confirm`, {
    method: 'POST',
    auth: true,
  });
  if (status !== 200 && status !== 201) return apiError(status, body);

  return NextResponse.json(body.data);
}
