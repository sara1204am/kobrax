import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { HttpException, type CallHandler, type ExecutionContext } from '@nestjs/common';
import { Subject, firstValueFrom } from 'rxjs';
import { MAX_CONCURRENT_UPLOADS, UploadConcurrencyInterceptor, uploadsInFlight } from './upload-concurrency.interceptor';

const ctx = {} as ExecutionContext;

describe('UploadConcurrencyInterceptor', () => {
  it('rechaza con 503 al pasar el tope y devuelve el cupo al terminar (también si falla o se cancela)', async () => {
    const interceptor = new UploadConcurrencyInterceptor();
    const open: Subject<string>[] = [];
    const subs = [];
    for (let i = 0; i < MAX_CONCURRENT_UPLOADS; i++) {
      const s = new Subject<string>();
      open.push(s);
      const handler: CallHandler = { handle: () => s };
      subs.push((interceptor.intercept(ctx, handler) as ReturnType<CallHandler['handle']>).subscribe({ error: () => {} }));
    }
    assert.equal(uploadsInFlight(), MAX_CONCURRENT_UPLOADS);

    // Uno más: 503
    assert.throws(
      () => interceptor.intercept(ctx, { handle: () => new Subject() }),
      (e: unknown) => e instanceof HttpException && e.getStatus() === 503,
    );
    assert.equal(uploadsInFlight(), MAX_CONCURRENT_UPLOADS, 'el rechazado no ocupa cupo');

    // Termina bien, falla y se cancela: los tres liberan.
    open[0]!.next('ok');
    open[0]!.complete();
    open[1]!.error(new Error('x'));
    subs[2]!.unsubscribe();
    assert.equal(uploadsInFlight(), MAX_CONCURRENT_UPLOADS - 3);

    // Y ya cabe otro.
    const s = new Subject<string>();
    const p = firstValueFrom(interceptor.intercept(ctx, { handle: () => s }) as ReturnType<CallHandler['handle']>);
    s.next('listo');
    assert.equal(await p, 'listo');

    for (const k of open.slice(3)) k.complete();
    assert.equal(uploadsInFlight(), 0);
  });
});
