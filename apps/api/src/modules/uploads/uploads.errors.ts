import { BadRequestException, NotFoundException } from '@nestjs/common';

/** Tipo o tamaño fuera de límite, o request sin archivo. */
export const fileRejected = (message: string) => new BadRequestException({ code: 'UPLOAD_001', message });

/** No existe, o es de otro tenant (mismo 404: no filtra existencia). */
export const fileNotFound = () =>
  new NotFoundException({ code: 'UPLOAD_002', message: 'Archivo no encontrado' });
