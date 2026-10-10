import { explainAgendaRejection, withAgendaExplanation } from './agenda-conflicts';

describe('explainAgendaRejection', () => {
  it('409: la gestión cambió mientras no había señal, y lo hecho no se aplicó', () => {
    const text = explainAgendaRejection(409, 'La gestión ya no está pendiente');
    expect(text).toMatch(/cambió mientras no tenías señal/);
    expect(text).toMatch(/no se aplicó/);
  });

  it('404: ya no está disponible para el cobrador (eliminada o reasignada)', () => {
    expect(explainAgendaRejection(404, 'Gestión agendada no encontrada')).toMatch(/eliminaron o se la pasaron/);
  });

  it('403: no es suya para editar', () => {
    expect(explainAgendaRejection(403, 'x')).toMatch(/solo ella puede editarla o eliminarla/);
  });

  it('cualquier otro caso conserva el mensaje del servidor', () => {
    expect(explainAgendaRejection(400, 'El motivo no existe')).toBe('El motivo no existe');
    expect(explainAgendaRejection(undefined, 'Algo')).toBe('Algo');
  });
});

describe('withAgendaExplanation', () => {
  it('reescribe solo los rechazos definitivos', () => {
    const r = withAgendaExplanation({ status: 'error', message: 'La gestión ya no está pendiente', permanent: true }, 409);
    expect(r.message).toMatch(/cambió mientras no tenías señal/);
  });

  it('un error de momento (5xx, sin red) no se toca: se va a reintentar', () => {
    const r = { status: 'error', message: 'Error del servidor', permanent: false };
    expect(withAgendaExplanation(r, 500)).toBe(r);
  });

  it('un éxito pasa igual', () => {
    const r = { status: 'ok' };
    expect(withAgendaExplanation(r, undefined)).toBe(r);
  });
});
