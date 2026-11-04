import { proxyMutation } from '@/lib/proxy';

/** Alta de una oficina (`office:write` y el tope del plan los valida la API). La lista la lee la pantalla desde el servidor. */
export const POST = (req: Request) => proxyMutation(req, '/branches');
