import { describe, expect, it } from 'vitest';
import es from '@/messages/es.json';
import en from '@/messages/en.json';
import { translator } from '@/test/translator';
import {
  ACCEPTED_FILES,
  confirmDaysPastDue,
  groupWarnings,
  pickDaysPastDue,
  rejectText,
  scopeRefName,
  warningText,
  withDeducedType,
} from './import';

const ES = translator(es, 'panel.import');
const EN = translator(en, 'panel.import');

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

describe('la calibración de la mora, en dos pasos', () => {
  const rule = { enabled: true, required: true, from: 'DIAS', calibrated: true };

  it('elegir la columna NUNCA la deja confirmada', () => {
    // Si elegir y confirmar cupieran en una llamada, «confirmado» no significaría nada: nadie
    // habría visto los valores de la columna nueva. El servidor lo rechaza con CALIBRATION_STALE.
    const patch = pickDaysPastDue(rule, 'DIAS_MORA');
    expect(patch.fields?.daysPastDue).toEqual({ ...rule, from: 'DIAS_MORA', calibrated: false });
  });

  it('confirmar es un patch aparte, y no toca la columna elegida', () => {
    const picked = pickDaysPastDue(rule, 'DIAS_MORA').fields?.daysPastDue ?? undefined;
    const patch = confirmDaysPastDue(picked);
    expect(patch.fields?.daysPastDue).toEqual({ ...rule, from: 'DIAS_MORA', calibrated: true });
  });

  it('la regla anterior viaja entera: el merge del servidor reemplaza, no fusiona', () => {
    const patch = pickDaysPastDue(rule, 'OTRA');
    expect(patch.fields?.daysPastDue).toMatchObject({ enabled: true, required: true });
  });

  it('una columna del cuadro de un extracto viaja marcada como tal', () => {
    // Sin `in: 'table'` el motor la busca como etiqueta del encabezado del bloque, no la
    // encuentra, y TODA la cartera entra con cero días de atraso — con el cartel «Confirmada».
    expect(pickDaysPastDue(rule, 'DIAS_MORA', 'table').fields?.daysPastDue).toMatchObject({
      from: 'DIAS_MORA',
      in: 'table',
    });
  });

  it('elegir una etiqueta del encabezado BORRA el marcador de cuadro que hubiera', () => {
    const deTabla = { ...rule, in: 'table' as const };
    expect(pickDaysPastDue(deTabla, 'DIAS').fields?.daysPastDue?.in).toBeUndefined();
  });
});

describe('groupWarnings', () => {
  it('junta los avisos que dicen exactamente lo mismo y los cuenta', () => {
    // `MORA_INCONSISTENTE` se emite una vez por fila sospechosa y no lleva detalle: sin agrupar,
    // un archivo grande dibuja cientos de renglones idénticos.
    const grouped = groupWarnings([
      { code: 'MORA_SIN_CONFIRMAR' },
      { code: 'MORA_INCONSISTENTE', detail: undefined },
      { code: 'MORA_INCONSISTENTE' },
      { code: 'MORA_INCONSISTENTE' },
    ]);

    expect(grouped).toEqual([
      { code: 'MORA_SIN_CONFIRMAR', detail: undefined, count: 1 },
      { code: 'MORA_INCONSISTENTE', detail: undefined, count: 3 },
    ]);
  });

  it('dos avisos del mismo código con detalles distintos NO se juntan', () => {
    const grouped = groupWarnings([
      { code: 'MORA_COLUMNA_SOSPECHOSA', detail: 'DIAS' },
      { code: 'MORA_COLUMNA_SOSPECHOSA', detail: 'ATRASO' },
    ]);
    expect(grouped).toHaveLength(2);
  });
});

describe('ACCEPTED_FILES', () => {
  it('nombra las extensiones que la API acepta, para filtrar antes de subir 15 MB', () => {
    expect(ACCEPTED_FILES.split(',')).toEqual(['.csv', '.txt', '.pdf', '.xlsx', '.xls']);
  });
});

describe('withDeducedType', () => {
  it('le pone tipo al archivo que el navegador dejó sin tipo', () => {
    // En Windows un .csv llega con `type: ''` y la API lo rechaza con FILE_REQUIRED.
    const file = withDeducedType(new File(['a;b'], 'cartera.csv', { type: '' }));
    expect(file.type).toBe('text/csv');
    expect(file.name).toBe('cartera.csv');
  });

  it('no toca el archivo que ya trae tipo', () => {
    const original = new File(['%PDF'], 'extracto.pdf', { type: 'application/pdf' });
    expect(withDeducedType(original)).toBe(original);
  });

  it('una extensión que no se acepta se deja pasar tal cual: quien rechaza es la API', () => {
    const original = new File(['x'], 'cartera.docx', { type: '' });
    expect(withDeducedType(original)).toBe(original);
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
