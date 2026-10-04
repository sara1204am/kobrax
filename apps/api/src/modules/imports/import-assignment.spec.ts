import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hasAssignments, ImportAssignmentError, parseImportAssignments, planAssignments, resolveImportOwnership } from './import-assignment';

const ME = '11111111-1111-1111-1111-111111111111';
const JUAN = '22222222-2222-2222-2222-222222222222';
const MARIA = '33333333-3333-3333-3333-333333333333';
const PEDRO = '44444444-4444-4444-4444-444444444444';
const ACCOUNT = { kind: 'account', ref: null } as const;

const throwsCode = (fn: () => unknown, code: string) =>
  assert.throws(fn, (e: unknown) => e instanceof ImportAssignmentError && e.code === code);

describe('resolveImportOwnership — el cobrador sólo importa su propia cartera', () => {
  const collector = { canAssign: false, me: ME, configScope: ACCOUNT };

  it('reporte de su asesor → su cartera, los nuevos a su nombre (SELF)', () => {
    const o = resolveImportOwnership({ ...collector, advisorCode: 'CQE', linkedUserId: ME });
    assert.deepEqual(o, { scope: { kind: 'official', ref: ME }, suggested: { userId: ME, source: 'SELF' }, mode: 'SELF' });
  });

  it('reporte del asesor de OTRA persona → ADVISOR_BELONGS_TO_OTHER', () => {
    throwsCode(() => resolveImportOwnership({ ...collector, advisorCode: 'CQE', linkedUserId: JUAN }), 'ADVISOR_BELONGS_TO_OTHER');
  });

  it('P1b · asesor sin vínculo → ADVISOR_NOT_LINKED (vincularlo es de quien configura)', () => {
    throwsCode(() => resolveImportOwnership({ ...collector, advisorCode: 'XYZ', linkedUserId: null }), 'ADVISOR_NOT_LINKED');
  });

  it('P2 · sin asesor → su cartera, aunque el alcance configurado sea la empresa', () => {
    const o = resolveImportOwnership({ ...collector, advisorCode: null, linkedUserId: null });
    assert.deepEqual(o.scope, { kind: 'official', ref: ME });
    assert.equal(o.mode, 'SELF');
  });
});

describe('resolveImportOwnership — quien reparte', () => {
  const boss = { canAssign: true, me: ME };

  it('asesor vinculado → alcance de ese usuario, que es la sugerencia', () => {
    const o = resolveImportOwnership({ ...boss, advisorCode: 'CQE', linkedUserId: JUAN, configScope: ACCOUNT });
    assert.deepEqual(o, { scope: { kind: 'official', ref: JUAN }, suggested: { userId: JUAN, source: 'ADVISOR' }, mode: 'CHOOSE' });
  });

  it('asesor sin vínculo con alcance «empresa» → ADVISOR_NOT_LINKED (como siempre, D8)', () => {
    throwsCode(() => resolveImportOwnership({ ...boss, advisorCode: 'XYZ', linkedUserId: null, configScope: ACCOUNT }), 'ADVISOR_NOT_LINKED');
  });

  it('sin asesor y alcance «empresa» → sin sugerencia: hay que elegir', () => {
    const o = resolveImportOwnership({ ...boss, advisorCode: null, linkedUserId: null, configScope: ACCOUNT });
    assert.equal(o.suggested, null);
    assert.equal(o.mode, 'CHOOSE');
  });

  it('alcance de un oficial configurado → ese oficial es la sugerencia', () => {
    const o = resolveImportOwnership({ ...boss, advisorCode: null, linkedUserId: null, configScope: { kind: 'official', ref: MARIA } });
    assert.deepEqual(o.suggested, { userId: MARIA, source: 'SCOPE' });
  });
});

