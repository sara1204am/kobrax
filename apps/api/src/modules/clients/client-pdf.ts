import type { Credit, CollectionCase } from '@prisma/client';
import { Report, arrearsTone, C, type TableColumn } from '../../common/pdf/report';
import { clientDisplayName, serializeClient } from './clients.serializer';

export interface ClientPdfBundle {
  client: ReturnType<typeof serializeClient>;
  credits: Credit[];
  cases: CollectionCase[];
}

export interface ClientPdfContext {
  accountName: string;
  currency?: string;
}

const CLIENT_STATUS: Record<string, string> = {
  ACTIVE: 'Activo',
  INACTIVE: 'Inactivo',
  BLOCKED: 'Bloqueado',
};

const CREDIT_STATUS: Record<string, string> = {
  ACTIVE: 'Vigente',
  PAID: 'Pagado',
  DEFAULTED: 'Incobrable',
  RESTRUCTURED: 'Reprogramado',
  CANCELLED: 'Anulado',
};

const CASE_STATUS: Record<string, string> = {
  PENDING: 'Pendiente',
  ACTIVE: 'Activo',
  IN_NEGOTIATION: 'En negociación',
  PROMISE_TO_PAY: 'Promesa de pago',
  PAID: 'Pagado',
  CLOSED: 'Cerrado',
  WRITTEN_OFF: 'Castigado',
};

const PRIORITY: Record<string, string> = {
  LOW: 'Baja',
  MEDIUM: 'Media',
  HIGH: 'Alta',
  CRITICAL: 'Crítica',
};

/** El segmento es texto libre en la base; los tres valores que usa el producto se traducen, el resto sale tal cual. */
const RISK: Record<string, string> = { HIGH: 'Alto', MEDIUM: 'Medio', LOW: 'Bajo' };

const CONTACT_LABEL: Record<string, string> = { PHONE: 'Teléfono', EMAIL: 'Correo', WHATSAPP: 'WhatsApp' };
const LOCATION_LABEL: Record<string, string> = { HOME: 'Domicilio', WORK: 'Trabajo', BUSINESS: 'Negocio', OTHER: 'Otra' };

const fecha = (d: Date | string | null | undefined): string =>
  d ? new Date(d).toLocaleDateString('es-BO', { dateStyle: 'medium' }) : '—';

/**
 * El legajo del cliente: quién es, cómo ubicarlo, qué debe y en qué estado está su cobranza.
 * Pensado para imprimir y llevar. Los adjuntos se listan, no se embeben — un legajo con seis
 * fotos de carnet pesa diez megas y deja de servir para lo que sirve.
 */
