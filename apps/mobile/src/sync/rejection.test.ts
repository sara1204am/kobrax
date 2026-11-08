import { explainRejection } from './rejection';

describe('explainRejection · por qué el servidor rechazó lo que se hizo sin señal (F14 · F8, N-06)', () => {
  it('🔴 404: ya no ve al cliente o crédito', () => {
    const m = explainRejection({ httpStatus: 404, message: 'Cliente no encontrado' });
    expect(m).toContain('Ya no tienes acceso');
    expect(m).toContain('no se aplicó');
  });

  it('🔴 403: su rol o su oficina ya no permiten la acción', () => {
    expect(explainRejection({ httpStatus: 403, code: 'AUTHZ_000', message: 'Sin permiso' })).toContain('Tu rol o tu oficina ya no permiten');
  });

  it('🔴 un alta sin oficina (422 de oficina) dice qué hacer', () => {
    for (const code of ['CLIENT_BRANCH_UNRESOLVED', 'CLIENT_CREATE_AT_ROOT', 'CLIENT_BRANCH_INVALID']) {
      expect(`${code}: ${explainRejection({ httpStatus: 422, code, message: 'x' })}`).toContain('elegir en qué oficina');
    }
  });

  it('🔴 elegir una oficina que no le corresponde NO se explica como «falta elegir»: dice que no puede registrar ahí', () => {
    const m = explainRejection({ httpStatus: 403, code: 'CLIENT_BRANCH_OUT_OF_SCOPE', message: 'x' });
    expect(m).toContain('No puedes registrar clientes en esa oficina');
    expect(m).not.toContain('Falta elegir');
  });

  it('un documento repetido sugiere «Crear mi préstamo» sobre ese cliente', () => {
    expect(explainRejection({ httpStatus: 409, code: 'CLIENT_DUP', message: 'Ya existe un cliente con ese documento' })).toContain('Crear mi préstamo');
  });

  it('el resto conserva el mensaje del servidor (ya es específico y está en español)', () => {
    expect(explainRejection({ httpStatus: 422, code: 'PAYMENT_001', message: 'El monto no puede ser negativo' })).toBe('El monto no puede ser negativo');
    expect(explainRejection({ message: 'No se pudo subir' })).toBe('No se pudo subir');
  });
});
