import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { APP_VERSION } from '@/lib/app-config';

/**
 * Pie del menú lateral: derechos reservados y la versión. Vive al final del menú (no es una barra fija: así no le quita alto
 * a la pantalla). Con el menú colapsado a íconos (`collapsible`, 1024–1279 px) solo queda la versión. El año se calcula al renderizar.
 */
export function PanelFooter({ collapsible = false }: { collapsible?: boolean }) {
  const t = useTranslations('panel.footer');
  return (
    <div className="border-t border-white/10 px-3 py-3 text-center text-[11px] leading-snug text-white/60">
      <p className={collapsible ? 'hidden xl:block' : undefined}>
        {t('rights', { year: new Date().getFullYear() })}
      </p>
      {/* Enlaces permanentes a los documentos legales (páginas públicas). Con el menú colapsado a íconos no caben. */}
      <p className={`mt-0.5 ${collapsible ? 'hidden xl:block' : ''}`}>
        <Link href="/terminos" className="underline-offset-2 hover:text-white hover:underline">
          {t('terms')}
        </Link>
        {' · '}
        <Link href="/privacidad" className="underline-offset-2 hover:text-white hover:underline">
          {t('privacy')}
        </Link>
      </p>
      {APP_VERSION && (
        <p className="mt-0.5 font-medium text-white/80" data-testid="app-version">
          v{APP_VERSION}
        </p>
      )}
    </div>
  );
}
