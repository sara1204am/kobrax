import { VisitOutcome } from '@kobrax/shared';
import {
  buildDetails,
  canSubmitResult,
  paymentCap,
  initialResult,
  installmentHint,
  paymentOutcome,
  postVisitWarning,
  VISIT_VARIANTS,
  type ResultForm,
} from './visit-result';

const HOY = '2026-08-05';
const form = (over: Partial<ResultForm> = {}): ResultForm => ({ ...initialResult(HOY), ...over });

describe('postVisitWarning', () => {
  it('sin fallas devuelve null: la pantalla puede navegar', () => {
    expect(postVisitWarning([])).toBeNull();
  });

  // El caso que importa: la visita quedó, el efectivo lo tiene el cobrador y el pago no se guardó.
  // Devolver un mensaje es lo que frena el `router.replace` y hace que alguien se entere.
  it('con el pago fallado devuelve un aviso que menciona el pago', () => {
    const aviso = postVisitWarning(['el pago de Bs 250 NO se guardó']);
    expect(aviso).toContain('el pago de Bs 250 NO se guardó');
    expect(aviso).toContain('La visita quedó registrada');
  });

  it('junta las fallas en un solo aviso', () => {
    expect(postVisitWarning(['la foto no se pudo adjuntar', 'el pago NO se guardó'])).toBe(
      'La visita quedó registrada, pero la foto no se pudo adjuntar y el pago NO se guardó. Anotalo y avisá a tu supervisor.',
    );
  });
});

describe('VISIT_VARIANTS', () => {
  it('son las 6 del mockup y ninguna se quedó sin outcome', () => {
    expect(VISIT_VARIANTS).toHaveLength(6);
    for (const v of VISIT_VARIANTS) {
      expect(v.outcome).toBeTruthy();
      expect(v.cta).toBeTruthy();
    }
  });
});

describe('buildDetails', () => {
  it('no contesta manda el canal intentado', () => {
    expect(buildDetails('NO_ANSWER', form({ channel: 'DOOR' }))).toEqual({ channel: 'DOOR' });
  });

  it('la visita sin contacto es siempre en la puerta', () => {
    // Aunque el form traiga CALL de una variante anterior: el cobrador FUE al domicilio.
    expect(buildDetails('NO_CONTACT_VISIT', form({ channel: 'CALL', noticeLeft: true }))).toEqual({
      channel: 'DOOR',
      noticeLeft: true,
    });
  });

  it('la gestión especial manda su categoría', () => {
    expect(buildDetails('SPECIAL', form({ categoryCode: 'DECEASED' }))).toEqual({ categoryCode: 'DECEASED' });
  });

  it('las variantes sin campos propios no mandan nada', () => {
    expect(buildDetails('PAID', form({ channel: 'DOOR', categoryCode: 'X' }))).toEqual({});
    expect(buildDetails('WRONG_ADDRESS', form({ categoryCode: 'X' }))).toEqual({});
  });
});

describe('installmentHint', () => {
  it('ofrece la cuota con su vencimiento dd/mm', () => {
    expect(installmentHint({ suggestedPaymentAmount: 450, nextDueDate: '2026-10-07' })).toEqual({ amount: 450, dueLabel: '07/10' });
  });
  it('sin vencimiento legible, solo el monto', () => {
    expect(installmentHint({ suggestedPaymentAmount: 450, nextDueDate: 'mañana' })).toEqual({ amount: 450 });
  });
  it('nunca inventa: ausente, cero o inválida es null', () => {
    expect(installmentHint(null)).toBeNull();
    expect(installmentHint({})).toBeNull();
    expect(installmentHint({ suggestedPaymentAmount: 0 })).toBeNull();
    expect(installmentHint({ suggestedPaymentAmount: Number.NaN })).toBeNull();
  });
});

