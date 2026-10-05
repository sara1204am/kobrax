/**
 * Lo puro del legajo de la ficha: adjuntos, garantes y garantías (paridad con el panel web, F4/08 · fase 5).
 * Las pantallas sólo dibujan lo que esto decide.
 */
import type { ClientAttachmentDetail, ClientRelationDetail, CollateralDetail } from '@kobrax/shared';

export const ATTACHMENT_LABEL: Record<string, string> = {
  ID_CARD: 'Carnet / CI',
  PHOTO: 'Foto',
  CONTRACT: 'Contrato',
  OTHER: 'Otro',
};

export const attachmentLabel = (type: string): string => ATTACHMENT_LABEL[type] ?? type;

export const RELATION_LABEL: Record<string, string> = {
  GUARANTOR: 'Garante',
  FAMILY: 'Familiar',
  COWORKER: 'Compañero de trabajo',
  NEIGHBOR: 'Vecino',
  OTHER: 'Otro',
};

/**
 * `fileUrl` es la ruta interna (`/api/uploads/<hash>.<ext>`): cuelga del host de la API, no de su prefijo
 * `/api` (que `API_BASE` ya trae). Una URL absoluta se respeta tal cual.
 */
export function attachmentUri(fileUrl: string | undefined, apiBase: string): string | null {
  if (!fileUrl) return null;
  if (/^https?:\/\//i.test(fileUrl)) return fileUrl;
  const host = apiBase.replace(/\/api\/?$/, '').replace(/\/$/, '');
  return `${host}${fileUrl.startsWith('/') ? '' : '/'}${fileUrl}`;
}

export const isImageFile = (fileUrl: string | undefined): boolean => /\.(jpe?g|png|webp|heic|gif)$/i.test(fileUrl ?? '');

/** Los más nuevos primero. */
export function sortAttachments(rows: ClientAttachmentDetail[] | undefined): ClientAttachmentDetail[] {
  return [...(rows ?? [])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

export interface LegajoRelation extends ClientRelationDetail {
  /** Responde por el préstamo que se está mirando. */
  linked: boolean;
}
export interface LegajoCollateral extends CollateralDetail {
  linked: boolean;
}

/** Los garantes primero y, entre ellos, los del préstamo elegido; el resto (familia, vecinos) después. */
export function relationsForCredit(rows: ClientRelationDetail[] | undefined, creditId: string | null): LegajoRelation[] {
  const rank = (r: LegajoRelation) => (r.relationshipType === 'GUARANTOR' ? 0 : 2) + (r.linked ? 0 : 1);
  return (rows ?? [])
    .map((r) => ({ ...r, linked: !!creditId && (r.creditIds ?? []).includes(creditId) }))
    .sort((a, b) => rank(a) - rank(b));
}

/** Las garantías del préstamo elegido primero. */
export function collateralsForCredit(rows: CollateralDetail[] | undefined, creditId: string | null): LegajoCollateral[] {
  return (rows ?? [])
    .map((g) => ({ ...g, linked: !!creditId && (g.creditIds ?? []).includes(creditId) }))
    .sort((a, b) => Number(b.linked) - Number(a.linked));
}

/** Teléfonos de una persona, el principal primero. */
export function phonesOf(r: Pick<ClientRelationDetail, 'contacts'>): string[] {
  return [...(r.contacts ?? [])]
    .filter((c) => c.contactType !== 'EMAIL' && c.value)
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
    .map((c) => c.value as string);
}
