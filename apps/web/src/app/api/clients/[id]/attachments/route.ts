import { NextResponse } from 'next/server';
import { apiCall, sameOrigin } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

interface Ctx {
  params: { id: string };
}

/**
 * Colgarle un adjunto al cliente.
 *
 * El archivo ya se subió por `/api/account/upload` (el mismo `POST /uploads` que W2 usa para la
 * foto de perfil y el QR); acá sólo se registra su URL y su hash contra el cliente. Son dos pasos
 * porque son dos cosas: guardar un archivo y decir de quién es.
 */
export async function POST(req: Request, { params }: Ctx): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }

  const dto = (await req.json().catch(() => ({}))) as { fileType?: string; fileUrl?: string; fileHash?: string };
  const { status, body } = await apiCall<{ id: string }>(`/clients/${params.id}/attachments`, {
    method: 'POST',
    auth: true,
    body: JSON.stringify(dto),
  });
  if ((status !== 200 && status !== 201) || !body.data) return apiError(status, body);

  return NextResponse.json(body.data);
}
