import { NextResponse } from 'next/server';
import { apiCall } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';
import { LEGAL_LOCALE } from '@/lib/legal';

/**
 * Las versiones vigentes de lo que se acepta al registrarse (Términos y Privacidad) → `GET /legal/signup-documents`.
 *
 * Público a propósito: la persona tiene que poder leerlos **antes** de tener una cuenta. Solo lectura, así que no hace falta
 * `sameOrigin`. Se pide siempre en español (`LEGAL_LOCALE`) mientras no haya traducciones publicadas.
 */
export async function GET(): Promise<NextResponse> {
  const { status, body } = await apiCall<unknown[]>(`/legal/signup-documents?locale=${LEGAL_LOCALE}`);
  if (status >= 400 || !body.data) return apiError(status, body);
  return NextResponse.json(body.data, { headers: { 'Cache-Control': 'no-store' } });
}
