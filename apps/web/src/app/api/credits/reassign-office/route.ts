import { proxyMutation } from '@/lib/proxy';

/** Reasigna créditos a otra oficina: `{ creditIds[], toBranchId }` (`assignment:write` lo valida la API). */
export const POST = (req: Request) => proxyMutation(req, '/credits/reassign-office');
