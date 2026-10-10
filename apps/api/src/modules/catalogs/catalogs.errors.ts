import { BadRequestException, NotFoundException } from '@nestjs/common';

export const catalogItemNotFound = () =>
  new NotFoundException({ code: 'CATALOG_NOT_FOUND', message: 'Ítem de catálogo no encontrado' });

export const catalogMetadataInvalid = (reason: string) =>
  new BadRequestException({ code: 'CATALOG_METADATA_INVALID', message: 'El contenido adicional del ítem no es válido', details: { reason } });
