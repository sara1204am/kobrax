import { nuevoId } from './ids';

describe('nuevoId', () => {
  it('tiene forma de UUID v4', () => {
    expect(nuevoId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  // El server valida el campo con @IsUUID: una forma inválida rebotaría el alta entera.
  it('no repite (10 000 seguidos, todos distintos)', () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 10_000; i++) vistos.add(nuevoId());
    expect(vistos.size).toBe(10_000);
  });
});
