import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Modal } from './modal';
import { ToastProvider, useToast } from './toast';

describe('Modal', () => {
  it('sigue a la prop `open` en vez de tener su propio estado', () => {
    const { rerender } = render(
      <Modal open={false} onClose={() => {}} title="Borrar cliente">
        ¿Seguro?
      </Modal>,
    );
    expect(screen.getByRole('dialog', { hidden: true })).not.toHaveAttribute('open');

    rerender(
      <Modal open onClose={() => {}} title="Borrar cliente">
        ¿Seguro?
      </Modal>,
    );
    expect(screen.getByRole('dialog')).toHaveAttribute('open');
  });

  it('avisa por `onClose` cuando el navegador lo cierra (la tecla Esc entra por acá)', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Borrar cliente">
        ¿Seguro?
      </Modal>,
    );
    // `close()` es lo que dispara el navegador al apretar Esc.
    (screen.getByRole('dialog') as HTMLDialogElement).close();
    expect(onClose).toHaveBeenCalled();
  });

  it('cerrarlo por código NO vuelve a llamar a `onClose`', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Modal open onClose={onClose} title="Borrar cliente">
        ¿Seguro?
      </Modal>,
    );

    // Lo que pasa al tocar la X: el llamador ya corrió su `onClose` y bajó `open`. Si el
    // cierre que eso provoca volviera a avisar, cada efecto del llamador saldría duplicado.
    rerender(
      <Modal open={false} onClose={onClose} title="Borrar cliente">
        ¿Seguro?
      </Modal>,
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('el título nombra al diálogo', () => {
    render(
      <Modal open onClose={() => {}} title="Borrar cliente">
        ¿Seguro?
      </Modal>,
    );
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Borrar cliente');
  });

  /**
   * 🔴 **El techo de alto es lo que mantiene el modal en el medio.** El navegador centra un
   * `<dialog>` repartiendo el espacio que le sobra (`margin: auto`); si el contenido lo hace tan
   * alto como la ventana no sobra nada, los márgenes dan cero y el diálogo se pega **arriba**. Pasó
   * con el visor de adjuntos y una foto de carnet en vertical. El contenido largo scrollea adentro
   * en vez de empujar la caja — por eso las dos clases se prueban juntas.
   */
  it('nunca es tan alto como la ventana: si no, deja de estar centrado', () => {
    const { rerender } = render(
      <Modal open onClose={() => {}} title="Ver documento">
        <img src="/x.jpg" alt="" />
      </Modal>,
    );
    const alto = (d: HTMLElement) => d.className.includes('max-h-[90vh]');
    expect(alto(screen.getByRole('dialog'))).toBe(true);
    expect(screen.getByRole('dialog').querySelector('.overflow-y-auto')).not.toBeNull();

    rerender(
      <Modal wide open onClose={() => {}} title="Ver documento">
        <img src="/x.jpg" alt="" />
      </Modal>,
    );
    expect(alto(screen.getByRole('dialog'))).toBe(true);
  });

  /**
   * 🔴 **El `display` tiene que colgar del atributo `open`, no ser fijo.**
   *
   * Un `<dialog>` cerrado se esconde por la hoja del navegador; cualquier `display` de autor la
   * pisa. Con un `flex` suelto, los tres modales de la ficha —dar de baja, quitar adjunto, ver en
   * el mapa— salían **todos abiertos a la vez**, dibujados en medio del contenido. jsdom no aplica
   * Tailwind, así que lo único verificable acá es el contrato de clases; el resto lo ve el ojo.
   */
  it('cerrado no se dibuja: el display cuelga de `open`, no es fijo', () => {
    render(
      <Modal open={false} onClose={() => {}} title="Borrar cliente">
        ¿Seguro?
      </Modal>,
    );
    const clases = screen.getByRole('dialog', { hidden: true }).className.split(/\s+/);
    expect(clases).toContain('hidden');
    // Un `flex`/`block`/`grid` sin variante volvería a mostrarlo cerrado.
    expect(clases.filter((c) => ['flex', 'block', 'grid', 'inline-flex'].includes(c))).toEqual([]);
  });
});

function Aviso() {
  const toast = useToast();
  return (
    <button type="button" onClick={() => toast('Cliente guardado')}>
      guardar
    </button>
  );
}

/**
 * Acá se usa `fireEvent` y no `userEvent`: el segundo mete sus propias esperas y, combinado
 * con los relojes falsos que hacen falta para ver morir el aviso, la prueba se cuelga sin
 * avanzar. `fireEvent` dispara el clic y nada más.
 */
describe('Toast', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('muestra el aviso y lo saca solo', () => {
    render(
      <ToastProvider>
        <Aviso />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'guardar' }));
    expect(screen.getByText('Cliente guardado')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(5000));
    expect(screen.queryByText('Cliente guardado')).not.toBeInTheDocument();
  });

  it('dos avisos del mismo instante no se pisan', () => {
    render(
      <ToastProvider>
        <Aviso />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'guardar' }));
    fireEvent.click(screen.getByRole('button', { name: 'guardar' }));
    // Si el id saliera de `Date.now()`, los dos del mismo tick compartirían clave de React.
    expect(screen.getAllByText('Cliente guardado')).toHaveLength(2);
  });
});
