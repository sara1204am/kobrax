import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildMoraOrder, buildMoraWhere, escapeLike, moraAccessConditions, moraScopeOf, type MoraScope } from './mora-query';

const NOW = new Date('2026-10-01T12:00:00Z');
const ADMIN: MoraScope = { accountId: 'acc', userId: 'u-admin', ownOnly: false, canAssign: true };
const COLLECTOR: MoraScope = { accountId: 'acc', userId: 'u-col', ownOnly: true, canAssign: false };
const VIEWER: MoraScope = { accountId: 'acc', userId: 'u-view', ownOnly: false, canAssign: false };

const where = (q: Parameters<typeof buildMoraWhere>[0], s: MoraScope = ADMIN) => buildMoraWhere(q, s, NOW);

describe('buildMoraWhere — qué créditos entran', () => {
  it('por defecto: sólo en mora (dpd >= 1), del tenant y sin borrados', () => {
    const w = where({});
    assert.match(w.sql, /cr\.account_id = ?/);
    assert.match(w.sql, /cr\.deleted_at IS NULL/);
    assert.match(w.sql, /cr\.days_past_due >= ?/);
    assert.ok(w.values.includes(1));
    assert.ok(w.values.includes('acc'));
  });

  it('todos=true incluye los al día y las operaciones ausentes', () => {
    const w = where({ todos: 'true' });
    assert.doesNotMatch(w.sql, /cr\.days_past_due >=/);
    assert.doesNotMatch(w.sql, /<> 'ABSENT'/);
  });

  it('una operación externa ausente del reporte no se lista por defecto (D4)', () => {
    assert.match(where({}).sql, /cr\.sync_status::text <> 'ABSENT'/);
  });

  it('dpdMin explícito manda sobre el default', () => {
    const w = where({ dpdMin: 90, dpdMax: 120 });
    assert.ok(w.values.includes(90));
    assert.ok(w.values.includes(120));
    assert.ok(!w.values.includes(1));
  });

  it('solo créditos ACTIVE, o DEFAULTED de fuente externa', () => {
    assert.match(where({}).sql, /cr\.status::text = 'ACTIVE' OR \(cr\.status::text = 'DEFAULTED' AND cr\.external_source IS NOT NULL\)/);
  });
});

describe('buildMoraWhere — alcance (C2/C4)', () => {
  it('el cobrador ve lo suyo: crédito a su cargo (responsable o asignación vigente), con o sin caso', () => {
    const w = where({}, COLLECTOR);
    assert.match(w.sql, /cr\.assigned_manager_id = ?/);
    assert.match(w.sql, /cc\.assignee_id = ?/);
    assert.match(w.sql, /credit_assignments/);
    assert.match(w.sql, /ca\.revoked_at IS NULL/);
    assert.ok(w.values.includes('u-col'));
  });

  it('moraScopeOf: por capacidad, igual que la ficha (case:write sin case:assign = sólo lo suyo)', () => {
    const t = (perms: string[]) => moraScopeOf({ accountId: 'acc', userId: 'u', can: (p) => perms.includes(p) });
    assert.deepEqual(t(['case:write']), { accountId: 'acc', userId: 'u', ownOnly: true, canAssign: false });
    assert.equal(t(['case:write', 'case:assign']).ownOnly, false);
    assert.equal(t(['case:read']).ownOnly, false);
  });

  it('el cobrador no puede ampliar su alcance con assigneeId, unassigned ni hasCase=false', () => {
    const w = where({ assigneeId: '11111111-1111-1111-1111-111111111111', unassigned: 'true' }, COLLECTOR);
    assert.ok(!w.values.includes('11111111-1111-1111-1111-111111111111'));
    assert.doesNotMatch(w.sql, /cc\.assignee_id IS NULL/);
    // sigue acotado a lo suyo
    assert.ok(w.values.includes('u-col'));
  });

  it('quien reparte ve todo (incluidos créditos sin caso) y puede filtrar por cobrador y por sin asignar', () => {
    assert.doesNotMatch(where({}).sql, /cc\.assignee_id/);
    assert.ok(where({ assigneeId: 'u-x' }).values.includes('u-x'));
    assert.match(where({ unassigned: 'true' }).sql, /cc\.id IS NOT NULL AND cc\.assignee_id IS NULL/);
    assert.match(where({ hasCase: 'false' }).sql, /cc\.id IS NULL/);
  });

  it('el rol sólo lector ve todo pero no filtra por cobrador', () => {
    const w = where({ assigneeId: 'u-x', unassigned: 'true' }, VIEWER);
    assert.doesNotMatch(w.sql, /cc\.assignee_id/);
  });
});

