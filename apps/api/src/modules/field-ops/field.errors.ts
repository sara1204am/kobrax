import { BadRequestException, ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

export const resourceNotFound = () =>
  new NotFoundException({ code: 'RESOURCE_NOT_FOUND', message: 'Recurso no encontrado' });

/** GPS obligatorio/ inválido en la visita. */
export const invalidGps = () =>
  new BadRequestException({ code: 'VISIT_GPS', message: 'Coordenadas GPS inválidas o ausentes' });

/** Visita sin referencia a crédito ni parada de ruta. */
export const visitNeedsTarget = () =>
  new BadRequestException({ code: 'VISIT_TARGET', message: 'La visita requiere creditId o routeStopId' });

/** Los campos propios de la variante no cierran con el `outcome` (S5 · RT-6). */
export const invalidVisitDetails = (errors: string[]) =>
  new BadRequestException({ code: 'VISIT_DETAILS', message: 'Faltan datos de la gestión', details: errors });

/** El hash declarado de la evidencia no coincide con el contenido (integridad). */
export const evidenceHashInvalid = () =>
  new UnprocessableEntityException({ code: 'EVIDENCE_001', message: 'El hash de la evidencia no coincide con el contenido' });

/** El `id` de la visita que mandó el cliente ya es de otra visita (otro caso, parada o cobrador). */
export const visitIdTaken = () =>
  new ConflictException({ code: 'VISIT_ID', message: 'Ese id de visita ya pertenece a otra visita' });

/** La parada y el crédito que mandó el cliente no son el mismo. */
export const visitCreditMismatch = () =>
  new BadRequestException({ code: 'VISIT_CREDIT', message: 'La parada no corresponde a ese crédito' });
