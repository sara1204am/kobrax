import { proxyMutation } from '@/lib/proxy';

/** Mueve una oficina (y su subárbol) bajo otra: `{ parentId }`. La API rechaza ciclos, mover la raíz y pasarse de profundidad. */
export const POST = (req: Request, { params }: { params: { id: string } }) =>
  proxyMutation(req, `/branches/${encodeURIComponent(params.id)}/move`);
