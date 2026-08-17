/**
 * Lógica pura del alta y la edición de cliente: qué es válido, qué se manda, y cómo se hidrata el
 * formulario desde el server. Sin red y sin React → la usan el móvil y el panel web.
 *
 * Promovido del móvil en F9 · W3 (regla §3.9). Acá viven tres reglas del modelo que cualquiera que
 * escriba este formulario de nuevo vuelve a descubrir a los golpes: **WhatsApp es un `ContactType`
 * aparte** (en pantalla es un switch), **las filas vacías se descartan**, y **`serverId` es lo que
 * hace que editar sepa qué actualizar y qué crear**.
 */
import type {
  ClienteForm,
  CollateralRow,
  ContactRow,
  LocationRow,
  NewClientInput,
  NewCollateralInput,
  NewContactInput,
  NewLocationInput,
  NewRelationInput,
  RelationRow,
} from '../types/client.types.js';

/**
 * Los tipos de dirección que se pueden **elegir** hoy.
 *
 * 🔴 **`GUARANTOR` no está, y no es un olvido.** La dirección del garante es la dirección **de esa
 * persona**, y esa persona ya existe en el formulario como contacto con su relación `GUARANTOR` y
 * sus propias direcciones. Ofrecerlo también como tipo de dirección del deudor daba dos lugares
 * para lo mismo, y quien cobra terminaba yendo a la casa del garante creyendo que iba a la del
 * deudor. El tipo **sigue existiendo en el modelo**: hay filas guardadas así.
 *
 * Es una lista y no un enum de TypeScript porque acá va la **regla**, no el texto: el rótulo de
 * cada código lo pone cada app en su idioma.
 */
export const LOCATION_TYPES = ['HOME', 'WORK', 'FAMILY', 'OTHER'] as const;

/**
 * Las opciones para una fila concreta.
 *
 * 🔴 **Un tipo que ya no se ofrece pero que la fila YA tiene sigue apareciendo.** Si no, esas cuatro
 * direcciones guardadas como `GUARANTOR` se dibujarían como «Casa» —la primera opción— mientras el
 * dato dice otra cosa: la pantalla mentiría sobre lo que hay guardado, y bastaría con abrir el
 * formulario para creer que se corrigió algo que no se tocó.
 */
export function locationTypeChoices(current?: string): string[] {
  const base: string[] = [...LOCATION_TYPES];
  return current && !base.includes(current) ? [...base, current] : base;
}

export function emptyContact(id: string, isPrimary = false): ContactRow {
  return { id, contactType: 'PHONE', value: '', hasWhatsApp: true, isPrimary };
}

export function emptyLocation(id: string): LocationRow {
  return {
    id,
    locationType: 'HOME',
    address: '',
    zone: '',
    latitude: '',
    longitude: '',
    coordMode: 'manual',
    referenceNotes: '',
    photoUrls: [],
  };
}

export function emptyRelation(id: string): RelationRow {
  return { id, relatedName: '', relationshipType: 'GUARANTOR', gender: '', isContactable: true, notes: '', contacts: [], locations: [], creditIds: [] };
}

export function emptyCollateral(id: string): CollateralRow {
  return { id, type: '', description: '', estimatedValue: '', currency: '', photoUrls: [], creditIds: [] };
}

export function initialCliente(): ClienteForm {
  return {
    clientType: 'PERSON',
    firstName: '',
    lastName: '',
    nationalId: '',
    gender: '',
    businessName: '',
    riskSegment: '',
    status: 'ACTIVE',
    contacts: [emptyContact('c0', true)], // un teléfono principal por defecto, WhatsApp marcado
    locations: [],
    relations: [],
    collaterals: [],
  };
}

/**
 * Alta con la ubicación ya marcada — el alta desde el mapa de Rutas entra por acá con el punto que
 * se tocó. Sin punto, es el alta de siempre.
 */
export function clienteEnPunto(point: { latitude: number; longitude: number }): ClienteForm {
  const loc = emptyLocation('l0');
  return {
    ...initialCliente(),
    locations: [{ ...loc, coordMode: 'map', latitude: point.latitude.toFixed(6), longitude: point.longitude.toFixed(6) }],
  };
}

