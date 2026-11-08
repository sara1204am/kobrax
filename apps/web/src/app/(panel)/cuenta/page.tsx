import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { RetryState } from '@/components/retry-state';
import { getMe } from '@/lib/authz';
import { visibleCuentaTabs } from '@/lib/cuenta-tabs';

/** `/cuenta` no es una pantalla: cae en la primera pestaña que esta persona puede abrir (no siempre es General). */
export default async function CuentaPage() {
  const me = await getMe();
  // La API tropezó: no se manda al Inicio sin decir nada, se ofrece reintentar.
  if (me.status === 0 || me.status >= 500) {
    const t = await getTranslations('account');
    return <RetryState title={t('loadErrorTitle')} text={t('loadErrorText')} />;
  }
  const first = visibleCuentaTabs(me.body.data?.permissions ?? [])[0];
  redirect(first ? first.href : '/dashboard');
}
