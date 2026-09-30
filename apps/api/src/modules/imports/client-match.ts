/**
 * A qué cliente va cada operación nueva de un reporte (D2 · opción B). Puro, sin DB.
 *
 * El reporte no trae el carnet casi nunca, así que la persona se reconoce por el nombre — y un nombre
 * no alcanza para juntar dos personas sin preguntar. Por eso, en orden:
 *
 *  1. **Vínculo confirmado** (`client_external_keys`): alguien ya dijo quién es esta persona → ese cliente.
 *  2. **Carnet** (si el reporte lo trae): identifica sin dudas → el cliente con ese carnet.
 *  3. **Coincidencias por nombre**: hay clientes que se llaman igual → **cliente provisional marcado
 *     «Revisar vínculo»**, con las sugerencias. El crédito entra igual: una duda no frena la cobranza.
 *  4. Nadie se llama así → cliente nuevo.
 *
 * Varias operaciones del mismo nombre en el mismo archivo van a un solo cliente — pero marcado para
 * revisar: que dos filas se llamen igual es probable que sea la misma persona, no seguro.
 */

/** "Miriam  CRUZ apaza" y "Apaza Cruz Miriam" → la misma llave: palabras sin tildes, ordenadas. */
export function nameKey(fullName: string | null | undefined): string | null {
  if (!fullName) return null;
  const words = fullName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return words.length === 0 ? null : [...words].sort().join(' ');
}

/** Las palabras por las que conviene buscar candidatos en la base: las más largas, que menos se repiten. */
export function searchWords(fullName: string | null | undefined): string[] {
  const key = nameKey(fullName);
  if (!key) return [];
  return key
    .split(' ')
    .filter((w) => w.length >= 4)
    .sort((a, b) => b.length - a.length)
    .slice(0, 1);
}

export interface MatchRow {
  index: number;
  fullName: string | null;
  /** Blind index del carnet, si el reporte lo trae. */
  nationalIdHash?: string | null;
}

export interface CandidateClient {
  id: string;
  firstName: string | null;
  lastName: string | null;
  businessName: string | null;
  nationalIdHash: string | null;
}

export type ClientResolution =
  /** Cliente que ya existe: vínculo confirmado o mismo carnet. */
  | { kind: 'existing'; clientId: string; via: 'link' | 'national_id' }
  /** Cliente a crear. `group` junta las filas que van al mismo cliente nuevo. */
  | { kind: 'new'; group: string; review: boolean; suggestions: string[]; nameKey: string | null };

export function resolveClients(
  rows: readonly MatchRow[],
  ctx: {
    /** `client_external_keys` de tipo NAME ya confirmados: llave → cliente. */
    linkedByName: ReadonlyMap<string, string>;
    /** Clientes que podrían ser: los que comparten alguna palabra larga del nombre. */
    candidates: readonly CandidateClient[];
  },
): Map<number, ClientResolution> {
  const out = new Map<number, ClientResolution>();
  const byIdHash = new Map(ctx.candidates.filter((c) => c.nationalIdHash).map((c) => [c.nationalIdHash!, c.id]));
  const candidatesByKey = new Map<string, string[]>();
  for (const c of ctx.candidates) {
    const key = nameKey([c.firstName, c.lastName, c.businessName].filter(Boolean).join(' '));
    if (!key) continue;
    candidatesByKey.set(key, [...(candidatesByKey.get(key) ?? []), c.id]);
  }

  // Cuántas filas nuevas comparten cada llave (o carnet): varias → mismo cliente, a revisar.
  const groupOf = (r: MatchRow): string => (r.nationalIdHash ? `id:${r.nationalIdHash}` : `name:${nameKey(r.fullName) ?? `row:${r.index}`}`);
  const groupSize = new Map<string, number>();
  for (const r of rows) groupSize.set(groupOf(r), (groupSize.get(groupOf(r)) ?? 0) + 1);

  for (const r of rows) {
    const key = nameKey(r.fullName);
    if (r.nationalIdHash && byIdHash.has(r.nationalIdHash)) {
      out.set(r.index, { kind: 'existing', clientId: byIdHash.get(r.nationalIdHash)!, via: 'national_id' });
      continue;
    }
    if (key && ctx.linkedByName.has(key)) {
      out.set(r.index, { kind: 'existing', clientId: ctx.linkedByName.get(key)!, via: 'link' });
      continue;
    }
    // Con carnet propio y sin nadie con ese carnet, es otra persona aunque se llame igual.
    const suggestions = r.nationalIdHash ? [] : key ? (candidatesByKey.get(key) ?? []) : [];
    const group = groupOf(r);
    out.set(r.index, {
      kind: 'new',
      group,
      review: suggestions.length > 0 || (!r.nationalIdHash && (groupSize.get(group) ?? 0) > 1),
      suggestions,
      nameKey: key,
    });
  }
  return out;
}
