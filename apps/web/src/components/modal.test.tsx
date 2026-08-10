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
