import { officeChoices, officesLine } from './office-choice';
import { otherCreditsNotice } from './other-credits';

const root = { id: 'root', name: 'Central', isRoot: true };
const sur = { id: 'sur', name: 'Agencia Sur', isRoot: false };
const norte = { id: 'norte', name: 'Agencia Norte', isRoot: false };

describe('officeChoices · en qué oficina se registra un cliente (F14 · F8, D-7)', () => {
  it('🔴 con UNA sola oficina posible no hay selector (RULES C2: el servidor la resuelve)', () => {
    expect(officeChoices({ own: [sur] })).toEqual({ options: [sur], needsChoice: false });
    expect(officeChoices({ own: [root] })).toEqual({ options: [root], needsChoice: false });
  });

  it('un cobrador con varias oficinas tiene que elegir una', () => {
    const c = officeChoices({ own: [sur, norte] });
    expect(c.needsChoice).toBe(true);
    expect(c.options.map((o) => o.name)).toEqual(['Agencia Norte', 'Agencia Sur']);
  });

  it('🔴 la central no se ofrece mientras haya otras (ahí no se registran clientes)', () => {
    const c = officeChoices({ own: [root, sur] });
    expect(c.options).toEqual([sur]);
    expect(c.needsChoice).toBe(false);
    expect(officeChoices({ own: [root, sur, norte] }).options.map((o) => o.id)).toEqual(['norte', 'sur']);
  });

  it('con `office:read` mandan las que ve en la cuenta; sin ellas, las suyas', () => {
    expect(officeChoices({ own: [sur], visible: [sur, norte, root] }).options.map((o) => o.id)).toEqual(['norte', 'sur']);
    expect(officeChoices({ own: [sur], visible: [] }).options).toEqual([sur]);
    expect(officeChoices({ own: [sur], visible: null }).options).toEqual([sur]);
  });

  it('sin oficina asignada no hay nada que elegir (el servidor explica el 422)', () => {
    expect(officeChoices({ own: [] })).toEqual({ options: [], needsChoice: false });
    expect(officeChoices({})).toEqual({ options: [], needsChoice: false });
  });
});

describe('officesLine · Más › Cuenta', () => {
  it('lista los nombres, o dice que no hay oficina', () => {
    expect(officesLine([sur, norte])).toBe('Agencia Sur, Agencia Norte');
    expect(officesLine([])).toBe('Sin oficina asignada');
    expect(officesLine(undefined)).toBe('Sin oficina asignada');
  });
});

describe('otherCreditsNotice · aviso de la ficha con sólo agregados (F14 · F8, D-8)', () => {
  const fmt = (n: number) => `Bs ${n}`;

  it('dice cuántos créditos más hay, por cuánto saldo y a cargo de quién; nunca el detalle', () => {
    const msg = otherCreditsNotice({ count: 2, totalOutstanding: 1500, responsibles: [{ userId: 'u1', name: 'Ana Rojas' }, { userId: 'u2', name: 'Luis Paz' }] }, fmt);
    expect(msg).toBe('Este cliente tiene 2 créditos más que no ves, por un saldo de Bs 1500. A cargo de: Ana Rojas, Luis Paz.');
  });

  it('singular y sin responsable', () => {
    expect(otherCreditsNotice({ count: 1, totalOutstanding: 10, responsibles: [] }, fmt)).toBe('Este cliente tiene 1 crédito más que no ves, por un saldo de Bs 10. A cargo de: sin responsable.');
  });

  it('🔴 si ve todos sus créditos (null/ausente/cero) no hay aviso', () => {
    expect(otherCreditsNotice(null, fmt)).toBeNull();
    expect(otherCreditsNotice(undefined, fmt)).toBeNull();
    expect(otherCreditsNotice({ count: 0, totalOutstanding: 0, responsibles: [] }, fmt)).toBeNull();
  });
});
