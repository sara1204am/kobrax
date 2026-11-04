import { proxyMutation } from '@/lib/proxy';

/** Baja lógica (papelera). La API la rechaza (409) si tiene hijas activas, créditos o personas vigentes. */
export const POST = (req: Request, { params }: { params: { id: string } }) =>
  proxyMutation(req, `/branches/${encodeURIComponent(params.id)}/deactivate`);
