/** Tipos de documento legal que Kobrax publica y versiona (el contenido vive en `legal_document_versions`). */
export enum LegalDocumentType {
  TERMS = 'TERMS',
  PRIVACY = 'PRIVACY',
  COOKIES = 'COOKIES',
  DPA = 'DPA',
  ACCEPTABLE_USE = 'ACCEPTABLE_USE',
  AI_POLICY = 'AI_POLICY',
}

/**
 * Qué hizo la persona con un documento. `ACCEPTED` = aceptación contractual (Términos). `ACKNOWLEDGED` = constancia de que se le
 * presentó la información y la leyó (Privacidad): **no** es un consentimiento general para tratamientos.
 */
export enum LegalAcceptanceAction {
  ACCEPTED = 'ACCEPTED',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
}

/** Dónde ocurrió la aceptación (evidencia de origen). */
export enum LegalAcceptanceSource {
  SIGNUP_WEB = 'SIGNUP_WEB',
  SIGNUP_MOBILE = 'SIGNUP_MOBILE',
  INVITATION_WEB = 'INVITATION_WEB',
  INVITATION_MOBILE = 'INVITATION_MOBILE',
  RE_ACCEPT = 'RE_ACCEPT',
  PROFILE = 'PROFILE',
  ORGANIZATION = 'ORGANIZATION',
}

/** Finalidades **opcionales** que se consienten por separado. Nunca condicionan el acceso al servicio. */
export enum LegalConsentPurpose {
  MARKETING = 'MARKETING',
  ANALYTICS = 'ANALYTICS',
  COOKIES_NON_ESSENTIAL = 'COOKIES_NON_ESSENTIAL',
}

export enum LegalConsentStatus {
  GRANTED = 'GRANTED',
  WITHDRAWN = 'WITHDRAWN',
}

/** Documentos que se exigen al crear una cuenta o aceptar una invitación, y la acción que se registra por cada uno. */
export const SIGNUP_REQUIRED_DOCUMENTS: ReadonlyArray<{
  type: LegalDocumentType;
  action: LegalAcceptanceAction;
}> = [
  { type: LegalDocumentType.TERMS, action: LegalAcceptanceAction.ACCEPTED },
  { type: LegalDocumentType.PRIVACY, action: LegalAcceptanceAction.ACKNOWLEDGED },
];
