/**
 * Utilidades de test compartidas por los specs de auth (no es un spec en sí:
 * no está en el glob del runner). Mantiene los fakes y aserciones legibles.
 */
import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';

/** Asserta que la promesa rechaza con un HttpException cuyo `code` (del body) coincide. */
export async function rejectsWithCode(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof HttpException, `se esperaba HttpException, llegó: ${String(err)}`);
    const body = err.getResponse() as { code?: string };
    assert.equal(body.code, code, `código de error esperado ${code}, llegó ${body.code}`);
    return true;
  });
}

/** Grabadora simple de llamadas: registra cada invocación y devuelve un valor fijo. */
export function spy<T>(returnValue?: T) {
  const calls: unknown[][] = [];
  const fn = async (...args: unknown[]): Promise<T> => {
    calls.push(args);
    return returnValue as T;
  };
  return Object.assign(fn, { calls });
}
