import { describe, it, expect } from 'vitest';
import type { Member } from '@kobrax/shared';
import { DEFAULT_PAGE_SIZE, hasTeamFilters, memberActions, teamView } from './team';

const member = (over: Partial<Member> = {}): Member => ({
  userId: 'u2',
  email: 'rosa@kobrax.demo',
  firstName: 'Rosa',
  lastName: 'Quispe',
  phone: null,
  photoUrl: null,
  roleId: 'role-collector',
  roleName: 'COLLECTOR',
  isOwner: false,
  isActive: true,
  userStatus: 'ACTIVE',
  ...over,
});

const YO = 'u1';
const TODO = { canWrite: true, canInvite: true };
const NADA = { canWrite: false, canInvite: false };

describe('teamView', () => {
  const equipo = [
    member({ userId: 'a', firstName: 'Rosa', lastName: 'Quispe', roleName: 'COLLECTOR' }),
    member({ userId: 'b', firstName: 'Ana', lastName: 'Vargas', roleName: 'MANAGER', email: 'ana@kobrax.demo' }),
    member({ userId: 'c', firstName: 'Luis', lastName: 'Mamani', roleName: 'COLLECTOR', userStatus: 'PENDING' }),
    member({ userId: 'd', firstName: 'Eva', lastName: 'Choque', roleName: 'SUPERVISOR', isActive: false }),
  ];

  it('sin nada en la URL devuelve a todos, en el orden que vinieron', () => {
    const { rows, meta } = teamView(equipo, {});
    expect(rows.map((m) => m.userId)).toEqual(['a', 'b', 'c', 'd']);
    expect(meta).toEqual({ total: 4, page: 1, limit: DEFAULT_PAGE_SIZE, pages: 1 });
  });

  it('busca por nombre y por correo', () => {
    expect(teamView(equipo, { q: 'quispe' }).rows.map((m) => m.userId)).toEqual(['a']);
    expect(teamView(equipo, { q: 'ana@' }).rows.map((m) => m.userId)).toEqual(['b']);
  });

  it('filtra por rol y por estado, y los combina con «y»', () => {
    expect(teamView(equipo, { role: 'COLLECTOR' }).rows.map((m) => m.userId)).toEqual(['a', 'c']);
    expect(teamView(equipo, { status: 'pending' }).rows.map((m) => m.userId)).toEqual(['c']);
    expect(teamView(equipo, { status: 'inactive' }).rows.map((m) => m.userId)).toEqual(['d']);
    expect(teamView(equipo, { role: 'COLLECTOR', status: 'pending' }).rows.map((m) => m.userId)).toEqual(['c']);
  });

  it('ordena por nombre y por rol, en los dos sentidos', () => {
    expect(teamView(equipo, { sort: 'name' }).rows.map((m) => m.firstName)).toEqual(['Ana', 'Eva', 'Luis', 'Rosa']);
    expect(teamView(equipo, { sort: 'name', dir: 'desc' }).rows[0]!.firstName).toBe('Rosa');
    expect(teamView(equipo, { sort: 'role' }).rows[0]!.roleName).toBe('COLLECTOR');
  });

  it('una clave de orden que la tabla no conoce deja la lista como está', () => {
    expect(teamView(equipo, { sort: 'inventado' }).rows.map((m) => m.userId)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('pagina, y el tamaño sale de la URL', () => {
    const { rows, meta } = teamView(equipo, { pageSize: '25', page: '1' });
    expect(rows).toHaveLength(4);
    expect(meta.pages).toBe(1);
  });

  it('🔴 filtrar desde una página alta no deja una tabla vacía: cae a la última que existe', () => {
    // El caso real: estás en la página 3, filtrás por un rol que tiene dos personas, y la tabla
    // sale vacía mientras el pie dice que hay dos.
    const { rows, meta } = teamView(equipo, { page: '9', role: 'COLLECTOR' });
    expect(meta.page).toBe(1);
    expect(rows).toHaveLength(2);
  });
});

describe('hasTeamFilters', () => {
  it('cuenta la búsqueda y los filtros, y no cuenta el espacio en blanco', () => {
    expect(hasTeamFilters({})).toBe(false);
    expect(hasTeamFilters({ q: '  ' })).toBe(false);
    expect(hasTeamFilters({ q: 'rosa' })).toBe(true);
    expect(hasTeamFilters({ role: 'COLLECTOR' })).toBe(true);
    expect(hasTeamFilters({ status: 'inactive' })).toBe(true);
  });
});

describe('memberActions', () => {
  it('a alguien activo se lo desactiva, no se lo elimina', () => {
    const a = memberActions(member(), YO, TODO);
    expect(a.deactivate).toBe(true);
    // DELETE /users/:id responde `notPending`: quien ya trabajó tiene casos y pagos colgando.
    expect(a.remove).toBe(false);
  });

  it('a un pendiente se lo elimina o se le reenvía, y no tiene sentido desactivarlo', () => {
    const a = memberActions(member({ userStatus: 'PENDING' }), YO, TODO);
    expect(a.remove).toBe(true);
    expect(a.resend).toBe(true);
    expect(a.deactivate).toBe(false);
  });

  it('reenviar pide user:invite, no user:write', () => {
    const pendiente = member({ userStatus: 'PENDING' });
    const soloInvitar = memberActions(pendiente, YO, { canWrite: false, canInvite: true });
    expect(soloInvitar.resend).toBe(true);
    // Sin `user:write` no puede cancelarla, aunque pueda reenviarla.
    expect(soloInvitar.remove).toBe(false);
  });

  it('a quien ya aceptó no se le reenvía nada', () => {
    expect(memberActions(member(), YO, TODO).resend).toBe(false);
  });

  it('a un inactivo se lo reactiva', () => {
    const a = memberActions(member({ isActive: false }), YO, TODO);
    expect(a.reactivate).toBe(true);
    expect(a.deactivate).toBe(false);
  });

  it('tu propia fila no ofrece nada: la API lo rechaza igual', () => {
    expect(memberActions(member({ userId: YO, userStatus: 'PENDING' }), YO, TODO)).toEqual({
      changeRole: false,
      deactivate: false,
      reactivate: false,
      remove: false,
      resend: false,
    });
  });

  it('sin permisos no se ofrece ninguna acción', () => {
    expect(memberActions(member({ userStatus: 'PENDING' }), YO, NADA)).toEqual({
      changeRole: false,
      deactivate: false,
      reactivate: false,
      remove: false,
      resend: false,
    });
  });

  it('un rol que la web no puede volver a asignar no se toca', () => {
    // GET /roles sólo devuelve ACCOUNT_ADMIN, SUPERVISOR y COLLECTOR: sacar a alguien de
    // MANAGER sería una puerta de una sola dirección.
    const a = memberActions(member({ roleName: 'MANAGER' }), YO, TODO);
    expect(a.changeRole).toBe(false);
    // Pero desactivarlo sí se puede: eso no depende del catálogo de roles.
    expect(a.deactivate).toBe(true);
  });

  it('un administrador sí se puede cambiar de rol: el freno del último admin es del servidor', () => {
    expect(memberActions(member({ roleName: 'ACCOUNT_ADMIN' }), YO, TODO).changeRole).toBe(true);
  });
});

describe('teamView · oficina (F13)', () => {
  // Central ⊃ Chuquisaca ⊃ Mesa Verde; La Paz aparte.
  const ofi = (id: string, parentId: string | null, path: string) =>
    ({ id, name: id, parentId, path, depth: 0, active: true, isRoot: !parentId }) as never;
  const offices = [ofi('c', null, '/c/'), ofi('ch', 'c', '/c/ch/'), ofi('mv', 'ch', '/c/ch/mv/'), ofi('lp', 'c', '/c/lp/')];
  const equipo = [
    member({ userId: 'a', branchId: 'mv' }),
    member({ userId: 'b', branchId: 'lp' }),
    member({ userId: 'c', branchId: 'ch' }),
    member({ userId: 'd', branchId: null }),
  ];

  it('filtrar por una regional incluye a quienes están en lo que cuelga de ella', () => {
    expect(teamView(equipo, { office: 'ch' }, offices).rows.map((m) => m.userId)).toEqual(['a', 'c']);
    expect(teamView(equipo, { office: 'c' }, offices).rows.map((m) => m.userId)).toEqual(['a', 'b', 'c']);
  });
  it('una hoja sólo trae a los suyos y nadie sin oficina', () => {
    expect(teamView(equipo, { office: 'lp' }, offices).rows.map((m) => m.userId)).toEqual(['b']);
  });
  it('cuenta como filtro puesto', () => {
    expect(hasTeamFilters({ office: 'c' })).toBe(true);
  });
});
