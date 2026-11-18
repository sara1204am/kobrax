import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Checkbox, FormActions, FormSection, Tabs } from './form-kit';

const TABS = [
  { value: 'a', label: 'Uno' },
  { value: 'b', label: 'Dos' },
  { value: 'c', label: 'Tres', disabled: true },
];

describe('Tabs', () => {
  it('expone tablist/tab con aria-selected y roving tabindex', () => {
    render(<Tabs value="a" tabs={TABS} onChange={() => {}} label="Secciones" idPrefix="x" />);
    expect(screen.getByRole('tablist', { name: 'Secciones' })).toBeTruthy();
    const uno = screen.getByRole('tab', { name: 'Uno' });
    const dos = screen.getByRole('tab', { name: 'Dos' });
    expect(uno.getAttribute('aria-selected')).toBe('true');
    expect(dos.getAttribute('aria-selected')).toBe('false');
    expect(uno.getAttribute('tabindex')).toBe('0');
    expect(dos.getAttribute('tabindex')).toBe('-1');
    expect(uno.getAttribute('aria-controls')).toBe('x-panel-a');
  });

  it('las flechas mueven entre pestañas habilitadas (saltan las deshabilitadas) y dan la vuelta', async () => {
    const onChange = vi.fn();
    render(<Tabs value="a" tabs={TABS} onChange={onChange} label="S" />);
    screen.getByRole('tab', { name: 'Uno' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('b');
    screen.getByRole('tab', { name: 'Dos' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('a'); // «Tres» está deshabilitada: vuelve a «Uno»
  });

  it('un clic cambia de pestaña', async () => {
    const onChange = vi.fn();
    render(<Tabs value="a" tabs={TABS} onChange={onChange} label="S" />);
    await userEvent.click(screen.getByRole('tab', { name: 'Dos' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });
});

describe('Checkbox y formularios', () => {
  it('Checkbox se nombra por su texto y reporta el cambio', async () => {
    const onChange = vi.fn();
    render(<Checkbox label="Acepto" onChange={onChange} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Acepto' }));
    expect(onChange).toHaveBeenCalled();
  });

  it('FormSection agrupa con legend y FormActions renderiza sus hijos', () => {
    render(
      <FormSection title="Datos" description="Explicación">
        <FormActions>
          <button type="button">Guardar</button>
        </FormActions>
      </FormSection>,
    );
    expect(screen.getByRole('group', { name: 'Datos' })).toBeTruthy();
    expect(screen.getByText('Explicación')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeTruthy();
  });
});
