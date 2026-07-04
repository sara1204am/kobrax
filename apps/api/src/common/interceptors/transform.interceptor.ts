import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { ResponseDto, type ApiResponse } from '@kobrax/shared';

/** Envuelve toda respuesta en el contrato `{ data, meta, error }`. */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((data) => {
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
