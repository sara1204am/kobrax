import { proxyMutation } from '@/lib/proxy';

/** Saca a una persona de la oficina. */
export const DELETE = (req: Request, { params }: { params: { id: string; userId: string } }) =>
  proxyMutation(req, `/branches/${encodeURIComponent(params.id)}/members/${encodeURIComponent(params.userId)}`, 'DELETE');
