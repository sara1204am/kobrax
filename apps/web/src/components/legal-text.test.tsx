import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LegalText, parseLegal } from './legal-text';

describe('LegalText', () => {
  it('arma títulos, párrafos y listas con y sin numeración', () => {
    const blocks = parseLegal('# Título\n\nUn párrafo\ncon dos líneas.\n\n## Sección\n\n- uno\n- dos\n\n1. primero\n2. segundo');
    expect(blocks).toEqual([
      { kind: 'h', level: 1, text: 'Título' },
      { kind: 'p', text: 'Un párrafo con dos líneas.' },
      { kind: 'h', level: 2, text: 'Sección' },
      { kind: 'ul', items: ['uno', 'dos'] },
      { kind: 'ol', items: ['primero', 'segundo'] },
    ]);
  });

  it('tolera saltos de línea de Windows', () => {
    expect(parseLegal('# A\r\n\r\ntexto')).toEqual([
      { kind: 'h', level: 1, text: 'A' },
      { kind: 'p', text: 'texto' },
    ]);
  });

  it('🔴 un texto con HTML o scripts se muestra como texto y NO se ejecuta ni se inserta como elemento', () => {
    const { container } = render(<LegalText content={'Hola <script>alert(1)</script> <img src=x onerror=alert(1)>'} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });

  it('resalta los marcadores [PENDIENTE …] para que un revisor los vea', () => {
    render(<LegalText content={'NIT: [PENDIENTE DE CONFIRMACIÓN LEGAL]'} />);
    const mark = screen.getByText('[PENDIENTE DE CONFIRMACIÓN LEGAL]');
    expect(mark.tagName).toBe('MARK');
  });

  it('los enlaces a otros documentos son enlaces internos; una URL externa NO se vuelve enlace', () => {
    render(<LegalText content={'Ver la [Política](/privacidad) y [esto](https://malo.example/x).'} />);
    const link = screen.getByRole('link', { name: 'Política' });
    expect(link).toHaveAttribute('href', '/privacidad');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(screen.queryByRole('link', { name: 'esto' })).toBeNull();
  });

  it('la negrita se pinta con <strong>', () => {
    render(<LegalText content={'Es **muy importante** leerlo'} />);
    expect(screen.getByText('muy importante').tagName).toBe('STRONG');
  });
});
