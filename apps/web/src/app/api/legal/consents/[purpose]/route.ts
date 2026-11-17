import { NextResponse } from 'next/server';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/** Lista cerrada de caracteres: la finalidad arma una ruta hacia la API, así que nada raro del cliente llega ahí. */
const PURPOSE = /^[A-Z_]{3,40}$/;

/** Otorga o retira un consentimiento opcional → `PUT /legal/consents/:purpose`. Retirar es tan fácil como otorgar. */
export async function PUT(req: Request, { params }: { params: { purpose: string } }): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }
  if (!PURPOSE.test(params.purpose)) {
    return NextResponse.json({ error: { code: 'VALIDATION', message: 'Finalidad no válida' } }, { status: 400 });
  }
  // Un cuerpo `null` o raro no debe tumbar el handler: se lee con `?.` y falla como 400.
  const parsed = (await req.json().catch(() => null)) as { granted?: unknown } | null;
  const granted = parsed?.granted;
  if (typeof granted !== 'boolean') {
    return NextResponse.json({ error: { code: 'VALIDATION', message: 'Falta el estado' } }, { status: 400 });
  }
  const { status, body } = await apiCall<unknown>(`/legal/consents/${params.purpose}`, {
    method: 'PUT',
    auth: true,
    body: JSON.stringify({ granted }),
  });
  if (status >= 400 || !body.data) return apiError(status, body);
  return NextResponse.json(body.data);
}
