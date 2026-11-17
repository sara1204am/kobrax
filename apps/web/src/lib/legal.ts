/**
 * Aceptación legal en el registro y la invitación (web).
 *
 * La lógica pura (casillas, ids de versión, lector del texto) vive en `@kobrax/shared`, compartida con el móvil: así las dos apps
 * dicen y envían exactamente lo mismo. Aquí quedan las piezas propias de la web (páginas permanentes y tipos de lo propio de cada persona).
 */
export {
  EMPTY_CHOICE,
  LEGAL_LOCALE,
  canSubmitLegal,
  legalPayload,
  type LegalChoice,
  type SignupDocument,
} from '@kobrax/shared';

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

/** Un documento que la persona debe aceptar o reconocer de nuevo (cambió algo material, o nunca lo aceptó). */
export interface PendingDocument {
  type: 'TERMS' | 'PRIVACY';
  versionId: string;
  version: string;
  title: string;
  isMaterial: boolean;
}

export interface AcceptanceRow {
  id: string;
  type: string;
  version: string;
  title: string;
  locale: string;
  action: 'ACCEPTED' | 'ACKNOWLEDGED';
  source: string;
  acceptedAt: string;
  contentSha256: string;
}

export interface ConsentState {
  purpose: 'MARKETING' | 'ANALYTICS' | 'COOKIES_NON_ESSENTIAL';
  status: 'GRANTED' | 'WITHDRAWN';
  /** `false` = nunca decidió (equivale a «no consintió»). */
  decided: boolean;
  recordedAt: string | null;
}

/** Lo de Mi perfil › Privacidad: `GET /legal/me`. */
export interface LegalOverview {
  pending: PendingDocument[];
  acceptances: AcceptanceRow[];
  consents: ConsentState[];
  history: { id: string; purpose: string; status: string; source: string; recordedAt: string }[];
}

/** Slug de la página permanente de un tipo de documento (`/terminos`, `/privacidad`…). */
export const PAGE_OF_TYPE: Record<string, keyof typeof LEGAL_PAGES> = {
  TERMS: 'terminos',
  PRIVACY: 'privacidad',
  COOKIES: 'cookies',
  DPA: 'dpa',
  ACCEPTABLE_USE: 'uso-aceptable',
  AI_POLICY: 'ia',
};

/** Una solicitud de derechos tal como la devuelve `/privacy/requests/*` (sin ids internos de personas ni de cuentas). */
export interface PrivacyRequestView {
  id: string;
  subjectKind: 'APP_USER' | 'DEBTOR_VIA_ORG';
  type: 'ACCESS' | 'RECTIFICATION' | 'ERASURE' | 'RESTRICTION' | 'OBJECTION' | 'PORTABILITY' | 'WITHDRAW_CONSENT' | 'OTHER';
  status: 'RECEIVED' | 'IN_REVIEW' | 'NEEDS_INFO' | 'APPROVED' | 'REJECTED' | 'COMPLETED';
  subjectLabel: string | null;
  description: string;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  events: { status: string; note: string | null; actorKind: 'REQUESTER' | 'ORG' | 'PLATFORM'; createdAt: string }[];
  /** Estados a los que puede pasar (vacío = final). Lo decide el servidor. */
  allowedNext: PrivacyRequestView['status'][];
}

export const PRIVACY_REQUEST_TYPES: PrivacyRequestView['type'][] = [
  'ACCESS',
  'RECTIFICATION',
  'ERASURE',
  'RESTRICTION',
  'OBJECTION',
  'PORTABILITY',
  'WITHDRAW_CONSENT',
  'OTHER',
];
