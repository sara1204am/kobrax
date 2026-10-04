import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nameKey, resolveClients, type CandidateClient } from './client-match';

const client = (id: string, firstName: string | null, lastName: string, nationalIdHash: string | null = null): CandidateClient => ({
  id,
  firstName,
  lastName,
  businessName: null,
  nationalIdHash,
});

describe('nameKey', () => {
  it('sin tildes, sin mayúsculas y sin importar el orden', () => {
    assert.equal(nameKey('Miriam Cruz Apaza'), nameKey('APAZA  cruz Míriam'));
    assert.equal(nameKey(''), null);
  });
});

describe('resolveClients — D2 · opción B', () => {
  const empty = { linkedByName: new Map<string, string>(), candidates: [] as CandidateClient[] };

  it('nadie se llama así → cliente nuevo, sin revisión', () => {
    const r = resolveClients([{ index: 0, fullName: 'Wilfredo Apaza Nina' }], empty).get(0)!;
    assert.equal(r.kind, 'new');
    assert.equal(r.kind === 'new' && r.review, false);
  });

  it('alguien se llama igual → cliente provisional a revisar, con la sugerencia; NO se junta solo', () => {
    const r = resolveClients([{ index: 0, fullName: 'Miriam Cruz Apaza' }], { ...empty, candidates: [client('c1', 'Miriam', 'Cruz Apaza')] }).get(0)!;
    assert.equal(r.kind, 'new');
    assert.ok(r.kind === 'new' && r.review);
    assert.deepEqual(r.kind === 'new' && r.suggestions, ['c1']);
  });

  it('el vínculo ya confirmado manda: va directo a ese cliente, sin volver a preguntar', () => {
    const r = resolveClients([{ index: 0, fullName: 'Miriam Cruz Apaza' }], {
      linkedByName: new Map([[nameKey('Miriam Cruz Apaza')!, 'c9']]),
      candidates: [client('c1', 'Miriam', 'Cruz Apaza')],
    }).get(0)!;
    assert.deepEqual(r, { kind: 'existing', clientId: 'c9', via: 'link' });
  });

  it('el carnet identifica sin dudas; con carnet propio distinto es otra persona aunque se llame igual', () => {
    const ctx = { ...empty, candidates: [client('c1', 'Miriam', 'Cruz Apaza', 'h1')] };
    assert.deepEqual(resolveClients([{ index: 0, fullName: 'X', nationalIdHash: 'h1' }], ctx).get(0), { kind: 'existing', clientId: 'c1', via: 'national_id' });
    const other = resolveClients([{ index: 0, fullName: 'Miriam Cruz Apaza', nationalIdHash: 'h2' }], ctx).get(0)!;
    assert.ok(other.kind === 'new' && !other.review);
  });

  it('dos operaciones del mismo nombre en el archivo → un solo cliente, marcado para revisar', () => {
    const res = resolveClients(
      [
        { index: 0, fullName: 'Juana Poma Huanca' },
        { index: 1, fullName: 'JUANA POMA HUANCA' },
      ],
      empty,
    );
    const [a, b] = [res.get(0)!, res.get(1)!];
    assert.ok(a.kind === 'new' && b.kind === 'new' && a.group === b.group && a.review && b.review);
  });
});
