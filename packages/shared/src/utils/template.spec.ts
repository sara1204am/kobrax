import { describe, expect, it } from 'vitest';
import { missingTemplateKeys, renderTemplate, templateKeys, unknownTemplateKeys } from './template.js';

describe('renderTemplate', () => {
  it('reemplaza las variables presentes', () => {
    expect(renderTemplate('Hola {{cliente}}, debe {{saldo}}', { cliente: 'Ana', saldo: 'Bs 500' })).toBe(
      'Hola Ana, debe Bs 500',
    );
  });

  it('tolera espacios dentro de las llaves y números', () => {
    expect(renderTemplate('Saldo: {{ saldo }}', { saldo: 500 })).toBe('Saldo: 500');
  });

  it('deja literal la variable sin valor, no la borra', () => {
    expect(renderTemplate('Hola {{cliente}}, debe {{saldo}}', { cliente: 'Ana' })).toBe('Hola Ana, debe {{saldo}}');
  });

  it('un cuerpo sin variables vuelve intacto', () => {
    expect(renderTemplate('Mensaje fijo', { cliente: 'Ana' })).toBe('Mensaje fijo');
  });
});

describe('variables de plantilla', () => {
  it('templateKeys devuelve claves distintas en orden, con o sin espacios', () => {
    expect(templateKeys('{{cliente}} {{ saldo }} {{cliente}}')).toEqual(['cliente', 'saldo']);
  });

  it('unknownTemplateKeys marca lo que el sistema no llena', () => {
    expect(unknownTemplateKeys('Hola {{clinte}}, {{saldo}}')).toEqual(['clinte']);
    expect(unknownTemplateKeys('Hola {{cliente}}')).toEqual([]);
  });

  it('missingTemplateKeys: sin valor o vacío es falta; una clave desconocida no es "falta" sino error aparte', () => {
    expect(missingTemplateKeys('{{cliente}} {{saldo}} {{negocio}} {{x}}', { cliente: 'Ana', saldo: ' ' })).toEqual([
      'saldo',
      'negocio',
    ]);
  });
});
