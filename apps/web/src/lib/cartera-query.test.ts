import { describe, expect, it } from 'vitest';
import { carteraQuery, hasCarteraFilters } from './cartera-query';

/**
 * El adaptador de la Cartera: lo que la tabla tiene en la URL → lo que la API recibe.
 *
 * Es la pieza que decide si un 400 rompe la pantalla entera, así que lo que se mira acá es sobre
 * todo **qué NO viaja**.
 */
describe('carteraQuery', () => {
  it('sin nada, pide la primera página con el tamaño por defecto', () => {
    expect(carteraQuery({}).toString()).toBe('view=portfolio&page=1&limit=50');
  });

  it('los filtros de rango viajan como los espera la API', () => {
    const q = carteraQuery({ dpdMin: '90', debtMin: '10000', creditsMin: '4' });
    expect(q.get('dpdMin')).toBe('90');
    expect(q.get('debtMin')).toBe('10000');
    expect(q.get('creditsMin')).toBe('4');
  });

  it('🔴 un número a medio escribir NO viaja', () => {
    // Se filtra tipeando: entre «1» y «10000» pasa por «-», por «» y por «1e». Mandar eso es un 400,
    // y un 400 acá no rompe una columna: deja la pantalla sin cartera.
    for (const raw of ['', '-', 'abc', '1e', ' ']) {
      expect(carteraQuery({ debtMin: raw }).has('debtMin')).toBe(false);
    }
  });

  it('🔴 un id inventado tampoco viaja', () => {
    expect(carteraQuery({ collectorId: '../../users' }).has('collectorId')).toBe(false);
    const id = '3f2b9c10-1a4d-4b7e-9c8f-0a1b2c3d4e5f';
    expect(carteraQuery({ collectorId: id }).get('collectorId')).toBe(id);
  });

  it('🔴 `status` NO es un orden válido', () => {
    // La columna Estado se deriva en el navegador de la deuda y la mora; el servidor sólo sabe
    // ordenar por `client_status`, que es otra cosa. Ordenar por ella devolvería un orden que no
    // se corresponde con lo que la columna muestra.
    expect(carteraQuery({ sort: 'status' }).has('sort')).toBe(false);
    expect(carteraQuery({ sort: 'dpd' }).get('sort')).toBe('dpd');
  });

  it('el orden por defecto es descendente', () => {
    // Se ordena por mora o por deuda para ver lo peor primero; tocar «Mora» y recibir los de un día
    // de atraso no es lo que nadie quiso.
    expect(carteraQuery({ sort: 'debt' }).get('dir')).toBe('desc');
    expect(carteraQuery({ sort: 'debt', dir: 'asc' }).get('dir')).toBe('asc');
  });

  it('un tamaño de página inventado cae al default', () => {
    // La API valida `limit ≤ 100`: pedir 5000 desde la URL sería un 400.
    expect(carteraQuery({ pageSize: '5000' }).get('limit')).toBe('50');
    expect(carteraQuery({ pageSize: '25' }).get('limit')).toBe('25');
  });

  it('distingue «sin cartera» de «sin resultados por el filtro»', () => {
    expect(hasCarteraFilters({ page: '3', sort: 'debt' })).toBe(false);
    expect(hasCarteraFilters({ dpdMin: '90' })).toBe(true);
    expect(hasCarteraFilters({ q: 'perez' })).toBe(true);
  });
});
