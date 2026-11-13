import { redirect } from 'next/navigation';

/** `/settings/perfil` no es una pantalla: cae en la primera pestaña. */
export default function PerfilPage() {
  redirect('/settings/perfil/datos-personales');
}
