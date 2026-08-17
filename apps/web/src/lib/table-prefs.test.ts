import { describe, expect, it, beforeEach } from 'vitest';
import { PREFS_VERSION, prefsToParams, readPrefs, writePrefs } from './table-prefs';

beforeEach(() => localStorage.clear());

describe('preferencias de tabla', () => {
  it('lo guardado vuelve tal cual', () => {
    writePrefs('u1', 'cartera', { filters: { dpdMin: '90' }, sort: 'debt', dir: 'desc', pageSize: 25, columns: ['name', 'debt'] });
    expect(readPrefs('u1', 'cartera')).toEqual({
      version: PREFS_VERSION,
      filters: { dpdMin: '90' },
      sort: 'debt',
      dir: 'desc',
      pageSize: 25,
      columns: ['name', 'debt'],
    });
  });

  it('cada usuario tiene las suyas', () => {
    // Dos personas en la misma máquina —el caso normal en una oficina de cobranzas— no comparten
    // el filtro que dejó puesto la anterior.
    writePrefs('u1', 'cartera', { filters: { dpdMin: '90' } });
    expect(readPrefs('u2', 'cartera')).toBeNull();
  });

  it('🔴 unas preferencias de otra versión se descartan', () => {
    // El día que cambien las columnas, lo guardado apuntaría a columnas que ya no existen y la tabla
    // saldría vacía. Con el número, se cae a los defaults: molesta una vez, no rompe nunca.
    localStorage.setItem('tablePrefs:u1:cartera', JSON.stringify({ version: 0, filters: { dpdMin: '90' } }));
    expect(readPrefs('u1', 'cartera')).toBeNull();
  });

  it('🔴 un JSON roto no tumba la pantalla', () => {
    localStorage.setItem('tablePrefs:u1:cartera', '{no es json');
    expect(readPrefs('u1', 'cartera')).toBeNull();
  });

  it('un `filters` que no es objeto se ignora, no explota', () => {
    localStorage.setItem('tablePrefs:u1:cartera', JSON.stringify({ version: PREFS_VERSION, filters: 'nada' }));
    expect(readPrefs('u1', 'cartera')?.filters).toEqual({});
  });

  it('vuelven a la URL como parámetros', () => {
    writePrefs('u1', 'cartera', { filters: { dpdMin: '90', q: 'perez' }, sort: 'debt', dir: 'asc', pageSize: 100 });
    const params = prefsToParams(readPrefs('u1', 'cartera')!);
    expect(params.get('dpdMin')).toBe('90');
    expect(params.get('q')).toBe('perez');
    expect(params.get('sort')).toBe('debt');
    expect(params.get('dir')).toBe('asc');
    expect(params.get('pageSize')).toBe('100');
    // La página NO se restaura: volver y aterrizar en la 7 de una lista que cambió no restaura nada.
    expect(params.has('page')).toBe(false);
  });
});
