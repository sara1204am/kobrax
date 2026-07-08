import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defer, lastValueFrom } from 'rxjs';
import { TenantContextService } from './tenant-context.service';
import { TenantContextInterceptor } from './tenant-context.interceptor';

describe('TenantContextService', () => {
  it('expone el contexto dentro de run() y nada fuera', () => {
    const tc = new TenantContextService();
    assert.equal(tc.get(), undefined);
    tc.run({ accountId: 'a1', userId: 'u1', permissions: ['case:read'] }, () => {
      assert.equal(tc.get()?.accountId, 'a1');
      assert.equal(tc.accountId, 'a1');
      assert.equal(tc.userId, 'u1');
      assert.equal(tc.can('case:read'), true);
      assert.equal(tc.can('case:assign'), false);
    });
    assert.equal(tc.get(), undefined);
  });

  it('accountId lanza si no hay contexto', () => {
    const tc = new TenantContextService();
    assert.throws(() => tc.accountId);
  });

  it('propaga el contexto a través de awaits', async () => {
    const tc = new TenantContextService();
    const seen = await tc.run({ accountId: 'a2', userId: 'u2', permissions: [] }, async () => {
      await new Promise((r) => setTimeout(r, 5));
      return tc.get()?.accountId;
    });
    assert.equal(seen, 'a2');
  });
});

describe('TenantContextInterceptor', () => {
  const execCtx = (req: unknown) =>
    ({ switchToHttp: () => ({ getRequest: () => req }) }) as never;

  it('abre el contexto con la identidad de request.user durante el handler', async () => {
    const tc = new TenantContextService();
    const interceptor = new TenantContextInterceptor(tc);
    const req = { user: { accountId: 'a1', userId: 'u1', sessionId: 's1' }, headers: {}, ip: '9.9.9.9' };
    // El handler lee el contexto al ejecutarse (defer → corre en la suscripción, dentro de als.run).
    const handler = { handle: () => defer(async () => tc.get()) } as never;
    const ctx = (await lastValueFrom(interceptor.intercept(execCtx(req), handler))) as {
      accountId: string;
      ip?: string;
    };
    assert.equal(ctx.accountId, 'a1');
    assert.equal(ctx.ip, '9.9.9.9');
  });

  it('no abre contexto si el request no está autenticado', async () => {
    const tc = new TenantContextService();
    const interceptor = new TenantContextInterceptor(tc);
    const req = { headers: {} }; // sin user
    const handler = { handle: () => defer(async () => tc.get() ?? 'NO_CTX') } as never;
    const out = await lastValueFrom(interceptor.intercept(execCtx(req), handler));
    assert.equal(out, 'NO_CTX');
  });
});
