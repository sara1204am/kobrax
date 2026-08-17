import { currentInstallment, type CreditDetail, type PrestamoForm, type UpdateCreditPatch } from '@kobrax/shared';

/**
 * Lo que se edita del crédito **y no cabe en `PrestamoForm`**: no son plata, son organización.
 *
 * Viven aparte y no dentro del formulario compartido con el alta porque el alta no los pregunta —el
 * código lo genera el servidor, el estado nace `ACTIVE`— salvo el responsable, que la web sí elige.
 */
export interface CreditExtras {
  status: string;
  code: string;
  typeCode: string;
  assignedManagerId: string;
}

export function creditExtras(credit: CreditDetail): CreditExtras {
  return {
    status: credit.status ?? '',
    code: credit.code ?? '',
    typeCode: credit.typeCode ?? '',
    assignedManagerId: credit.assignedManagerId ?? '',
  };
}

const num = (s: string): number | undefined => {
  const n = Number(s.trim());
  return s.trim() !== '' && Number.isFinite(n) ? n : undefined;
};

/**
 * Qué mandarle a `PATCH /credits/:id`: **sólo lo que cambió**.
 *
 * La API corre con `forbidNonWhitelisted`, así que reenviar la ficha entera es un 400. Y hay un
 * borde que decide solo: **vaciar la cuota no la borra**. Es plata congelada —es cómo se cobra este
 * crédito—, no un campo opcional; un input en blanco es alguien que lo limpió para escribirlo de
 * nuevo, no alguien pidiendo que el préstamo deje de tener cuota. Se ignora, y la vieja queda.
 *
 * Lo mismo con la fecha: vaciarla manda `undefined`, no una fecha vacía que la API rechazaría.
 *
 * 🔴 **La cuota sale de `currentInstallment`, no del input.** En modo B el campo muestra la cuota
 * calculada sin que nadie la haya tipeado: leer el input crudo mandaría el valor viejo y el
 * préstamo quedaría recotizado en el panel y sin recotizar en la base.
 */
export function creditPatch(credit: CreditDetail, form: PrestamoForm, extras: CreditExtras): UpdateCreditPatch {
  const patch: UpdateCreditPatch = {};

  const principal = num(form.principal);
  if (principal !== undefined && principal !== credit.principalAmount) patch.principalAmount = principal;

  /*
   * La tasa sólo viaja si el préstamo se está cotizando por interés. En modo A el campo ni se dibuja,
   * y mandar el valor hidratado convertiría cada guardado de una nota en un `UPDATE` de la tasa.
   */
  if (form.mode === 'B') {
    const rate = num(form.interestPercent);
    if (rate !== undefined && rate !== credit.interestRate) patch.interestRate = rate;
  }

  const installment = currentInstallment(form);
  if (installment > 0 && installment !== credit.installmentAmount) patch.installmentAmount = installment;

  if (form.frequency !== credit.frequency) patch.frequency = form.frequency;
  if (form.nextDueDate && form.nextDueDate !== (credit.nextDueDate?.slice(0, 10) ?? '')) {
    patch.nextDueDate = form.nextDueDate;
  }
  if (form.notes !== (credit.notes ?? '')) patch.notes = form.notes;

  if (extras.status && extras.status !== (credit.status ?? '')) patch.status = extras.status;
  // Vaciarlos manda `null`, no `''`: son columnas anulables, y la cadena vacía deja un código de
  // cero caracteres que la ficha dibuja como un hueco en vez de «sin código».
  if (extras.code !== (credit.code ?? '')) patch.code = extras.code || null;
  if (extras.typeCode !== (credit.typeCode ?? '')) patch.typeCode = extras.typeCode || null;
  // Vacío = «sin asignar», y la API pide un uuid: desasignar no se puede desde acá y no se finge.
  if (extras.assignedManagerId && extras.assignedManagerId !== (credit.assignedManagerId ?? '')) {
    patch.assignedManagerId = extras.assignedManagerId;
  }

  return patch;
}

/** ¿Hay algo que mandar? Guardar sin tocar nada no llama a la red. */
export function hasCreditChanges(patch: UpdateCreditPatch): boolean {
  return Object.keys(patch).length > 0;
}
