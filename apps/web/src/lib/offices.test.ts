import { describe, expect, it } from 'vitest';
import {
  canAddFirstOffice,
  deactivateBlockers,
  expandedUpTo,
  filterOfficeTree,
  isMultiOffice,
  maxDepthOf,
  moveVerdict,
  officeOptions,
  officePlan,
  parseOfficeDetail,
  rootPortfolioPending,
  willBranchRootWithPortfolio,
  type OfficeRow,
} from './offices';

/** El caso de referencia de la usuaria (R10): Central → La Paz · Cochabamba · Chuquisaca → agencias de Sucre y provincia. */
function office(id: string, name: string, parent: OfficeRow | null, extra: Partial<OfficeRow> = {}): OfficeRow {
  const path = `${parent?.path ?? '/'}${id}/`;
  return {
    id,
    name,
    code: null,
    city: null,
    address: null,
    active: true,
    parentId: parent?.id ?? null,
    typeId: 't',
    typeName: null,
    path,
    depth: parent ? parent.depth + 1 : 0,
    isRoot: !parent,
    fullName: parent ? `${parent.fullName} › ${name}` : name,
    managerUserId: null,
    members: 0,
    credits: 0,
    ...extra,
  };
}

const central = office('c', 'Central', null);
const lp = office('lp', 'La Paz', central);
const cb = office('cb', 'Cochabamba', central);
const ch = office('ch', 'Chuquisaca', central, { members: 2 });
const mv = office('mv', 'Mesa Verde', ch, { code: 'MV', credits: 12, members: 3 });
const chCentral = office('cc', 'Central', ch);
const camargo = office('cm', 'Camargo', ch, { city: 'Camargo' });
const ROWS = [central, lp, cb, ch, mv, chCentral, camargo];

describe('isMultiOffice (RULES C2)', () => {
  it('una sola oficina vigente no tiene jerarquía que mostrar', () => {
    expect(isMultiOffice([central])).toBe(false);
    expect(isMultiOffice([central, { ...lp, active: false }])).toBe(false);
  });
  it('con dos vigentes sí', () => {
    expect(isMultiOffice([central, lp])).toBe(true);
  });
});

describe('officeOptions', () => {
  it('no ofrece nada si la cuenta tiene una sola oficina (sin selector)', () => {
    expect(officeOptions([central])).toEqual([]);
  });
  it('va en orden de árbol y con la ruta completa: dos «Central» no se confunden', () => {
    const names = officeOptions(ROWS).map((o) => o.name);
    expect(names).toEqual([
      'Central',
      'Central › Chuquisaca',
      'Central › Chuquisaca › Camargo',
      'Central › Chuquisaca › Central',
      'Central › Chuquisaca › Mesa Verde',
      'Central › Cochabamba',
      'Central › La Paz',
    ]);
  });
  it('omite las desactivadas', () => {
    expect(officeOptions([...ROWS, office('x', 'Vieja', central, { active: false })]).map((o) => o.id)).not.toContain('x');
  });
});

describe('filterOfficeTree', () => {
  it('sin texto todo se ve', () => {
    expect(filterOfficeTree(ROWS, '').visible.size).toBe(ROWS.length);
  });
  it('muestra las coincidencias más sus ancestros', () => {
    const { visible, matched } = filterOfficeTree(ROWS, 'mesa');
    expect([...matched]).toEqual(['mv']);
    expect([...visible].sort()).toEqual(['c', 'ch', 'mv']);
  });
  it('ignora tildes y mayúsculas, y busca por código y ciudad', () => {
    expect([...filterOfficeTree(ROWS, 'LA PAZ').matched]).toEqual(['lp']);
    expect([...filterOfficeTree(ROWS, 'mv').matched]).toEqual(['mv']);
    expect([...filterOfficeTree(ROWS, 'camargo').matched]).toEqual(['cm']);
  });
  it('un texto que no coincide deja vacío', () => {
    expect(filterOfficeTree(ROWS, 'zzz').visible.size).toBe(0);
  });
});

describe('niveles', () => {
  it('expande los nodos de profundidad menor al nivel', () => {
    expect([...expandedUpTo(ROWS, 1)]).toEqual(['c']);
    expect([...expandedUpTo(ROWS, 2)].sort()).toEqual(['c', 'cb', 'ch', 'lp']);
    expect(maxDepthOf(ROWS)).toBe(2);
  });
});

