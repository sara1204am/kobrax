import { render, fireEvent, screen } from '@testing-library/react-native';
import type { ClientDuplicateCheck } from '@kobrax/shared';
import { DuplicateNotice } from './duplicate-notice';

const match = { id: 'c9', displayName: 'Marta Cliente', maskedDocument: '55512***', status: 'ACTIVE' as const, creditCount: 2, deleted: false, otherDocument: false };
const checkWith = (over: Partial<typeof match> & { hidden?: boolean } = {}): ClientDuplicateCheck => ({ document: { ...match, ...over }, names: [] });

describe('DuplicateNotice · documento ya registrado (F14 · F8, D-8 b)', () => {
  it('un cliente que SÍ veo bloquea y manda a buscarlo en la cartera (como siempre)', () => {
    render(<DuplicateNotice check={checkWith()} local={false} accepted={false} onAccept={() => undefined} />);
    expect(screen.getByText('Ya existe un cliente con ese documento')).toBeTruthy();
    expect(screen.queryByText('Crear mi préstamo sobre este cliente')).toBeNull();
  });

  it('🔴 un cliente que NO veo (lo llevan otras personas) ofrece «Crear mi préstamo sobre este cliente»', () => {
    const onCreateMine = jest.fn();
    render(<DuplicateNotice check={checkWith({ hidden: true })} local={false} accepted={false} onAccept={() => undefined} onCreateMine={onCreateMine} />);
    expect(screen.getByText('Este cliente ya existe y lo llevan otras personas')).toBeTruthy();
    expect(screen.getByText('Marta Cliente · 55512***')).toBeTruthy();
    fireEvent.press(screen.getByText('Crear mi préstamo sobre este cliente'));
    expect(onCreateMine).toHaveBeenCalledWith(expect.objectContaining({ id: 'c9', displayName: 'Marta Cliente' }));
  });

  it('🔴 sin permiso para crear créditos (no hay `onCreateMine`) solo se explica, sin botón', () => {
    render(<DuplicateNotice check={checkWith({ hidden: true })} local={false} accepted={false} onAccept={() => undefined} />);
    expect(screen.getByText(/Todavía no está en tu cartera/)).toBeTruthy();
    expect(screen.queryByText('Crear mi préstamo sobre este cliente')).toBeNull();
  });

  it('🔴 sin señal no se ofrece (solo el servidor sabe que ese cliente existe)', () => {
    render(<DuplicateNotice check={checkWith({ hidden: true })} local accepted={false} onAccept={() => undefined} onCreateMine={() => undefined} />);
    expect(screen.queryByText('Crear mi préstamo sobre este cliente')).toBeNull();
  });

  it('el aviso de homónimos no cambia', () => {
    const check: ClientDuplicateCheck = { document: null, names: [match] };
    render(<DuplicateNotice check={check} local={false} accepted={false} onAccept={() => undefined} />);
    expect(screen.getByText('Ya hay alguien con ese nombre')).toBeTruthy();
    expect(screen.getByText('Es otra persona, continuar')).toBeTruthy();
  });
});
