import { BadRequestException, ValidationPipe, type ValidationError } from '@nestjs/common';

/** Errores por campo: `{ email: ['…'], 'items.0.qty': ['…'] }` (anidados con ruta de puntos). */
export function collectFieldErrors(errors: ValidationError[], prefix = ''): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const e of errors) {
    const path = prefix ? `${prefix}.${e.property}` : e.property;
    if (e.constraints) out[path] = Object.values(e.constraints);
    if (e.children?.length) Object.assign(out, collectFieldErrors(e.children, path));
  }
  return out;
}

/**
 * Misma respuesta de siempre (`message` = lista de textos) **más** `fields`, para que los clientes
 * puedan pintar cada mensaje bajo su campo. El filtro global lo vuelca en `error.details`.
 */
export function validationExceptionFactory(errors: ValidationError[]): BadRequestException {
  const fields = collectFieldErrors(errors);
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    message: Object.values(fields).flat(),
    fields,
  });
}

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: validationExceptionFactory,
  });
}
