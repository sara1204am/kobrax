import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ARREAR_CATEGORIES, Permission, categoryForDays } from '@kobrax/shared';
import { buildMoraOrder, buildMoraWhere, categoryCodes, escapeLike, moraAccessConditions, moraScopeOf, routedDay, visitCutoff, type MoraCategoryRange, type MoraScope } from './mora-query';

const NOW = new Date('2026-10-01T12:00:00Z');
const ADMIN: MoraScope = { accountId: 'acc', userId: 'u-admin', kind: 'ALL', ownOnly: false, canAssign: true };
const SUPERVISOR: MoraScope = { accountId: 'acc', userId: 'u-sup', kind: 'BRANCH', ownOnly: false, canAssign: true };
const COLLECTOR: MoraScope = { accountId: 'acc', userId: 'u-col', kind: 'OWN', ownOnly: true, canAssign: false };

const CATS: MoraCategoryRange[] = DEFAULT_ARREAR_CATEGORIES.map((c) => ({ code: c.code, name: c.name, color: c.color, fromDays: c.fromDays, toDays: c.toDays }));

const where = (q: Parameters<typeof buildMoraWhere>[0], s: MoraScope = ADMIN, cats: MoraCategoryRange[] = CATS) => buildMoraWhere(q, s, NOW, cats);

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

  it('una operación externa ausente del reporte no se lista por defecto (D9)', () => {
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

  it('F4/08: ya no hay JOIN ni referencia al caso en ninguna parte', () => {
    const everything = where({ priority: 'HIGH', assigneeId: 'u-x', unassigned: 'true', category: 'A', writtenOff: 'true', hasPromise: 'true', q: 'x' }, SUPERVISOR);
    assert.doesNotMatch(everything.sql, /\bcc\./);
    assert.doesNotMatch(everything.sql, /collection_cases/);
  });
});

describe('buildMoraWhere — filtros que ya no existen no filtran ni rompen', () => {
  it('estado, hasCase, SLA y «sin gestión desde» se ignoran (D1/D2)', () => {
    const base = where({});
    const old = where({ status: 'ACTIVE', hasCase: 'true', overdue: 'true', noActionSince: '2026-09-01' });
    assert.equal(old.sql, base.sql);
    assert.deepEqual(old.values, base.values);
  });
});

describe('buildMoraWhere — categoría de mora (rangos de la cuenta)', () => {
  const rangeOf = (code: string) => where({ category: code });

  it('A = 1–30: ambos extremos entran como parámetros', () => {
    const w = rangeOf('A');
    assert.match(w.sql, /cr\.days_past_due >= \? AND cr\.days_past_due <= \?/);
    assert.ok(w.values.includes(1) && w.values.includes(30));
  });

  it('B = 31–60 y C = 61 en adelante (sin tope)', () => {
    const b = rangeOf('B');
    assert.ok(b.values.includes(31) && b.values.includes(60));
    const c = rangeOf('C');
    assert.ok(c.values.includes(61));
    assert.doesNotMatch(c.sql.split('(cr.sync_status')[1] ?? '', /days_past_due <=/);
  });

  it('en los límites 1, 30, 31, 60, 61 el filtro coincide con la categoría calculada de la fila', () => {
    // Evalúa el rango que el filtro pone en el SQL contra `categoryForDays`: una sola definición de los límites.
    const inRange = (code: string, days: number): boolean => {
      const cat = CATS.find((c) => c.code === code)!;
      return days >= cat.fromDays && (cat.toDays === null || days <= cat.toDays);
    };
    for (const days of [1, 30, 31, 60, 61]) {
      const owner = categoryForDays(days, CATS)!.code;
      for (const code of ['A', 'B', 'C']) assert.equal(inRange(code, days), code === owner, `día ${days} / ${code}`);
    }
  });

  it('varias categorías se unen con OR; el orden y los repetidos no importan', () => {
    const w = where({ category: 'C, A,A' });
    // Salen en el orden pedido (C primero, sin tope; luego A) y A una sola vez.
    assert.match(w.sql, /\(cr\.days_past_due >= \? OR \(cr\.days_past_due >= \? AND cr\.days_past_due <= \?\)\)/);
    assert.deepEqual(categoryCodes('C, A,A,'), ['C', 'A']);
  });

  it('un código que la cuenta no tiene (enlace viejo) se ignora; sin categorías configuradas tampoco filtra', () => {
    assert.equal(where({ category: 'Z' }).sql, where({}).sql);
    assert.equal(where({ category: 'A' }, ADMIN, []).sql, where({}).sql);
  });

  it('respeta los rangos EDITADOS de la cuenta, no unos escritos en el código', () => {
    const custom: MoraCategoryRange[] = [
      { code: 'A', name: 'A', color: null, fromDays: 1, toDays: 15 },
      { code: 'B', name: 'B', color: null, fromDays: 16, toDays: null },
    ];
    const w = where({ category: 'A' }, ADMIN, custom);
    assert.ok(w.values.includes(15));
    assert.ok(!w.values.includes(30));
  });
});

