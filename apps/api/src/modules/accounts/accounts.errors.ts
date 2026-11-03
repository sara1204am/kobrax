import { BadRequestException, ConflictException, ForbiddenException, InternalServerErrorException, NotFoundException } from '@nestjs/common';

export const accountNotFound = () =>
  new NotFoundException({ code: 'ACCOUNT_NOT_FOUND', message: 'Cuenta no encontrada' });

/** Registro público: el email ya tiene usuario. Mensaje accionable, sin filtrar más. */
export const emailTaken = () =>
  new ConflictException({
    code: 'AUTH_EMAIL_TAKEN',
    message: 'Ya existe una cuenta con ese correo. Inicia sesión.',
  });

/** El rol `ACCOUNT_ADMIN` sale del seed: si falta, la base está mal provisionada. */
export const roleCatalogMissing = () =>
  new InternalServerErrorException({
    code: 'ROLE_CATALOG_MISSING',
    message: 'Catálogo de roles no inicializado',
  });

/** Las preferencias, ya mezcladas con lo guardado, no forman un juego coherente (p. ej. la jornada termina antes de empezar). */
export const preferencesInvalid = (reason: string) =>
  new BadRequestException({ code: 'PREFERENCES_INVALID', message: 'Las preferencias de trabajo no son válidas', details: { reason } });

/** Ya hay un pedido del mismo tipo esperando respuesta de Kobrax. */
export const requestAlreadyPending = () =>
  new ConflictException({ code: 'REQUEST_ALREADY_PENDING', message: 'Ya hay un pedido igual esperando respuesta. Kobrax te contesta pronto.' });

/** Pidió cambiar al plan que ya tiene. */
export const requestPlanInvalid = () =>
  new BadRequestException({ code: 'REQUEST_PLAN_INVALID', message: 'Esa cuenta ya tiene ese plan' });

/** Para darse de baja hay que escribir el nombre del negocio: es el freno contra un clic equivocado. */
export const requestConfirmMismatch = () =>
  new BadRequestException({ code: 'REQUEST_CONFIRM_MISMATCH', message: 'El nombre escrito no coincide con el del negocio' });

export const requestNotFound = () =>
  new NotFoundException({ code: 'REQUEST_NOT_FOUND', message: 'Solicitud no encontrada o ya atendida' });

/** Sólo el dueño actual puede transferir la propiedad. */
export const ownerNotOwner = () =>
  new ForbiddenException({ code: 'OWNER_NOT_OWNER', message: 'Sólo el dueño de la cuenta puede transferir la propiedad' });

/** El destinatario debe ser otro administrador activo de esta cuenta. */
export const ownerTargetInvalid = () =>
  new BadRequestException({ code: 'OWNER_TARGET_INVALID', message: 'Elige a otro administrador activo de la cuenta' });

/** 400 y no 401: un 401 haría que el panel crea que la sesión venció. */
export const ownerPasswordInvalid = () =>
  new BadRequestException({ code: 'OWNER_PASSWORD_INVALID', message: 'La contraseña no es correcta' });

export const ownerCodeInvalid = () =>
  new BadRequestException({ code: 'OWNER_CODE_INVALID', message: 'El código de verificación no es válido' });
