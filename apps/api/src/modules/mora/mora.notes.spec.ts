import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { MoraService } from './mora.service';

const CREDIT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const NOTE_ID = '33333333-3333-4333-8333-333333333333';

function make(opts: { visible?: boolean; permissions?: string[]; existing?: { id: string; creditId: string; kind: string; body: string; authorId: string | null; createdAt: Date } | null } = {}) {
  const calls = { created: [] as Record<string, unknown>[], audit: [] as Record<string, unknown>[], queries: [] as { sql: string; values: unknown[] }[] };
  const tx = {
    $queryRaw: async (q: { sql: string; values: unknown[] }) => {
      calls.queries.push({ sql: q.sql, values: q.values });
      return opts.visible === false ? [] : [{ id: CREDIT, client_id: 'cl1' }];
    },
    creditNote: {
      findFirst: async () => opts.existing ?? null,
      findMany: async () => [{ id: 'n1', creditId: CREDIT, kind: 'WARNING', body: 'Visitar al padre', authorId: 'u1', createdAt: new Date('2026-10-01T10:00:00Z') }],
      create: async (a: { data: Record<string, unknown> }) => {
        calls.created.push(a.data);
        return { id: (a.data.id as string) ?? 'gen', creditId: CREDIT, kind: a.data.kind, body: a.data.body, authorId: a.data.authorId, createdAt: new Date('2026-10-01T10:00:00Z') };
      },
    },
  };
  const permissions = opts.permissions ?? ['case:read', 'case:write', 'case:assign'];
  const service = new MoraService(
    { withTenant: async (_a: string, fn: (t: unknown) => unknown) => fn(tx) } as never,
    { accountId: 'acc', userId: 'u1', can: (p: string) => permissions.includes(p) } as never,
    { record: async (e: Record<string, unknown>) => void calls.audit.push(e) } as never,
    {} as never,
  );
  return { service, calls };
}

describe('MoraService.addNote — notas por crédito', () => {
  it('crea la nota con autor, cliente del crédito y tipo por defecto INFO', async () => {
    const { service, calls } = make();
    const res = await service.addNote(CREDIT, { body: '  Visitar al padre  ' });
    assert.equal(res.data!.body, 'Visitar al padre', 'recorta los espacios');
    assert.equal(calls.created[0]!.authorId, 'u1');
    assert.equal(calls.created[0]!.clientId, 'cl1');
    assert.equal(calls.created[0]!.accountId, 'acc');
    assert.equal(calls.created[0]!.kind, 'INFO');
  });

  it('una nota vacía o de puros espacios se rechaza', async () => {
    const { service, calls } = make();
    await assert.rejects(() => service.addNote(CREDIT, { body: '    ' }), BadRequestException);
    assert.equal(calls.created.length, 0);
  });

  it('🔴 sobre un crédito que no puede ver responde 404 y no escribe nada', async () => {
    const { service, calls } = make({ visible: false });
    await assert.rejects(() => service.addNote(CREDIT, { body: 'x' }), NotFoundException);
    assert.equal(calls.created.length, 0);
  });

  it('el alcance del cobrador entra en la consulta de visibilidad', async () => {
    const { service, calls } = make({ permissions: ['case:read', 'case:write'] });
    await service.addNote(CREDIT, { body: 'x' });
    assert.match(calls.queries[0]!.sql, /cc\.assignee_id = \?/);
    assert.ok(calls.queries[0]!.values.includes('u1'));
  });

  it('🔴 idempotente: reintentar con el mismo id devuelve la nota guardada, sin duplicar ni auditar de nuevo', async () => {
    const existing = { id: NOTE_ID, creditId: CREDIT, kind: 'INFO', body: 'ya estaba', authorId: 'u1', createdAt: new Date('2026-10-01T09:00:00Z') };
    const { service, calls } = make({ existing });
    const res = await service.addNote(CREDIT, { id: NOTE_ID, body: 'otra vez' });
    assert.equal(res.data!.id, NOTE_ID);
    assert.equal(res.data!.body, 'ya estaba');
    assert.equal(calls.created.length, 0);
    assert.equal(calls.audit.length, 0);
  });

  it('un id que ya es de otro crédito es un conflicto', async () => {
    const existing = { id: NOTE_ID, creditId: OTHER, kind: 'INFO', body: 'de otro', authorId: 'u2', createdAt: new Date() };
    const { service } = make({ existing });
    await assert.rejects(() => service.addNote(CREDIT, { id: NOTE_ID, body: 'x' }), ConflictException);
  });

  it('con id nuevo lo conserva (el móvil lo genera sin red)', async () => {
    const { service, calls } = make();
    const res = await service.addNote(CREDIT, { id: NOTE_ID, kind: 'IMPORTANT', body: 'Ir hoy' });
    assert.equal(calls.created[0]!.id, NOTE_ID);
    assert.equal(res.data!.kind, 'IMPORTANT');
  });

  it('🔴 audita la creación sin el texto (puede traer datos personales)', async () => {
    const { service, calls } = make();
    await service.addNote(CREDIT, { body: 'Teléfono del hijo: 70000000' });
    assert.equal(calls.audit.length, 1);
    assert.equal(calls.audit[0]!.entity, 'credit_note');
    assert.equal(calls.audit[0]!.action, 'CREATE');
    const after = calls.audit[0]!.after as Record<string, unknown>;
    assert.equal(after.length, 'Teléfono del hijo: 70000000'.length);
    assert.ok(!JSON.stringify(after).includes('70000000'));
  });
});

describe('MoraService.notes / promises — lectura con el mismo alcance', () => {
  it('lee las notas de un crédito visible', async () => {
    const { service } = make();
    const res = await service.notes(CREDIT);
    assert.equal(res.data!.length, 1);
    assert.equal(res.data![0]!.kind, 'WARNING');
  });

  it('un crédito que no puede ver: 404 (no 403)', async () => {
    const { service } = make({ visible: false });
    await assert.rejects(() => service.notes(CREDIT), NotFoundException);
    await assert.rejects(() => service.promises(CREDIT), NotFoundException);
  });
});
