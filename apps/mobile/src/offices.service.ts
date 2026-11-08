/**
 * Las oficinas que la persona ve en la cuenta (`GET /branches`, F14 · F8). Solo con `office:read`: el cobrador no lo tiene y usa las suyas de `/auth/me`.
 */
import { apiQuery, type QueryResult } from './api-client';
import type { OfficeOption } from './office-choice';

interface BranchRow {
  id: string;
  name: string;
  fullName?: string;
  isRoot?: boolean;
  parentId?: string | null;
  active?: boolean;
}

export async function listOffices(): Promise<QueryResult<OfficeOption[]>> {
  const res = await apiQuery<BranchRow[]>('/branches');
  if (res.status !== 'ok') return res;
  const rows = res.data.filter((b) => b.active !== false);
  return { ...res, data: rows.map((b) => ({ id: b.id, name: b.fullName ?? b.name, isRoot: b.isRoot ?? b.parentId == null })), total: rows.length };
}
