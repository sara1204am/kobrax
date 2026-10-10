import type { CatalogType } from '../enums/agenda.enum.js';

/**
 * Catálogos que toda cuenta tiene al empezar. Una sola fuente para el **seed** y para el **registro**: antes vivían
 * solo en `seed.ts`, así que una cuenta registrada nacía sin métodos de pago ni bancos (F4/13 · D-01, D-09).
 *
 * El `catalog` va como literal (`${CatalogType}`) y no como el enum: así lo acepta Prisma sin conversión, y un valor
 * que Prisma no conozca rompe la compilación.
 *
 * Cada cuenta los edita después; sembrar es idempotente (`skipDuplicates` sobre cuenta+catálogo+código), así que
 * **no pisa** lo que alguien cambió ni vuelve a crear lo que dio de baja.
 */
export interface CatalogDefault {
  catalog: `${CatalogType}`;
  code: string;
  label: string;
  sortOrder: number;
  metadata?: Record<string, unknown>;
}

/** Las filas listas para `catalog_items.createMany`: las usan el registro y el backfill (el seed arma las suyas). */
export function catalogDefaultRows(accountId: string): { accountId: string; catalog: CatalogDefault['catalog']; code: string; label: string; sortOrder: number; metadata: Record<string, unknown> }[] {
  return CATALOG_DEFAULTS.map((c) => ({ accountId, catalog: c.catalog, code: c.code, label: c.label, sortOrder: c.sortOrder, metadata: c.metadata ?? {} }));
}

