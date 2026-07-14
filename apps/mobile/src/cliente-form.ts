/**
 * Lógica pura del alta de cliente (V1, §5.1). Sin red, sin React → testeable sola. El mínimo para guardar
 * es nombre + apellido + teléfono (el modelo exige apellido para PERSON; §5.1 pide "nombre + teléfono").
 * Todo lo demás (documento, dirección, GPS, foto) es opcional y se completa después desde la ficha.
 */
import type { NewClientInput } from './clients.service';

export interface ClienteForm {
  firstName: string;
  lastName: string;
  nationalId: string;
  phone: string;
  hasWhatsapp: boolean;
  address: string;
  zone: string;
  reference: string;
  latitude?: number;
  longitude?: number;
  /** URL de la foto de fachada ya subida (POST /uploads). */
  photoUrl?: string;
}

export function initialCliente(): ClienteForm {
  return {
    firstName: '',
    lastName: '',
    nationalId: '',
    phone: '',
    hasWhatsapp: true, // §5.1: casilla marcada por defecto
    address: '',
    zone: '',
    reference: '',
  };
}

/** Mínimo viable (§5.1, ajustado al modelo): nombre + apellido + teléfono. */
export function canSubmitCliente(s: ClienteForm): boolean {
  return s.firstName.trim().length >= 2 && s.lastName.trim().length >= 1 && s.phone.trim().length > 0;
}

export function buildClientePayload(s: ClienteForm): NewClientInput {
  const hasLocation = !!(s.address.trim() || s.zone.trim() || s.latitude != null || s.photoUrl || s.reference.trim());
  return {
    clientType: 'PERSON',
    firstName: s.firstName.trim(),
    lastName: s.lastName.trim(),
    nationalId: s.nationalId.trim() || undefined,
    preferredContactChannel: s.hasWhatsapp ? 'WHATSAPP' : 'PHONE',
    contacts: [{ contactType: s.hasWhatsapp ? 'WHATSAPP' : 'PHONE', value: s.phone.trim(), isPrimary: true }],
    location: hasLocation
      ? {
          address: s.address.trim() || undefined,
          zone: s.zone.trim() || undefined,
          latitude: s.latitude,
          longitude: s.longitude,
          referenceNotes: s.reference.trim() || undefined,
          photoUrls: s.photoUrl ? [s.photoUrl] : undefined,
        }
      : undefined,
  };
}