describe('planAssignments — el reparto final', () => {
  const base = {
    me: ME,
    toCreate: ['A', 'B', 'C'],
    toUpdate: new Map<string, string | null>([['X', JUAN], ['Y', MARIA]]),
    assignable: new Set([ME, JUAN, MARIA, PEDRO]),
    requested: null,
  };

  it('SELF: todos los nuevos a quien importa, y lo pedido no cuenta', () => {
    const p = planAssignments({ ...base, mode: 'SELF', suggested: { userId: ME, source: 'SELF' } });
    assert.deepEqual([...p.create.values()].map((a) => [a.userId, a.reason]), [[ME, 'IMPORT_OWN'], [ME, 'IMPORT_OWN'], [ME, 'IMPORT_OWN']]);
    assert.deepEqual(p.reassign, []);
  });

  it('CHOOSE con sugerencia: la acepta para los que no se eligieron', () => {
    const p = planAssignments({
      ...base,
      mode: 'CHOOSE',
      suggested: { userId: JUAN, source: 'ADVISOR' },
      requested: { version: 1, create: [{ userId: PEDRO, externalIds: ['B'] }] },
    });
    assert.deepEqual(Object.fromEntries([...p.create].map(([c, a]) => [c, `${a.userId}/${a.reason}`])), {
      A: `${JUAN}/IMPORT_SUGGESTED`,
      B: `${PEDRO}/IMPORT_CHOSEN`,
      C: `${JUAN}/IMPORT_SUGGESTED`,
    });
    assert.deepEqual(p.unassigned, []);
  });

  it('repartir 30/40/30 es agrupar por persona', () => {
    const p = planAssignments({
      ...base,
      mode: 'CHOOSE',
      suggested: null,
      requested: { version: 1, create: [{ userId: JUAN, externalIds: ['A'] }, { userId: MARIA, externalIds: ['B'] }, { userId: ME, externalIds: ['C'] }] },
    });
    assert.deepEqual([...p.create.values()].map((a) => a.userId), [JUAN, MARIA, ME]);
  });

  it('sin sugerencia y sin elegir → quedan sin responsable (confirmar es error)', () => {
    const p = planAssignments({ ...base, mode: 'CHOOSE', suggested: null });
    assert.deepEqual(p.unassigned, ['A', 'B', 'C']);
  });

  it('una sugerencia que no se puede asignar (un gerente ajeno) no cuenta', () => {
    const p = planAssignments({ ...base, mode: 'CHOOSE', suggested: { userId: 'gerente', source: 'ADVISOR' } });
    assert.deepEqual(p.unassigned, ['A', 'B', 'C']);
  });

  it('nuevo que al confirmar ya existe → NOW_EXISTING, y no se toma como reasignación', () => {
    const p = planAssignments({
      ...base,
      mode: 'CHOOSE',
      suggested: { userId: JUAN, source: 'ADVISOR' },
      requested: { version: 1, create: [{ userId: PEDRO, externalIds: ['X', 'ZZZ'] }] },
    });
    assert.deepEqual(p.notes, [
      { externalId: 'X', reason: 'NOW_EXISTING' },
      { externalId: 'ZZZ', reason: 'UNKNOWN_CODE' },
    ]);
    assert.deepEqual(p.reassign, []);
  });

  it('reasignar: sólo lo que de verdad cambia; «Juan → Juan» no es reasignación', () => {
    const p = planAssignments({
      ...base,
      mode: 'CHOOSE',
      suggested: { userId: JUAN, source: 'ADVISOR' },
      requested: {
        version: 1,
        reassign: [
          { externalId: 'X', fromUserId: JUAN, toUserId: JUAN },
          { externalId: 'Y', fromUserId: MARIA, toUserId: PEDRO },
          { externalId: 'NO-VINO', fromUserId: null, toUserId: PEDRO },
        ],
      },
    });
    assert.deepEqual(p.reassign, [{ code: 'Y', from: MARIA, to: PEDRO }]);
    assert.deepEqual(p.notes, [{ externalId: 'NO-VINO', reason: 'NOT_UPDATED' }]);
  });

  it('destinatarios que no son asignables se informan para rechazar', () => {
    const p = planAssignments({
      ...base,
      mode: 'CHOOSE',
      suggested: null,
      requested: { version: 1, create: [{ userId: 'ex-empleado', externalIds: ['A'] }], reassign: [{ externalId: 'X', fromUserId: JUAN, toUserId: 'otro' }] },
    });
    assert.deepEqual(p.notAssignable, ['ex-empleado', 'otro']);
  });
});

describe('parseImportAssignments — lo que manda la pantalla', () => {
  it('vacío → nada que asignar', () => {
    assert.equal(parseImportAssignments(undefined), null);
    assert.equal(parseImportAssignments(''), null);
    assert.equal(hasAssignments(null), false);
  });

  it('lee grupos y reasignaciones válidos', () => {
    const a = parseImportAssignments(JSON.stringify({ version: 1, create: [{ userId: JUAN, externalIds: [' A ', 'B'] }], reassign: [{ externalId: 'X', fromUserId: null, toUserId: MARIA }] }));
    assert.deepEqual(a, { version: 1, create: [{ userId: JUAN, externalIds: ['A', 'B'] }], reassign: [{ externalId: 'X', fromUserId: null, toUserId: MARIA }] });
    assert.equal(hasAssignments(a), true);
  });

  it('el mismo crédito dos veces (en dos grupos, o nuevo y reasignado) → INVALID_ASSIGNMENTS', () => {
    throwsCode(() => parseImportAssignments({ version: 1, create: [{ userId: JUAN, externalIds: ['A'] }, { userId: MARIA, externalIds: ['A'] }] }), 'INVALID_ASSIGNMENTS');
    throwsCode(() => parseImportAssignments({ version: 1, create: [{ userId: JUAN, externalIds: ['A'] }], reassign: [{ externalId: 'A', fromUserId: null, toUserId: MARIA }] }), 'INVALID_ASSIGNMENTS');
  });

  it('JSON roto, versión desconocida o usuario que no es uuid → INVALID_ASSIGNMENTS', () => {
    throwsCode(() => parseImportAssignments('{no'), 'INVALID_ASSIGNMENTS');
    throwsCode(() => parseImportAssignments({ version: 2 }), 'INVALID_ASSIGNMENTS');
    throwsCode(() => parseImportAssignments({ version: 1, create: [{ userId: 'juan', externalIds: ['A'] }] }), 'INVALID_ASSIGNMENTS');
  });
});
