import { NextResponse } from 'next/server';
import { sameOrigin } from '@/lib/bff';
import { clearPlatformCookie } from '@/lib/platform-bff';

/** Cierra la sesión de la consola (borra la cookie; el token de plataforma no tiene refresh, así que no hay nada más que revocar). */
export async function POST(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  const res = NextResponse.json({ ok: true });
  clearPlatformCookie(res);
  return res;
}
