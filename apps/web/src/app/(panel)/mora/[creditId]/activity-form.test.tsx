import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RegisterActivityButton } from './activity-form';
import { ActivityResult } from './activity-result';

const { refresh, toast, post } = vi.hoisted(() => ({ refresh: vi.fn(), toast: vi.fn(), post: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/mora/x',
  useSearchParams: () => new URLSearchParams(''),
}));
vi.mock('@/components/toast', () => ({ useToast: () => toast }));
vi.mock('@/lib/client', async (orig) => ({ ...(await orig<typeof import('@/lib/client')>()), postJson: post }));

const tomorrow = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function open(props: Partial<React.ComponentProps<typeof RegisterActivityButton>> = {}) {
  render(<RegisterActivityButton creditId="c1" methods={[]} banks={[]} {...props} />);
  await userEvent.click(screen.getByRole('button', { name: 'Registrar gestión' }));
}
const resultSelect = () => screen.getByLabelText('Resultado') as HTMLSelectElement;
const optionsOf = (sel: HTMLSelectElement) => within(sel).getAllByRole('option').map((o) => (o as HTMLOptionElement).value).filter(Boolean);

beforeEach(() => {
  refresh.mockClear();
  toast.mockClear();
  post.mockReset();
});

describe('RegisterActivityButton — qué se ofrece', () => {
  it('🔴 sólo ofrece los resultados que corresponden al tipo: «no lo encontró» es de una visita', async () => {
    await open();
    // Arranca en llamada.
    expect(optionsOf(resultSelect())).toEqual(['CONTACTED', 'NO_ANSWER', 'WRONG_NUMBER', 'REFUSAL', 'PROMISE_TO_PAY']);
    await userEvent.selectOptions(screen.getByLabelText('Qué se hizo'), 'VISIT');
    expect(optionsOf(resultSelect())).toEqual(['CONTACTED', 'NOT_FOUND', 'WRONG_ADDRESS', 'REFUSAL', 'PROMISE_TO_PAY']);
  });

  it('al cambiar de tipo no arrastra un resultado que ya no corresponde', async () => {
    await open();
    await userEvent.selectOptions(resultSelect(), 'WRONG_NUMBER');
    await userEvent.selectOptions(screen.getByLabelText('Qué se hizo'), 'VISIT');
    expect(resultSelect().value).toBe('');
  });

  it('una nota no tiene resultado ni promesa: sólo texto', async () => {
    await open();
    await userEvent.selectOptions(screen.getByLabelText('Qué se hizo'), 'NOTE');
    expect(screen.queryByLabelText('Resultado')).toBeNull();
    expect(screen.getByLabelText('Nota')).toBeInTheDocument();
  });

  it('los campos de la promesa aparecen sólo con el resultado «promesa de pago»', async () => {
    await open();
    expect(screen.queryByLabelText('Monto prometido')).toBeNull();
    await userEvent.selectOptions(resultSelect(), 'PROMISE_TO_PAY');
    expect(screen.getByLabelText('Monto prometido')).toBeInTheDocument();
    expect(screen.getByLabelText('Fecha prometida')).toBeInTheDocument();
    expect(screen.getByLabelText('Medio de pago')).toBeInTheDocument();
    await userEvent.selectOptions(resultSelect(), 'NO_ANSWER');
    expect(screen.queryByLabelText('Monto prometido')).toBeNull();
  });

  it('el monto de la promesa arranca con el sugerido', async () => {
    await open({ suggestedAmount: 333.48 });
    await userEvent.selectOptions(resultSelect(), 'PROMISE_TO_PAY');
    expect(screen.getByLabelText('Monto prometido')).toHaveValue('333.48');
  });

  it('sin catálogo de medios de pago ofrece los de siempre; con catálogo, el del tenant', async () => {
    const { unmount } = render(<RegisterActivityButton creditId="c1" methods={[]} banks={[]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Registrar gestión' }));
    await userEvent.selectOptions(resultSelect(), 'PROMISE_TO_PAY');
    expect(optionsOf(screen.getByLabelText('Medio de pago') as HTMLSelectElement)).toEqual(['CASH', 'TRANSFER', 'QR', 'CARD', 'MOBILE_PAYMENT']);
    unmount();
    render(<RegisterActivityButton creditId="c1" methods={[{ code: 'DEPOSITO', label: 'Depósito' }]} banks={[]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Registrar gestión' }));
    await userEvent.selectOptions(resultSelect(), 'PROMISE_TO_PAY');
    expect(optionsOf(screen.getByLabelText('Medio de pago') as HTMLSelectElement)).toEqual(['DEPOSITO']);
  });

  it('el banco sólo se ofrece si el tenant cargó el catálogo', async () => {
    await open({ banks: [] });
    await userEvent.selectOptions(resultSelect(), 'PROMISE_TO_PAY');
    expect(screen.queryByLabelText('Banco (opcional)')).toBeNull();
  });
});

describe('RegisterActivityButton — registrar', () => {
  it('🔴 no manda nada si falta el resultado, y lo dice', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }));
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByText('Elegí cómo terminó la gestión.')).toBeInTheDocument();
  });

  it('🔴 «promesa de pago» sin los datos de la promesa no se manda, y dice qué falta, de a uno', async () => {
    await open();
    await userEvent.selectOptions(resultSelect(), 'PROMISE_TO_PAY');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }));
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByText('El monto prometido tiene que ser mayor a cero.')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Monto prometido'), '500');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }));
    expect(screen.getByText('Elegí la fecha prometida.')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Fecha prometida'), tomorrow());
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }));
    expect(screen.getByText('Elegí el medio de pago de la promesa.')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('una fecha prometida pasada no se manda', async () => {
    await open();
    await userEvent.selectOptions(resultSelect(), 'PROMISE_TO_PAY');
    await userEvent.type(screen.getByLabelText('Monto prometido'), '500');
    await userEvent.type(screen.getByLabelText('Fecha prometida'), '2020-01-01');
    await userEvent.selectOptions(screen.getByLabelText('Medio de pago'), 'CASH');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }));
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByText('La fecha prometida no puede ser anterior a hoy.')).toBeInTheDocument();
  });

  it('registra una visita con resultado y observaciones, sin promesa', async () => {
    post.mockResolvedValue({ ok: true, status: 201, data: { id: 'a1', type: 'CALL', createdAt: 'x', episodeId: 'e1' } });
    await open();
    await userEvent.selectOptions(screen.getByLabelText('Qué se hizo'), 'VISIT');
    await userEvent.selectOptions(resultSelect(), 'NOT_FOUND');
    await userEvent.type(screen.getByLabelText('Observaciones'), '  Se dejó aviso con un familiar ');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith('/api/mora/c1/activities', { type: 'VISIT', result: 'NOT_FOUND', notes: 'Se dejó aviso con un familiar', promise: undefined });
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Gestión registrada'));
    expect(refresh).toHaveBeenCalled();
  });

  it('🔴 registra una promesa con monto numérico, fecha y medio', async () => {
    post.mockResolvedValue({ ok: true, status: 201, data: { id: 'a1', type: 'CALL', createdAt: 'x', episodeId: 'e1' } });
    await open();
    await userEvent.selectOptions(resultSelect(), 'PROMISE_TO_PAY');
    await userEvent.clear(screen.getByLabelText('Monto prometido'));
    await userEvent.type(screen.getByLabelText('Monto prometido'), '500,50');
    await userEvent.type(screen.getByLabelText('Fecha prometida'), tomorrow());
    await userEvent.selectOptions(screen.getByLabelText('Medio de pago'), 'QR');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const body = post.mock.calls[0]![1];
    expect(body.type).toBe('CALL');
    expect(body.result).toBe('PROMISE_TO_PAY');
    expect(body.promise).toEqual({ amount: 500.5, promiseDate: tomorrow(), paymentMethodCode: 'QR' });
  });

  it('🔴 sobre un crédito al día registra igual y no habla de ningún caso (acción preventiva)', async () => {
    post.mockResolvedValue({ ok: true, status: 201, data: { id: 'a2', type: 'CALL', createdAt: 'x' } });
    await open();
    await userEvent.selectOptions(resultSelect(), 'NO_ANSWER');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Gestión registrada'));
    expect(toast).not.toHaveBeenCalledWith(expect.stringMatching(/caso/i));
  });

  it('un error de la API se muestra y el formulario sigue abierto con lo escrito', async () => {
    post.mockResolvedValue({ ok: false, status: 400, data: { error: { code: 'MORA_X', message: 'No se pudo registrar' } } });
    await open();
    await userEvent.selectOptions(resultSelect(), 'NO_ANSWER');
    await userEvent.type(screen.getByLabelText('Observaciones'), 'hola');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }));
    expect(await screen.findByText('No se pudo registrar')).toBeInTheDocument();
    expect(screen.getByLabelText('Observaciones')).toHaveValue('hola');
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('ActivityResult — el resultado en el historial', () => {
  it('muestra la etiqueta de un resultado conocido', () => {
    render(<ActivityResult result="NOT_FOUND" />);
    expect(screen.getByText('No lo encontró')).toBeInTheDocument();
    expect(screen.getByText(/Resultado:/)).toBeInTheDocument();
  });

  it('🔴 un resultado que el diccionario no conoce se muestra crudo, no se esconde', () => {
    render(<ActivityResult result="llamó_y_colgó" />);
    expect(screen.getByText('llamó_y_colgó')).toBeInTheDocument();
  });
});

