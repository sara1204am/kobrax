/**
 * Aceptación legal en el registro y la invitación (lógica pura, sin React).
 *
 * La pantalla muestra casillas; esto decide cuándo se puede enviar y qué viaja a la API. 🔴 **Lo que viaja son los ids de las
 * versiones que la pantalla mostró**, nunca un texto ni un hash: el servidor calcula el hash con su propia copia y rechaza una
 * versión que ya no sea la vigente (`LEGAL_VERSION_STALE`).
 */

/** Un documento que se exige al crear el acceso, tal como lo devuelve `GET /legal/signup-documents`. */
export interface SignupDocument {
  type: 'TERMS' | 'PRIVACY';
  action: 'ACCEPTED' | 'ACKNOWLEDGED';
  versionId: string;
  version: string;
  title: string;
  contentSha256: string;
}

/**
 * Lo que la persona marcó. Todo nace en `false`: nada viene premarcado.
 *
 * No hay casilla de marketing en el registro (decisión de diseño): la API ya soporta `marketingOptIn`, pero ese consentimiento
 * opcional se pedirá, si corresponde, desde Mi perfil › Privacidad y nunca condicionará el acceso.
 */
export interface LegalChoice {
  terms: boolean;
  privacy: boolean;
}

export const EMPTY_CHOICE: LegalChoice = { terms: false, privacy: false };

/**
 * Los documentos legales solo existen en español por ahora. Se piden siempre en `es`, también a quien usa la interfaz en inglés:
 * pedir `en` sin tener una versión publicada dejaría a esa persona sin poder registrarse. Cuando haya traducciones publicadas,
 * este es el único punto que cambia.
 */
export const LEGAL_LOCALE = 'es';

/** Se puede enviar solo con los documentos cargados y las DOS casillas obligatorias marcadas. */
export function canSubmitLegal(docs: readonly SignupDocument[] | null, choice: LegalChoice): boolean {
  if (!docs) return false;
  const has = (t: SignupDocument['type']) => docs.some((d) => d.type === t);
  return has('TERMS') && has('PRIVACY') && choice.terms && choice.privacy;
}

/**
 * El fragmento del cuerpo del alta: los ids de las versiones que se mostraron.
 * Devuelve `{}` si la persona no completó lo obligatorio: ese envío no debería ocurrir, y la API lo rechazaría igual.
 */
export function legalPayload(
  docs: readonly SignupDocument[] | null,
  choice: LegalChoice,
): { termsVersionId?: string; privacyVersionId?: string } {
  if (!canSubmitLegal(docs, choice) || !docs) return {};
  const id = (t: SignupDocument['type']) => docs.find((d) => d.type === t)!.versionId;
  return {
    termsVersionId: id('TERMS'),
    privacyVersionId: id('PRIVACY'),
  };
}

/**
 * Las páginas públicas de los documentos: ruta en español → slug de la API → qué es. Lista cerrada: cualquier otra ruta es 404.
 * Los enlaces permanentes (`/terminos`, `/privacidad`…) los usan el pie del menú, los correos y quien quiera citar un documento.
 */
export const LEGAL_PAGES = {
  terminos: { slug: 'terms', key: 'terms' },
  privacidad: { slug: 'privacy', key: 'privacy' },
  cookies: { slug: 'cookies', key: 'cookies' },
  dpa: { slug: 'dpa', key: 'dpa' },
  'uso-aceptable': { slug: 'acceptable-use', key: 'acceptableUse' },
  ia: { slug: 'ai-policy', key: 'aiPolicy' },
} as const;

export type LegalPageKey = keyof typeof LEGAL_PAGES;

export const isLegalPage = (v: string): v is LegalPageKey => Object.hasOwn(LEGAL_PAGES, v);

/** Un documento tal como lo devuelve `GET /legal/documents/:slug/...`. */
export interface LegalDocument {
  id: string;
  type: string;
  locale: string;
  version: string;
  title: string;
  content: string;
  contentSha256: string;
  isMaterial: boolean;
  changeSummary: string | null;
  publishedAt: string;
  effectiveAt: string;
}

/** Una versión del historial (sin el texto). */
export type LegalVersionSummary = Omit<LegalDocument, 'content'>;
