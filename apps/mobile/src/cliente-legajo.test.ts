import { attachmentUri, collateralsForCredit, isImageFile, phonesOf, relationsForCredit, sortAttachments } from './cliente-legajo';

describe('attachmentUri', () => {
  it('cuelga la ruta interna del host de la API, sin duplicar /api', () => {
    expect(attachmentUri('/api/uploads/ab.jpg', 'https://x.test/api')).toBe('https://x.test/api/uploads/ab.jpg');
    expect(attachmentUri('/api/uploads/ab.jpg', 'http://127.0.0.1:4010/api/')).toBe('http://127.0.0.1:4010/api/uploads/ab.jpg');
  });
  it('respeta una URL absoluta y devuelve null sin archivo', () => {
    expect(attachmentUri('https://cdn.x/a.png', 'https://x.test/api')).toBe('https://cdn.x/a.png');
    expect(attachmentUri(undefined, 'https://x.test/api')).toBeNull();
  });
  it('sólo las imágenes llevan miniatura', () => {
    expect(isImageFile('/api/uploads/a.JPG')).toBe(true);
    expect(isImageFile('/api/uploads/a.pdf')).toBe(false);
  });
});

describe('sortAttachments', () => {
  it('los más nuevos primero, sin mutar', () => {
    const rows = [
      { id: 'a', fileType: 'OTHER', encrypted: false, createdAt: '2026-01-01' },
      { id: 'b', fileType: 'OTHER', encrypted: false, createdAt: '2026-03-01' },
    ];
    expect(sortAttachments(rows).map((r) => r.id)).toEqual(['b', 'a']);
    expect(rows[0]!.id).toBe('a');
    expect(sortAttachments(undefined)).toEqual([]);
  });
});

describe('relationsForCredit / collateralsForCredit', () => {
  const rel = (id: string, relationshipType: 'GUARANTOR' | 'FAMILY', creditIds?: string[]) => ({
    id, relatedName: id, relationshipType, isContactable: true, creditIds,
  });
  it('garantes del préstamo primero, luego otros garantes, luego el resto', () => {
    const out = relationsForCredit([rel('fam', 'FAMILY'), rel('g2', 'GUARANTOR', ['c2']), rel('g1', 'GUARANTOR', ['c1'])], 'c1');
    expect(out.map((r) => r.id)).toEqual(['g1', 'g2', 'fam']);
    expect(out.map((r) => r.linked)).toEqual([true, false, false]);
  });
  it('las garantías del préstamo elegido van primero', () => {
    const out = collateralsForCredit([{ id: 'x', description: 'Moto' }, { id: 'y', description: 'Auto', creditIds: ['c1'] }], 'c1');
    expect(out.map((g) => g.id)).toEqual(['y', 'x']);
    expect(collateralsForCredit(undefined, null)).toEqual([]);
  });
});

describe('phonesOf', () => {
  it('ignora emails y vacíos, principal primero', () => {
    const contacts = [
      { id: '1', contactType: 'PHONE' as const, value: '70000001', isPrimary: false },
      { id: '2', contactType: 'EMAIL' as const, value: 'a@b.c', isPrimary: true },
      { id: '3', contactType: 'WHATSAPP' as const, value: '70000002', isPrimary: true },
      { id: '4', contactType: 'PHONE' as const, value: null, isPrimary: false },
    ];
    expect(phonesOf({ contacts })).toEqual(['70000002', '70000001']);
  });
});
