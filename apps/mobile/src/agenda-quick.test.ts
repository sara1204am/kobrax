import type { AgendaItemDetail } from '@kobrax/shared';
import { quickActions } from './agenda-quick';

const detail = (target: Record<string, unknown> | undefined, details: Record<string, unknown> = {}) =>
  ({ target, item: { details } }) as unknown as Pick<AgendaItemDetail, 'target' | 'item'>;

describe('quickActions', () => {
  it('una llamada ofrece Llamar con el teléfono limpio', () => {
    const [a] = quickActions('CALL' as never, 'SCHEDULED' as never, detail({ phone: '+591 780-12345' }));
    expect(a).toMatchObject({ kind: 'tel', label: 'Llamar', url: 'tel:+59178012345' });
  });

  it('un WhatsApp abre la conversación con el mensaje escrito', () => {
    const [a] = quickActions('WHATSAPP' as never, 'SCHEDULED' as never, detail({ phone: '78012345' }, { message: 'Hola Ana' }));
    expect(a).toMatchObject({ kind: 'wa', url: 'https://wa.me/78012345?text=Hola%20Ana' });
  });

  it('una visita ofrece Navegar solo si hay a dónde ir', () => {
    expect(quickActions('VISIT' as never, 'SCHEDULED' as never, detail({ latitude: -16.5, longitude: -68.1 }))[0]).toMatchObject({ kind: 'nav' });
    expect(quickActions('VISIT' as never, 'SCHEDULED' as never, detail({ phone: '78012345' }))).toEqual([]);
  });

  it('recordatorios y promesas no tienen acción de contacto', () => {
    expect(quickActions('REMINDER' as never, 'SCHEDULED' as never, detail({ phone: '78012345' }))).toEqual([]);
    expect(quickActions('PROMISE_TO_PAY' as never, 'SCHEDULED' as never, detail({ phone: '78012345' }))).toEqual([]);
  });

  it('una gestión que ya no está pendiente no ofrece nada', () => {
    expect(quickActions('CALL' as never, 'EXECUTED' as never, detail({ phone: '78012345' }))).toEqual([]);
  });

  it('sin el detalle descargado no hay acciones: hay que abrirla', () => {
    expect(quickActions('CALL' as never, 'SCHEDULED' as never, null)).toEqual([]);
    expect(quickActions('CALL' as never, 'SCHEDULED' as never, detail(undefined))).toEqual([]);
  });
});
