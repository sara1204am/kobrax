import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseVerifyOutput, passed, verifyFiles } from './verify-lib';
import { compareSources, diffSnapshots, normalizeScopes, summarizeByRole, hasUnplanned, unexpectedMismatches, unplanned, type MembershipPermissions, type PermissionsSnapshot } from './permissions-lib';

describe('verify-lib · ejecutor de verificaciones (F14 · F9)', () => {
  it('lista solo las verificaciones de solo lectura: verify_*.sql menos verify_isolation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-'));
    for (const f of ['001_enable_rls.sql', 'verify_scope.sql', 'verify_isolation.sql', 'verify_files.sql', 'verify-otra.txt', 'notas.sql']) writeFileSync(join(dir, f), '');
    assert.deepEqual(verifyFiles(dir), ['verify_files.sql', 'verify_scope.sql']);
  });

  it('en la carpeta REAL: están las de F1…F7 y ninguna política ni la de aislamiento', () => {
    const real = verifyFiles(join(__dirname, 'rls'));
    for (const f of ['verify_authz.sql', 'verify_catalog.sql', 'verify_files.sql', 'verify_platform.sql', 'verify_roles.sql', 'verify_scope.sql']) assert.ok(real.includes(f), f);
    assert.ok(!real.includes('verify_isolation.sql'));
    assert.ok(real.every((f) => f.startsWith('verify_')));
  });

  it('lee las comprobaciones, los avisos y la causa del error de lo que escribe psql', () => {
    const stderr = ['NOTICE:  OK 1/2 · todo bien', 'psql:<stdin>:40: NOTICE:  AVISO · 3 sesiones sin dispositivo', 'NOTICE:  OK 2/2 · otra'].join('\n');
    const r = parseVerifyOutput(stderr);
    assert.deepEqual(r.ok, ['OK 1/2 · todo bien', 'OK 2/2 · otra']);
    assert.deepEqual(r.warnings, ['AVISO · 3 sesiones sin dispositivo']);
    assert.equal(r.error, null);
    assert.equal(passed(r, 0), true);
  });

  it('🔴 un ERROR falla aunque hayan pasado comprobaciones antes; se queda con la PRIMERA causa', () => {
    const r = parseVerifyOutput(['NOTICE:  OK 1/3 · bien', 'psql:<stdin>:20: ERROR:  files no tiene RLS forzado', 'CONTEXT:  PL/pgSQL', 'ERROR:  otra cosa'].join('\n'));
    assert.equal(r.error, 'files no tiene RLS forzado');
    assert.equal(r.ok.length, 1);
    assert.equal(passed(r, 3), false);
    assert.equal(passed(r, 0), false, 'con error no pasa ni con código 0');
  });

  it('🔴 un archivo que no imprime ninguna comprobación NO pasa (no verificó nada)', () => {
    assert.equal(passed(parseVerifyOutput(''), 0), false);
  });
});

const m = (userId: string, permissions: string[], over: Partial<MembershipPermissions> = {}): MembershipPermissions => ({ accountId: 'a1', userId, role: 'COLLECTOR', source: 'account', permissions, ...over });
const snap = (...memberships: MembershipPermissions[]): PermissionsSnapshot => ({ takenAt: '2026-11-08T00:00:00.000Z', memberships });

