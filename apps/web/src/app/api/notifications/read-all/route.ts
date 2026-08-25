import { NextResponse } from 'next/server';
import { apiCall, sameOrigin } from '@/lib/bff';

export async function POST(req: Request): Promise<NextResponse> {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Origen no permitido' } }, { status: 403 });
  }

  const { status } = await apiCall('/notifications/read-all', { method: 'POST', auth: true });
  if (status !== 204 && status !== 200) {
    return NextResponse.json({ error: { code: 'MARK_READ_FAILED' } }, { status });
  }
  return NextResponse.json({ data: true });
}
