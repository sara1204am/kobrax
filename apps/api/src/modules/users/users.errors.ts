import { BadRequestException, NotFoundException } from '@nestjs/common';

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

export const roleNotAllowed = () =>
  new BadRequestException({
    code: 'USER_ROLE_NOT_ALLOWED',
    message: 'Ese rol se administra desde la web',
  });
