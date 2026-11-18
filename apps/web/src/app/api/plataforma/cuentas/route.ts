import { NextResponse } from 'next/server';
import { apiError } from '@/lib/auth-flow';
import { platformCall } from '@/lib/platform-bff';

/** Busca cuentas de empresa → `GET /platform/accounts?q=`. Solo lo que identifica a la cuenta. */
export async function GET(req: Request): Promise<NextResponse> {
  const q = (new URL(req.url).searchParams.get('q') ?? '').slice(0, 100);
  const { status, body } = await platformCall<unknown[]>(`/platform/accounts?q=${encodeURIComponent(q)}`, { method: 'GET' });
  if (status !== 200 || !body.data) return apiError(status, body);
  return NextResponse.json(body.data, { headers: { 'Cache-Control': 'no-store' } });
}
