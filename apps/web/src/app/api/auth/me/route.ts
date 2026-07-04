import { NextResponse } from 'next/server';
import { apiCall } from '@/lib/bff';

interface Me {
  userId: string;
  email: string;
  profile: { firstName: string; lastName: string; photoUrl?: string } | null;
  accountId: string;
  role: string;
  permissions: string[];
}

export async function GET(): Promise<NextResponse> {
  const { status, body } = await apiCall<Me>('/auth/me', { method: 'GET', auth: true });
  if (status !== 200 || !body.data) {
    return NextResponse.json({ error: body.error ?? { code: 'AUTH_003', message: 'No autenticado' } }, { status: status >= 400 ? status : 401 });
  }
  return NextResponse.json(body.data);
}
