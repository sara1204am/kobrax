import { collateralMissing, hasCollateralData, type ClienteForm } from '@kobrax/shared';

/** Lo que falta para dar de alta un cliente desde el panel. */
export type MissingClientField = 'document' | 'firstName' | 'lastName' | 'businessName' | 'phone' | 'contactEmpty' | 'locationAddress' | 'collateral';

/**
 * Los obligatorios del alta del panel: documento, nombre y apellido (o razón social si es empresa) y un teléfono, más —si hay garantías— el tipo y el valor de cada una.
 *
 * Es el mismo corte de `canSubmitCliente` (shared: nombre/apellido/teléfono, que exige el servidor) **más el documento**,
 * que el panel pide siempre aunque el servidor lo admita vacío (el móvil carga clientes sin él en la calle). Por eso vive
 * acá y no en shared.
 */
export function missingClientFields(f: ClienteForm): MissingClientField[] {
  const out: MissingClientField[] = [];
  if (f.nationalId.trim() === '') out.push('document');
  if (f.clientType === 'COMPANY') {
    if (f.businessName.trim().length < 2) out.push('businessName');
  } else {
    if (f.firstName.trim().length < 2) out.push('firstName');
    if (f.lastName.trim().length < 1) out.push('lastName');
  }
  if (!f.contacts.some((c) => c.contactType === 'PHONE' && c.value.trim().length > 0)) out.push('phone');
  // Cada fila agregada hay que llenarla o quitarla: un teléfono en blanco o una dirección sin calle no sirven para cobrar.
  if (f.contacts.some((c) => c.value.trim() === '') && f.contacts.some((c) => c.value.trim() !== '')) out.push('contactEmpty');
  if (f.locations.some((l) => l.address.trim() === '')) out.push('locationAddress');
  // Una garantía agregada tiene que traer tipo (y «qué» si es Otro) y valor; las vacías de todo no cuentan.
  if (f.collaterals.some((g) => hasCollateralData(g) && collateralMissing(g).length > 0)) out.push('collateral');
  return out;
}
