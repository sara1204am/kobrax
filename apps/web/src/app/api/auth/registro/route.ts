import { NextResponse } from 'next/server';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/**
 * Registro público → `POST /accounts`.
 *
 * **No setea cookies a propósito**: el alta no devuelve tokens (decisión S4-D1 del módulo de
 * Cuenta del móvil). La pantalla hace después su `POST /api/auth/login` normal y hereda toda la
 * máquina de estados — para un `ACCOUNT_ADMIN` eso significa aterrizar en el enrolamiento de MFA,
 * que su rol exige.
 *
 * El rate limit real (10/hora por IP) vive en la API, no acá.
 */
export async function POST(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const { businessName, firstName, lastName, email, password, planCode } = body;
  if (!businessName || !firstName || !lastName || !email || !password) {
    return NextResponse.json({ error: { code: 'VALIDATION', message: 'Faltan datos' } }, { status: 400 });
  }

  // `planCode` viaja sin mirarlo: la lista blanca que decide qué planes existen vive en el DTO de
  // la API, que es la frontera de confianza real — este handler no puede ser la única guarda de
  // algo que también entra por el móvil. Lo que sí importa es **no olvidarlo acá**: este objeto se
  // arma campo por campo, así que lo que no se nombre se pierde en silencio.
  const { status, body: res } = await apiCall<{ accountId: string; email: string }>('/accounts', {
    method: 'POST',
    body: JSON.stringify({ businessName, firstName, lastName, email, password, planCode }),
  });
  if (status >= 400 || !res.data) return apiError(status, res);
  return NextResponse.json(res.data);
}
