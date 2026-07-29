import { NotFoundException } from '@nestjs/common';

export const accountNotFound = () =>
  new NotFoundException({ code: 'ACCOUNT_NOT_FOUND', message: 'Cuenta no encontrada' });
