import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { allPassed, PasswordChecklist } from './password-checklist';

describe('allPassed', () => {
  it('true cuando cumple toda la política', () => {
    expect(allPassed('Kobrax123!')).toBe(true);
  });
  it('false cuando falta algún requisito', () => {
    expect(allPassed('kobrax123')).toBe(false); // sin mayúscula ni símbolo
    expect(allPassed('Short1!')).toBe(false); // < 8
  });
});

describe('PasswordChecklist', () => {
  it('no renderiza nada con la contraseña vacía', () => {
    const { container } = render(<PasswordChecklist password="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('marca las 4 reglas como cumplidas con una contraseña válida', () => {
    render(<PasswordChecklist password="Kobrax123!" />);
    expect(screen.getAllByText('✓')).toHaveLength(4);
    expect(screen.queryAllByText('○')).toHaveLength(0);
  });

  it('muestra reglas pendientes cuando la contraseña es parcial', () => {
    render(<PasswordChecklist password="kobrax" />); // falta mayúscula, número, símbolo
    expect(screen.getAllByText('○').length).toBeGreaterThan(0);
  });
});
