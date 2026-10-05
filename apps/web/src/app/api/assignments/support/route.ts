import type { NextResponse } from 'next/server';
import { proxyMutation } from '@/lib/proxy';

/** Ayuda: un segundo cobrador sobre el crédito: `{ creditId, userId, expiresAt? }` (`assignment:write`). */
export async function POST(req: Request): Promise<NextResponse> {
  return proxyMutation<unknown>(req, '/assignments/support');
}
