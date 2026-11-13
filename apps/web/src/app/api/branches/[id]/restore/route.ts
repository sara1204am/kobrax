import { proxyMutation } from '@/lib/proxy';

/** Saca una oficina de la papelera. */
export const POST = (req: Request, { params }: { params: { id: string } }) =>
  proxyMutation(req, `/branches/${encodeURIComponent(params.id)}/restore`);
