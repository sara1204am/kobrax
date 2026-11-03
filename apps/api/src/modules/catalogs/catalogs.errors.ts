import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

export const catalogItemNotFound = () =>
  new NotFoundException({ code: 'CATALOG_NOT_FOUND', message: 'Ítem de catálogo no encontrado' });

export const catalogMetadataInvalid = (reason: string) =>
  new BadRequestException({ code: 'CATALOG_METADATA_INVALID', message: 'El contenido adicional del ítem no es válido', details: { reason } });

export const catalogCodeDuplicate = (code: string) =>
  new ConflictException({ code: 'CATALOG_CODE_DUPLICATE', message: 'Ya existe un ítem con ese código en este catálogo', details: { code } });
