import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ResponseDto } from '@kobrax/shared';

/** Prisma: «Inconsistent query result: Field route is required to return data, got `null` instead.» */
const INVISIBLE_PARENT = /Inconsistent query result: Field \w+ is required to return data/;

/** Convierte cualquier excepción al contrato `{ data:null, error, meta }`. */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Error interno';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = `HTTP_${status}`;
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const b = body as Record<string, unknown>;
        if (Array.isArray(b.message)) {
          // Errores de class-validator
          code = 'VALIDATION_ERROR';
          message = 'Validación fallida';
          // `fields` (lo pone el pipe global) trae los mensajes agrupados por campo.
          details =
            b.fields && typeof b.fields === 'object' ? { fields: b.fields, messages: b.message } : b.message;
        } else {
          message = (b.message as string) ?? exception.message;
        }
        if (typeof b.code === 'string') code = b.code;
        if (b.details !== undefined) details = b.details;
      }
    } else if (exception instanceof Error && INVISIBLE_PARENT.test(exception.message)) {
      // F14 · F2b: una fila hija cuyo padre OBLIGATORIO la barrera de alcance no deja ver (p. ej. la parada de la ruta de otro cobrador):
      // para quien pregunta no existe. Es lo mismo que respondía la API a mano; Prisma lo reporta como resultado inconsistente.
      status = HttpStatus.NOT_FOUND;
      code = 'RESOURCE_NOT_FOUND';
      message = 'Recurso no encontrado';
      this.logger.warn(`padre obligatorio fuera de alcance → 404: ${exception.message.split('\n')[0]}`);
    } else if (exception instanceof Error) {
      message = process.env.NODE_ENV === 'production' ? 'Error interno' : exception.message;
      this.logger.error(exception.message, exception.stack);
    }

    res.status(status).json(ResponseDto.error(code, message, details));
  }
}