describe('moveVerdict', () => {
  it('no se mueve la raíz', () => {
    expect(moveVerdict(ROWS, 'c', 'lp')).toBe('IS_ROOT');
  });
  it('no entra en su propio subárbol (ciclo) ni en sí misma', () => {
    expect(moveVerdict(ROWS, 'ch', 'mv')).toBe('INTO_OWN_SUBTREE');
    expect(moveVerdict(ROWS, 'ch', 'ch')).toBe('INTO_ITSELF');
  });
  it('mover al mismo padre no es un movimiento', () => {
    expect(moveVerdict(ROWS, 'mv', 'ch')).toBe('SAME_PARENT');
  });
  it('una agencia puede pasar a otra regional', () => {
    expect(moveVerdict(ROWS, 'mv', 'lp')).toBe('OK');
  });
  it('un id que no existe no pasa', () => {
    expect(moveVerdict(ROWS, 'mv', 'nope')).toBe('NOT_FOUND');
  });
});

describe('deactivateBlockers', () => {
  it('avisa lo mismo que rechazaría el servidor', () => {
    expect(deactivateBlockers(ROWS, 'c').blockers).toEqual(expect.arrayContaining(['ROOT', 'ACTIVE_CHILDREN']));
    expect(deactivateBlockers(ROWS, 'mv')).toMatchObject({ blockers: ['CREDITS', 'MEMBERS'], credits: 12, members: 3 });
    expect(deactivateBlockers(ROWS, 'ch').blockers).toEqual(['ACTIVE_CHILDREN', 'MEMBERS']);
  });
  it('una hoja vacía se puede dar de baja', () => {
    expect(deactivateBlockers(ROWS, 'lp').blockers).toEqual([]);
  });
  it('las hijas ya desactivadas no bloquean', () => {
    const rows = [central, { ...lp, active: false }];
    expect(deactivateBlockers(rows, 'c').blockers).toEqual(['ROOT']);
  });
});

describe('cartera de la raíz (ADR-0004)', () => {
  const rootWithPortfolio = { ...central, credits: 40 };
  it('al crear la primera hija avisa', () => {
    expect(willBranchRootWithPortfolio([rootWithPortfolio], 'c')).toBe(true);
    expect(willBranchRootWithPortfolio([rootWithPortfolio, lp], 'c')).toBe(false);
    expect(willBranchRootWithPortfolio([central], 'c')).toBe(false);
  });
  it('queda pendiente mientras la raíz con créditos tenga hijas', () => {
    expect(rootPortfolioPending([rootWithPortfolio])).toBeNull();
    expect(rootPortfolioPending([rootWithPortfolio, lp])?.id).toBe('c');
    expect(rootPortfolioPending([central, lp])).toBeNull();
  });
});

describe('plan', () => {
  it('canAddFirstOffice exige permiso y cupo (la raíz cuenta)', () => {
    expect(canAddFirstOffice({ canWrite: true, used: 1, limit: 3 })).toBe(true);
    expect(canAddFirstOffice({ canWrite: true, used: 1, limit: 1 })).toBe(false);
    expect(canAddFirstOffice({ canWrite: false, used: 1, limit: 3 })).toBe(false);
    expect(canAddFirstOffice({ canWrite: true, used: 5, limit: null })).toBe(true);
  });
  it('officePlan usa lo que dice el servidor y, si falta, cuenta las vigentes', () => {
    expect(officePlan({ limits: { branches: 3 }, usage: { branches: 2 } }, ROWS)).toEqual({ used: 2, limit: 3 });
    expect(officePlan({ limits: {}, usage: {} }, ROWS)).toEqual({ used: 7, limit: null });
    expect(officePlan(null, [central])).toEqual({ used: 1, limit: null });
  });
});

describe('parseOfficeDetail', () => {
  it('acepta members como lista y trae estadísticas e historial', () => {
    const d = parseOfficeDetail({
      ...mv,
      members: [{ userId: 'u1', name: 'Ana' }],
      stats: { members: 1, credits: 12, children: 0, arrears: 4 },
      history: [{ id: 'h', action: 'UPDATE', at: '2026-11-02T10:00:00Z', actorName: 'Sara', summary: null }],
    });
    expect(d.membersList).toHaveLength(1);
    expect(d.stats).toEqual({ members: 1, credits: 12, children: 0, arrears: 4 });
    expect(d.history).toHaveLength(1);
  });
  it('acepta members como conteo y estadísticas ausentes sin romperse', () => {
    const d = parseOfficeDetail({ ...mv });
    expect(d.membersCount).toBe(3);
    expect(d.membersList).toEqual([]);
    expect(d.stats).toEqual({ members: 3, credits: 12, children: 0, arrears: null });
    expect(d.history).toEqual([]);
  });
});
