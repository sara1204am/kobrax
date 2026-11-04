import { proxyMutation } from '@/lib/proxy';

/** Edita un tipo (nombre, orden, activo). */
export const PATCH = (req: Request, { params }: { params: { id: string } }) =>
  proxyMutation(req, `/branch-types/${encodeURIComponent(params.id)}`, 'PATCH');
