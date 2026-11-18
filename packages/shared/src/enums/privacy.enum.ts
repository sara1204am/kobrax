/** Qué derecho ejerce la persona (privacidad · solicitudes). */
export enum PrivacyRequestType {
  ACCESS = 'ACCESS',
  RECTIFICATION = 'RECTIFICATION',
  ERASURE = 'ERASURE',
  RESTRICTION = 'RESTRICTION',
  OBJECTION = 'OBJECTION',
  PORTABILITY = 'PORTABILITY',
  WITHDRAW_CONSENT = 'WITHDRAW_CONSENT',
  OTHER = 'OTHER',
  /** Reporte público de hostigamiento o de datos cargados sin derecho (lo presenta un tercero, sin cuenta). */
  ABUSE_REPORT = 'ABUSE_REPORT',
  /** Pedido público de eliminación de una cuenta de Kobrax (la web que Google Play exige). */
  ACCOUNT_DELETION = 'ACCOUNT_DELETION',
}

/** Estados de seguimiento de una solicitud. `REJECTED` y `COMPLETED` son finales; rechazar exige una justificación. */
export enum PrivacyRequestStatus {
  RECEIVED = 'RECEIVED',
  IN_REVIEW = 'IN_REVIEW',
  NEEDS_INFO = 'NEEDS_INFO',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  COMPLETED = 'COMPLETED',
}

/**
 * De quién es la solicitud. `APP_USER`: una persona usuaria de Kobrax sobre sus propios datos (la procesa Kobrax).
 * `DEBTOR_VIA_ORG`: una persona cuyos datos de cobranza administra una organización, que es la responsable (la registra su personal).
 * Son flujos distintos y nunca se mezclan.
 */
export enum PrivacySubjectKind {
  APP_USER = 'APP_USER',
  DEBTOR_VIA_ORG = 'DEBTOR_VIA_ORG',
  /** Una persona SIN cuenta (un deudor, un tercero) que escribe por el formulario público. La atiende la plataforma. */
  THIRD_PARTY = 'THIRD_PARTY',
}