describe('paymentCap (D3)', () => {
  it('Kobrax se topea con el saldo de la parada', () => {
    expect(paymentCap({ overdueAmount: 500 })).toBe(500);
  });

  it('🔴 un crédito externo no tiene tope: su saldo es el reportado al corte', () => {
    expect(paymentCap({ overdueAmount: 500, externalSource: 'PSF' })).toBeUndefined();
    expect(canSubmitResult('PAID', form({ amount: '800' }), paymentCap({ overdueAmount: 500, externalSource: 'PSF' }))).toBe(true);
  });

  it('sin parada todavía no hay tope que aplicar', () => {
    expect(paymentCap(null)).toBeUndefined();
  });
});

describe('canSubmitResult', () => {
  it('cobrado exige monto y no deja pasarse del saldo', () => {
    expect(canSubmitResult('PAID', form({ amount: '0' }), 500)).toBe(false);
    expect(canSubmitResult('PAID', form({ amount: '500' }), 500)).toBe(true);
    expect(canSubmitResult('PAID', form({ amount: '500.01' }), 500)).toBe(false);
    // Sin saldo conocido no se inventa un techo.
    expect(canSubmitResult('PAID', form({ amount: '99999' }), undefined)).toBe(true);
  });

  it('la promesa exige monto y fecha', () => {
    expect(canSubmitResult('PROMISE', form({ amount: '100' }))).toBe(true);
    expect(canSubmitResult('PROMISE', form({ amount: '' }))).toBe(false);
    expect(canSubmitResult('PROMISE', form({ amount: '100', promiseDate: 'mañana' }))).toBe(false);
  });

  it('la gestión especial exige la categoría — la regla la pone el validador compartido', () => {
    expect(canSubmitResult('SPECIAL', form())).toBe(false);
    expect(canSubmitResult('SPECIAL', form({ categoryCode: 'DECEASED' }))).toBe(true);
  });

  it('la dirección incorrecta exige explicar qué pasó', () => {
    expect(canSubmitResult('WRONG_ADDRESS', form())).toBe(false);
    expect(canSubmitResult('WRONG_ADDRESS', form({ notes: 'El edificio ya no existe' }))).toBe(true);
  });

  it('no contesta y visita sin contacto se pueden guardar sin escribir nada', () => {
    expect(canSubmitResult('NO_ANSWER', form())).toBe(true);
    expect(canSubmitResult('NO_CONTACT_VISIT', form())).toBe(true);
  });
});

describe('paymentOutcome', () => {
  it('cubrir el saldo es PAID; menos que eso es parcial', () => {
    expect(paymentOutcome(500, 500)).toBe(VisitOutcome.PAID);
    expect(paymentOutcome(600, 500)).toBe(VisitOutcome.PAID);
    expect(paymentOutcome(100, 500)).toBe(VisitOutcome.PARTIAL_PAYMENT);
  });

  it('sin saldo conocido no marca un parcial que no puede probar', () => {
    expect(paymentOutcome(100, undefined)).toBe(VisitOutcome.PAID);
  });
});

describe('postVisitWarning · lo que quedó en la cola', () => {
  it('lo guardado en el teléfono se avisa igual (el banner sigue), pero sin pedir que lo anote', () => {
    const aviso = postVisitWarning([], ['el pago de Bs 250']);
    expect(aviso).toBe('La visita quedó registrada; el pago de Bs 250 quedó guardado en el teléfono y se sube solo cuando haya señal.');
    expect(aviso).not.toContain('Anotalo');
  });

  it('junta varias partes guardadas', () => {
    expect(postVisitWarning([], ['la foto', 'la promesa'])).toContain('la foto y la promesa quedó guardado');
  });

  it('mezcla: lo perdido pide anotarlo y lo guardado se menciona aparte', () => {
    const aviso = postVisitWarning(['el pago NO se guardó'], ['la foto'])!;
    expect(aviso).toContain('el pago NO se guardó. Anotalo y avisá a tu supervisor.');
    expect(aviso).toContain('Además, la foto quedó guardado en el teléfono');
  });

  it('sin fallas ni cola sigue devolviendo null', () => {
    expect(postVisitWarning([], [])).toBeNull();
  });
});
