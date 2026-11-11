import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GlobalExceptionFilter } from './global-exception.filter';

function run(exception: unknown): { status: number; body: { error?: { code?: string; message?: string } } } {
  const out = { status: 0, body: {} as { error?: { code?: string; message?: string } } };
  const res = { status: (s: number) => ((out.status = s), { json: (b: typeof out.body) => void (out.body = b) }) };
  new GlobalExceptionFilter().catch(exception, { switchToHttp: () => ({ getResponse: () => res }) } as never);
  return out;
}

describe('GlobalExceptionFilter — padre obligatorio fuera de alcance (F14 · F2b)', () => {
  it('«Inconsistent query result: Field route is required…» responde 404 RESOURCE_NOT_FOUND, no 500', () => {
    const r = run(new Error('Invalid `prisma.routeStop.findFirst()` invocation:\nInconsistent query result: Field route is required to return data, got `null` instead.'));
    assert.equal(r.status, 404);
    assert.equal(r.body.error?.code, 'RESOURCE_NOT_FOUND');
  });

  it('un error cualquiera sigue siendo 500', () => {
    const r = run(new Error('algo se rompió'));
    assert.equal(r.status, 500);
    assert.equal(r.body.error?.code, 'INTERNAL_ERROR');
  });
});
