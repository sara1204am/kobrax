import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

export const privacyRequestNotFound = () =>
  new NotFoundException({ code: 'PRIVACY_REQUEST_NOT_FOUND', message: 'Solicitud no encontrada' });

export const privacyInvalidTransition = (from: string, to: string) =>
  new ConflictException({
    code: 'PRIVACY_REQUEST_INVALID_TRANSITION',
    message: 'La solicitud no puede pasar a ese estado desde el actual',
    details: { from, to },
  });

export const privacyReasonRequired = () =>
  new UnprocessableEntityException({
    code: 'PRIVACY_REQUEST_REASON_REQUIRED',
    message: 'Para rechazar una solicitud hay que escribir la justificación',
  });

export const privacyNoteRequired = () =>
  new UnprocessableEntityException({
    code: 'PRIVACY_REQUEST_NOTE_REQUIRED',
    message: 'Indica qué información falta para poder continuar',
  });

export const privacyTooManyOpen = () =>
  new ConflictException({
    code: 'PRIVACY_REQUEST_TOO_MANY_OPEN',
    message: 'Ya tienes varias solicitudes abiertas. Espera a que se atiendan antes de presentar otra.',
  });