/**
 * Campo numérico del formulario → número, o `undefined` si está vacío o a medio escribir.
 *
 * Lo usan las coordenadas y el valor de la garantía: los dos se guardan como texto mientras se
 * tipean —un `<input>` con un `-` o un `1.` no es un número— y se convierten recién al mandar.
 */
function parseNum(s: string): number | undefined {
  const t = s.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/** Filas del server → filas del formulario, marcadas con el id que tienen allá. */
type ServerContact = { id: string; contactType: string; value: string | null; isPrimary: boolean };
type ServerLocation = {
  id: string;
  locationType: string;
  address: string | null;
  zone?: string;
  latitude?: number;
  longitude?: number;
  referenceNotes?: string;
  photoUrls?: string[];
};

function hydrateContacts(rows: ServerContact[]): ContactRow[] {
  return rows.map((c) => ({
    id: c.id,
    serverId: c.id,
    // El server modela WhatsApp como un tipo aparte; el formulario lo muestra como un switch.
    contactType: c.contactType === 'EMAIL' ? 'EMAIL' : 'PHONE',
    value: c.value ?? '',
    hasWhatsApp: c.contactType === 'WHATSAPP',
    isPrimary: c.isPrimary,
  }));
}

function hydrateLocations(rows: ServerLocation[]): LocationRow[] {
  return rows.map((l) => ({
    id: l.id,
    serverId: l.id,
    locationType: l.locationType as LocationRow['locationType'],
    address: l.address ?? '',
    zone: l.zone ?? '',
    latitude: l.latitude != null ? String(l.latitude) : '',
    longitude: l.longitude != null ? String(l.longitude) : '',
    // Con punto cargado se abre en modo mapa: es donde se ve y se corrige.
    coordMode: l.latitude != null ? 'map' : 'manual',
    referenceNotes: l.referenceNotes ?? '',
    photoUrls: l.photoUrls ?? [],
  }));
}

/**
 * Server → formulario. Es la vuelta de `buildClientePayload`: hidrata el MISMO formulario que usa el
 * alta, marcando cada fila con su `serverId` para que al guardar se sepa qué actualizar y qué crear.
 * Las filas sin `serverId` son nuevas.
 *
 * 🔴 Quien lo llame tiene que traer la PII **en claro** (`GET /clients/:id?reveal=true`). Con el
 * valor enmascarado, guardar escribe la máscara encima del dato real.
 */
export function hydrateCliente(d: {
  clientType: 'PERSON' | 'COMPANY';
  firstName?: string;
  lastName?: string;
  businessName?: string;
  nationalId: string | null;
  gender?: string;
  riskSegment?: string;
  status: 'ACTIVE' | 'INACTIVE' | 'BLOCKED';
  contacts?: ServerContact[];
  locations?: ServerLocation[];
  relations?: {
    id: string;
    relatedName: string;
    relationshipType: string;
    gender?: string;
    isContactable: boolean;
    notes?: string;
    contacts?: ServerContact[];
    locations?: ServerLocation[];
    creditIds?: string[];
  }[];
  collaterals?: {
    id: string;
    type?: string;
    description: string;
    estimatedValue?: number;
    currency?: string;
    photoUrls?: string[];
    creditIds?: string[];
  }[];
}): ClienteForm {
  return {
    clientType: d.clientType,
    firstName: d.firstName ?? '',
    lastName: d.lastName ?? '',
    nationalId: d.nationalId ?? '',
    gender: d.gender ?? '',
    businessName: d.businessName ?? '',
    riskSegment: d.riskSegment ?? '',
    status: d.status,
    contacts: hydrateContacts(d.contacts ?? []),
    locations: hydrateLocations(d.locations ?? []),
    relations: (d.relations ?? []).map((r) => ({
      id: r.id,
      serverId: r.id,
      relatedName: r.relatedName,
      relationshipType: r.relationshipType as RelationRow['relationshipType'],
      gender: r.gender ?? '',
      isContactable: r.isContactable,
      notes: r.notes ?? '',
      contacts: hydrateContacts(r.contacts ?? []),
      locations: hydrateLocations(r.locations ?? []),
      creditIds: r.creditIds ?? [],
    })),
    collaterals: (d.collaterals ?? []).map((g) => ({
      id: g.id,
      serverId: g.id,
      type: g.type ?? '',
      description: g.description,
      estimatedValue: g.estimatedValue != null ? String(g.estimatedValue) : '',
      currency: g.currency ?? '',
      photoUrls: g.photoUrls ?? [],
      creditIds: g.creditIds ?? [],
    })),
  };
}

/** El teléfono principal (o el primero con valor) — lo que exige el mínimo. */
function hasPhone(s: ClienteForm): boolean {
  return s.contacts.some((c) => c.contactType === 'PHONE' && c.value.trim().length > 0);
}

/**
 * Forma de un teléfono para el `pattern` de un `<input>`: empieza con dígito o `+` y sigue con al
 * menos cuatro dígitos, espacios o guiones.
 *
 * 🔴 **La regla vive acá porque ya estaba escrita en tres lados** —el perfil del panel, el alta del
 * móvil y el `@Length(5,32)` del servidor— y el navegador no valida nada que no le digamos. Sin
 * esto, «no me acuerdo» se guarda como teléfono y el día de la cobranza no hay a qué llamar. Vacío
 * sigue valiendo: el navegador no aplica `pattern` a un campo en blanco, así que borrar un teléfono
 * lo quita.
 */
export const PHONE_PATTERN = '[\\d+][\\d\\s-]{4,}';

/**
 * Las palabras de una búsqueda por nombre.
 *
 * 🔴 **Buscar «Teresa Mama» tiene que encontrar a «Teresa Mamani Padilla».** Con la frase entera no
 * la encuentra nunca: «Teresa Mama» no está en el nombre («Teresa») ni en el apellido («Mamani
 * Padilla»), porque el espacio cae justo en el medio. Quien busca escribe el nombre y el arranque
 * del apellido — es la forma natural de escribir a alguien — y la búsqueda tiene que partirlo.
 *
 * La regla que se arma con esto: **cada palabra tiene que aparecer en algún campo del nombre**, y
 * puede ser en campos distintos. Así «Teresa Mama» pide «Teresa» en alguno y «Mama» en alguno.
 *
 * El tope no es capricho: cada palabra suma un `OR` de tres `ILIKE` a la consulta, y una frase
 * pegada de veinte palabras armaría un `WHERE` que no termina. Cinco alcanzan para nombre completo.
 */
export function searchTerms(q: string | undefined | null, max = 5): string[] {
  return (q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, max);
}

/**
 * Mínimo viable, ajustado al modelo: **quién es** + un teléfono.
 *
 * 🔴 **Quién es depende del tipo.** Una empresa no tiene nombre ni apellido —tiene razón social— y
 * exigírselos dejaba el botón de guardar apagado para siempre: el formulario ofrecía «Empresa»,
 * escondía los dos campos que él mismo estaba exigiendo, y no había forma de darse cuenta. Es el
 * mismo corte que hace `assertIdentity` en el servidor.
 */
export function canSubmitCliente(s: ClienteForm): boolean {
  const identificado =
    s.clientType === 'COMPANY'
      ? s.businessName.trim().length >= 2
      : s.firstName.trim().length >= 2 && s.lastName.trim().length >= 1;
  return identificado && hasPhone(s);
}

/**
 * Una fila de teléfono → su payload. WhatsApp marcado ⇒ tipo WHATSAPP; email ⇒ EMAIL; resto PHONE.
 *
 * Por fila y no sólo por lista porque la **edición** las manda de a una (cada sub-recurso tiene su
 * endpoint): sin esto, la pantalla de editar reescribe esta conversión al lado, y el día que
 * WhatsApp deje de ser un tipo aparte quedan dos lugares que arreglar.
 */
export function contactPayload(c: ContactRow): NewContactInput {
  return {
    contactType: c.contactType === 'EMAIL' ? 'EMAIL' : c.hasWhatsApp ? 'WHATSAPP' : 'PHONE',
    value: c.value.trim(),
    isPrimary: c.isPrimary,
  };
}

/** Una fila de ubicación → su payload. Ídem `contactPayload`. */
export function locationPayload(l: LocationRow): NewLocationInput {
  return {
    locationType: l.locationType,
    address: l.address.trim() || undefined,
    zone: l.zone.trim() || undefined,
    latitude: parseNum(l.latitude),
    longitude: parseNum(l.longitude),
    referenceNotes: l.referenceNotes.trim() || undefined,
    photoUrls: l.photoUrls.length > 0 ? l.photoUrls : undefined,
  };
}

/** ¿La fila de ubicación tiene algún dato real? Las vacías no se mandan. */
export function hasLocationData(l: LocationRow): boolean {
  return Boolean(l.address.trim() || l.zone.trim() || l.latitude.trim() || l.photoUrls.length > 0 || l.referenceNotes.trim());
}

/** Teléfonos → payload, descartando los vacíos. */
export function mapContacts(rows: ContactRow[]): NewContactInput[] {
  return rows.filter((c) => c.value.trim().length > 0).map(contactPayload);
}

/** Ubicaciones → payload, descartando las filas sin ningún dato. */
export function mapLocations(rows: LocationRow[]): NewLocationInput[] {
  return rows.filter(hasLocationData).map(locationPayload);
}

/**
 * Un garante → su payload, con sus teléfonos y ubicaciones adentro (el alta de una relación es
 * atómica). Para el `PATCH` de uno ya existente, sus sub-recursos van por su propia vía: se manda
 * este mismo objeto sin `contacts` ni `locations`.
 */
export function relationPayload(r: RelationRow): NewRelationInput {
  return {
    relatedName: r.relatedName.trim(),
    relationshipType: r.relationshipType,
    gender: r.gender || undefined,
    isContactable: r.isContactable,
    notes: r.notes.trim() || undefined,
    contacts: mapContacts(r.contacts),
    locations: mapLocations(r.locations),
    /*
     * 🔴 **Viaja siempre, incluso vacío.** El server reemplaza el vínculo entero con lo que llegue:
     * mandarlo sólo cuando hay algo haría que **desmarcar el último crédito no se pudiera guardar**
     * — la persona lo saca en pantalla, guarda, vuelve, y sigue ahí.
     */
    creditIds: r.creditIds,
  };
}

/** Una garantía → su payload. Ídem `contactPayload`: por fila, porque la edición las manda de a una. */
export function collateralPayload(g: CollateralRow): NewCollateralInput {
  return {
    type: g.type || undefined,
    description: g.description.trim(),
    estimatedValue: parseNum(g.estimatedValue),
    currency: g.currency || undefined,
    photoUrls: g.photoUrls.length > 0 ? g.photoUrls : undefined,
    // Ídem `relationPayload`: vacío también viaja, o no se puede desvincular la última.
    creditIds: g.creditIds,
  };
}

/**
 * ¿La fila de garantía tiene algo? **La descripción es lo que la hace existir**: una garantía que
 * dice sólo «vehículo» y no cuál no le sirve a nadie que salga a buscarla.
 */
export function hasCollateralData(g: CollateralRow): boolean {
  return g.description.trim().length > 0;
}

/** Garantías → payload, descartando las filas sin descripción. */
export function mapCollaterals(rows: CollateralRow[]): NewCollateralInput[] {
  return rows.filter(hasCollateralData).map(collateralPayload);
}

export function buildClientePayload(s: ClienteForm): NewClientInput {
  return {
    clientType: s.clientType,
    firstName: s.firstName.trim() || undefined,
    lastName: s.lastName.trim() || undefined,
    businessName: s.businessName.trim() || undefined,
    nationalId: s.nationalId.trim() || undefined,
    gender: s.gender || undefined,
    riskSegment: s.riskSegment || undefined,
    status: s.status,
    contacts: mapContacts(s.contacts),
    locations: mapLocations(s.locations),
    // `relatedName` es obligatorio en el DTO → se descartan las relaciones sin nombre. Cada contacto
    // (persona) lleva sus propios teléfonos y ubicaciones con la MISMA estructura que el cliente.
    relations: s.relations.filter((r) => r.relatedName.trim().length > 0).map(relationPayload),
    collaterals: mapCollaterals(s.collaterals),
  };
}
