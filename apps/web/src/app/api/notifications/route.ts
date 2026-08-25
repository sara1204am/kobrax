import { NextResponse } from 'next/server';
import type { NotificationPayload } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { apiError } from '@/lib/auth-flow';

/** Las notificaciones del usuario en sesión, para la campanita de la topbar. */
export async function GET(): Promise<NextResponse> {
  const { status, body } = await apiCall<NotificationPayload[]>('/notifications?limit=20', {
    method: 'GET',
    auth: true,
  });
  if (status !== 200 || !body.data) return apiError(status, body);

  return NextResponse.json({ data: body.data });
}
