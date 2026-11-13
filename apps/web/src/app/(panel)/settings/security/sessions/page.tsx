import { redirect } from 'next/navigation';

/** Las sesiones ahora viven en la pestaña Seguridad de Mi perfil; se conserva la ruta por los enlaces viejos. */
export default function SessionsPage() {
  redirect('/settings/perfil/seguridad');
}
