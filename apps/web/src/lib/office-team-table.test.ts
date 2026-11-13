import { describe, it, expect } from 'vitest';
import { officeTeamView, type OfficeTeamRow } from './office-team-table';

const row = (name: string, credits: number, arrearsCredits: number, balance: number, arrearsBalance: number, over: Partial<OfficeTeamRow> = {}): OfficeTeamRow => ({
  userId: name,
  name,
  email: `${name.toLowerCase()}@kobrax.demo`,
  roleName: 'COLLECTOR',
  officeId: 'o1',
  officeName: 'Agencia Mesa Verde',
  portfolio: { credits, arrearsCredits, byCurrency: balance || arrearsBalance ? [{ currency: 'BOB', credits, arrearsCredits, balance, arrearsBalance }] : [] },
  ...over,
});

const EQUIPO = [row('Carla', 4, 2, 9000, 3000), row('Ana', 10, 0, 20000, 0), row('Beto', 1, 1, 500, 500, { roleName: 'SUPERVISOR' })];
const names = (rows: OfficeTeamRow[]) => rows.map((r) => r.name);

describe('officeTeamView', () => {
  it('sin parámetros ordena por nombre', () => {
    expect(names(officeTeamView(EQUIPO, {}).rows)).toEqual(['Ana', 'Beto', 'Carla']);
  });

  it('ordena por cada columna numérica, en los dos sentidos', () => {
    expect(names(officeTeamView(EQUIPO, { sort: 'credits', dir: 'desc' }).rows)).toEqual(['Ana', 'Carla', 'Beto']);
    expect(names(officeTeamView(EQUIPO, { sort: 'arrearsCredits', dir: 'desc' }).rows)).toEqual(['Carla', 'Beto', 'Ana']);
    expect(names(officeTeamView(EQUIPO, { sort: 'balance', dir: 'asc' }).rows)).toEqual(['Beto', 'Carla', 'Ana']);
    expect(names(officeTeamView(EQUIPO, { sort: 'arrearsBalance', dir: 'desc' }).rows)).toEqual(['Carla', 'Beto', 'Ana']);
  });

  it('un empate se desempata por nombre', () => {
    const e = [row('Zoe', 3, 0, 1, 0), row('Abel', 3, 0, 1, 0)];
    expect(names(officeTeamView(e, { sort: 'credits' }).rows)).toEqual(['Abel', 'Zoe']);
  });

  it('una columna que no existe cae al nombre (no rompe)', () => {
    expect(names(officeTeamView(EQUIPO, { sort: 'inventada;DROP' }).rows)).toEqual(['Ana', 'Beto', 'Carla']);
  });

  it('la búsqueda global mira nombre, correo y rol, sin tildes ni mayúsculas', () => {
    expect(names(officeTeamView(EQUIPO, { q: 'carl' }).rows)).toEqual(['Carla']);
    expect(names(officeTeamView(EQUIPO, { q: 'BETO@KOBRAX' }).rows)).toEqual(['Beto']);
    expect(names(officeTeamView(EQUIPO, { q: 'supervisor' }).rows)).toEqual(['Beto']);
    expect(officeTeamView(EQUIPO, { q: 'nadie' }).meta.total).toBe(0);
  });

  it('pagina y el meta dice cuántas hay; buscar no deja en una página que ya no existe', () => {
    const muchos = Array.from({ length: 25 }, (_, i) => row(`P${String(i).padStart(2, '0')}`, i, 0, 0, 0));
    const p3 = officeTeamView(muchos, { page: '3' });
    expect(p3.meta).toEqual({ total: 25, page: 3, limit: 10, pages: 3 });
    expect(p3.rows).toHaveLength(5);
    expect(officeTeamView(muchos, { page: '3', q: 'P01' }).meta.page).toBe(1);
  });

  it('en una regional cada fila trae su agencia: se busca y se ordena por oficina', () => {
    const e = [row('Ana', 1, 0, 1, 0, { officeName: 'Agencia Padilla' }), row('Beto', 1, 0, 1, 0, { officeName: 'Agencia Camargo' }), row('Carla', 1, 0, 1, 0, { officeName: 'Agencia Padilla' })];
    expect(names(officeTeamView(e, { q: 'padilla' }).rows)).toEqual(['Ana', 'Carla']);
    expect(names(officeTeamView(e, { sort: 'office' }).rows)).toEqual(['Beto', 'Ana', 'Carla']);
    expect(names(officeTeamView(e, { sort: 'office', dir: 'desc' }).rows)).toEqual(['Ana', 'Carla', 'Beto']);
  });

  it('una persona sin créditos muestra ceros y no se rompe al ordenar por saldo', () => {
    const e = [row('Sin', 0, 0, 0, 0), row('Con', 2, 1, 100, 100)];
    expect(names(officeTeamView(e, { sort: 'balance', dir: 'desc' }).rows)).toEqual(['Con', 'Sin']);
  });
});
