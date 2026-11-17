import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

export const legalDocumentNotFound = () =>
  new NotFoundException({
    code: 'LEGAL_DOCUMENT_NOT_FOUND',
    message: 'No hay una versión publicada de ese documento',
  });

/** Falta aceptar un documento obligatorio. Nada se guarda: la cuenta no se crea. */
export const legalAcceptanceRequired = (missing: string[]) =>
  new UnprocessableEntityException({
    code: 'LEGAL_ACCEPTANCE_REQUIRED',
    message: 'Debes aceptar los Términos y Condiciones y reconocer la Política de Privacidad',
    details: { missing },
  });

/**
 * La persona vio una versión que ya no es la vigente (se publicó otra mientras llenaba el formulario). Se le pide recargar:
 * nunca se registra una aceptación de un texto distinto al que está en vigor.
 */
export const legalVersionStale = (type: string) =>
  new ConflictException({
    code: 'LEGAL_VERSION_STALE',
    message: 'Los documentos legales cambiaron mientras completabas el formulario. Recarga y revísalos.',
    details: { type },
  });
