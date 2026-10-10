import { clearPendingTarget, consumePendingTarget, setPendingTarget } from './push-pending';

describe('push-pending · el aviso que abrió la app', () => {
  beforeEach(() => clearPendingTarget());

  it('se consume una sola vez', () => {
    setPendingTarget('/agenda/abc');
    expect(consumePendingTarget()).toBe('/agenda/abc');
    expect(consumePendingTarget()).toBeNull();
  });

  it('sin nada pendiente devuelve null', () => {
    expect(consumePendingTarget()).toBeNull();
  });

  it('el último aviso pisa al anterior', () => {
    setPendingTarget('/a');
    setPendingTarget('/b');
    expect(consumePendingTarget()).toBe('/b');
  });
});
