import { describe, expect, it } from 'vitest';
import { renderTemplate } from './template.js';

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
