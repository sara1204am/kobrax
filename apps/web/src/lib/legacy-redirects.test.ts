import { describe, it, expect } from 'vitest';
import { LEGACY_REDIRECTS } from '../../legacy-redirects.mjs';

/** Next convierte `source` en una expresión; para probar el destino basta resolver `:path*` a mano. */
function resolve(url: string): string | null {
  for (const r of LEGACY_REDIRECTS) {
    const wild = r.source.endsWith('/:path*');
    const base = wild ? r.source.slice(0, -'/:path*'.length) : r.source;
    if (url === base) return r.destination.replace('/:path*', '');
    if (wild && url.startsWith(`${base}/`)) return r.destination.replace(':path*', url.slice(base.length + 1));
  }
  return null;
}

describe('rutas viejas de Cuenta (F14 · F6)', () => {
  it('todas son redirecciones permanentes', () => {
    expect(LEGACY_REDIRECTS.every((r) => r.permanent)).toBe(true);
  });

  it.each([
    ['/cuenta/oficinas', '/organizacion'],
    ['/cuenta/oficinas/papelera', '/organizacion/papelera'],
    ['/cuenta/oficinas/0b2c1f9e-0000-4000-8000-000000000001', '/organizacion/0b2c1f9e-0000-4000-8000-000000000001'],
    ['/cuenta/actividad', '/actividad'],
    ['/cuenta/soporte', '/seguridad/soporte'],
  ])('%s → %s', (from, to) => {
    expect(resolve(from)).toBe(to);
  });

  it('las pestañas que se quedan en Cuenta no se tocan', () => {
    for (const keep of ['/cuenta/general', '/cuenta/plan', '/cuenta/facturacion', '/cuenta/avanzado']) expect(resolve(keep)).toBeNull();
  });
});
