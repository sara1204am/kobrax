import { NextResponse } from 'next/server';
import { apiError } from '@/lib/auth-flow';
import { platformCall } from '@/lib/platform-bff';

const STATUSES = new Set(['RECEIVED', 'IN_REVIEW', 'NEEDS_INFO', 'APPROVED', 'REJECTED', 'COMPLETED']);

/** Las solicitudes y reportes que atiende la plataforma → `GET /platform/privacy-requests`. `?status=` filtra (lista cerrada). */
export async function GET(req: Request): Promise<NextResponse> {
  const status = new URL(req.url).searchParams.get('status');
  const qs = status && STATUSES.has(status) ? `?status=${status}` : '';
  const { status: code, body } = await platformCall<unknown[]>(`/platform/privacy-requests${qs}`, { method: 'GET' });
  if (code !== 200 || !body.data) return apiError(code, body);
  return NextResponse.json(body.data, { headers: { 'Cache-Control': 'no-store' } });
}
