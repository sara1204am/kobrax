'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui';
import { Modal } from '@/components/modal';
import { LegalText } from '@/components/legal-text';
import { date } from '@/lib/format';
import type { LegalDocument } from '@/lib/legal';

type State = 'loading' | 'ready' | 'error';

/**
 * Lee un documento legal **sin sacar a la persona del formulario**: se abre encima, y al aceptar marca la casilla y vuelve al mismo
 * lugar con todo lo escrito intacto.
 *
 * Pide la **versión exacta** que el formulario va a enviar (`version`, la que devolvió `signup-documents`): lo que se lee es lo
 * mismo que se acepta. Si mientras tanto se publicó otra, el servidor lo detecta al enviar (`LEGAL_VERSION_STALE`).
 *
 * `onAccept` ausente = solo lectura (no hay botón de aceptar).
 */
export function LegalDocumentModal({
  open,
  onClose,
  slug,
  version,
  pageHref,
  acknowledge,
  onAccept,
}: {
  open: boolean;
  onClose: () => void;
  /** Slug de la API (`terms`, `privacy`…). */
  slug: string;
  version?: string;
  /** Enlace permanente de este documento (se ofrece abrirlo en una página aparte). */
  pageHref: string;
  /** `true` = constancia de lectura (Privacidad); `false` = aceptación (Términos). Solo cambia el texto del botón. */
  acknowledge?: boolean;
  onAccept?: () => void;
}) {
  const t = useTranslations('legal.document');
  const [doc, setDoc] = useState<LegalDocument | null>(null);
  const [state, setState] = useState<State>('loading');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const qs = version ? `?version=${encodeURIComponent(version)}` : '';
      const res = await fetch(`/api/legal/documents/${slug}${qs}`, { cache: 'no-store' });
      const data = (await res.json().catch(() => null)) as LegalDocument | null;
      if (!res.ok || !data || typeof data.content !== 'string') throw new Error('legal-doc');
      setDoc(data);
      setState('ready');
    } catch {
      setDoc(null);
      setState('error');
    }
  }, [slug, version]);

  // Se carga al abrir (no antes: el formulario no paga el texto jurídico si nadie lo abre).
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  return (
    <Modal
      wide
      open={open}
      onClose={onClose}
      title={doc?.title ?? ''}
      actions={
        <>
          <Button type="button" variant="ghost" className="!w-auto px-5" onClick={onClose}>
            {t('close')}
          </Button>
          {onAccept && (
            <Button
              type="button"
              variant="primary"
              className="!w-auto px-6"
              disabled={state !== 'ready'}
              onClick={() => {
                onAccept();
                onClose();
              }}
            >
              {acknowledge ? t('acknowledgePrivacy') : t('acceptTerms')}
            </Button>
          )}
        </>
      }
    >
      {state === 'loading' && <p className="text-k-text-2">{t('loading')}</p>}

      {state === 'error' && (
        <div className="space-y-2">
          <p role="alert" className="text-k-danger">
            {t('error')}
          </p>
          <button type="button" onClick={() => void load()} className="font-medium text-k-purple hover:underline">
            {t('retry')}
          </button>
        </div>
      )}

      {state === 'ready' && doc && (
        <div className="space-y-4">
          <p className="text-k-xs text-k-muted">
            {t('version', { version: doc.version })} · {t('effective', { date: date(doc.effectiveAt) })}
          </p>
          <LegalText content={doc.content} />
          <div className="border-t border-k-border pt-3 text-k-2xs text-k-muted">
            <p className="break-all font-mono">{t('fingerprint', { hash: doc.contentSha256 })}</p>
            <a href={pageHref} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block font-medium text-k-purple hover:underline">
              {t('openPage')}
            </a>
            {onAccept && <p className="mt-1">{t('acceptHint')}</p>}
          </div>
        </div>
      )}
    </Modal>
  );
}
