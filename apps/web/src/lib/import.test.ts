import { describe, expect, it } from 'vitest';
import es from '@/messages/es.json';
import en from '@/messages/en.json';
import { translator } from '@/test/translator';
import type { FieldDef, ImportConfig, PortfolioSummary } from '@kobrax/shared';
import {
  ACCEPTED_FILES,
  fileSize,
  HISTORY_PAGE_SIZE,
  hasHistoryFilters,
  assignCodes,
  assignmentStats,
  buildAssignmentsPayload,
  initialAssignState,
  pendingReassignments,
  historyQuery,
  runItemAction,
  runItemsQuery,
  configProgress,
  confirmDaysPastDue,
  fieldStatus,
  groupWarnings,
  pickDaysPastDue,
  postImportFile,
  rejectText,
  normalizeStatusLabel,
  parseStaleAfterDays,
  removeStatusMapEntry,
  scopeRefName,
  setStatusMapEntry,
  trackedFields,
  usedColumns,
  warningText,
  withDeducedType,
} from './import';

const ES = translator(es, 'panel.import');
const EN = translator(en, 'panel.import');

/** Recorte del catálogo real: los dos bloqueados, dos esenciales más y uno adicional. */
const CATALOG: Record<string, FieldDef> = {
  code: { label: 'N° de crédito', type: 'text', starred: true, locked: true },
  clientName: { label: 'Cliente', type: 'text', starred: true, locked: true },
  daysPastDue: { label: 'Días de retraso', type: 'int', starred: true },
  outstandingBalance: { label: 'Saldo', type: 'number', starred: true },
  phone: { label: 'Teléfono', type: 'text' },
};

