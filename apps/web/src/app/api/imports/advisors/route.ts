import { NextResponse } from 'next/server';
import { apiCall } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

export interface AdvisorLinks {
  links: { advisorCode: string; userId: string }[];
  /** Códigos que ya trajeron los reportes y todavía no tienen usuario. */
  unlinked: string[];
}

/** D8: de qué usuario es cada código de asesor de los reportes. */
export async function GET(): Promise<NextResponse> {
  const { status, body } = await apiCall<AdvisorLinks>('/imports/portfolio/advisors', { auth: true });
  if (status !== 200 || !body.data) return apiError(status, body);
  return NextResponse.json(body.data);
}
