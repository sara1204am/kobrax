import { describe, expect, it } from 'vitest';
import { CATALOG_DEFAULTS } from '../constants/catalog-defaults.js';
import { CatalogType } from '../enums/agenda.enum.js';
import { reasonsFor, validateCatalogMetadata } from './catalog-metadata.js';

describe('validateCatalogMetadata — rubros (OCCUPATION)', () => {
  const v = (m: unknown) => validateCatalogMetadata(CatalogType.OCCUPATION, m);

  it('un rubro completo es válido', () => expect(v({ incomeSource: 'BUSINESS', defaultCycle: 'WEEKLY', synonyms: ['chofer', 'taxista'] })).toBeNull());
  it('todo es opcional: un objeto vacío vale', () => expect(v({})).toBeNull());
  it('rechaza lo que no es un objeto', () => {
    expect(v(null)).toBe('METADATA_NOT_OBJECT');
    expect(v([])).toBe('METADATA_NOT_OBJECT');
    expect(v('x')).toBe('METADATA_NOT_OBJECT');
  });
  it('🔴 la fuente de ingreso tiene que ser una de las conocidas: filtra los motivos que se ofrecen', () => expect(v({ incomeSource: 'JEFE' })).toBe('INCOME_SOURCE_INVALID'));
  it('el ciclo tiene que existir', () => expect(v({ defaultCycle: 'CADA_LUNA' })).toBe('CYCLE_INVALID'));
  it('los sinónimos son una lista de textos no vacíos y cortos', () => {
    expect(v({ synonyms: 'chofer' })).toBe('SYNONYMS_INVALID');
    expect(v({ synonyms: ['chofer', ''] })).toBe('SYNONYMS_INVALID');
    expect(v({ synonyms: [5] })).toBe('SYNONYMS_INVALID');
    expect(v({ synonyms: ['x'.repeat(61)] })).toBe('SYNONYMS_INVALID');
    expect(v({ synonyms: Array.from({ length: 41 }, (_, i) => `s${i}`) })).toBe('SYNONYMS_INVALID');
  });
});

describe('validateCatalogMetadata — motivos de no pago (NO_PAYMENT_REASON)', () => {
  const v = (m: unknown) => validateCatalogMetadata(CatalogType.NO_PAYMENT_REASON, m);

  it('un motivo con sus banderas es válido', () => expect(v({ appliesTo: ['EMPLOYEE'], suggestion: 'x', asksExpectedIncomeDate: true, sensitive: false })).toBeNull());
  it('appliesTo solo admite fuentes de ingreso conocidas', () => expect(v({ appliesTo: ['EMPLEADO'] })).toBe('APPLIES_TO_INVALID'));
  it('las banderas son booleanas', () => expect(v({ sensitive: 'si' })).toBe('FLAG_INVALID'));
  it('la sugerencia tiene tope de largo', () => expect(v({ suggestion: 'x'.repeat(281) })).toBe('SUGGESTION_INVALID'));
});

describe('validateCatalogMetadata — el resto de los catálogos no cambia', () => {
  it('un catálogo anterior sigue aceptando cualquier objeto', () => {
    expect(validateCatalogMetadata(CatalogType.PAYMENT_METHOD, { requiresBank: true, lo_que_sea: 1 })).toBeNull();
    expect(validateCatalogMetadata(CatalogType.WHATSAPP_TEMPLATE, { body: 'Hola' })).toBeNull();
  });
});

describe('reasonsFor — qué motivos se ofrecen', () => {
  const reasons = [
    { code: 'JOB_LOSS', metadata: { appliesTo: ['EMPLOYEE', 'OTHER'] } },
    { code: 'NO_SALES', metadata: { appliesTo: ['BUSINESS'] } },
    { code: 'FORGOT', metadata: {} },
    { code: 'LEGACY', metadata: null },
  ];

  it('filtra por fuente de ingreso y deja pasar los que son para todos', () => {
    expect(reasonsFor(reasons, 'EMPLOYEE').map((r) => r.code)).toEqual(['JOB_LOSS', 'FORGOT', 'LEGACY']);
    expect(reasonsFor(reasons, 'BUSINESS').map((r) => r.code)).toEqual(['NO_SALES', 'FORGOT', 'LEGACY']);
  });
  it('🔴 sin fuente de ingreso conocida se ofrecen todos: no se esconde una opción por falta de un dato', () => {
    expect(reasonsFor(reasons)).toHaveLength(4);
    expect(reasonsFor(reasons, null)).toHaveLength(4);
  });
});

describe('CATALOG_DEFAULTS — las listas por defecto', () => {
  it('no repite (catálogo, código): el seed y el registro usan skipDuplicates sobre esa clave', () => {
    const keys = CATALOG_DEFAULTS.map((c) => `${c.catalog}:${c.code}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('todo catálogo declarado es un tipo que existe', () => {
    const known = new Set<string>(Object.values(CatalogType));
    for (const c of CATALOG_DEFAULTS) expect(known.has(c.catalog)).toBe(true);
  });

  it('los 4 catálogos nuevos traen contenido', () => {
    for (const t of ['INCOME_SOURCE', 'OCCUPATION', 'NO_PAYMENT_REASON', 'COLLECTION_MODALITY']) {
      expect(CATALOG_DEFAULTS.some((c) => c.catalog === t)).toBe(true);
    }
  });

  it('🔴 el metadata de lo que se siembra cumple su propia validación', () => {
    for (const c of CATALOG_DEFAULTS) expect(validateCatalogMetadata(c.catalog, c.metadata ?? {})).toBeNull();
  });

  it('cada rubro propone un ciclo y una fuente de ingreso que existen', () => {
    for (const c of CATALOG_DEFAULTS.filter((x) => x.catalog === 'OCCUPATION')) {
      expect(c.metadata?.incomeSource).toBeTruthy();
    }
  });

  it('el motivo «ingreso atrasado» pide la fecha esperada y el de domicilio dispara actualizar el contacto', () => {
    const by = (code: string) => CATALOG_DEFAULTS.find((c) => c.catalog === 'NO_PAYMENT_REASON' && c.code === code);
    expect(by('LATE_INCOME')?.metadata?.asksExpectedIncomeDate).toBe(true);
    expect(by('MOVED_OR_PHONE_CHANGED')?.metadata?.triggersContactUpdate).toBe(true);
  });
});
