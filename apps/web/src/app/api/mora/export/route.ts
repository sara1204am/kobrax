import { NextResponse } from 'next/server';
import { API_BASE, bearerHeaders } from '@/lib/bff';
import { isMoraExportFormat, moraExportQuery, type MoraParams } from '@/lib/mora';

/**
 * Proxy de la descarga de Mora (`/mora/export.csv` y `.pdf`). Como `api/exports/[type]`: el navegador llega con
 * la cookie de sesión, este handler adjunta el Bearer y reenvía el archivo con su `Content-Disposition`.
 *
 * 🔴 **La query se reconstruye, no se reenvía.** Pasa por `moraExportQuery`, la misma función que arma la de la
 * lista, así que sólo viaja lo que la pantalla sabe filtrar y el formato sale de una lista cerrada. El
 * alcance (el cobrador sólo baja lo suyo) lo decide la API con el token, no esta ruta.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const format = url.searchParams.get('format');
  if (!isMoraExportFormat(format)) {
    return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 });
  }

  const params = Object.fromEntries(url.searchParams.entries()) as MoraParams;
  const query = moraExportQuery(params);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/mora/export.${format}?${query}`, { headers: bearerHeaders(), cache: 'no-store' });
  } catch {
    return NextResponse.json({ error: { code: 'API_UNREACHABLE', message: 'No se pudo conectar con el servidor.' } }, { status: 502 });
  }

  // Un error de la API (el filtro devuelve demasiados créditos, sin permiso…) viaja con su mensaje: la
  // pantalla lo muestra, en vez de un «falló» sin explicación.
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => null);
    return NextResponse.json({ error: body?.error ?? { code: 'EXPORT_FAILED' } }, { status: res.status || 502 });
  }

  return new Response(res.body, {
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
      'content-disposition': res.headers.get('content-disposition') ?? 'attachment',
      'cache-control': 'private, no-store',
    },
  });
}
