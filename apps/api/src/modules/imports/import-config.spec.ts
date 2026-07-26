import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_IMPORT_CONFIG,
  readImportConfig,
  requiredFields,
  scopeLabel,
  toFieldMap,
  validateImportConfig,
  type ImportConfig,
} from './import-config';

const base = (over: Partial<ImportConfig> = {}): ImportConfig => ({
  ...DEFAULT_IMPORT_CONFIG,
  source: 'file',
  profile: { kind: 'rows', headerRow: 1, recordStart: '' },
  scope: { kind: 'account', ref: null },
  fields: { code: { from: 'NRO', required: true }, clientName: { from: 'DEUDOR' } },
  ...over,
});

const fails = (cfg: ImportConfig, code: string, prev?: ImportConfig): void => {
  assert.throws(
    () => validateImportConfig(cfg, prev),
    (e: unknown) => (e as { code: string }).code === code,
    `esperaba ${code}`,
  );
};

describe('import-config — invariantes de §3.1', () => {
  it('una config sana pasa', () => {
    validateImportConfig(base());
  });

  it('1 · no importar + obligatorio es contradictorio', () => {
    fails(base({ fields: { installmentAmount: { enabled: false, required: true } } }), 'FIELD_RULE_CONFLICT');
  });

  it('2 · obligatorio sin emparejar reventaría todas las filas', () => {
    fails(base({ fields: { installmentAmount: { required: true } } }), 'FIELD_NOT_MAPPED');
  });

  it('3 · la llave y el cliente no se pueden apagar', () => {
    fails(base({ fields: { code: { enabled: false } } }), 'FIELD_RULE_CONFLICT');
    fails(base({ fields: { clientName: { enabled: false } } }), 'FIELD_RULE_CONFLICT');
  });

  it('4 · cambiar la forma del archivo obliga a emparejar de nuevo', () => {
    const prev = base({ profile: { kind: 'pdf-blocks', recordStart: 'Cliente' } });
    fails(base(), 'PROFILE_CHANGED', prev);
  });

  it('5 · una columna no puede alimentar dos campos', () => {
    fails(
      base({ fields: { outstandingBalance: { from: 'SALDO' }, principalAmount: { from: 'SALDO' } } }),
      'COLUMN_ALREADY_MAPPED',
    );
  });

  it('5 · pero la misma etiqueta en cabecera y en el cuadro NO choca', () => {
    validateImportConfig(
      base({
        fields: { outstandingBalance: { from: 'Saldo' }, daysPastDue: { from: 'Saldo', in: 'table' } },
      }),
    );
  });

  it('6 · el alcance empresa no lleva referencia; agencia y oficial sí', () => {
    fails(base({ scope: { kind: 'account', ref: 'x' } }), 'IMPORT_NOT_CONFIGURED');
    fails(base({ scope: { kind: 'branch', ref: null } }), 'IMPORT_NOT_CONFIGURED');
    validateImportConfig(base({ scope: { kind: 'branch', ref: 'uuid' } }));
  });

  it('7 · sólo los días de retraso se confirman', () => {
    fails(base({ fields: { outstandingBalance: { from: 'SALDO', calibrated: true } } }), 'FIELD_RULE_CONFLICT');
  });

  it('7 · no se puede cambiar la columna y confirmarla en la misma llamada', () => {
    const prev = base({ fields: { daysPastDue: { from: 'Dias Mora' } } });
    fails(base({ fields: { daysPastDue: { from: 'Dias Int.', calibrated: true } } }), 'CALIBRATION_STALE', prev);
    // Confirmar SIN cambiar la columna sí vale.
    validateImportConfig(base({ fields: { daysPastDue: { from: 'Dias Mora', calibrated: true } } }), prev);
  });

  it('un campo que no está en el catálogo se rechaza', () => {
    fails(base({ fields: { loQueSea: { from: 'X' } } }), 'UNKNOWN_FIELD');
  });
});

describe('import-config — lectura y derivados', () => {
  it('un JSONB vacío o a medias no explota: se completa con defaults', () => {
    assert.deepEqual(readImportConfig(undefined), DEFAULT_IMPORT_CONFIG);
    const parcial = readImportConfig({ source: 'file', scope: { kind: 'branch', ref: 'b1' } });
    assert.equal(parcial.source, 'file');
    assert.equal(parcial.askOnLogin, true);
    assert.equal(parcial.absentRule, 'set-current');
  });

  it('toFieldMap deja fuera lo apagado y lo no emparejado', () => {
    const map = toFieldMap({
      code: { from: 'NRO' },
      status: { from: 'ESTADO', enabled: false },
      interestRate: { required: false },
      daysPastDue: { from: 'Dias Mora', in: 'table' },
    });
    assert.deepEqual(Object.keys(map).sort(), ['code', 'daysPastDue']);
    assert.deepEqual(map.daysPastDue, { from: 'Dias Mora', in: 'table' });
  });

  it('requiredFields ignora los apagados', () => {
    assert.deepEqual(
      requiredFields({
        code: { from: 'NRO', required: true },
        installmentAmount: { from: 'C', required: true, enabled: false },
        status: { from: 'E' },
      }),
      ['code'],
    );
  });

  it('scopeLabel no escribe "account:null"', () => {
    assert.equal(scopeLabel({ kind: 'account', ref: null }), 'account');
    assert.equal(scopeLabel({ kind: 'branch', ref: 'b1' }), 'branch:b1');
  });
});
