import type { ReactNode } from 'react';

/**
 * Pinta el texto de un documento legal (markdown mínimo). **Sin `dangerouslySetInnerHTML`**: todo se arma con elementos de React,
 * así que un texto con HTML o scripts se muestra como texto y no se ejecuta.
 *
 * Soporta lo que usan los documentos: `#`/`##`/`###`, listas con `-` y numeradas con `1.`, párrafos y `**negrita**`. Los marcadores
 * `[PENDIENTE …]` se resaltan: son lo que un abogado todavía debe completar o confirmar, y no deben pasar desapercibidos.
 */
const INLINE = /(\*\*[^*]+\*\*|\[PENDIENTE[^\]]*\]|\[[^\]]+\]\(\/[a-z-]+\))/g;
const LINK = /^\[([^\]]+)\]\((\/[a-z-]+)\)$/;

function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    const link = LINK.exec(part);
    // Solo enlaces internos a otro documento (`/ruta`): nunca una URL externa que venga en el texto.
    if (link)
      return (
        <a key={i} href={link[2]} target="_blank" rel="noopener noreferrer" className="font-medium text-k-purple hover:underline">
          {link[1]}
        </a>
      );
    if (part.startsWith('[PENDIENTE'))
      return (
        <mark key={i} className="rounded bg-k-warning-bg px-1 text-k-warning-text">
          {part}
        </mark>
      );
    return part;
  });
}

type Block =
  | { kind: 'h'; level: 1 | 2 | 3; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'ul' | 'ol'; items: string[] };

export function parseLegal(content: string): Block[] {
  const blocks: Block[] = [];
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

const H: Record<1 | 2 | 3, string> = {
  1: 'mt-2 text-[20px] font-semibold text-k-navy',
  2: 'mt-6 text-[16px] font-semibold text-k-navy',
  3: 'mt-4 text-[14px] font-semibold text-k-text',
};

export function LegalText({ content }: { content: string }) {
  return (
    <div className="space-y-3 text-[14px] leading-relaxed text-k-text">
      {parseLegal(content).map((b, i) => {
        if (b.kind === 'h') {
          const Tag = (`h${b.level + 1}` as 'h2' | 'h3' | 'h4');
          return (
            <Tag key={i} className={H[b.level]}>
              {inline(b.text)}
            </Tag>
          );
        }
        if (b.kind === 'p') return <p key={i}>{inline(b.text)}</p>;
        const List = b.kind === 'ul' ? 'ul' : 'ol';
        return (
          <List key={i} className={`space-y-1 pl-5 ${b.kind === 'ul' ? 'list-disc' : 'list-decimal'}`}>
            {b.items.map((it, j) => (
              <li key={j}>{inline(it)}</li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