export const CATALOG_DEFAULTS: readonly CatalogDefault[] = [
  { catalog: 'PAYMENT_METHOD', code: 'CASH', label: 'Efectivo', sortOrder: 1 },
  { catalog: 'PAYMENT_METHOD', code: 'DEPOSIT', label: 'Depósito', sortOrder: 2, metadata: { requiresBank: true } },
  { catalog: 'PAYMENT_METHOD', code: 'TRANSFER', label: 'Transferencia', sortOrder: 3, metadata: { requiresBank: true } },
  { catalog: 'PAYMENT_METHOD', code: 'QR', label: 'QR', sortOrder: 4 },
  { catalog: 'PAYMENT_METHOD', code: 'CHECK', label: 'Cheque', sortOrder: 5, metadata: { requiresBank: true } },
  { catalog: 'PAYMENT_METHOD', code: 'MOBILE', label: 'Pago móvil', sortOrder: 6 },
  { catalog: 'PAYMENT_METHOD', code: 'AGENCY', label: 'Agencia', sortOrder: 7 },
  { catalog: 'PAYMENT_METHOD', code: 'COLLECTOR', label: 'Cobrador', sortOrder: 8 },
  { catalog: 'BANK', code: 'BNB', label: 'Banco Nacional de Bolivia', sortOrder: 1 },
  { catalog: 'BANK', code: 'BCP', label: 'BCP', sortOrder: 2 },
  { catalog: 'BANK', code: 'BMSC', label: 'Banco Mercantil Santa Cruz', sortOrder: 3 },
  { catalog: 'BANK', code: 'BISA', label: 'Banco BISA', sortOrder: 4 },
  { catalog: 'BANK', code: 'UNION', label: 'Banco Unión', sortOrder: 5 },
  { catalog: 'BANK', code: 'FIE', label: 'Banco FIE', sortOrder: 6 },
  { catalog: 'BANK', code: 'SOL', label: 'Banco Sol', sortOrder: 7 },
  { catalog: 'BANK', code: 'ECOFUTURO', label: 'EcoFuturo', sortOrder: 8 },
  { catalog: 'PRIORITY', code: 'VERY_HIGH', label: 'Muy alta', sortOrder: 1 },
  { catalog: 'PRIORITY', code: 'HIGH', label: 'Alta', sortOrder: 2 },
  { catalog: 'PRIORITY', code: 'MEDIUM', label: 'Media', sortOrder: 3 },
  { catalog: 'PRIORITY', code: 'LOW', label: 'Baja', sortOrder: 4 },
  { catalog: 'EXPECTED_RESULT', code: 'COLLECT', label: 'Cobrar', sortOrder: 1 },
  { catalog: 'EXPECTED_RESULT', code: 'REMIND', label: 'Recordar', sortOrder: 2 },
  { catalog: 'EXPECTED_RESULT', code: 'CONFIRM_VISIT', label: 'Confirmar visita', sortOrder: 3 },
  { catalog: 'EXPECTED_RESULT', code: 'CONFIRM_PAYMENT', label: 'Confirmar pago', sortOrder: 4 },
  { catalog: 'EXPECTED_RESULT', code: 'NEGOTIATE', label: 'Negociar', sortOrder: 5 },
  { catalog: 'PHONE_TYPE', code: 'MOBILE', label: 'Celular', sortOrder: 1 },
  { catalog: 'PHONE_TYPE', code: 'OFFICE', label: 'Oficina', sortOrder: 2 },
  { catalog: 'PHONE_TYPE', code: 'HOME', label: 'Casa', sortOrder: 3 },
  { catalog: 'PHONE_TYPE', code: 'REFERENCE', label: 'Referencia', sortOrder: 4 },
  { catalog: 'ADDRESS_TYPE', code: 'HOME', label: 'Casa', sortOrder: 1 },
  { catalog: 'ADDRESS_TYPE', code: 'WORK', label: 'Trabajo', sortOrder: 2 },
  { catalog: 'ADDRESS_TYPE', code: 'BUSINESS', label: 'Negocio', sortOrder: 3 },
  { catalog: 'REMINDER_CATEGORY', code: 'PAYMENT', label: 'Pago', sortOrder: 1 },
  { catalog: 'REMINDER_CATEGORY', code: 'DOCUMENT', label: 'Documento', sortOrder: 2 },
  { catalog: 'REMINDER_CATEGORY', code: 'FOLLOWUP', label: 'Seguimiento', sortOrder: 3 },
  { catalog: 'CANCEL_REASON', code: 'CLIENT_UNAVAILABLE', label: 'Cliente no disponible', sortOrder: 1 },
  { catalog: 'CANCEL_REASON', code: 'WRONG_DATA', label: 'Datos incorrectos', sortOrder: 2 },
  { catalog: 'RESCHEDULE_REASON', code: 'CLIENT_REQUEST', label: 'A pedido del cliente', sortOrder: 1 },
  { catalog: 'RESCHEDULE_REASON', code: 'NO_ANSWER', label: 'Sin respuesta', sortOrder: 2 },
  { catalog: 'CURRENCY', code: 'BOB', label: 'Boliviano', sortOrder: 1 },
  { catalog: 'CURRENCY', code: 'USD', label: 'Dólar', sortOrder: 2 },
  // Clases de crédito y de garantía: cada empresa las edita, pero el catálogo no arranca vacío.
  { catalog: 'CREDIT_TYPE', code: 'CONSUMER', label: 'Crédito de consumo', sortOrder: 1 },
  { catalog: 'CREDIT_TYPE', code: 'PERSONAL', label: 'Préstamo personal', sortOrder: 2 },
  { catalog: 'CREDIT_TYPE', code: 'MICRO', label: 'Microcrédito', sortOrder: 3 },
  { catalog: 'CREDIT_TYPE', code: 'HOUSING', label: 'Vivienda', sortOrder: 4 },
  { catalog: 'COLLATERAL_TYPE', code: 'VEHICLE', label: 'Vehículo', sortOrder: 1 },
  { catalog: 'COLLATERAL_TYPE', code: 'PROPERTY', label: 'Inmueble', sortOrder: 2 },
  { catalog: 'COLLATERAL_TYPE', code: 'MACHINERY', label: 'Maquinaria', sortOrder: 3 },
  { catalog: 'COLLATERAL_TYPE', code: 'APPLIANCE', label: 'Electrodoméstico', sortOrder: 4 },
  { catalog: 'COLLATERAL_TYPE', code: 'OTHER', label: 'Otro', sortOrder: 5 },
  // Plantillas de WhatsApp (S4): el cuerpo va en `metadata.body` con variables {{cliente}}/{{saldo}}.
  { catalog: 'WHATSAPP_TEMPLATE', code: 'INITIAL', label: 'Cobro inicial', sortOrder: 1, metadata: { body: 'Hola {{cliente}}, le escribimos de Kobrax para recordarle su saldo pendiente de {{saldo}}. Puede coordinar su pago con nosotros.' } },
  { catalog: 'WHATSAPP_TEMPLATE', code: 'REMINDER', label: 'Recordatorio', sortOrder: 2, metadata: { body: 'Hola {{cliente}}, le recordamos que su pago de {{saldo}} vence pronto. Quedamos atentos.' } },
  { catalog: 'WHATSAPP_TEMPLATE', code: 'LAST_NOTICE', label: 'Último aviso', sortOrder: 3, metadata: { body: 'Hola {{cliente}}, su deuda de {{saldo}} se encuentra vencida. Le pedimos regularizar su pago a la brevedad para evitar cargos adicionales.' } },
  // Gestión especial en campo (S5 · RT-6).
  { catalog: 'SPECIAL_CATEGORY', code: 'DECEASED', label: 'Fallecimiento', sortOrder: 1 },
  { catalog: 'SPECIAL_CATEGORY', code: 'SERIOUS_ILLNESS', label: 'Enfermedad grave', sortOrder: 2 },
  { catalog: 'SPECIAL_CATEGORY', code: 'LONG_TRIP', label: 'Viaje prolongado', sortOrder: 3 },
  { catalog: 'SPECIAL_CATEGORY', code: 'LEGAL_DISPUTE', label: 'Conflicto legal', sortOrder: 4 },
  { catalog: 'SPECIAL_CATEGORY', code: 'OTHER', label: 'Otro', sortOrder: 5 },

  // ── F4/13 · Contexto del deudor (capa de datos para la IA). Listas BORRADOR: cada cuenta las ajusta. ──
  // Fuente de ingreso: filtra qué motivos de no pago se ofrecen.
  { catalog: 'INCOME_SOURCE', code: 'EMPLOYEE', label: 'Asalariado o profesional', sortOrder: 1 },
  { catalog: 'INCOME_SOURCE', code: 'BUSINESS', label: 'Comerciante o productivo', sortOrder: 2 },
  { catalog: 'INCOME_SOURCE', code: 'OTHER', label: 'Otro', sortOrder: 3 },
  // Rubro. `synonyms` permite reconocer lo que alguien escribe o dicta sin usar IA.
  { catalog: 'OCCUPATION', code: 'TRANSPORT', label: 'Transportista', sortOrder: 1, metadata: { incomeSource: 'BUSINESS', defaultCycle: 'WEEKLY', synonyms: ['transportista', 'chofer', 'conductor', 'taxista', 'minibusero', 'micrero', 'camionero', 'flete', 'trufi'] } },
  { catalog: 'OCCUPATION', code: 'PUBLIC_SERVANT', label: 'Funcionario público', sortOrder: 2, metadata: { incomeSource: 'EMPLOYEE', defaultCycle: 'MONTHLY', synonyms: ['funcionario', 'empleado publico', 'alcaldia', 'municipal', 'gobernacion', 'ministerio', 'policia'] } },
  { catalog: 'OCCUPATION', code: 'MERCHANT', label: 'Comerciante', sortOrder: 3, metadata: { incomeSource: 'BUSINESS', defaultCycle: 'DAILY', synonyms: ['comerciante', 'tienda', 'puesto', 'mercado', 'vendedor', 'negocio', 'abarrotes', 'ambulante', 'gremialista', 'kiosco'] } },
  { catalog: 'OCCUPATION', code: 'PRODUCER', label: 'Productor agropecuario', sortOrder: 4, metadata: { incomeSource: 'BUSINESS', defaultCycle: 'SEASONAL', synonyms: ['agricultor', 'productor', 'campesino', 'ganadero', 'cosecha', 'chacra', 'agricola'] } },
  { catalog: 'OCCUPATION', code: 'CONSTRUCTION', label: 'Construcción y oficios', sortOrder: 5, metadata: { incomeSource: 'BUSINESS', defaultCycle: 'WEEKLY', synonyms: ['albanil', 'constructor', 'carpintero', 'electricista', 'plomero', 'soldador', 'pintor', 'oficio'] } },
  { catalog: 'OCCUPATION', code: 'SERVICES', label: 'Servicios', sortOrder: 6, metadata: { incomeSource: 'BUSINESS', defaultCycle: 'IRREGULAR', synonyms: ['peluqueria', 'mecanico', 'costurera', 'restaurante', 'comida', 'lavanderia', 'taller', 'servicio'] } },
  { catalog: 'OCCUPATION', code: 'PROFESSIONAL', label: 'Profesional independiente', sortOrder: 7, metadata: { incomeSource: 'EMPLOYEE', defaultCycle: 'MONTHLY', synonyms: ['abogado', 'medico', 'ingeniero', 'contador', 'arquitecto', 'consultor', 'profesional', 'licenciado'] } },
  { catalog: 'OCCUPATION', code: 'TEACHER', label: 'Docente', sortOrder: 8, metadata: { incomeSource: 'EMPLOYEE', defaultCycle: 'MONTHLY', synonyms: ['profesor', 'docente', 'magisterio', 'colegio', 'escuela', 'maestro de aula'] } },
  { catalog: 'OCCUPATION', code: 'PRIVATE_EMPLOYEE', label: 'Empleado privado', sortOrder: 9, metadata: { incomeSource: 'EMPLOYEE', defaultCycle: 'MONTHLY', synonyms: ['empleado', 'obrero', 'fabrica', 'empresa', 'sueldo', 'oficinista'] } },
  { catalog: 'OCCUPATION', code: 'OTHER', label: 'Otro', sortOrder: 10, metadata: { incomeSource: 'OTHER' } },
  // Motivo de no pago. `appliesTo` omitido = se ofrece a todos. `declaredOnly`: lo que el deudor DIJO, no un hecho.
  { catalog: 'NO_PAYMENT_REASON', code: 'JOB_LOSS', label: 'Perdió el empleo', sortOrder: 1, metadata: { group: 'CAPACITY', appliesTo: ['EMPLOYEE', 'OTHER'], suggestion: 'Suele tardar más en recuperarse: evaluar un plazo o una reestructura.' } },
  { catalog: 'NO_PAYMENT_REASON', code: 'REDUCED_INCOME', label: 'Ingresos reducidos', sortOrder: 2, metadata: { group: 'CAPACITY', suggestion: 'Revisar el monto de la cuota o el plan de pagos.' } },
  { catalog: 'NO_PAYMENT_REASON', code: 'NO_SALES', label: 'Sin ventas o negocio caído', sortOrder: 3, metadata: { group: 'CAPACITY', appliesTo: ['BUSINESS', 'OTHER'], suggestion: 'Seguimiento corto; revisar cómo está la actividad.' } },
  { catalog: 'NO_PAYMENT_REASON', code: 'EXTERNAL_EVENT', label: 'Evento externo (bloqueo, paro, accidente, clima)', sortOrder: 4, metadata: { group: 'CAPACITY', appliesTo: ['BUSINESS', 'OTHER'], suggestion: 'Reprogramar; avisar al supervisor si se repite en la misma zona.' } },
  { catalog: 'NO_PAYMENT_REASON', code: 'LATE_INCOME', label: 'Ingreso atrasado (le pagan tarde)', sortOrder: 5, metadata: { group: 'TIMING', asksExpectedIncomeDate: true, suggestion: 'Pagará al cobrar: promesa corta alineada a esa fecha.' } },
  { catalog: 'NO_PAYMENT_REASON', code: 'HEALTH_OR_BEREAVEMENT', label: 'Problema de salud o fallecimiento en la familia', sortOrder: 6, metadata: { group: 'CAPACITY', sensitive: true, suggestion: 'Trato sensible: no presionar.' } },
  { catalog: 'NO_PAYMENT_REASON', code: 'OVER_INDEBTED', label: 'Sobreendeudamiento', sortOrder: 7, metadata: { group: 'DEBT', suggestion: 'Conversar un plan de pagos realista.' } },
  { catalog: 'NO_PAYMENT_REASON', code: 'CREDIT_FOR_OTHER', label: 'Declara que el crédito fue para otra persona', sortOrder: 8, metadata: { group: 'OWNERSHIP', declaredOnly: true, suggestion: 'Preguntar quién responde realmente por el crédito.' } },
  { catalog: 'NO_PAYMENT_REASON', code: 'MOVED_OR_PHONE_CHANGED', label: 'Cambió de domicilio o de teléfono; no se lo ubica', sortOrder: 9, metadata: { group: 'LOCATION', triggersContactUpdate: true, suggestion: 'Ubicarlo de nuevo: actualizar dirección o teléfono; consultar al garante o a los contactos.' } },
  { catalog: 'NO_PAYMENT_REASON', code: 'FORGOT', label: 'Olvido o descuido', sortOrder: 10, metadata: { group: 'LAPSE', suggestion: 'Basta un recordatorio; poco frecuente.' } },
  { catalog: 'NO_PAYMENT_REASON', code: 'NO_WILL', label: 'No manifiesta intención de pago', sortOrder: 11, metadata: { group: 'WILL', declaredOnly: true, suggestion: 'Escalar al supervisor.' } },
  { catalog: 'NO_PAYMENT_REASON', code: 'OTHER', label: 'Otro', sortOrder: 12, metadata: { group: 'OTHER' } },
  // Cómo conviene cobrarle: alimenta el perfil de cobro (`client_locations.visit_schedule`).
  { catalog: 'COLLECTION_MODALITY', code: 'AT_BUSINESS', label: 'Visita en el negocio', sortOrder: 1 },
  { catalog: 'COLLECTION_MODALITY', code: 'AT_HOME', label: 'Visita en el domicilio', sortOrder: 2 },
  { catalog: 'COLLECTION_MODALITY', code: 'PICK_UP', label: 'Recoger la cuota', sortOrder: 3 },
  { catalog: 'COLLECTION_MODALITY', code: 'AT_OFFICE', label: 'Paga en oficina', sortOrder: 4 },
  { catalog: 'COLLECTION_MODALITY', code: 'TRANSFER_QR', label: 'Transferencia o QR', sortOrder: 5 },
];