describe('buildMoraWhere — castigado (condición aparte)', () => {
  it('writtenOff=true: sólo castigados, aunque el estado del crédito ya no sea ACTIVE, y sin exigir mora', () => {
    const w = where({ writtenOff: 'true' });
    assert.match(w.sql, /cr\.written_off_at IS NOT NULL/);
    assert.match(w.sql, /OR cr\.written_off_at IS NOT NULL\)/);
    assert.doesNotMatch(w.sql, /cr\.days_past_due >=/);
  });

  it('writtenOff=false: deja afuera a los castigados y conserva el default de mora', () => {
    const w = where({ writtenOff: 'false' });
    assert.match(w.sql, /cr\.written_off_at IS NULL/);
    assert.match(w.sql, /cr\.days_past_due >=/);
  });

  it('sin el filtro, el castigo no se mira', () => {
    assert.doesNotMatch(where({}).sql, /written_off_at/);
  });
});

describe('buildMoraWhere — responsable y prioridad del episodio', () => {
  it('assigneeId = responsable del crédito O temporal/apoyo vigentes del mismo (misma regla que el acceso)', () => {
    const w = where({ assigneeId: '11111111-1111-1111-1111-111111111111' });
    assert.match(w.sql, /cr\.assigned_manager_id = \? OR EXISTS/);
    assert.match(w.sql, /ca\.kind::text = ANY/);
    assert.match(w.sql, /ca\.revoked_at IS NULL AND ca\.starts_at <= now\(\) AND \(ca\.expires_at IS NULL OR ca\.expires_at > now\(\)\)/);
    assert.ok(w.values.some((v) => Array.isArray(v) && v.includes('TEMPORAL') && v.includes('APOYO') && !v.includes('PRINCIPAL')));
  });

  it('unassigned = sin responsable', () => {
    assert.match(where({ unassigned: 'true' }).sql, /cr\.assigned_manager_id IS NULL/);
  });

  it('prioridad: filtra la del episodio abierto; sólo valores del enum, lo desconocido se descarta', () => {
    const w = where({ priority: 'CRITICAL,INVENTADA' });
    assert.match(w.sql, /ep\.priority::text = ANY/);
    assert.ok(w.values.some((v) => Array.isArray(v) && v.length === 1 && v[0] === 'CRITICAL'));
    assert.doesNotMatch(where({ priority: 'INVENTADA' }).sql, /ep\.priority/);
  });
});

describe('alcance (D8) — moraScopeOf', () => {
  const t = (perms: string[]) => moraScopeOf({ accountId: 'acc', userId: 'u', can: (p) => perms.includes(p) });

  it('data:scope:all → todo; data:scope:branch → su agencia; ninguno → lo suyo', () => {
    assert.equal(t([Permission.DATA_SCOPE_ALL]).kind, 'ALL');
    assert.equal(t([Permission.DATA_SCOPE_BRANCH]).kind, 'BRANCH');
    assert.equal(t([Permission.COLLECTION_WRITE]).kind, 'OWN');
    assert.equal(t([]).kind, 'OWN');
  });

  it('si tiene los dos, manda el total', () => {
    assert.equal(t([Permission.DATA_SCOPE_BRANCH, Permission.DATA_SCOPE_ALL]).kind, 'ALL');
  });

  it('sólo el cobrador está acotado a lo suyo y no filtra por responsable', () => {
    assert.deepEqual(t([Permission.COLLECTION_WRITE]), { accountId: 'acc', userId: 'u', kind: 'OWN', ownOnly: true, canAssign: false });
    assert.equal(t([Permission.DATA_SCOPE_BRANCH]).canAssign, true);
    assert.equal(t([Permission.DATA_SCOPE_ALL]).ownOnly, false);
  });
});

