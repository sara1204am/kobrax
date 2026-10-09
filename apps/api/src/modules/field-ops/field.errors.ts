import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

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

// ── F4/12 · quién registra y qué se puede registrar ──────────────────────────────────────────────────

/** Ni anda rutas ni las administra (auditor, visor): no registra visitas. */
export const visitForbidden = () =>
  new ForbiddenException({ code: 'AUTH_002', message: 'No tenés permiso para registrar visitas' });

/** Desde el panel la visita va sobre una parada: de ahí sale de quién es la ruta y quién manda sobre ella. */
export const visitNeedsStop = () =>
  new BadRequestException({ code: 'VISIT_STOP', message: 'Registrá la visita sobre una parada de la ruta' });

/** Una ruta cancelada ya no se anda: sus paradas no reciben visitas. */
export const visitRouteCancelled = () =>
  new UnprocessableEntityException({ code: 'VISIT_ROUTE_CANCELLED', message: 'La ruta está cancelada: no se pueden registrar visitas en ella' });

/** La parada ya tiene su visita: una visita no se edita ni se repite, se corrige con una nueva que lo diga. */
export const visitStopDone = () =>
  new ConflictException({
    code: 'VISIT_STOP_DONE',
    message: 'Esta parada ya tiene su visita. Para corregirla registrá una nueva indicando cuál corrige.',
  });

/** La visita que se dice corregir no existe o no es de esa parada. */
export const visitCorrectionInvalid = () =>
  new BadRequestException({ code: 'VISIT_CORRECTS', message: 'La visita que querés corregir no es de esta parada' });
