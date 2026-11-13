import { redirect } from 'next/navigation';

/** Seguridad ahora es una pestaña de Mi perfil; se conserva la ruta por los enlaces viejos. */
export default function SecurityHub() {
  redirect('/settings/perfil/seguridad');
}
