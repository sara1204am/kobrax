import { describe, it, expect } from 'vitest';
import { config } from './middleware';

/**
 * La cookie de acceso dura 15 minutos y sólo el middleware la renueva. Un handler `/api/...` que llama a la API
 * con el Bearer y no está en el `matcher` empieza a fallar con 401 pasado ese tiempo, y reintentar nunca lo
 * arregla. Fue lo que pasaba con «Exportar» de Mora: «No se pudo exportar» para siempre.
 */
describe('middleware · rutas que renuevan la sesión', () => {
  it.each(['/api/mora/:path*', '/api/assignments/:path*', '/api/arrear-categories/:path*', '/mora/:path*'])('cubre %s', (route) => {
    expect(config.matcher).toContain(route);
  });
});
