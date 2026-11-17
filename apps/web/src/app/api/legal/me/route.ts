import { NextResponse } from 'next/server';
import { apiCall } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';
import type { LegalOverview } from '@/lib/legal';

/** Lo legal de la propia persona (pendientes, historial de aceptaciones y consentimientos) → `GET /legal/me`. La clave sale de la sesión. */
export async function GET(): Promise<NextResponse> {
  const { status, body } = await apiCall<LegalOverview>('/legal/me', { method: 'GET', auth: true });
  if (status !== 200 || !body.data) return apiError(status, body);
  return NextResponse.json(body.data, { headers: { 'Cache-Control': 'no-store' } });
}
