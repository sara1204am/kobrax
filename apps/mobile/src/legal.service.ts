/**
 * Documentos legales (privacidad · B7). Lectura **pública**: se tienen que poder leer antes de crear la cuenta, así que van por
 * `publicCall` (sin sesión). El hash y la versión vigente los calcula el servidor; acá solo se piden.
 */
import { LEGAL_LOCALE, type SignupDocument } from '@kobrax/shared';
import { publicCall, type PublicResult } from './api';

/** Un documento tal como lo devuelve `GET /legal/documents/:slug/versions/:version`. */
export interface LegalDocument {
  id: string;
  type: string;
  version: string;
  title: string;
  content: string;
  contentSha256: string;
  effectiveAt: string;
}

/** Slug de la API de cada documento que se acepta al registrarse. */
export const LEGAL_SLUG = { TERMS: 'terms', PRIVACY: 'privacy' } as const;

/** Las versiones vigentes de lo que se acepta al registrarse (Términos y Privacidad). */
export function getSignupDocuments(): Promise<PublicResult<SignupDocument[]>> {
  return publicCall<SignupDocument[]>(
    `/legal/signup-documents?locale=${LEGAL_LOCALE}`,
    {},
    'No pudimos cargar los documentos',
  );
}

/** Una versión EXACTA de un documento: la que el formulario va a enviar, para que lo que se lee sea lo que se acepta. */
export function getLegalDocument(slug: string, version: string): Promise<PublicResult<LegalDocument>> {
  return publicCall<LegalDocument>(
    `/legal/documents/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}?locale=${LEGAL_LOCALE}`,
    {},
    'No pudimos cargar el documento',
  );
}
