import { proxyMutation } from '@/lib/proxy';

/** Editar una oficina (nombre, código, tipo, responsable…). El cuerpo es un parche. Mover, desactivar y restaurar tienen su ruta. */
export const PATCH = (req: Request, { params }: { params: { id: string } }) =>
  proxyMutation(req, `/branches/${encodeURIComponent(params.id)}`, 'PATCH');
