import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

export const memberNotFound = () =>
  new NotFoundException({ code: 'USER_NOT_FOUND', message: 'El miembro no existe en esta cuenta' });

export const profileNotFound = () =>
  new NotFoundException({ code: 'USER_PROFILE_NOT_FOUND', message: 'Perfil no encontrado' });

export const cannotEditSelf = () =>
  new BadRequestException({
    code: 'USER_CANNOT_EDIT_SELF',
    message: 'No podés cambiar tu propio rol ni desactivarte',
  });

export const lastAdmin = () =>
  new BadRequestException({
    code: 'USER_LAST_ADMIN',
    message: 'La cuenta quedaría sin ningún administrador activo',
  });

/*
 * El techo de asientos ya no vive acá: es `planLimitReached` de `common/plan/plan.errors.ts`, uno
 * solo para todos los topes del plan. `USER_SEAT_LIMIT` se retiró con él.
 */

/** Reenviar o cancelar una invitación sólo aplica a quien todavía no aceptó (S2-D5). */
export const notPending = () =>
  new ConflictException({
    code: 'USER_NOT_PENDING',
    message: 'Ese miembro ya aceptó la invitación. Podés desactivarlo, no eliminarlo.',
  });

export const roleNotAllowed = () =>
  new BadRequestException({
    code: 'USER_ROLE_NOT_ALLOWED',
    message: 'Ese rol se administra desde la web',
  });
