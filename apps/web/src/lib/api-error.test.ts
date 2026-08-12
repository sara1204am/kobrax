import { describe, expect, it } from 'vitest';
import es from '@/messages/es.json';
import en from '@/messages/en.json';
import { translator } from '@/test/translator';
import { errorText } from './api-error';

const ES = translator(es, 'panel.import');
const EN = translator(en, 'panel.import');

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

  it('sirve para cualquier módulo, no sólo para el import', () => {
    // La tabla `errors.*` la pone cada namespace; la regla es una sola.
    const casos = translator(en, 'panel.cases');
    expect(errorText({ code: 'CASE_002', message: 'no' }, casos, 'en')).toBe(en.panel.cases.errors.CASE_002);
  });
});
