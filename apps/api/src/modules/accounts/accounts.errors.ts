import { ConflictException, InternalServerErrorException, NotFoundException } from '@nestjs/common';

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
