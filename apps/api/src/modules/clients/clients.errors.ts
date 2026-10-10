import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

/** Documento ya registrado en el tenant (mensaje genérico, sin revelar el cliente). */
export const clientDuplicate = () =>
  new ConflictException({ code: 'CLIENT_DUP', message: 'Ya existe un cliente con ese documento' });

/**
 * El perfil de cobro de una ubicación (F4/13 · E2) decide comportamiento —rutas, agenda— y hasta ahora la columna
 * guardaba cualquier objeto. `reason` es el código de `validateCollectionProfile`.
 */
export const invalidCollectionProfile = (reason: string) =>
  new BadRequestException({ code: 'CLIENT_COLLECTION_PROFILE_INVALID', message: 'El perfil de cobro de la ubicación no es válido', details: { reason } });

/** Recurso inexistente O de otro tenant (genérico, anti-enumeración). */
export const resourceNotFound = () =>
  new NotFoundException({ code: 'RESOURCE_NOT_FOUND', message: 'Recurso no encontrado' });

/** No se puede dar de baja un cliente con créditos activos. */
export const clientHasActiveCredits = () =>
  new ConflictException({
    code: 'CLIENT_HAS_CREDITS',
    message: 'El cliente tiene créditos activos y no puede darse de baja',
  });

/** Falta el permiso para revelar PII en claro (`?reveal=true`). */
export const insufficientPiiPermission = () =>
  new ForbiddenException({
    code: 'INSUFFICIENT_PERMISSION',
    message: 'No tienes permiso para revelar datos sensibles',
  });

/** Identificación incoherente con el tipo de cliente. */
export const invalidClientIdentity = (message: string) =>
  new BadRequestException({ code: 'CLIENT_INVALID', message });
