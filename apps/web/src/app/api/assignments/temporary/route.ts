import type { NextResponse } from 'next/server';
import { proxyMutation } from '@/lib/proxy';

/** Reemplazo temporal de un crédito: `{ creditId, userId, expiresAt, reason? }` (`assignment:write`). */
export async function POST(req: Request): Promise<NextResponse> {
  return proxyMutation<unknown>(req, '/assignments/temporary');
}
