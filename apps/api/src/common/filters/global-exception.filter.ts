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
          details = b.message;
        } else {
          message = (b.message as string) ?? exception.message;
        }
        if (typeof b.code === 'string') code = b.code;
        if (b.details !== undefined) details = b.details;
      }
    } else if (exception instanceof Error) {
      message = process.env.NODE_ENV === 'production' ? 'Error interno' : exception.message;
      this.logger.error(exception.message, exception.stack);
    }

    res.status(status).json(ResponseDto.error(code, message, details));
  }
}
