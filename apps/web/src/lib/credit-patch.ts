import {
  creditFormFromCredit,
  creditRedefinition,
  initialStateForm,
  type CreditDetail,
  type CreditForm,
  type InitialStateForm,
  type UpdateCreditPatch,
} from '@kobrax/shared';

/**
 * Lo que se edita del crédito **y no es plata**: organización y dos datos operativos.
 *
 * El próximo cobro vive acá y no en las condiciones porque, con pagos registrados, es lo único del
 * calendario que se puede mover. Sin pagos se deriva del estado al registrar (D13).
 */
export interface CreditExtras {
  status: string;
  code: string;
  typeCode: string;
  assignedManagerId: string;
  nextDueDate: string;
}

export function creditExtras(credit: CreditDetail): CreditExtras {
  return {
    status: credit.status ?? '',
    code: credit.code ?? '',
    typeCode: credit.typeCode ?? '',
    assignedManagerId: credit.assignedManagerId ?? '',
    nextDueDate: credit.nextDueDate?.slice(0, 10) ?? '',
  };
}

/** Todo lo que la ficha tiene en pantalla al editar. */
export interface CreditDraft {
  /** Condiciones, más la nota (que el formulario del alta también lleva). */
  form: CreditForm;
  initial: InitialStateForm;
  extras: CreditExtras;
}

export function creditDraft(credit: CreditDetail, todayIso: string): CreditDraft {
  return {
    form: creditFormFromCredit(credit, todayIso),
    initial: initialStateForm(credit.initialState),
    extras: creditExtras(credit),
  };
}

/**
 * Qué mandarle a `PATCH /credits/:id`: **sólo lo que cambió**.
 *
 * 🔴 **Las condiciones se comparan contra cómo se abrió la ficha, no contra el crédito.** Un crédito
 * anterior a F4/06 se abre como «cuota acordada»; si se lo comparara con sus columnas, guardar sólo una
 * nota lo redefiniría — y con pagos, la API lo rechazaría por algo que nadie tocó.
 *
 * `redefinable` = se pueden cambiar condiciones y estado al registrar (sin pagos, ni importado, ni
 * cronograma guardado). Si no, esos dos no viajan aunque el borrador difiera.
 */
export function creditPatch(credit: CreditDetail, opened: CreditDraft, draft: CreditDraft, redefinable: boolean): UpdateCreditPatch {
  const patch: UpdateCreditPatch = {};

  if (redefinable) Object.assign(patch, creditRedefinition(opened, draft));

  const { extras } = draft;
  if (draft.form.notes !== (credit.notes ?? '')) patch.notes = draft.form.notes;
  // Al redefinir, el próximo cobro lo deriva la API: mandarlo aparte sería un conflicto.
  if (!patch.terms && !patch.initialState && extras.nextDueDate && extras.nextDueDate !== (credit.nextDueDate?.slice(0, 10) ?? '')) {
    patch.nextDueDate = extras.nextDueDate;
  }

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
