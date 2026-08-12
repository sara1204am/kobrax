import { describe, expect, it } from 'vitest';
import es from '@/messages/es.json';
import en from '@/messages/en.json';
import { errorText, rejectText, scopeRefName, warningText, type Translator } from './import';

/** El traductor de verdad de un idioma, atado al namespace `panel.import`. */
function translator(messages: Record<string, unknown>): Translator {
  const dict = (messages as { panel: { import: Record<string, unknown> } }).panel.import;
  const lookup = (key: string): unknown =>
    key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], dict);

  const t = ((key: string, values: Record<string, string | number> = {}) => {
    const raw = lookup(key);
    if (typeof raw !== 'string') throw new Error(`clave inexistente: ${key}`);
    return raw.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''));
  }) as Translator;
  t.has = (key: string) => typeof lookup(key) === 'string';
  return t;
}

const ES = translator(es);
const EN = translator(en);

describe('errorText', () => {
  it('en español gana el mensaje del servidor, que ya viene específico', () => {
    const text = errorText({ code: 'FILE_SHAPE_MISMATCH', message: 'Se esperaba un PDF' }, ES, 'es');
    expect(text).toBe('Se esperaba un PDF');
  });

  it('en inglés traduce por código', () => {
    const text = errorText({ code: 'XLS_LEGACY_NOT_SUPPORTED', message: 'Guardalo como .xlsx' }, EN, 'en');
    expect(text).toBe(en.panel.import.errors.XLS_LEGACY_NOT_SUPPORTED);
  });

  it('en inglés, un código que el diccionario no tiene cae al mensaje del servidor', () => {
    const text = errorText({ code: 'CODIGO_NUEVO', message: 'Mensaje del backend' }, EN, 'en');
    expect(text).toBe('Mensaje del backend');
  });

  it('un código desconocido sin mensaje se muestra CRUDO, no se esconde', () => {
    // El backend puede ser más nuevo que el panel; un error mudo deja a la persona sin nada
    // que contarle al soporte.
    expect(errorText({ code: 'CODIGO_NUEVO' }, ES, 'es')).toBe('CODIGO_NUEVO');
  });

  it('sin error no dice nada', () => {
    expect(errorText(null, ES, 'es')).toBe('');
  });
});

describe('rejectText', () => {
  it('colapsa todos los MISSING_* en un solo texto', () => {
    // `MISSING_OUTSTANDINGBALANCE` es el nombre interno: mostrarlo es peor que no decirlo.
    const text = rejectText('MISSING_OUTSTANDINGBALANCE', ES);
    expect(text).toBe(es.panel.import.rejects.MISSING);
    expect(rejectText('MISSING_DAYSPASTDUE', ES)).toBe(text);
  });

  it('traduce los motivos conocidos', () => {
    expect(rejectText('NO_CODE', ES)).toBe(es.panel.import.rejects.NO_CODE);
  });

  it('un motivo nuevo se muestra crudo', () => {
    expect(rejectText('MOTIVO_NUEVO', ES)).toBe('MOTIVO_NUEVO');
  });
});

describe('warningText', () => {
  it('pega el detalle al texto traducido', () => {
    const text = warningText({ code: 'MORA_COLUMNA_SOSPECHOSA', detail: 'DIAS' }, ES);
    expect(text).toBe(`${es.panel.import.warnings.MORA_COLUMNA_SOSPECHOSA} (DIAS)`);
  });

  it('un aviso nuevo se muestra crudo', () => {
    expect(warningText({ code: 'AVISO_NUEVO' }, ES)).toBe('AVISO_NUEVO');
  });
});

describe('scopeRefName', () => {
  const members = [{ id: 'u1', name: 'Ana Quispe', role: 'COLLECTOR' }];
  const branches = [{ id: 'b1', name: 'Agencia Centro' }];

  it('el alcance de empresa no pide a nadie', () => {
    expect(scopeRefName({ kind: 'account', ref: null }, members, branches, ES)).toBeNull();
  });

  it('resuelve el nombre de la persona y el de la sucursal', () => {
    expect(scopeRefName({ kind: 'official', ref: 'u1' }, members, branches, ES)).toBe('Ana Quispe');
    expect(scopeRefName({ kind: 'branch', ref: 'b1' }, members, branches, ES)).toBe('Agencia Centro');
  });

  it('un ref que ya no existe lo dice, en vez de parecer configurado', () => {
    expect(scopeRefName({ kind: 'official', ref: 'borrado' }, members, branches, ES)).toBe(
      es.panel.import.settings.scopeRefGone,
    );
  });

  it('sin elegir todavía, no inventa nombre', () => {
    expect(scopeRefName({ kind: 'branch', ref: null }, members, branches, ES)).toBeNull();
  });
});