const cfg = (fields: ImportConfig['fields'] = {}): ImportConfig => ({
  source: 'file',
  profile: { kind: 'rows' },
  fields,
  nameOrder: 'full',
  scope: { kind: 'account', ref: null },
  absentRule: 'set-current',
  carriesAssignee: false,
  askOnLogin: false,
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

describe('postImportFile — cada bandera por su carril', () => {
  /** Intercepta el `fetch` para mirar exactamente qué se manda, sin red de por medio. */
  async function capture(options: Parameters<typeof postImportFile>[1]) {
    const calls: { url: string; form: FormData }[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = ((url: string, init: RequestInit) => {
      calls.push({ url, form: init.body as FormData });
      return Promise.resolve(new Response('{}', { status: 200 }));
    }) as typeof fetch;
    await postImportFile(new File(['a'], 'cartera.csv', { type: 'text/csv' }), options);
    globalThis.fetch = original;
    return calls[0]!;
  }

  it('🔴 `dryRun` va como campo del multipart, nunca en la query', async () => {
    // El controller lo lee con `@Body('dryRun')`. Mandarlo por query hace que el POST aplique la
    // importación de verdad creyendo que previsualiza.
    const { url, form } = await capture({ dryRun: true });
    expect(form.get('dryRun')).toBe('true');
    expect(url).toBe('/api/imports/run');
  });

  it('🔴 `columnsOnly` va como query, nunca en el multipart', async () => {
    // Lo lee con `@Query`. Adentro del cuerpo, el servidor correría el reconcile de verdad sobre
    // el archivo que se subió sólo para mirar qué columnas trae.
    const { url, form } = await capture({ columnsOnly: true });
    expect(url).toBe('/api/imports/run?columnsOnly=true');
    expect(form.get('columnsOnly')).toBeNull();
    expect(form.get('dryRun')).toBeNull();
  });

  it('sin opciones no manda ninguna de las dos: es la corrida real', async () => {
    const { url, form } = await capture({});
    expect(url).toBe('/api/imports/run');
    expect(form.get('dryRun')).toBeNull();
  });
});

describe('fieldStatus', () => {
  it('sin columna es un pendiente', () => {
    expect(fieldStatus('outstandingBalance', undefined)).toBe('missing');
    expect(fieldStatus('outstandingBalance', { enabled: true })).toBe('missing');
  });

  it('con columna está listo', () => {
    expect(fieldStatus('outstandingBalance', { from: 'SALDO' })).toBe('ready');
  });

  it('la mora emparejada y sin confirmar NO está lista', () => {
    // Es la única que puede estar emparejada y no lista: de esa columna depende quién está en mora.
    expect(fieldStatus('daysPastDue', { from: 'ATRASO' })).toBe('review');
    expect(fieldStatus('daysPastDue', { from: 'ATRASO', calibrated: true })).toBe('ready');
  });

  it('apagado no es un pendiente: es una decisión tomada', () => {
    expect(fieldStatus('phone', { enabled: false, from: 'TEL' })).toBe('off');
    expect(fieldStatus('phone', { enabled: false })).toBe('off');
  });
});

describe('trackedFields — los esenciales se listan SIEMPRE', () => {
  it('con la config vacía igual lista los cinco esenciales', () => {
    // 🔴 El caso de una cuenta nueva o recién reseteada: `fields` viene `{}`. Si la lista saliera
    // de la config, la llave y el cliente quedarían escondidos en el desplegable de agregar.
    expect(trackedFields(cfg(), CATALOG)).toEqual(['code', 'clientName', 'daysPastDue', 'outstandingBalance']);
  });

  it('los agregados van después de los esenciales, sin repetirlos', () => {
    const fields = trackedFields(cfg({ phone: { from: 'TEL' }, code: { from: 'OPER' } }), CATALOG);
    expect(fields).toEqual(['code', 'clientName', 'daysPastDue', 'outstandingBalance', 'phone']);
  });
});

describe('configProgress', () => {
  it('la config vacía son cuatro pendientes, dos de ellos bloqueantes', () => {
    const p = configProgress(cfg(), CATALOG);
    expect(p).toMatchObject({ ready: 0, review: 0, missing: 4, total: 4 });
    // La llave y el cliente están bloqueados en el catálogo: sin ellos no hay import que corra.
    expect(p.blocking).toEqual(['code', 'clientName']);
  });

  it('la mora sin confirmar cuenta aparte de lo listo y de lo que falta', () => {
    const p = configProgress(
      cfg({ code: { from: 'OPER' }, clientName: { from: 'CLIENTE' }, daysPastDue: { from: 'ATRASO' } }),
      CATALOG,
    );
    expect(p).toMatchObject({ ready: 2, review: 1, missing: 1, blocking: [] });
  });

  it('un campo apagado sale del total en vez de contar como pendiente', () => {
    const p = configProgress(cfg({ outstandingBalance: { enabled: false } }), CATALOG);
    expect(p.total).toBe(3);
    expect(p.missing).toBe(3);
  });

  it('un opcional marcado obligatorio y sin columna también bloquea', () => {
    const p = configProgress(cfg({ phone: { required: true } }), CATALOG);
    expect(p.blocking).toContain('phone');
  });
});

describe('usedColumns', () => {
  it('marca la columna que ya alimenta a otro dato', () => {
    const used = usedColumns(cfg({ outstandingBalance: { from: 'SALDO' } }), 'installmentAmount');
    expect(used.get('header:SALDO')).toBe('outstandingBalance');
  });

  it('el campo que se está editando no se bloquea a sí mismo', () => {
    const used = usedColumns(cfg({ outstandingBalance: { from: 'SALDO' } }), 'outstandingBalance');
    expect(used.size).toBe(0);
  });

  it('la misma etiqueta en dos LUGARES distintos no choca — igual que en el servidor', () => {
    // La llave del servidor es `dónde:etiqueta`: bloquear sólo por nombre sacaría una combinación
    // que el `PATCH` acepta (el encabezado del bloque y el cuadro de movimientos).
    const used = usedColumns(cfg({ daysPastDue: { from: 'DIAS', in: 'table' } }), 'phone');
    expect(used.get('table:DIAS')).toBe('daysPastDue');
    expect(used.has('header:DIAS')).toBe(false);
  });

  it('un campo apagado libera su columna', () => {
    expect(usedColumns(cfg({ phone: { from: 'TEL', enabled: false } }), 'address').size).toBe(0);
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

describe('historial de importaciones', () => {
  it('la página y el tamaño viajan; un tamaño que la tabla no ofrece cae al default', () => {
    expect(historyQuery({ page: '2', pageSize: '50' }).toString()).toBe('page=2&limit=50');
    expect(historyQuery({ pageSize: '7' }).get('limit')).toBe(String(HISTORY_PAGE_SIZE));
  });

  it('la búsqueda y los filtros viajan a la API; los vacíos no', () => {
    const q = historyQuery({ q: ' CQE ', from: '2026-09-01', to: '', reportTo: '2026-09-30', createdBy: 'u-1' });
    expect(q.get('q')).toBe('CQE');
    expect(q.get('from')).toBe('2026-09-01');
    expect(q.has('to')).toBe(false);
    expect(q.get('reportTo')).toBe('2026-09-30');
    expect(q.get('createdBy')).toBe('u-1');
    expect(hasHistoryFilters({ page: '2' })).toBe(false);
    expect(hasHistoryFilters({ createdBy: 'u-1' })).toBe(true);
  });

  it('🔴 sólo viaja un tipo de movimiento que existe: otro sería un 400', () => {
    expect(runItemsQuery({ action: 'ABSENT' }).get('action')).toBe('ABSENT');
    expect(runItemsQuery({ action: 'BORRADOS' }).has('action')).toBe(false);
    expect(runItemAction(undefined)).toBeUndefined();
  });

  it('el tamaño del documento se lee como en un explorador', () => {
    expect(fileSize(9629)).toBe('9 KB');
    expect(fileSize(2.4 * 1024 * 1024)).toBe('2,4 MB');
    expect(fileSize(10)).toBe('1 KB');
  });
});

describe('responsables al importar', () => {
  const S = {
    dryRun: true,
    idempotentSkip: false,
    counts: { created: 3, updated: 2, setCurrent: 0, invalid: 0 },
    assignment: { mode: 'CHOOSE', selfUserId: 'yo' },
    preview: {
      toCreate: [
        { code: 'A', clientName: 'a', suggestedAssigneeId: 'juan' },
        { code: 'B', clientName: 'b', suggestedAssigneeId: null },
        { code: 'C', clientName: 'c' },
      ],
      toUpdate: [
        { code: 'X', currentAssigneeId: 'juan' },
        { code: 'Y', currentAssigneeId: 'maria' },
      ],
      toSetCurrent: [],
      invalid: [],
      warnings: [],
    },
  } as unknown as PortfolioSummary;

  it('arranca en la sugerencia para los nuevos y en el responsable de hoy para los existentes', () => {
    expect(initialAssignState(S)).toEqual({ create: { A: 'juan', B: null, C: null }, update: { X: 'juan', Y: 'maria' } });
  });

  it('cuenta asignados, sin asignar y el reparto por persona', () => {
    const st = assignCodes(initialAssignState(S), 'create', ['B'], 'maria');
    expect(assignmentStats(st.create)).toEqual({
      assigned: 2,
      unassigned: 1,
      byUser: [
        { userId: 'juan', count: 1 },
        { userId: 'maria', count: 1 },
      ],
    });
  });

  it('asignar no inventa créditos que no están en la lista', () => {
    const st = assignCodes(initialAssignState(S), 'create', ['NO-EXISTE'], 'juan');
    expect(Object.keys(st.create)).toEqual(['A', 'B', 'C']);
  });

  it('sólo es reasignación lo que cambia: «Juan → Juan» no viaja', () => {
    const st = assignCodes(initialAssignState(S), 'update', ['X', 'Y'], 'juan');
    expect(pendingReassignments(st, S)).toEqual([{ code: 'Y', clientName: undefined, from: 'maria', to: 'juan' }]);
  });

  it('el envío agrupa los nuevos por persona y lleva el responsable visto en cada reasignación', () => {
    let st = assignCodes(initialAssignState(S), 'create', ['B', 'C'], 'maria');
    st = assignCodes(st, 'update', ['X'], 'maria');
    expect(buildAssignmentsPayload(st, S)).toEqual({
      version: 1,
      create: [
        { userId: 'juan', externalIds: ['A'] },
        { userId: 'maria', externalIds: ['B', 'C'] },
      ],
      reassign: [{ externalId: 'X', fromUserId: 'juan', toUserId: 'maria' }],
    });
  });
});

describe('los datos del reporte (estados y antigüedad)', () => {
  it('la etiqueta de estado se guarda como la busca el servidor: mayúsculas, sin tildes, espacios colapsados', () => {
    expect(normalizeStatusLabel('  Ejecución   judicial ')).toBe('EJECUCION JUDICIAL');
  });

  it('suma una etiqueta y devuelve el mapa entero (el PATCH reemplaza, no mezcla)', () => {
    const r = setStatusMapEntry({ VIGENTE: 'ACTIVE' }, 'Ejecución', 'DEFAULTED');
    expect(r).toEqual({ ok: true, map: { VIGENTE: 'ACTIVE', EJECUCION: 'DEFAULTED' } });
  });

  it('rechaza lo que el servidor rechazaría: etiqueta vacía, estado inexistente, etiqueta repetida', () => {
    expect(setStatusMapEntry({}, '   ', 'ACTIVE')).toEqual({ ok: false, reason: 'EMPTY_LABEL' });
    expect(setStatusMapEntry({}, 'X', 'MOROSO')).toEqual({ ok: false, reason: 'INVALID_STATUS' });
    expect(setStatusMapEntry({ X: 'ACTIVE' }, 'x', 'PAID')).toEqual({ ok: false, reason: 'DUPLICATE_LABEL' });
  });

  it('cambiar el estado de una etiqueta que ya está no cuenta como repetida', () => {
    expect(setStatusMapEntry({ X: 'ACTIVE' }, 'X', 'PAID', 'X')).toEqual({ ok: true, map: { X: 'PAID' } });
  });

  it('quitar una etiqueta deja el resto y no toca el original', () => {
    const map = { A: 'ACTIVE', B: 'PAID' };
    expect(removeStatusMapEntry(map, 'A')).toEqual({ B: 'PAID' });
    expect(map).toEqual({ A: 'ACTIVE', B: 'PAID' });
  });

  it('los días de antigüedad son un entero entre 1 y 60', () => {
    expect(parseStaleAfterDays('7')).toEqual({ ok: true, value: 7 });
    expect(parseStaleAfterDays(' 60 ')).toEqual({ ok: true, value: 60 });
    for (const bad of ['0', '61', '2.5', '-1', 'abc', '']) expect(parseStaleAfterDays(bad)).toEqual({ ok: false });
  });
});