describe('permissions-lib · permisos efectivos por membresía (F14 · F9)', () => {
  it('dos volcados iguales no tienen diferencias', () => {
    const d = diffSnapshots(snap(m('u1', ['a', 'b'])), snap(m('u1', ['b', 'a'])));
    assert.deepEqual(d, { changed: [], gone: [], appeared: [] });
    assert.equal(hasUnplanned(unplanned(d)), false);
  });

  it('🔴 detecta lo añadido, lo quitado, las membresías que ya no están y las nuevas', () => {
    const d = diffSnapshots(snap(m('u1', ['a', 'b']), m('u2', ['a'])), snap(m('u1', ['b', 'c']), m('u3', ['a'])));
    assert.deepEqual(d.changed, [{ accountId: 'a1', userId: 'u1', added: ['c'], removed: ['a'] }]);
    assert.deepEqual(d.gone, ['a1:u2']);
    assert.deepEqual(d.appeared, [{ a: 'a1:u3' }].map((x) => x.a));
  });

  it('🔴 «cero diferencias salvo las planificadas»: lo permitido no cuenta; lo demás sí', () => {
    const d = diffSnapshots(snap(m('u1', ['a'])), snap(m('u1', ['a', 'nuevo:permiso', 'otro'])));
    assert.equal(hasUnplanned(unplanned(d)), true);
    assert.equal(hasUnplanned(unplanned(d, { allowAdded: ['nuevo:permiso', 'otro'] })), false);
    const u = unplanned(d, { allowAdded: ['nuevo:permiso'] });
    assert.deepEqual(u.unplanned[0]!.added, ['otro']);
  });

  it('`allowAnyAdded`: un despliegue que agrega permisos no es una diferencia, pero quitar uno SÍ', () => {
    const agrega = diffSnapshots(snap(m('u1', ['a'])), snap(m('u1', ['a', 'nuevo'])));
    assert.equal(hasUnplanned(unplanned(agrega, { allowAnyAdded: true })), false);
    const quita = diffSnapshots(snap(m('u1', ['a', 'b'])), snap(m('u1', ['a', 'nuevo'])));
    assert.equal(hasUnplanned(unplanned(quita, { allowAnyAdded: true })), true);
  });

  it('quitar un permiso es una diferencia aunque se permita añadir', () => {
    const d = diffSnapshots(snap(m('u1', ['a', 'b'])), snap(m('u1', ['a'])));
    assert.equal(hasUnplanned(unplanned(d, { allowAdded: ['b'] })), true);
    assert.equal(hasUnplanned(unplanned(d, { allowRemoved: ['b'] })), false);
  });

  it('las altas y bajas de membresías entre un volcado y otro solo se aceptan si se pide', () => {
    const d = diffSnapshots(snap(m('u1', ['a'])), snap(m('u1', ['a']), m('u9', ['a'])));
    assert.equal(hasUnplanned(unplanned(d)), true);
    assert.equal(hasUnplanned(unplanned(d, { allowMembershipChanges: true })), false);
  });

  it('el volcado no contiene datos personales: solo identificadores, rol y códigos', () => {
    const keys = Object.keys(m('u1', ['a']));
    assert.deepEqual(keys.sort(), ['accountId', 'permissions', 'role', 'source', 'userId']);
  });

  it('🔴 compara el rol global con la copia de la cuenta: iguales = sin diferencia', () => {
    const rows = [{ accountId: 'a1', userId: 'u1', role: 'MANAGER', accountPermissions: ['a', 'b'], globalPermissions: ['b', 'a'], diverged: false }];
    assert.deepEqual(compareSources(rows), []);
  });

  it('una diferencia en una copia SIN divergir es inesperada; en una divergida es esperable', () => {
    const base = { accountId: 'a1', userId: 'u1', role: 'MANAGER', accountPermissions: ['a', 'x'], globalPermissions: ['a', 'b'] };
    const sin = compareSources([{ ...base, diverged: false }]);
    assert.deepEqual(sin[0]!.onlyAccount, ['x']);
    assert.deepEqual(sin[0]!.onlyGlobal, ['b']);
    assert.equal(unexpectedMismatches(sin).length, 1);
    assert.equal(unexpectedMismatches(compareSources([{ ...base, diverged: true }])).length, 0);
  });

  it('🔴 con `data:scope:all` los alcances más angostos no suman: el administrador global (los tres) y su copia (solo `all`) son lo mismo', () => {
    assert.deepEqual(normalizeScopes(['a', 'data:scope:all', 'data:scope:subtree', 'data:scope:branch']), ['a', 'data:scope:all']);
    assert.deepEqual(normalizeScopes(['data:scope:subtree', 'data:scope:branch']), ['data:scope:subtree', 'data:scope:branch'], 'sin `all` no se toca nada');
    const rows = [{ accountId: 'a1', userId: 'u1', role: 'ACCOUNT_ADMIN', accountPermissions: ['a', 'data:scope:all'], globalPermissions: ['a', 'data:scope:all', 'data:scope:subtree', 'data:scope:branch'], diverged: false }];
    assert.deepEqual(compareSources(rows), []);
  });

  it('pero un alcance distinto de verdad sigue siendo una diferencia (gerente con subárbol vs. con toda la cuenta)', () => {
    const rows = [{ accountId: 'a1', userId: 'u1', role: 'MANAGER', accountPermissions: ['data:scope:all'], globalPermissions: ['data:scope:subtree'], diverged: false }];
    assert.equal(unexpectedMismatches(compareSources(rows)).length, 1);
  });

  it('una cuenta sin copia de su rol es inesperada siempre (aunque diga divergida)', () => {
    const r = compareSources([{ accountId: 'a1', userId: 'u1', role: 'COLLECTOR', accountPermissions: null, globalPermissions: ['a'], diverged: true }]);
    assert.equal(r[0]!.noCopy, true);
    assert.equal(unexpectedMismatches(r).length, 1);
  });

  it('un volcado serializado y vuelto a leer da el mismo resultado', () => {
    const dir = mkdtempSync(join(tmpdir(), 'perm-'));
    const f = join(dir, 'a.json');
    writeFileSync(f, JSON.stringify(snap(m('u1', ['a', 'b']))));
    const back = JSON.parse(readFileSync(f, 'utf8')) as PermissionsSnapshot;
    assert.deepEqual(diffSnapshots(back, snap(m('u1', ['a', 'b']))).changed, []);
  });

  it('🔴 resume el cambio POR ROL: quienes cambian igual van juntos y una persona que se aparta queda sola', () => {
    const before = snap(m('u1', ['a'], { role: 'COLLECTOR' }), m('u2', ['a'], { role: 'COLLECTOR' }), m('u3', ['a'], { role: 'COLLECTOR' }), m('u4', ['a', 'z'], { role: 'MANAGER' }));
    const after = snap(m('u1', ['a', 'n'], { role: 'COLLECTOR' }), m('u2', ['a', 'n'], { role: 'COLLECTOR' }), m('u3', ['a', 'n', 'raro'], { role: 'COLLECTOR' }), m('u4', ['a'], { role: 'MANAGER' }));
    const g = summarizeByRole(before, after);
    assert.deepEqual(g.map((x) => [x.role, x.people, x.added, x.removed]), [
      ['COLLECTOR', 2, ['n'], []],
      ['COLLECTOR', 1, ['n', 'raro'], []],
      ['MANAGER', 1, [], ['z']],
    ]);
  });

  it('🔴 el diff también normaliza los alcances: pasar de los tres alcances a solo `all` no es una diferencia', () => {
    const d = diffSnapshots(snap(m('u1', ['data:scope:all', 'data:scope:subtree', 'data:scope:branch'])), snap(m('u1', ['data:scope:all'])));
    assert.deepEqual(d.changed, []);
  });

  it('el resumen por rol no cuenta como cambio un alcance que se angosta sin cambiar lo que puede hacer (con `all`)', () => {
    const before = snap(m('u1', ['data:scope:all', 'data:scope:subtree', 'data:scope:branch'], { role: 'ACCOUNT_ADMIN' }));
    const after = snap(m('u1', ['data:scope:all'], { role: 'ACCOUNT_ADMIN' }));
    assert.deepEqual(summarizeByRole(before, after), []);
  });

  it('el resumen por rol y el diff dicen lo mismo (una sola fuente del cálculo)', () => {
    const b = snap(m('u1', ['a', 'z']), m('u2', ['a']));
    const a = snap(m('u1', ['a', 'n']), m('u2', ['a']));
    const changed = diffSnapshots(b, a).changed;
    const groups = summarizeByRole(b, a);
    assert.equal(changed.length, groups.reduce((n, g) => n + g.people, 0));
    assert.deepEqual([changed[0]!.added, changed[0]!.removed], [groups[0]!.added, groups[0]!.removed]);
  });
});