describe('buildMoraWhere — filtros', () => {
  it('fuente: KOBRAX = sin fuente externa; PSF = esa fuente', () => {
    assert.match(where({ source: 'KOBRAX' }).sql, /cr\.external_source IS NULL/);
    assert.ok(where({ source: 'PSF' }).values.includes('PSF'));
  });

  it('origen de la mora sigue la regla de arrearsSourceOf', () => {
    assert.match(where({ arrearsSource: 'IMPORTED' }).sql, /cr\.origin::text IN \('IMPORT', 'API'\)/);
    assert.match(where({ arrearsSource: 'MANUAL' }).sql, /NOT IN \('IMPORT', 'API'\) AND \(cr\.metadata->>'moraSince'\) IS NOT NULL/);
    assert.match(where({ arrearsSource: 'CALCULATED' }).sql, /\(cr\.metadata->>'moraSince'\) IS NULL/);
  });

  it('prioridad y estado: sólo valores del enum; lo desconocido se descarta', () => {
    const w = where({ priority: 'CRITICAL,INVENTADA', status: 'ACTIVE' });
    assert.ok(w.values.some((v) => Array.isArray(v) && v.length === 1 && v[0] === 'CRITICAL'));
    assert.ok(w.values.some((v) => Array.isArray(v) && v[0] === 'ACTIVE'));
    assert.doesNotMatch(where({ priority: 'INVENTADA' }).sql, /cc\.priority/);
  });

  it('oficina, saldo y SLA vencido', () => {
    const w = where({ branchId: 'b1', balanceMin: 100, balanceMax: 900, overdue: 'true' });
    assert.match(w.sql, /cr\.branch_id = ?/);
    assert.match(w.sql, /cr\.outstanding_balance >= ?/);
    assert.match(w.sql, /cc\.sla_due_at < ?/);
    assert.ok(w.values.includes('b1') && w.values.includes(100) && w.values.includes(900));
  });

  it('promesa vigente: EXISTS / NOT EXISTS sobre la agenda', () => {
    assert.match(where({ hasPromise: 'true' }).sql, /EXISTS \(\s*SELECT 1 FROM agenda_items a/);
    assert.match(where({ hasPromise: 'false' }).sql, /NOT EXISTS/);
  });

  it('sin gestión desde una fecha incluye a quien nunca tuvo', () => {
    assert.match(where({ noActionSince: '2026-09-01' }).sql, /cc\.last_action_at IS NULL OR cc\.last_action_at </);
  });
});

describe('buildMoraWhere — búsqueda', () => {
  it('busca por nº de crédito, nombre palabra por palabra y zona en la misma caja', () => {
    const w = where({ q: 'Teresa Mama' });
    assert.match(w.sql, /cr\.code ILIKE/);
    assert.match(w.sql, /l\.zone ILIKE/);
    assert.match(w.sql, /cl\.first_name ILIKE/);
    assert.ok(w.values.includes('%Teresa%'));
    assert.ok(w.values.includes('%Mama%'));
  });

  it('el texto del usuario va como parámetro, nunca en el SQL', () => {
    const w = where({ q: "x'; DROP TABLE credits;--" });
    assert.doesNotMatch(w.sql, /DROP TABLE/);
  });

  it('% y _ del usuario son literales', () => {
    assert.equal(escapeLike('50%_off\\'), '50\\%\\_off\\\\');
    assert.ok(where({ q: '100%' }).values.includes('%100\\%%'));
  });

  it('q vacío no agrega condición', () => {
    assert.doesNotMatch(where({ q: '   ' }).sql, /ILIKE/);
  });
});

describe('buildMoraOrder', () => {
  const order = (s?: string, d?: string) => buildMoraOrder(s, d).sql;

  it('default: días de mora descendente, nulos al final y desempate por id', () => {
    assert.equal(order(), 'cr.days_past_due DESC NULLS LAST, cr.id ASC');
  });

  it('prioridad ordena crítica primero y los créditos sin caso al final', () => {
    const o = order('priority', 'desc');
    assert.match(o, /CASE cc\.priority::text WHEN 'CRITICAL' THEN 4/);
    assert.match(o, /DESC NULLS LAST, cr\.days_past_due DESC, cr\.id ASC$/);
  });

  it('claves y dirección desconocidas caen al default (no rebotan ni inyectan)', () => {
    assert.equal(order('hasOwnProperty'), order());
    assert.equal(order('1; DROP TABLE x'), order());
    assert.match(order('balance', 'sideways'), /outstanding_balance DESC/);
    assert.match(order('balance', 'asc'), /outstanding_balance ASC/);
  });
});

describe('moraAccessConditions — la ficha tiene el mismo alcance que la lista', () => {
  const access = (s: MoraScope) => {
    const parts = moraAccessConditions(s);
    return { sql: parts.map((p) => p.sql).join(' AND '), values: parts.flatMap((p) => p.values) };
  };

  it('siempre acota por tenant y excluye lo borrado, sin exigir estar en mora', () => {
    const a = access(ADMIN);
    assert.match(a.sql, /cr.account_id = ?/);
    assert.match(a.sql, /cr.deleted_at IS NULL/);
    assert.doesNotMatch(a.sql, /days_past_due/);
    assert.doesNotMatch(a.sql, /cc.assignee_id/);
  });

  it('el cobrador sólo abre el crédito si el caso abierto es suyo', () => {
    const a = access(COLLECTOR);
    assert.match(a.sql, /cc.assignee_id = ?/);
    assert.ok(a.values.includes('u-col'));
  });

  it('la lista usa las mismas condiciones de acceso', () => {
    const list = where({}, COLLECTOR);
    for (const p of moraAccessConditions(COLLECTOR)) assert.ok(list.sql.includes(p.sql));
  });
});
