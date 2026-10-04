import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MoraService } from './mora.service';

const CREDIT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const NOTE_ID = '33333333-3333-4333-8333-333333333333';

const NOTE = { id: NOTE_ID, creditId: CREDIT, kind: 'INFO', body: 'texto', color: 'YELLOW', anchor: 'PAGE', posX: 40, posY: 40, width: 240, height: 180, zIndex: 3, authorId: 'u1', createdAt: new Date('2026-10-01T10:00:00Z'), updatedAt: new Date('2026-10-01T10:00:00Z'), deletedAt: null };

function make(opts: { count?: number; topZ?: number; raceOnCreate?: boolean; visible?: boolean; permissions?: string[]; existing?: Partial<typeof NOTE> | null } = {}) {
  let raceCreated = false;
  const calls = { updated: [] as { where: { id: string }; data: Record<string, unknown> }[], created: [] as Record<string, unknown>[], audit: [] as Record<string, unknown>[], queries: [] as { sql: string; values: unknown[] }[] };
  const tx = {
    $queryRaw: async (q: { sql: string; values: unknown[] }) => {
      calls.queries.push({ sql: q.sql, values: q.values });
      return opts.visible === false ? [] : [{ id: CREDIT, client_id: 'cl1' }];
    },
    creditNote: {
      findFirst: async () =>
        opts.raceOnCreate && raceCreated ? { ...NOTE, body: 'ganadora', authorId: 'u2' } : (opts.existing ?? null),
      findMany: async () => [{ ...NOTE, id: 'n1', kind: 'WARNING', body: 'Visitar al padre' }],
      count: async () => opts.count ?? 0,
      aggregate: async () => ({ _max: { zIndex: opts.topZ ?? 0 } }),
      update: async (a: { where: { id: string }; data: Record<string, unknown> }) => {
        calls.updated.push(a);
        return { ...NOTE, ...(opts.existing ?? {}), ...a.data };
      },
      create: async (a: { data: Record<string, unknown> }) => {
        if (opts.raceOnCreate) {
          raceCreated = true;
          throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        }
        calls.created.push(a.data);
        return { ...NOTE, id: (a.data.id as string) ?? 'gen', ...a.data };
      },
    },
  };
  const permissions = opts.permissions ?? ['case:read', 'case:write', 'case:assign', 'data:scope:all'];
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

  it('el alcance del cobrador entra en la consulta de visibilidad (responsable, temporal o apoyo; sin caso)', async () => {
    const { service, calls } = make({ permissions: ['case:read', 'case:write'] });
    await service.addNote(CREDIT, { body: 'x' });
    assert.match(calls.queries[0]!.sql, /cr\.assigned_manager_id = \?/);
    assert.match(calls.queries[0]!.sql, /credit_assignments/);
    assert.doesNotMatch(calls.queries[0]!.sql, /cc\./);
    assert.ok(calls.queries[0]!.values.includes('u1'));
  });

  it('🔴 idempotente: reintentar con el mismo id devuelve la nota guardada, sin duplicar ni auditar de nuevo', async () => {
    const existing = { ...NOTE, body: 'ya estaba', createdAt: new Date('2026-10-01T09:00:00Z') };
    const { service, calls } = make({ existing });
    const res = await service.addNote(CREDIT, { id: NOTE_ID, body: 'otra vez' });
    assert.equal(res.data!.id, NOTE_ID);
    assert.equal(res.data!.body, 'ya estaba');
    assert.equal(calls.created.length, 0);
    assert.equal(calls.audit.length, 0);
  });

  it('un id que ya es de otro crédito es un conflicto', async () => {
    const existing = { ...NOTE, creditId: OTHER, body: 'de otro', authorId: 'u2' };
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

describe('MoraService.addNote — carrera por id repetido', () => {
  it('🔴 dos envíos con el mismo id a la vez: el que pierde devuelve la nota del ganador, no un 500', async () => {
    const { service, calls } = make({ raceOnCreate: true });
    const res = await service.addNote(CREDIT, { id: NOTE_ID, body: 'mi nota' });
    assert.equal(res.data!.body, 'ganadora');
    assert.equal(calls.audit.length, 0, 'no audita: no creó nada');
  });
});

describe('MoraService.addNote — post-it en el tablero', () => {
  it('sin lugar ni color: amarilla, en cascada según cuántas hay y encima de las demás', async () => {
    const { service, calls } = make({ count: 2, topZ: 7 });
    await service.addNote(CREDIT, { body: 'hola' });
    assert.deepEqual(
      { c: calls.created[0]!.color, x: calls.created[0]!.posX, y: calls.created[0]!.posY, w: calls.created[0]!.width, h: calls.created[0]!.height, z: calls.created[0]!.zIndex },
      { c: 'YELLOW', x: 92, y: 84, w: 240, h: 180, z: 8 },
    );
  });

  it('respeta color y lugar que trae', async () => {
    const { service, calls } = make();
    await service.addNote(CREDIT, { body: 'hola', color: 'PINK', x: 300, y: 120, w: 160, h: 120 });
    assert.equal(calls.created[0]!.color, 'PINK');
    assert.equal(calls.created[0]!.posX, 300);
    assert.equal(calls.created[0]!.width, 160);
  });

  it('la lista trae el color y el orden de apilado', async () => {
    const { service } = make();
    const res = await service.notes(CREDIT);
    assert.equal(res.data!.length, 1);
    assert.equal(res.data![0]!.color, 'YELLOW');
    assert.equal(res.data![0]!.zIndex, 3);
  });
});

describe('MoraService.updateNote', () => {
  const asCollector = ['case:read', 'case:write'];

  it('quien la escribió puede cambiar el texto, y se audita sin el texto', async () => {
    const { service, calls } = make({ existing: { ...NOTE, authorId: 'u1' }, permissions: asCollector });
    const res = await service.updateNote(CREDIT, NOTE_ID, { body: '  nuevo texto  ' });
    assert.equal(res.data!.body, 'nuevo texto');
    assert.equal(calls.audit.length, 1);
    assert.equal(calls.audit[0]!.action, 'UPDATE');
    assert.equal(JSON.stringify(calls.audit[0]).includes('nuevo texto'), false);
  });

  it('🔴 otro cobrador no puede cambiar el texto de una nota ajena: 403', async () => {
    const { service, calls } = make({ existing: { ...NOTE, authorId: 'otro' }, permissions: asCollector });
    await assert.rejects(() => service.updateNote(CREDIT, NOTE_ID, { body: 'x' }), ForbiddenException);
    assert.equal(calls.updated.length, 0);
  });

  it('quien reparte cartera sí puede cambiar el tipo de una ajena', async () => {
    const { service } = make({ existing: { ...NOTE, authorId: 'otro' }, permissions: [...asCollector, 'case:assign'] });
    const res = await service.updateNote(CREDIT, NOTE_ID, { kind: 'IMPORTANT' });
    assert.equal(res.data!.kind, 'IMPORTANT');
  });

  it('mover, pintar y redimensionar lo puede cualquiera que escriba, aunque la nota sea ajena, y no se audita', async () => {
    const { service, calls } = make({ existing: { ...NOTE, authorId: 'otro' }, permissions: asCollector });
    const res = await service.updateNote(CREDIT, NOTE_ID, { x: 500, y: 200, w: 500, color: 'GREEN' });
    assert.equal(res.data!.x, 500);
    assert.equal(res.data!.color, 'GREEN');
    assert.equal(res.data!.w, 500);
    assert.equal(calls.audit.length, 0);
  });

  it('🔴 re-anclarla a otra sección la mueve con sus coordenadas, sin auditar (es ordenar el tablero)', async () => {
    const { service, calls } = make({ existing: { ...NOTE, authorId: 'otro' }, permissions: asCollector });
    const res = await service.updateNote(CREDIT, NOTE_ID, { anchor: 'PAYMENTS', x: 30, y: 60 });
    assert.equal(res.data!.anchor, 'PAYMENTS');
    assert.equal(res.data!.x, 30);
    assert.equal(res.data!.y, 60);
    assert.equal(calls.audit.length, 0);
  });

  it('una nota nueva sin sección cae en la ficha entera; con sección, en esa', async () => {
    const a = make({});
    await a.service.addNote(CREDIT, { body: 'hola' });
    assert.equal(a.calls.created[0]!.anchor, 'PAGE');
    const b = make({});
    await b.service.addNote(CREDIT, { body: 'hola', anchor: 'PROMISES', x: 20, y: 30 });
    assert.equal(b.calls.created[0]!.anchor, 'PROMISES');
  });

  it('traerla al frente la pone encima de todas', async () => {
    const { service, calls } = make({ existing: { ...NOTE, zIndex: 2 }, topZ: 9 });
    await service.updateNote(CREDIT, NOTE_ID, { front: true });
    assert.equal(calls.updated[0]!.data.zIndex, 10);
  });

  it('si ya está al frente no escribe otra vez', async () => {
    const { service, calls } = make({ existing: { ...NOTE, zIndex: 9 }, topZ: 9 });
    await service.updateNote(CREDIT, NOTE_ID, { front: true });
    assert.equal(calls.updated.length, 0);
  });

  it('un texto vacío es 400', async () => {
    const { service } = make({ existing: NOTE });
    await assert.rejects(() => service.updateNote(CREDIT, NOTE_ID, { body: '   ' }), BadRequestException);
  });

  it('una nota que no existe (o ya borrada) es 404', async () => {
    const { service } = make();
    await assert.rejects(() => service.updateNote(CREDIT, NOTE_ID, { color: 'BLUE' }), NotFoundException);
  });

  it('sobre un crédito que no puede ver, 404', async () => {
    const { service } = make({ visible: false, existing: NOTE });
    await assert.rejects(() => service.updateNote(CREDIT, NOTE_ID, { color: 'BLUE' }), NotFoundException);
  });
});

describe('MoraService.deleteNote', () => {
  it('quien la escribió la borra (borrado lógico) y queda auditado', async () => {
    const { service, calls } = make({ existing: { ...NOTE, authorId: 'u1' }, permissions: ['case:read', 'case:write'] });
    const res = await service.deleteNote(CREDIT, NOTE_ID);
    assert.equal(res.data!.id, NOTE_ID);
    assert.ok(calls.updated[0]!.data.deletedAt instanceof Date);
    assert.equal(calls.audit[0]!.action, 'DELETE');
  });

  it('🔴 otro cobrador no puede borrar una nota ajena: 403 y no se escribe nada', async () => {
    const { service, calls } = make({ existing: { ...NOTE, authorId: 'otro' }, permissions: ['case:read', 'case:write'] });
    await assert.rejects(() => service.deleteNote(CREDIT, NOTE_ID), ForbiddenException);
    assert.equal(calls.updated.length, 0);
  });

  it('quien reparte cartera sí puede', async () => {
    const { service } = make({ existing: { ...NOTE, authorId: 'otro' } });
    assert.equal((await service.deleteNote(CREDIT, NOTE_ID)).data!.id, NOTE_ID);
  });

  it('una nota sin autor sólo la borra quien reparte', async () => {
    const { service } = make({ existing: { ...NOTE, authorId: null }, permissions: ['case:read', 'case:write'] });
    await assert.rejects(() => service.deleteNote(CREDIT, NOTE_ID), ForbiddenException);
  });
});