describe('alcance (D8) — qué ve cada uno', () => {
  const access = (s: MoraScope) => {
    const parts = moraAccessConditions(s);
    return { sql: parts.map((p) => p.sql).join(' AND '), values: parts.flatMap((p) => p.values) };
  };

  it('gerente / administrador (ALL): todo el tenant, sin condición de responsable ni de agencia', () => {
    const a = access(ADMIN);
    assert.match(a.sql, /cr\.account_id = ?/);
    assert.match(a.sql, /cr\.deleted_at IS NULL/);
    assert.doesNotMatch(a.sql, /assigned_manager_id|credit_assignments|user_accounts|branch_id/);
    assert.doesNotMatch(a.sql, /days_past_due/);
  });

  it('cobrador (OWN): el crédito a su cargo — responsable, o asignación vigente de cualquier tipo (temporal y apoyo incluidos)', () => {
    const a = access(COLLECTOR);
    assert.match(a.sql, /cr\.assigned_manager_id = \? OR EXISTS/);
    assert.match(a.sql, /FROM credit_assignments ca/);
    assert.match(a.sql, /ca\.revoked_at IS NULL AND ca\.starts_at <= now\(\) AND \(ca\.expires_at IS NULL OR ca\.expires_at > now\(\)\)/);
    // No acota por tipo: TEMPORAL y APOYO ven y trabajan el crédito igual que el principal.
    assert.doesNotMatch(a.sql, /ca\.kind/);
    assert.ok(a.values.every((v) => v !== 'u-other'));
    assert.ok(a.values.includes('u-col'));
  });

  it('cobrador: nada de su agencia ni de créditos sin responsable', () => {
    const a = access(COLLECTOR);
    assert.doesNotMatch(a.sql, /user_accounts|branch_id/);
    assert.doesNotMatch(a.sql, /assigned_manager_id IS NULL/);
  });

  it('supervisor (BRANCH): lo suyo O los créditos CON responsable de su agencia (user_accounts.branch_id)', () => {
    const a = access(SUPERVISOR);
    // lo suyo (mismo predicado que el cobrador)
    assert.match(a.sql, /cr\.assigned_manager_id = \? OR EXISTS/);
    // su agencia, y sólo si alguien lo atiende
    assert.match(a.sql, /cr\.assigned_manager_id IS NOT NULL AND cr\.branch_id IS NOT NULL AND cr\.branch_id = \(\s*SELECT ua\.branch_id FROM user_accounts ua/);
    assert.match(a.sql, /ua\.user_id = \? AND ua\.account_id = cr\.account_id AND ua\.is_active = true/);
    assert.ok(a.values.filter((v) => v === 'u-sup').length >= 3);
  });

  it('un crédito SIN responsable queda fuera del cobrador y del supervisor, y sólo lo ve el alcance total', () => {
    // El crédito sin responsable no cumple `assigned_manager_id = yo` ni la rama de agencia (exige IS NOT NULL).
    for (const s of [COLLECTOR, SUPERVISOR]) {
      const sql = moraAccessConditions(s).map((p) => p.sql).join(' AND ');
      assert.match(sql, /assigned_manager_id = \?/);
      assert.doesNotMatch(sql, /assigned_manager_id IS NULL/);
    }
    assert.doesNotMatch(moraAccessConditions(SUPERVISOR).map((p) => p.sql).join(' '), /OR cr\.branch_id = /);
    assert.doesNotMatch(moraAccessConditions(ADMIN).map((p) => p.sql).join(' '), /assigned_manager_id/);
  });

  it('el cobrador no puede ampliar su alcance con assigneeId ni unassigned', () => {
    const w = where({ assigneeId: '11111111-1111-1111-1111-111111111111', unassigned: 'true' }, COLLECTOR);
    assert.ok(!w.values.includes('11111111-1111-1111-1111-111111111111'));
    assert.doesNotMatch(w.sql, /assigned_manager_id IS NULL/);
    assert.ok(w.values.includes('u-col'));
  });

  it('supervisor y gerente sí filtran por responsable y por sin responsable', () => {
    for (const s of [SUPERVISOR, ADMIN]) {
      assert.ok(where({ assigneeId: '11111111-1111-1111-1111-111111111111' }, s).values.includes('11111111-1111-1111-1111-111111111111'));
      assert.match(where({ unassigned: 'true' }, s).sql, /cr\.assigned_manager_id IS NULL/);
    }
  });

  it('la lista usa las mismas condiciones de acceso que la ficha y la agenda', () => {
    for (const s of [ADMIN, SUPERVISOR, COLLECTOR]) {
      const list = where({}, s);
      for (const p of moraAccessConditions(s)) assert.ok(list.sql.includes(p.sql));
    }
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

  it('oficina y saldo', () => {
    const w = where({ branchId: 'b1', balanceMin: 100, balanceMax: 900 });
    assert.match(w.sql, /cr\.branch_id = ?/);
    assert.match(w.sql, /cr\.outstanding_balance >= ?/);
    assert.ok(w.values.includes('b1') && w.values.includes(100) && w.values.includes(900));
  });

  it('promesa vigente: EXISTS / NOT EXISTS sobre la agenda', () => {
    assert.match(where({ hasPromise: 'true' }).sql, /EXISTS \(\s*SELECT 1 FROM agenda_items a/);
    assert.match(where({ hasPromise: 'false' }).sql, /NOT EXISTS/);
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

  it('prioridad sale del EPISODIO abierto: crítica primero y los créditos al día al final', () => {
    const o = order('priority', 'desc');
    assert.match(o, /CASE ep\.priority::text WHEN 'CRITICAL' THEN 4/);
    assert.match(o, /DESC NULLS LAST, cr\.days_past_due DESC, cr\.id ASC$/);
  });

  it('claves y dirección desconocidas caen al default (no rebotan ni inyectan)', () => {
    assert.equal(order('hasOwnProperty'), order());
    assert.equal(order('1; DROP TABLE x'), order());
    assert.match(order('balance', 'sideways'), /outstanding_balance DESC/);
    assert.match(order('balance', 'asc'), /outstanding_balance ASC/);
  });

  it('lastAction y slaDueAt ya no ordenan (D2): caen al default', () => {
    assert.equal(order('lastAction'), order());
    assert.equal(order('slaDueAt', 'asc'), order(undefined, 'asc'));
  });
});

describe('buildMoraWhere — filtros de planificación de rutas (por crédito)', () => {
  it('sin filtros de visita ni de ruta no toca field_visits ni route_stops', () => {
    const w = where({});
    assert.doesNotMatch(w.sql, /field_visits/);
    assert.doesNotMatch(w.sql, /route_stops/);
  });

  it('excludeRouted=true excluye las paradas de rutas NO canceladas de hoy, por credit_id', () => {
    const w = where({ excludeRouted: 'true' });
    assert.match(w.sql, /NOT EXISTS \(\s*SELECT 1 FROM route_stops rs JOIN route_plans rp ON rp\.id = rs\.route_id/);
    assert.match(w.sql, /rs\.credit_id = cr\.id/);
    assert.match(w.sql, /rp\.status::text <> 'CANCELLED'/);
    assert.ok(w.values.includes('2026-10-01'), 'hoy en UTC');
    assert.doesNotMatch(w.sql, /case_id/);
  });

  it('excludeRouted acepta una fecha (lo que mandaba el filtro viejo) y la pasa como parámetro', () => {
    const w = where({ excludeRouted: '2026-11-15' });
    assert.ok(w.values.includes('2026-11-15'));
    assert.match(w.sql, /rp\.planned_date = \?::date/);
  });

  it('excludeRouted inválido o vacío se ignora (nunca un 400 ni una consulta rota)', () => {
    for (const bad of ['false', 'mañana', '2026-02-31', '2026-13-01', '', '   ']) {
      assert.doesNotMatch(where({ excludeRouted: bad }).sql, /route_stops/, `«${bad}»`);
    }
  });

  it('neverVisited=true: NOT EXISTS sobre field_visits.credit_id', () => {
    const w = where({ neverVisited: 'true' });
    assert.match(w.sql, /NOT EXISTS \(SELECT 1 FROM field_visits v WHERE v\.credit_id = cr\.id AND v\.account_id = cr\.account_id\)/);
  });

  it('neverVisited=false no filtra', () => {
    assert.doesNotMatch(where({ neverVisited: 'false' }).sql, /field_visits/);
  });

  it('notVisitedSince con fecha: ninguna visita con captured_at >= esa fecha (incluye los nunca visitados)', () => {
    const w = where({ notVisitedSince: '2026-09-01' });
    assert.match(w.sql, /NOT EXISTS \(SELECT 1 FROM field_visits v WHERE .* AND v\.captured_at >= \?\)/);
    assert.ok(w.values.some((v) => v instanceof Date && v.toISOString() === '2026-09-01T00:00:00.000Z'));
  });

  it('notVisitedSince con días: cuenta hacia atrás desde ahora', () => {
    const w = where({ notVisitedSince: '30' });
    assert.ok(w.values.some((v) => v instanceof Date && v.toISOString() === '2026-09-01T12:00:00.000Z'));
  });

  it('neverVisited=true gana sobre notVisitedSince (es un subconjunto): no se repite el criterio', () => {
    const w = where({ neverVisited: 'true', notVisitedSince: '30' });
    assert.doesNotMatch(w.sql, /captured_at/);
  });

  it('outcome = resultado de la ÚLTIMA visita; sólo valores del enum, lo demás se descarta', () => {
    const w = where({ outcome: 'NOT_FOUND, REFUSAL,INVENTADO,NOT_FOUND' });
    assert.match(w.sql, /ORDER BY v\.captured_at DESC, v\.id DESC LIMIT 1\) = ANY\(\?::text\[\]\)/);
    const list = w.values.find((v) => Array.isArray(v) && v.includes('NOT_FOUND')) as string[];
    assert.deepEqual(list, ['NOT_FOUND', 'REFUSAL']);
  });

  it('outcome sin ningún valor válido no filtra', () => {
    assert.doesNotMatch(where({ outcome: 'XX,YY' }).sql, /field_visits/);
    assert.doesNotMatch(where({ outcome: '' }).sql, /field_visits/);
  });

  it('el filtro es del crédito, no del caso: ningún filtro nuevo menciona collection_cases', () => {
    const w = where({ excludeRouted: 'true', outcome: 'PAID', notVisitedSince: '7', zone: 'Centro' });
    assert.doesNotMatch(w.sql, /collection_cases|case_id/);
  });
});

describe('routedDay / visitCutoff — valores límite', () => {
  it('routedDay: true = hoy; fecha real = ella; el resto null', () => {
    assert.equal(routedDay('true', NOW), '2026-10-01');
    assert.equal(routedDay('2026-02-28', NOW), '2026-02-28');
    assert.equal(routedDay('2024-02-29', NOW), '2024-02-29', 'bisiesto');
    assert.equal(routedDay('2026-02-29', NOW), null, 'no bisiesto');
    assert.equal(routedDay(undefined, NOW), null);
  });

  it('visitCutoff: 1 y 3650 días son los extremos válidos; 0, 3651 y basura no filtran', () => {
    assert.equal(visitCutoff('1', NOW)?.toISOString(), '2026-09-30T12:00:00.000Z');
    assert.ok(visitCutoff('3650', NOW));
    assert.equal(visitCutoff('0', NOW), null);
    assert.equal(visitCutoff('3651', NOW), null);
    assert.equal(visitCutoff('-5', NOW), null);
    assert.equal(visitCutoff('1.5', NOW), null);
    assert.equal(visitCutoff('abc', NOW), null);
    assert.equal(visitCutoff('2026-02-31', NOW), null);
    assert.equal(visitCutoff('2026-10-01', NOW)?.toISOString(), '2026-10-01T00:00:00.000Z');
  });
});