export async function buildClientPdf(bundle: ClientPdfBundle, ctx: ClientPdfContext): Promise<Buffer> {
  const { client: c, credits, cases } = bundle;
  const nombre = clientDisplayName(c) ?? 'Cliente';

  const r = new Report({
    title: 'Legajo de cliente',
    subtitle: nombre,
    accountName: ctx.accountName,
    currency: ctx.currency,
  });

  const vivos = credits.filter((x) => x.status === 'ACTIVE');
  const abiertos = cases.filter((x) => !['CLOSED', 'WRITTEN_OFF'].includes(x.status));

  r.kpis([
    { label: 'Saldo total', value: r.fmtMoney(c.totalDebt), tone: 'money' },
    { label: 'Créditos vigentes', value: `${vivos.length} de ${credits.length}` },
    {
      label: 'Mora máxima',
      value: `${c.maxDaysPastDue} d`,
      tone: c.maxDaysPastDue > 30 ? 'danger' : c.maxDaysPastDue > 0 ? 'warn' : 'neutral',
    },
    { label: 'Cobranzas abiertas', value: String(abiertos.length), tone: 'accent' },
  ]);

  r.section('Identificación');
  r.facts([
    { label: 'Nombre', value: nombre },
    { label: 'Tipo', value: c.clientType === 'COMPANY' ? 'Empresa' : 'Persona' },
    { label: 'Documento', value: c.nationalId ?? '—' },
    { label: 'NIT', value: c.taxId ?? '—' },
    { label: 'Estado', value: CLIENT_STATUS[c.status] ?? c.status },
    { label: 'Segmento de riesgo', value: c.riskSegment ? (RISK[c.riskSegment] ?? c.riskSegment) : '—' },
    { label: 'Alta', value: fecha(c.createdAt) },
    { label: 'Última actualización', value: fecha(c.updatedAt) },
  ]);

  r.section('Contactos');
  r.table<NonNullable<typeof c.contacts>[number]>(
    [
      { header: 'Tipo', width: 20, value: (x) => CONTACT_LABEL[x.contactType] ?? x.contactType },
      { header: 'Valor', width: 45, value: (x) => x.value ?? '—', strong: true },
      { header: 'Principal', width: 15, value: (x) => (x.isPrimary ? 'Sí' : '—'), align: 'center' },
      { header: 'Notas', width: 20, value: (x) => x.notes ?? '—' },
    ],
    c.contacts ?? [],
    { empty: 'Este cliente no tiene contactos cargados.' },
  );

  r.section('Ubicaciones');
  r.table<NonNullable<typeof c.locations>[number]>(
    [
      { header: 'Tipo', width: 15, value: (x) => LOCATION_LABEL[x.locationType] ?? x.locationType },
      { header: 'Dirección', width: 45, value: (x) => x.address ?? '—', strong: true },
      { header: 'Zona', width: 20, value: (x) => x.zone ?? '—' },
      {
        header: 'GPS',
        width: 20,
        value: (x) => (x.latitude != null && x.longitude != null ? `${x.latitude.toFixed(5)}, ${x.longitude.toFixed(5)}` : '—'),
      },
    ],
    c.locations ?? [],
    { empty: 'Este cliente no tiene direcciones cargadas.' },
  );

  r.section('Créditos');
  r.table<Credit>(
    [
      { header: 'Código', width: 18, value: (x) => x.code ?? '—', strong: true },
      { header: 'Estado', width: 16, value: (x) => CREDIT_STATUS[x.status] ?? x.status },
      { header: 'Otorgado', width: 15, value: (x) => fecha(x.disbursedAt) },
      { header: 'Capital', width: 17, value: (x) => r.fmtMoney(Number(x.principalAmount)), align: 'right' },
      { header: 'Saldo', width: 17, value: (x) => r.fmtMoney(Number(x.outstandingBalance)), align: 'right', strong: true },
      {
        header: 'Mora',
        width: 12,
        value: (x) => (x.daysPastDue > 0 ? `${x.daysPastDue} d` : 'Al día'),
        align: 'right',
        tone: (x) => arrearsTone(x.daysPastDue),
      },
    ],
    credits,
    { empty: 'Este cliente no tiene créditos.' },
  );

  r.section('Cobranzas');
  r.table<CollectionCase>(
    [
      {
        header: 'Estado',
        width: 25,
        value: (x) => CASE_STATUS[x.status] ?? x.status,
        strong: true,
        tone: (x) => (['CLOSED', 'WRITTEN_OFF'].includes(x.status) ? C.muted : C.text),
      },
      { header: 'Prioridad', width: 18, value: (x) => PRIORITY[x.priority] ?? x.priority },
      { header: 'Abierta', width: 19, value: (x) => fecha(x.createdAt) },
      { header: 'Última gestión', width: 19, value: (x) => fecha(x.lastActionAt) },
      { header: 'Cierre', width: 19, value: (x) => fecha(x.closedAt) },
    ],
    cases,
    { empty: 'Este cliente no tiene cobranzas registradas.' },
  );

  const relaciones = c.relations ?? [];
  const garantias = c.collaterals ?? [];
  if (relaciones.length > 0 || garantias.length > 0) {
    r.section('Respaldo');
    r.bullets(
      [
        ...relaciones.map((x) => {
          const canales = (x.contacts ?? []).map((ct) => ct.value).filter(Boolean).join(' · ');
          return `${x.relatedName} — ${x.relationshipType}${canales ? ` (${canales})` : ''}`;
        }),
        ...garantias.map((g) => {
          const valor = g.estimatedValue != null ? ` — ${r.fmtMoney(g.estimatedValue)}` : '';
          return `${g.description}${valor}`;
        }),
      ],
      'Sin garantes ni garantías registradas.',
    );
  }

  const adjuntos = c.attachments ?? [];
  if (adjuntos.length > 0) {
    r.section('Legajo digital');
    r.bullets(adjuntos.map((a) => `${a.fileType} — ${fecha(a.createdAt)}`));
    r.note('Los archivos no se incluyen en este PDF; se consultan en la ficha del cliente.');
  }

  return r.finish();
}
