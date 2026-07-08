import { NotFoundException } from '@nestjs/common';

export const catalogItemNotFound = () =>
  new NotFoundException({ code: 'CATALOG_NOT_FOUND', message: 'Ítem de catálogo no encontrado' });
