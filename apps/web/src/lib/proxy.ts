import { NextResponse } from 'next/server';
import { apiCall, sameOrigin } from './bff';
import { apiError } from './auth-flow';

/**
 * El patrón que repiten todos los handlers que mutan: guarda de origen, llamada a la API con el
 * Bearer de la cookie, y devolver `data` o propagar el error con su código.
 *
 * Vive en su propio archivo y no en `bff.ts` para no hacer un ciclo: `auth-flow` ya importa de
 * `bff`.
 *
 * 🔴 **Éxito es cualquier 2xx, no sólo 200.** Los controllers de casos y agenda no llevan
 * `@HttpCode`, así que sus `POST` responden **201** — y `auth`, que sí lo lleva, responde 200. Un
 * handler que exija 200 convierte toda respuesta buena de esos módulos en un error sin mensaje.
 *
 * El cuerpo se reenvía **tal cual llegó**: estos endpoints reciben DTO validados del otro lado, y
 * volver a parsear y re-serializar acá sólo agrega una forma de romperlos.
 */
export async function proxyMutation<T>(
  req: Request,
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE' = 'POST',
): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }

  const body = await req.text();
  const { status, body: res } = await apiCall<T>(path, {
    method,
    auth: true,
    ...(body ? { body } : {}),
  });
  if (status < 200 || status >= 300 || !res.data) return apiError(status, res);

  return NextResponse.json(res.data);
}
