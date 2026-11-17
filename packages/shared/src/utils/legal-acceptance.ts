/**
 * Aceptación legal al crear un acceso (registro e invitación) y lectura del texto de los documentos. Lógica pura, sin framework:
 * la usan la web y el móvil, para que digan y envíen exactamente lo mismo.
 *
 * 🔴 Lo que viaja a la API son los **ids de las versiones que la pantalla mostró**, nunca un texto ni un hash: el servidor calcula el
 * hash con su propia copia y rechaza una versión que ya no sea la vigente (`LEGAL_VERSION_STALE`).
 */

/** Un documento que se exige al crear el acceso, tal como lo devuelve `GET /legal/signup-documents`. */
export interface SignupDocument {
  type: 'TERMS' | 'PRIVACY';
  action: 'ACCEPTED' | 'ACKNOWLEDGED';
  versionId: string;
  version: string;
  title: string;
  contentSha256: string;
}

/**
 * Lo que la persona marcó. Todo nace en `false`: nada viene premarcado.
 *
 * No hay casilla de marketing en el registro (decisión de diseño): la API soporta `marketingOptIn`, pero ese consentimiento opcional
 * se ofrece desde Mi perfil › Privacidad y nunca condiciona el acceso.
 */
export interface LegalChoice {
  terms: boolean;
  privacy: boolean;
}

export const EMPTY_CHOICE: LegalChoice = { terms: false, privacy: false };

/**
 * Los documentos legales solo existen en español por ahora. Se piden siempre en `es`, también a quien usa la interfaz en inglés:
 * pedir `en` sin tener una versión publicada dejaría a esa persona sin poder registrarse. Cuando haya traducciones publicadas,
 * este es el único punto que cambia.
 */
export const LEGAL_LOCALE = 'es';

/** Se puede enviar solo con los documentos cargados y las DOS casillas obligatorias marcadas. */
export function canSubmitLegal(docs: readonly SignupDocument[] | null, choice: LegalChoice): boolean {
  if (!docs) return false;
  const has = (t: SignupDocument['type']) => docs.some((d) => d.type === t);
  return has('TERMS') && has('PRIVACY') && choice.terms && choice.privacy;
}

/**
 * El fragmento del cuerpo del alta: los ids de las versiones que se mostraron.
 * Devuelve `{}` si la persona no completó lo obligatorio: ese envío no debería ocurrir, y la API lo rechazaría igual.
 */
export function legalPayload(
  docs: readonly SignupDocument[] | null,
  choice: LegalChoice,
): { termsVersionId?: string; privacyVersionId?: string } {
  if (!canSubmitLegal(docs, choice) || !docs) return {};
  const id = (t: SignupDocument['type']) => docs.find((d) => d.type === t)!.versionId;
  return {
    termsVersionId: id('TERMS'),
    privacyVersionId: id('PRIVACY'),
  };
}

/** Bloques del texto de un documento legal (markdown mínimo). */
export type LegalBlock =
  | { kind: 'h'; level: 1 | 2 | 3; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'ul' | 'ol'; items: string[] };

/**
 * Lee el texto de un documento legal: `#`/`##`/`###`, listas con `-` y numeradas con `1.`, y párrafos (varias líneas seguidas forman
 * uno). Devuelve **datos**, no HTML: quien lo pinta (web o móvil) arma sus propios elementos, así un texto con HTML o scripts se
 * muestra como texto y nunca se ejecuta.
 */
export function parseLegal(content: string): LegalBlock[] {
  const blocks: LegalBlock[] = [];
  let para: string[] = [];
  let list: { kind: 'ul' | 'ol'; items: string[] } | null = null;
  const flushPara = () => {
    if (para.length) blocks.push({ kind: 'p', text: para.join(' ') });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };
  for (const raw of content.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const ul = /^\s*-\s+(.*)$/.exec(line);
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      flushList();
      blocks.push({ kind: 'h', level: h[1]!.length as 1 | 2 | 3, text: h[2]! });
    } else if (ul || ol) {
      flushPara();
      const kind = ul ? 'ul' : 'ol';
      if (!list || list.kind !== kind) {
        flushList();
        list = { kind, items: [] };
      }
      list.items.push((ul ?? ol)![1]!);
    } else if (line.trim() === '') {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return blocks;
}

/** Trozos de una línea: texto llano, **negrita**, marcador `[PENDIENTE …]` (lo que un abogado debe completar) o un enlace interno `[texto](/ruta)`. */
export type LegalInline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'pending'; text: string }
  | { kind: 'link'; text: string; href: string };

const INLINE = /(\*\*[^*]+\*\*|\[PENDIENTE[^\]]*\]|\[[^\]]+\]\(\/[a-z-]+\))/g;
const LINK = /^\[([^\]]+)\]\((\/[a-z-]+)\)$/;

/** Parte una línea en trozos. Solo se reconocen enlaces internos (`/ruta`): una URL externa dentro del texto NO se vuelve enlace. */
export function parseLegalInline(text: string): LegalInline[] {
  return text
    .split(INLINE)
    .filter((p) => p !== '')
    .map((part): LegalInline => {
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return { kind: 'bold', text: part.slice(2, -2) };
      const link = LINK.exec(part);
      if (link) return { kind: 'link', text: link[1]!, href: link[2]! };
      if (part.startsWith('[PENDIENTE')) return { kind: 'pending', text: part };
      return { kind: 'text', text: part };
    });
}
