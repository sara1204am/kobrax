import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PlatformAccountsService } from './platform-accounts.service';

type Status = 'ACTIVE' | 'SUSPENDED' | 'TRIAL' | 'CANCELLED';

function make(current: Status | null) {
  const updates: unknown[] = [];
  const audits: unknown[] = [];
  const tx = {
    account: {
      findFirst: async () => (current ? { status: current, businessName: 'Cobranzas Sur' } : null),
      update: async (args: { data: { status: Status } }) => {
        updates.push(args);
        return { status: args.data.status };
      },
    },
    userAccount: { findFirst: async () => ({ userId: 'owner-1' }) },
    auditLog: { create: async (args: unknown) => audits.push(args) },
  };
  const prisma = { withSystemTenant: async (_id: string, fn: (t: unknown) => unknown) => fn(tx), $queryRaw: async () => [] };
  return { svc: new PlatformAccountsService(prisma as never), updates, audits };
}

const code = (e: unknown) => (e as { response?: { code?: string } }).response?.code;

describe('plataforma · suspender y reactivar cuentas', () => {
  it('suspende una cuenta activa y deja auditoría con el motivo y quién lo hizo', async () => {
    const { svc, updates, audits } = make('ACTIVE');
    const out = await svc.setStatus('acc-1', 'SUSPENDED', 'Reporte de hostigamiento confirmado', 'plat-1');
    assert.equal(out.status, 'SUSPENDED');
    assert.equal(updates.length, 1);
    const entry = (audits[0] as { data: { after: Record<string, unknown> } }).data.after;
    assert.equal(entry.reason, 'Reporte de hostigamiento confirmado');
    assert.equal(entry.platformUserId, 'plat-1');
    assert.equal(entry.via, 'platform:suspend');
  });

  it('🔴 sin motivo suficiente no toca nada', async () => {
    const { svc, updates } = make('ACTIVE');
    await assert.rejects(svc.setStatus('acc-1', 'SUSPENDED', 'corto', 'plat-1'), (e) => code(e) === 'PLATFORM_REASON_REQUIRED');
    assert.equal(updates.length, 0);
  });

  it('🔴 solo se reactiva una cuenta suspendida (no una cancelada ni una en prueba)', async () => {
    for (const s of ['TRIAL', 'CANCELLED', 'ACTIVE'] as const) {
      const { svc, updates } = make(s);
      await assert.rejects(svc.setStatus('acc-1', 'ACTIVE', 'Se resolvió el reclamo del titular', 'plat-1'), (e) => code(e) === 'PLATFORM_ACCOUNT_NOT_SUSPENDED');
      assert.equal(updates.length, 0, s);
    }
    const { svc } = make('SUSPENDED');
    assert.equal((await svc.setStatus('acc-1', 'ACTIVE', 'Se resolvió el reclamo del titular', 'plat-1')).status, 'ACTIVE');
  });

  it('no suspende dos veces, y una cuenta inexistente es un 404', async () => {
    await assert.rejects(make('SUSPENDED').svc.setStatus('acc-1', 'SUSPENDED', 'Motivo suficientemente largo', 'plat-1'), (e) => code(e) === 'PLATFORM_ACCOUNT_ALREADY');
    await assert.rejects(make(null).svc.setStatus('acc-1', 'SUSPENDED', 'Motivo suficientemente largo', 'plat-1'), (e) => code(e) === 'PLATFORM_ACCOUNT_NOT_FOUND');
  });
});