describe('RegisterActivityButton — motivo y quién responde (F4/13 · E4)', () => {
  const REASONS = [
    { code: 'JOB_LOSS', label: 'Perdió el empleo', metadata: { appliesTo: ['EMPLOYEE', 'OTHER'], suggestion: 'Suele tardar más en recuperarse.' } },
    { code: 'NO_SALES', label: 'Sin ventas o negocio caído', metadata: { appliesTo: ['BUSINESS'] } },
    { code: 'LATE_INCOME', label: 'Ingreso atrasado', metadata: { asksExpectedIncomeDate: true, suggestion: 'Pagará al cobrar.' } },
    { code: 'FORGOT', label: 'Olvido o descuido', metadata: {} },
  ];
  const reasonSelect = () => screen.getByLabelText('Motivo de no pago') as HTMLSelectElement;

  it('🔴 sin catálogo de motivos el formulario es el de siempre: no aparece el bloque', async () => {
    await open();
    expect(screen.queryByLabelText('Motivo de no pago')).toBeNull();
  });

  it('con catálogo ofrece los motivos y quién responde', async () => {
    await open({ reasons: REASONS });
    expect(optionsOf(reasonSelect())).toEqual(['JOB_LOSS', 'NO_SALES', 'LATE_INCOME', 'FORGOT']);
    expect(screen.getByLabelText('Quién responde por el crédito')).toBeInTheDocument();
  });

  it('el motivo se filtra por la fuente de ingreso del cliente', async () => {
    await open({ reasons: REASONS, incomeSource: 'BUSINESS' });
    expect(optionsOf(reasonSelect())).toEqual(['NO_SALES', 'LATE_INCOME', 'FORGOT']);
  });

  it('🔴 una nota no lleva motivo', async () => {
    await open({ reasons: REASONS });
    await userEvent.selectOptions(screen.getByLabelText('Qué se hizo'), 'NOTE');
    expect(screen.queryByLabelText('Motivo de no pago')).toBeNull();
  });

  it('la fecha en que espera cobrar solo aparece con el motivo que la pide', async () => {
    await open({ reasons: REASONS });
    expect(screen.queryByLabelText('Cuándo espera cobrar')).toBeNull();
    await userEvent.selectOptions(reasonSelect(), 'FORGOT');
    expect(screen.queryByLabelText('Cuándo espera cobrar')).toBeNull();
    await userEvent.selectOptions(reasonSelect(), 'LATE_INCOME');
    expect(screen.getByLabelText('Cuándo espera cobrar')).toBeInTheDocument();
  });

  it('muestra la sugerencia del motivo elegido', async () => {
    await open({ reasons: REASONS });
    await userEvent.selectOptions(reasonSelect(), 'LATE_INCOME');
    expect(screen.getByText('Pagará al cobrar.')).toBeInTheDocument();
  });

  it('🔴 el motivo, la fecha y quién responde viajan con la gestión', async () => {
    post.mockResolvedValue({ ok: true, data: {} });
    await open({ reasons: REASONS });
    await userEvent.selectOptions(resultSelect(), 'NO_ANSWER');
    await userEvent.selectOptions(reasonSelect(), 'LATE_INCOME');
    await userEvent.type(screen.getByLabelText('Cuándo espera cobrar'), tomorrow());
    await userEvent.selectOptions(screen.getByLabelText('Quién responde por el crédito'), 'GUARANTOR');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]![1]).toMatchObject({
      type: 'CALL',
      result: 'NO_ANSWER',
      reasonCode: 'LATE_INCOME',
      expectedIncomeDate: tomorrow(),
      payerParty: 'GUARANTOR',
    });
  });

  it('🔴 sin tocar el bloque no manda nada nuevo: la gestión es la de siempre', async () => {
    post.mockResolvedValue({ ok: true, data: {} });
    await open({ reasons: REASONS });
    await userEvent.selectOptions(resultSelect(), 'NO_ANSWER');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const body = post.mock.calls[0]![1] as Record<string, unknown>;
    expect('reasonCode' in body).toBe(false);
    expect('expectedIncomeDate' in body).toBe(false);
    expect('payerParty' in body).toBe(false);
  });

  it('una fecha sin pedirla el motivo no viaja', async () => {
    post.mockResolvedValue({ ok: true, data: {} });
    await open({ reasons: REASONS });
    await userEvent.selectOptions(resultSelect(), 'NO_ANSWER');
    await userEvent.selectOptions(reasonSelect(), 'LATE_INCOME');
    await userEvent.type(screen.getByLabelText('Cuándo espera cobrar'), tomorrow());
    await userEvent.selectOptions(reasonSelect(), 'FORGOT'); // cambia a uno que no la pide
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect('expectedIncomeDate' in (post.mock.calls[0]![1] as Record<string, unknown>)).toBe(false);
  });
});
