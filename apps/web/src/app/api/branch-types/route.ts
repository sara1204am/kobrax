import { proxyMutation } from '@/lib/proxy';

/** Alta de un tipo de oficina del catálogo de la cuenta (`office:write` lo valida la API). */
export const POST = (req: Request) => proxyMutation(req, '/branch-types');
