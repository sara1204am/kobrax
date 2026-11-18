import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button, Field, IconButton, Input, TextButton } from './ui';

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

describe('Button — tamaños y ancho', () => {
  it('sin props extra conserva el aspecto de siempre (ancho completo, 48px)', () => {
    render(<Button>Guardar</Button>);
    const el = screen.getByRole('button', { name: 'Guardar' });
    expect(el.className).toContain('w-full');
    expect(el.className).toContain('h-12');
  });
  it('size="sm" y fullWidth={false} ajustan alto y ancho', () => {
    render(<Button size="sm" fullWidth={false}>Chico</Button>);
    const el = screen.getByRole('button', { name: 'Chico' });
    expect(el.className).toContain('h-9');
    expect(el.className).toContain('w-auto');
    expect(el.className).not.toContain('w-full');
  });
  it('IconButton exige label y lo expone como nombre accesible', () => {
    render(<IconButton label="Cerrar">x</IconButton>);
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeTruthy();
  });
});

describe('TextButton', () => {
  it('es type=button por omisión: dentro de un formulario no lo envía', async () => {
    let submitted = false;
    render(
      <form onSubmit={(e) => { e.preventDefault(); submitted = true; }}>
        <TextButton>Cambiar</TextButton>
      </form>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cambiar' }));
    expect(submitted).toBe(false);
  });

  it('el tono elige el color y el disabled apaga el clic', async () => {
    let clicks = 0;
    render(<TextButton tone="danger" disabled onClick={() => { clicks++; }}>Quitar</TextButton>);
    const b = screen.getByRole('button', { name: 'Quitar' });
    expect(b.className).toContain('text-k-danger');
    await userEvent.click(b);
    expect(clicks).toBe(0);
  });
});
