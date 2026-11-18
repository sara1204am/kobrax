'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ErrorBanner } from '@/components/ui';
import { LegalDocumentModal } from '@/components/legal-document-modal';
import { LEGAL_PAGES, type LegalChoice, type SignupDocument } from '@/lib/legal';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Carga las versiones vigentes de los documentos que se aceptan al crear el acceso. Sin ellas no se puede crear el acceso:
 * la API exige los ids de lo que la persona vio, y no hay alta sin aceptación.
 */
export function useSignupDocuments() {
  const [docs, setDocs] = useState<SignupDocument[] | null>(null);
  const [state, setState] = useState<LoadState>('loading');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const res = await fetch('/api/legal/signup-documents', { cache: 'no-store' });
      const data = (await res.json().catch(() => null)) as SignupDocument[] | null;
      if (!res.ok || !Array.isArray(data) || data.length === 0) throw new Error('legal-docs');
      setDocs(data);
      setState('ready');
    } catch {
      setDocs(null);
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { docs, state, reload: load };
}

const LINK = 'font-medium text-k-purple underline-offset-2 hover:underline';

function Check({
  id,
  checked,
  onChange,
  disabled,
  children,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        // 20 px: el área de toque real es la fila entera (la etiqueta), no solo el cuadro.
        className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-k-navy"
      />
      <label htmlFor={id} className="cursor-pointer text-[12.5px] leading-snug text-k-text">
        {children}
      </label>
    </div>
  );
}

/**
 * Un enlace que abre el documento en un modal **sin salir del formulario**. Sigue siendo un `<a href>` real al enlace permanente:
 * con Ctrl/⌘/Mayús o clic central abre la página (y sin JavaScript también). Solo el clic normal lo intercepta.
 */
function DocLink({ href, onOpen, children }: { href: string; onOpen: () => void; children: ReactNode }) {
  return (
    <a
      href={href}
      className={LINK}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        onOpen();
      }}
    >
      {children}
    </a>
  );
}

/**
 * Las dos casillas obligatorias del registro y de la aceptación de invitación, **en línea, debajo de la contraseña** y sin ningún
 * otro texto (para que el formulario entre en pantalla sin scroll). Nacen desmarcadas.
 *
 * - **Dos y separadas**: aceptar los Términos (contractual) y reconocer la Política (constancia de que se le presentó la información;
 *   no es un consentimiento general para todos los tratamientos).
 * - Cada enlace abre el documento completo en UN modal encima del formulario (la versión exacta que se va a aceptar); desde ahí se
 *   marca la casilla y se vuelve al formulario con todo lo escrito intacto.
 * - Si los documentos no cargan lo dice y deja reintentar: sin documentos no hay alta.
 * - No hay casilla de marketing ni de analítica: el panel no usa ninguna tecnología de seguimiento y el marketing, si se ofrece, será
 *   desde Mi perfil.
 */
export function LegalConsents({
  docs,
  state,
  onReload,
  choice,
  onChange,
  disabled,
  stale,
}: {
  docs: SignupDocument[] | null;
  state: LoadState;
  onReload: () => void;
  choice: LegalChoice;
  onChange: (next: LegalChoice) => void;
  disabled?: boolean;
  /** Los documentos cambiaron mientras la persona llenaba el formulario: se avisa y se vuelve a pedir que los marque. */
  stale?: boolean;
}) {
  const t = useTranslations('legal.consent');
  const set = (k: keyof LegalChoice) => (v: boolean) => onChange({ ...choice, [k]: v });
  /** Qué documento está abierto para leerlo completo (`null` = ninguno). */
  const [reading, setReading] = useState<'terms' | 'privacy' | null>(null);

  if (state === 'loading') {
    return <p className="text-[12.5px] text-k-text-2">{t('loading')}</p>;
  }
  if (state === 'error' || !docs) {
    return (
      <div className="space-y-1.5">
        <ErrorBanner message={t('loadError')} />
        <button type="button" onClick={onReload} className={`${LINK} text-[12.5px]`}>
          {t('retry')}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {stale && <ErrorBanner message={t('changed')} />}

      <Check id="legal-terms" checked={choice.terms} onChange={set('terms')} disabled={disabled}>
        {t('terms.before')}
        <DocLink href="/terminos" onOpen={() => setReading('terms')}>
          {t('terms.link')}
        </DocLink>
        {t('terms.after')}
      </Check>

      <Check id="legal-privacy" checked={choice.privacy} onChange={set('privacy')} disabled={disabled}>
        {t('privacy.before')}
        <DocLink href="/privacidad" onOpen={() => setReading('privacy')}>
          {t('privacy.link')}
        </DocLink>
        {t('privacy.after')}
      </Check>

      {/* El modal pide la versión exacta que se va a enviar: lo que se lee es lo que se acepta. Al aceptar marca la casilla. */}
      {(['terms', 'privacy'] as const).map((kind) => {
        const doc = docs.find((d) => d.type === (kind === 'terms' ? 'TERMS' : 'PRIVACY'));
        const page = kind === 'terms' ? LEGAL_PAGES.terminos : LEGAL_PAGES.privacidad;
        return (
          <LegalDocumentModal
            key={kind}
            open={reading === kind}
            onClose={() => setReading(null)}
            slug={page.slug}
            version={doc?.version}
            pageHref={kind === 'terms' ? '/terminos' : '/privacidad'}
            acknowledge={kind === 'privacy'}
            onAccept={() => onChange({ ...choice, [kind]: true })}
          />
        );
      })}
    </div>
  );
}
