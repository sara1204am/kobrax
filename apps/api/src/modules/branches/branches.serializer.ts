import type { Branch } from '@prisma/client';

export interface BranchStats {
  members: number;
  credits: number;
  managerName: string | null;
}

/** Una agencia con lo que la pantalla necesita para decidir (cuánta gente y cuánta cartera tiene). */
export function serializeBranch(b: Branch, stats: BranchStats) {
  return {
    id: b.id,
    name: b.name,
    code: b.code,
    city: b.city,
    address: b.address,
    managerUserId: b.managerUserId,
    managerName: stats.managerName,
    active: b.active,
    members: stats.members,
    credits: stats.credits,
  };
}
