import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Field, Input } from './ui';

describe('Input · ver contraseña', () => {
  it('alterna entre oculto y visible', async () => {
    render(
      <Field label="Contraseña">
        <Input type="password" reveal defaultValue="secreta" />
      </Field>,
    );
    const input = screen.getByLabelText('Contraseña');
    expect(input).toHaveAttribute('type', 'password');

    await userEvent.click(screen.getByRole('button', { name: 'Mostrar contraseña' }));
    expect(input).toHaveAttribute('type', 'text');

    await userEvent.click(screen.getByRole('button', { name: 'Ocultar contraseña' }));
    expect(input).toHaveAttribute('type', 'password');
  });

  /**
   * `Field` envuelve todo en un `<label>` y la asociación implícita apunta al PRIMER control del
   * DOM. Si el botón del ojo quedara antes del input, el label pasaría a nombrar al botón: los
   * lectores de pantalla dejarían de anunciar el campo. Esta prueba lo fija.
   */
  it('el label sigue nombrando al input, no al botón del ojo', () => {
    render(
      <Field label="Nueva contraseña">
        <Input type="password" reveal />
      </Field>,
    );
    expect(screen.getByLabelText('Nueva contraseña').tagName).toBe('INPUT');
  });

  it('sin `reveal` no hay botón', () => {
    render(
      <Field label="Correo">
        <Input type="email" />
      </Field>,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});
