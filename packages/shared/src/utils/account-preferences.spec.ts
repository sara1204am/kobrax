import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PREFERENCES,
  diffPreferences,
  mergePreferences,
  preferencesOf,
  validatePreferences,
  type AccountPreferences,
} from './account-preferences.js';

const assert = {
  equal: (a: unknown, b: unknown) => expect(a).toBe(b),
  deepEqual: (a: unknown, b: unknown) => expect(a).toEqual(b),
};

const OK: AccountPreferences = { ...DEFAULT_PREFERENCES };

describe('preferencesOf', () => {
  it('una cuenta que nunca las configuró recibe los valores de fábrica', () => {
    assert.deepEqual(preferencesOf({}), DEFAULT_PREFERENCES);
    assert.deepEqual(preferencesOf(null), DEFAULT_PREFERENCES);
    assert.deepEqual(preferencesOf({ importConfig: { staleAfterDays: 30 } }), DEFAULT_PREFERENCES);
  });

  it('no comparte el arreglo de fábrica: modificar el resultado no altera el default', () => {
    const p = preferencesOf({});
    p.workDays.push(7);
    assert.deepEqual(DEFAULT_PREFERENCES.workDays, [1, 2, 3, 4, 5, 6]);
  });

  it('lee lo guardado, con los días ordenados y sin repetir', () => {
    const p = preferencesOf({ preferences: { workDays: [5, 1, 3, 3], workStart: '07:30', workEnd: '16:00', weekStart: 'SUN', defaultLocale: 'en' } });
    assert.deepEqual(p, { workDays: [1, 3, 5], workStart: '07:30', workEnd: '16:00', weekStart: 'SUN', defaultLocale: 'en' });
  });

  it('un campo mal formado cae a su valor de fábrica sin tumbar los demás', () => {
    const p = preferencesOf({ preferences: { workDays: [1, 2], workStart: '25:99', weekStart: 'VIE', defaultLocale: 'fr' } });
    assert.deepEqual(p.workDays, [1, 2]);
    assert.equal(p.workStart, DEFAULT_PREFERENCES.workStart);
    assert.equal(p.weekStart, 'MON');
    assert.equal(p.defaultLocale, 'es');
  });

  it('🔴 un juego incoherente (fin antes que inicio) se descarta entero, no se sirve a medias', () => {
    const p = preferencesOf({ preferences: { workStart: '18:00', workEnd: '08:00', weekStart: 'SUN' } });
    assert.deepEqual(p, DEFAULT_PREFERENCES);
  });

  it('días fuera de 1–7 o vacíos caen al default', () => {
    assert.deepEqual(preferencesOf({ preferences: { workDays: [0, 8] } }).workDays, DEFAULT_PREFERENCES.workDays);
    assert.deepEqual(preferencesOf({ preferences: { workDays: [] } }).workDays, DEFAULT_PREFERENCES.workDays);
  });
});

describe('validatePreferences', () => {
  it('el default es válido', () => assert.equal(validatePreferences(OK), null));

  it('exige al menos un día de trabajo y días entre 1 y 7', () => {
    assert.equal(validatePreferences({ ...OK, workDays: [] }), 'NO_WORK_DAYS');
    assert.equal(validatePreferences({ ...OK, workDays: [1, 9] }), 'WORK_DAY_INVALID');
  });

  it('las horas son HH:MM de 24 h y el fin va después del inicio', () => {
    assert.equal(validatePreferences({ ...OK, workStart: '8:00' }), 'TIME_INVALID');
    assert.equal(validatePreferences({ ...OK, workEnd: '24:00' }), 'TIME_INVALID');
    assert.equal(validatePreferences({ ...OK, workStart: '10:00', workEnd: '10:00' }), 'END_NOT_AFTER_START');
    assert.equal(validatePreferences({ ...OK, workStart: '10:00', workEnd: '09:59' }), 'END_NOT_AFTER_START');
    assert.equal(validatePreferences({ ...OK, workStart: '00:00', workEnd: '23:59' }), null);
  });
});

describe('mergePreferences · diffPreferences', () => {
  it('el parche pisa sólo lo que trae', () => {
    const merged = mergePreferences(OK, { workEnd: '17:00', workDays: [6, 1] });
    assert.equal(merged.workEnd, '17:00');
    assert.equal(merged.workStart, OK.workStart);
    assert.deepEqual(merged.workDays, [1, 6]);
  });

  it('el diff devuelve sólo lo que cambió, y vacío si nada', () => {
    assert.deepEqual(diffPreferences(OK, { ...OK }), {});
    assert.deepEqual(diffPreferences(OK, { ...OK, weekStart: 'SUN', workDays: [1, 2] }), { weekStart: 'SUN', workDays: [1, 2] });
  });
});
