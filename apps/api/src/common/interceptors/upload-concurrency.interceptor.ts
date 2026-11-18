import { CallHandler, ExecutionContext, HttpException, HttpStatus, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, defer, finalize } from 'rxjs';

/**
 * Tope de subidas en vuelo POR PROCESO. `FileInterceptor` guarda cada archivo en MEMORIA (hasta 15 MB): sin tope, unas decenas de
 * subidas simultáneas bastan para agotar la RAM del servidor. Se pone ANTES de `FileInterceptor` para que el cupo se tome antes de
 * leer el cuerpo y se libere al terminar la respuesta (también si falla o el cliente aborta).
 *
 * El rate limit por IP/usuario ya frena a un cliente; esto frena la suma de todos. Al excederse: 503 con `Retry-After`, que el móvil
 * trata como «reintenta» (su cola offline ya reintenta lo que falla por red).
 */
export const MAX_CONCURRENT_UPLOADS = 12;

/** Contador a nivel de módulo: Nest instancia el interceptor una vez por módulo, y el tope es del proceso. */
let inFlight = 0;

export const uploadsInFlight = (): number => inFlight;

@Injectable()
export class UploadConcurrencyInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (inFlight >= MAX_CONCURRENT_UPLOADS) {
      throw new HttpException(
        { code: 'UPLOAD_003', message: 'Hay muchas subidas en curso. Reintenta en unos segundos.' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    inFlight++;
    // `defer` + `finalize`: el cupo se devuelve una sola vez, termine bien, con error o cancelado.
    return defer(() => next.handle()).pipe(finalize(() => void inFlight--));
  }
}
