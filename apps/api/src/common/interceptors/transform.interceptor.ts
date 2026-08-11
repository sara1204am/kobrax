import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { ResponseDto, type ApiResponse } from '@kobrax/shared';

/** Envuelve toda respuesta en el contrato `{ data, meta, error }`. */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((data) => {
        /*
         * Un archivo no es un `data`: `GET /uploads/:name` devuelve un `StreamableFile`, y
         * envolverlo lo serializaba a JSON — con el descriptor del stream y **la ruta absoluta
         * del archivo en el disco del servidor** adentro. O sea que ninguna foto de perfil se
         * vio nunca, y encima se filtraba dónde vive el archivo.
         */
        if (data instanceof StreamableFile) return data as unknown as ApiResponse<T>;

        // No re-envolver si el controlador ya devolvió el contrato.
        if (
          data &&
          typeof data === 'object' &&
          'data' in data &&
          'meta' in data &&
          'error' in data
        ) {
          return data as unknown as ApiResponse<T>;
        }
        return ResponseDto.ok(data);
      }),
    );
  }
}
