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
const TODO = { canWrite: true, canInvite: true };
const NADA = { canWrite: false, canInvite: false };

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
