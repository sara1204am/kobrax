import { redirect } from 'next/navigation';

/** «Agencias» ahora es «Oficinas»: el enlace viejo (favoritos, correos) sigue llevando al mismo lugar. */
export default function CuentaAgenciasRedirect(): never {
  redirect('/cuenta/oficinas');
}
