import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Permission } from '@kobrax/shared';
import { CreditsService } from './credits.service';
import { rejectsWithCode } from '../auth/auth-test-utils';

/**
 * F4/08 · D1-a — el castigo es una condición independiente (`written_off_at/by/reason`): no cambia
 * `credits.status` y no cierra la mora. Sólo gerente y administrador.
 */

type Credit = Record<string, unknown> & { id: string };

function make(opts: { permissions?: string[]; credit?: Credit | null } = {}) {
  const credit: Credit | null = opts.credit === undefined ? { id: 'cr1', status: 'ACTIVE', daysPastDue: 240, metadata: {}, writtenOffAt: null, writtenOffBy: null, writtenOffReason: null } : opts.credit;
  const updates: Record<string, unknown>[] = [];
  const touched = { episodes: 0 };
  const audited: { action: string; entityId: string; before?: Record<string, unknown>; after?: Record<string, unknown> }[] = [];

  const tx = {
    credit: {
      findFirst: async () => (credit ? { ...credit } : null),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        Object.assign(credit!, data);
        return { ...credit! };
      },
    },
    account: { findUnique: async () => ({ currencyCode: 'BOB', configuration: {}, settings: {} }) },
    // Cualquier toque a estas tablas rompe el spec: castigar no cierra la mora.
    creditArrearEpisode: new Proxy({}, { get: () => () => void touched.episodes++ }),
  };
  const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  const permissions = opts.permissions ?? [];
  const tenant = { accountId: 'acc-A', userId: 'gerente-1', can: (p: string) => permissions.includes(p) };
  const audit = { record: async (e: (typeof audited)[number]) => void audited.push(e), recordMany: async () => undefined };
  const service = new CreditsService(prisma as never, tenant as never, audit as never, {} as never, {} as never, {} as never);
  return { service, credit, updates, audited, touched };
}

const MANAGER = [Permission.CREDIT_WRITE, Permission.DATA_SCOPE_ALL];

describe('POST /credits/:id/write-off', () => {
  it('marca written_off_at/by/reason; el estado y los días de mora no cambian', async () => {
    const { service, credit, updates } = make({ permissions: MANAGER });
    const out = await service.writeOff('cr1', '  Sin ubicar al deudor  ');
    assert.ok(credit!.writtenOffAt instanceof Date);
    assert.equal(credit!.writtenOffBy, 'gerente-1');
    assert.equal(credit!.writtenOffReason, 'Sin ubicar al deudor');
    assert.equal(credit!.status, 'ACTIVE', 'no cambia el estado');
    assert.equal(credit!.daysPastDue, 240, 'los días de mora siguen');
    assert.equal('status' in updates[0]!, false, 'ni siquiera lo toca en el update');
    assert.equal(out.writtenOff, true);
    assert.ok(out.writtenOffAt);
    assert.equal(out.status, 'ACTIVE');
  });

  it('🔴 no cierra el episodio de mora', async () => {
    const { service, touched } = make({ permissions: MANAGER });
    await service.writeOff('cr1');
    assert.deepEqual(touched, { episodes: 0 });
  });

  it('audita WRITE_OFF con el motivo; sin motivo guarda null', async () => {
    const a = make({ permissions: MANAGER });
    await a.service.writeOff('cr1', 'incobrable');
    assert.equal(a.audited[0]!.action, 'WRITE_OFF');
    assert.equal(a.audited[0]!.entityId, 'cr1');
    assert.equal(a.audited[0]!.after!.reason, 'incobrable');
    const b = make({ permissions: MANAGER });
    await b.service.writeOff('cr1');
    assert.equal(b.credit!.writtenOffReason, null);
  });

  it('es idempotente: castigar al ya castigado no escribe ni audita', async () => {
    const at = new Date('2026-09-01T00:00:00Z');
    const { service, updates, audited } = make({
      permissions: MANAGER,
      credit: { id: 'cr1', status: 'ACTIVE', metadata: {}, writtenOffAt: at, writtenOffBy: 'otro', writtenOffReason: 'primero' },
    });
    const out = await service.writeOff('cr1', 'segundo');
    assert.equal(updates.length, 0);
    assert.equal(audited.length, 0);
    assert.equal(out.writtenOffAt, at);
  });

  it('crédito inexistente → 404', async () => {
    const { service } = make({ permissions: MANAGER, credit: null });
    await rejectsWithCode(service.writeOff('cr1'), 'RESOURCE_NOT_FOUND');
  });

  it('🔴 sólo gerente y administrador: el supervisor (alcance de agencia) y el cobrador reciben 403', async () => {
    const supervisor = make({ permissions: [Permission.CREDIT_WRITE, Permission.ASSIGNMENT_WRITE, Permission.DATA_SCOPE_BRANCH] });
    await rejectsWithCode(supervisor.service.writeOff('cr1'), 'WRITE_OFF_FORBIDDEN');
    await rejectsWithCode(supervisor.service.unWriteOff('cr1'), 'WRITE_OFF_FORBIDDEN');
    const cobrador = make({ permissions: [Permission.CREDIT_WRITE] });
    await rejectsWithCode(cobrador.service.writeOff('cr1'), 'WRITE_OFF_FORBIDDEN');
    const lector = make({ permissions: [Permission.CREDIT_READ, Permission.DATA_SCOPE_ALL] });
    await rejectsWithCode(lector.service.writeOff('cr1'), 'WRITE_OFF_FORBIDDEN');
    assert.equal(supervisor.updates.length + cobrador.updates.length + lector.updates.length, 0);
  });
});

describe('DELETE /credits/:id/write-off', () => {
  it('limpia written_off_at/by/reason y audita WRITE_OFF_REVERT', async () => {
    const { service, credit, audited } = make({
      permissions: MANAGER,
      credit: { id: 'cr1', status: 'ACTIVE', metadata: {}, writtenOffAt: new Date(), writtenOffBy: 'x', writtenOffReason: 'y' },
    });
    const out = await service.unWriteOff('cr1');
    assert.equal(credit!.writtenOffAt, null);
    assert.equal(credit!.writtenOffBy, null);
    assert.equal(credit!.writtenOffReason, null);
    assert.equal(out.writtenOff, false);
    assert.equal(audited[0]!.action, 'WRITE_OFF_REVERT');
  });

  it('revertir al que no está castigado no hace nada', async () => {
    const { service, updates, audited } = make({ permissions: MANAGER });
    await service.unWriteOff('cr1');
    assert.equal(updates.length, 0);
    assert.equal(audited.length, 0);
  });

  it('compatibilidad: un crédito viejo con estado WRITTEN_OFF se lee como castigado, y al revertir vuelve a ACTIVE', async () => {
    const { service, credit } = make({
      permissions: MANAGER,
      credit: { id: 'cr1', status: 'WRITTEN_OFF', metadata: {}, writtenOffAt: null, writtenOffBy: null, writtenOffReason: null },
    });
    await service.unWriteOff('cr1');
    assert.equal(credit!.status, 'ACTIVE');
    assert.equal(credit!.writtenOffAt, null);
  });
});

describe('credits.status = WRITTEN_OFF ya no se escribe', () => {
  it('PATCH con status WRITTEN_OFF → 422 y se manda al endpoint de castigo', async () => {
    const { service, updates } = make({ permissions: MANAGER });
    await rejectsWithCode(service.update('cr1', { status: 'WRITTEN_OFF' } as never), 'CREDIT_WRITE_OFF_USE_ENDPOINT');
    assert.equal(updates.length, 0);
  });
});
