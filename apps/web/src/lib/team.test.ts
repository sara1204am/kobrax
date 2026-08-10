import { describe, it, expect } from 'vitest';
import type { Member } from '@kobrax/shared';
import { memberActions } from './team';

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

describe('memberActions', () => {
  it('a alguien activo se lo desactiva, no se lo elimina', () => {
    const a = memberActions(member(), YO, true);
    expect(a.deactivate).toBe(true);
    // DELETE /users/:id responde `notPending`: quien ya trabajó tiene casos y pagos colgando.
    expect(a.remove).toBe(false);
  });

  it('a un pendiente se lo elimina, y no tiene sentido desactivarlo', () => {
    const a = memberActions(member({ userStatus: 'PENDING' }), YO, true);
    expect(a.remove).toBe(true);
    expect(a.deactivate).toBe(false);
  });

  it('a un inactivo se lo reactiva', () => {
    const a = memberActions(member({ isActive: false }), YO, true);
    expect(a.reactivate).toBe(true);
    expect(a.deactivate).toBe(false);
  });

  it('tu propia fila no ofrece nada: la API lo rechaza igual', () => {
    expect(memberActions(member({ userId: YO }), YO, true)).toEqual({
      changeRole: false,
      deactivate: false,
      reactivate: false,
      remove: false,
    });
  });

  it('sin user:write no se ofrece ninguna acción', () => {
    expect(memberActions(member(), YO, false)).toEqual({
      changeRole: false,
      deactivate: false,
      reactivate: false,
      remove: false,
    });
  });

  it('un rol que la web no puede volver a asignar no se toca', () => {
    // GET /roles sólo devuelve ACCOUNT_ADMIN, SUPERVISOR y COLLECTOR: sacar a alguien de
    // MANAGER sería una puerta de una sola dirección.
    const a = memberActions(member({ roleName: 'MANAGER' }), YO, true);
    expect(a.changeRole).toBe(false);
    // Pero desactivarlo sí se puede: eso no depende del catálogo de roles.
    expect(a.deactivate).toBe(true);
  });

  it('un administrador sí se puede cambiar de rol: el freno del último admin es del servidor', () => {
    expect(memberActions(member({ roleName: 'ACCOUNT_ADMIN' }), YO, true).changeRole).toBe(true);
  });
});
