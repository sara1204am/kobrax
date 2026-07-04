import { BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

export const resourceNotFound = () =>
  new NotFoundException({ code: 'RESOURCE_NOT_FOUND', message: 'Recurso no encontrado' });

/** GPS obligatorio/ inválido en la visita. */
export const invalidGps = () =>
  new BadRequestException({ code: 'VISIT_GPS', message: 'Coordenadas GPS inválidas o ausentes' });

/** Visita sin referencia a caso ni parada de ruta. */
export const visitNeedsTarget = () =>
  new BadRequestException({ code: 'VISIT_TARGET', message: 'La visita requiere caseId o routeStopId' });

/** El hash declarado de la evidencia no coincide con el contenido (integridad). */
export const evidenceHashInvalid = () =>
  new UnprocessableEntityException({ code: 'EVIDENCE_001', message: 'El hash de la evidencia no coincide con el contenido' });
