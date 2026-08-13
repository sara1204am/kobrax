import type { NextResponse } from 'next/server';
import type { DashboardDefinition } from '@kobrax/shared';
import { proxyMutation } from '@/lib/proxy';

/** Duplicar: partir de uno que ya sirve en vez de armar otro desde cero. */
export function POST(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  return proxyMutation<DashboardDefinition>(req, `/dashboards/${params.id}/duplicate`);
}
