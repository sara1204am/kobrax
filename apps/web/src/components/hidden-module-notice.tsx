'use client';

import { Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { HIDEABLE_MODULES } from '@kobrax/shared';

/**
 * El aviso de que se llegó a un módulo que la organización ocultó (`?oculto=<módulo>`, que pone `requireModuleVisible`).
 * Se monta una vez en el marco del panel, así que aparece en la pantalla a la que se volvió sea cual sea.
 *
 * Quien puede editar la cuenta (`canManage`) sabe dónde volver a mostrarlo; el resto, a quién pedírselo. Una clave que no es
 * de un módulo ocultable no dice nada: la URL no se puede usar para escribir textos en la pantalla.
 */
function Notice({ canManage }: { canManage: boolean }) {
  const t = useTranslations('panel.workspace.hiddenModule');
  const tNav = useTranslations('panel.nav');
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const key = params.get('oculto');
  if (!key || !(HIDEABLE_MODULES as readonly string[]).includes(key)) return null;

  return (
    <div role="status" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-k-border bg-k-highlight/40 px-4 py-3 text-[14px] text-k-text">
      <p>
        <span className="font-semibold">{t('title', { module: tNav(key) })}</span> {canManage ? t('textAdmin') : t('textMember')}
      </p>
      <button
        type="button"
        onClick={() => {
          // Solo se quita `oculto`: el resto de la URL (pestaña del tablero, filtros, modo edición) se conserva.
          const rest = new URLSearchParams(params.toString());
          rest.delete('oculto');
          const query = rest.toString();
          router.replace(query ? `${pathname}?${query}` : pathname);
        }}
        className="min-h-[44px] whitespace-nowrap rounded-lg px-3 font-semibold text-k-periwinkle hover:underline"
      >
        {t('dismiss')}
      </button>
    </div>
  );
}

export function HiddenModuleNotice({ canManage }: { canManage: boolean }) {
  // `useSearchParams` pide un borde de Suspense para no volver dinámico todo el árbol.
  return (
    <Suspense fallback={null}>
      <Notice canManage={canManage} />
    </Suspense>
  );
}
