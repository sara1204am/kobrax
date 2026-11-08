import { redirect } from 'next/navigation';
import { getMe } from '@/lib/authz';
import { visibleCuentaTabs } from '@/lib/cuenta-tabs';

/** `/cuenta` no es una pantalla: cae en la primera pestaña que esta persona puede abrir (no siempre es General). */
export default async function CuentaPage() {
  const me = await getMe();
  const first = visibleCuentaTabs(me.body.data?.permissions ?? [])[0];
  redirect(first ? first.href : '/dashboard');
}
