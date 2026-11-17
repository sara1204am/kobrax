import type { ReactNode } from 'react';
import { parseLegal as parseLegalShared, parseLegalInline } from '@kobrax/shared';

/**
 * Pinta el texto de un documento legal (markdown mínimo). **Sin `dangerouslySetInnerHTML`**: todo se arma con elementos de React,
 * así que un texto con HTML o scripts se muestra como texto y no se ejecuta.
 *
 * Soporta lo que usan los documentos: `#`/`##`/`###`, listas con `-` y numeradas con `1.`, párrafos y `**negrita**`. Los marcadores
 * `[PENDIENTE …]` se resaltan: son lo que un abogado todavía debe completar o confirmar, y no deben pasar desapercibidos.
 */
function inline(text: string): ReactNode[] {
  return parseLegalInline(text).map((part, i) => {
    if (part.kind === 'bold') return <strong key={i}>{part.text}</strong>;
    // Solo enlaces internos a otro documento (`/ruta`): nunca una URL externa que venga en el texto (lo garantiza el lector compartido).
    if (part.kind === 'link')
      return (
        <a key={i} href={part.href} target="_blank" rel="noopener noreferrer" className="font-medium text-k-purple hover:underline">
          {part.text}
        </a>
      );
    if (part.kind === 'pending')
      return (
        <mark key={i} className="rounded bg-k-warning-bg px-1 text-k-warning-text">
          {part.text}
        </mark>
      );
    return part.text;
  });
}

export const parseLegal = parseLegalShared;

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
