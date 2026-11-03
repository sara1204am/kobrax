import { describe, expect, it } from 'vitest';
import {
  MAX_OFFICE_DEPTH,
  buildOfficeTree,
  checkOfficeMove,
  collapseOfficePaths,
  isInOfficeSubtree,
  officeDepth,
  officeFullName,
  officeInScope,
  officePath,
  officePathIds,
  officeSubtree,
  rebaseOfficePath,
  type OfficeNodeLike,
} from './office-tree.js';

// El caso de referencia de la usuaria (R10): Central → regionales → agencias de Chuquisaca.
const n = (id: string, name: string, parent: OfficeNodeLike | null): OfficeNodeLike => ({
  id,
  name,
  parentId: parent?.id ?? null,
  path: officePath(parent?.path ?? null, id),
  depth: parent ? parent.depth + 1 : 0,
});
const central = n('c', 'Central', null);
const lapaz = n('lp', 'La Paz', central);
const cocha = n('cb', 'Cochabamba', central);
const chuq = n('ch', 'Chuquisaca', central);
const agCentral = n('ac', 'Central', chuq); // mismo nombre que la raíz, otra rama
const mesa = n('mv', 'Mesa Verde', chuq);
const padilla = n('pa', 'Padilla', chuq);
const ALL = [central, lapaz, cocha, chuq, agCentral, mesa, padilla];

describe('ruta materializada', () => {
  it('la ruta de un hijo es la del padre más su id; la raíz empieza en /', () => {
    expect(central.path).toBe('/c/');
    expect(mesa.path).toBe('/c/ch/mv/');
    expect(officePathIds(mesa.path)).toEqual(['c', 'ch', 'mv']);
    expect(officeDepth(central.path)).toBe(0);
    expect(officeDepth(mesa.path)).toBe(2);
  });

  it('🔴 el subárbol usa el prefijo COMPLETO: /c/ch/ no incluye a /c/chx/', () => {
    expect(isInOfficeSubtree('/c/ch/mv/', '/c/ch/')).toBe(true);
    expect(isInOfficeSubtree('/c/ch/', '/c/ch/')).toBe(true);
    expect(isInOfficeSubtree('/c/chx/', '/c/ch/')).toBe(false);
    expect(isInOfficeSubtree('/c/lp/', '/c/ch/')).toBe(false);
  });
});

describe('alcance por subárbol (R4)', () => {
  it('la regional ve sus agencias y nada de las otras regionales', () => {
    const ids = officeSubtree(ALL, 'ch').map((x) => x.id).sort();
    expect(ids).toEqual(['ac', 'ch', 'mv', 'pa']);
  });

  it('una asignación a la regional cubre a sus agencias; la agencia sola no cubre a la regional', () => {
    expect(officeInScope(mesa.path, [chuq.path])).toBe(true);
    expect(officeInScope(chuq.path, [mesa.path])).toBe(false);
    expect(officeInScope(lapaz.path, [chuq.path])).toBe(false);
  });

  it('sin asignaciones no ve nada ajeno (falla cerrado, A-4)', () => {
    expect(officeInScope(mesa.path, [])).toBe(false);
  });

  it('colapsar rutas: asignado a la regional y a una de sus agencias = solo la regional', () => {
    expect(collapseOfficePaths([mesa.path, chuq.path, chuq.path, lapaz.path]).sort()).toEqual([chuq.path, lapaz.path].sort());
  });
});

describe('mover un nodo', () => {
  const ref = (x: OfficeNodeLike) => ({ id: x.id, path: x.path, depth: x.depth });

  it('se puede mover una agencia a otra regional', () => {
    expect(checkOfficeMove({ ...mesa }, ref(lapaz))).toBe('OK');
  });

  it('🔴 no se puede mover un nodo dentro de sí mismo ni de su propio subárbol (ciclo)', () => {
    expect(checkOfficeMove({ ...chuq }, ref(chuq))).toBe('INTO_ITSELF');
    expect(checkOfficeMove({ ...chuq }, ref(mesa))).toBe('INTO_OWN_SUBTREE');
  });

  it('la raíz no se mueve', () => {
    expect(checkOfficeMove({ ...central, isRoot: true }, ref(lapaz))).toBe('IS_ROOT');
  });

  it('mover al mismo padre no es un movimiento', () => {
    expect(checkOfficeMove({ ...mesa }, ref(chuq))).toBe('SAME_PARENT');
  });

  it('respeta la profundidad máxima contando la altura del subárbol que se mueve', () => {
    const hondo = { id: 'x', path: '/c/a/b/c/d/e/f/g/', depth: MAX_OFFICE_DEPTH - 1 };
    expect(checkOfficeMove({ ...mesa }, hondo, 0)).toBe('OK');
    expect(checkOfficeMove({ ...mesa }, hondo, 1)).toBe('TOO_DEEP');
  });

  it('reescribe la ruta de todo el subárbol al cambiar de padre', () => {
    const nuevoPrefijo = officePath(lapaz.path, chuq.id); // /c/lp/ch/
    expect(rebaseOfficePath(mesa.path, chuq.path, nuevoPrefijo)).toBe('/c/lp/ch/mv/');
    expect(() => rebaseOfficePath(lapaz.path, chuq.path, nuevoPrefijo)).toThrow();
  });
});

describe('presentación', () => {
  it('🔴 la ruta completa distingue la agencia Central de la oficina raíz Central (R10)', () => {
    expect(officeFullName(ALL, 'c')).toBe('Central');
    expect(officeFullName(ALL, 'ac')).toBe('Central › Chuquisaca › Central');
    expect(officeFullName(ALL, 'zzz')).toBe('');
  });

  it('arma el árbol ordenado por nombre y trata como raíz al que no tiene padre en la lista', () => {
    const tree = buildOfficeTree(ALL);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.children.map((c) => c.node.name)).toEqual(['Chuquisaca', 'Cochabamba', 'La Paz']);
    expect(tree[0]!.children[0]!.children.map((c) => c.node.name)).toEqual(['Central', 'Mesa Verde', 'Padilla']);
    // sin la raíz en la lista, la regional queda como raíz del fragmento
    expect(buildOfficeTree(ALL.filter((x) => x.id !== 'c')).map((r) => r.node.name)).toEqual(['Chuquisaca', 'Cochabamba', 'La Paz']);
  });
});
