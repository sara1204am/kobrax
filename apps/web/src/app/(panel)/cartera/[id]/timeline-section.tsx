import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ClientTimelineEntry, Member } from '@kobrax/shared';
import { memberName } from '@kobrax/shared';
import { money, relativeDate } from '@/lib/format';

/** El punto de color por fuente. Es apoyo del texto, nunca su reemplazo. */
const DOT: Record<ClientTimelineEntry['kind'], string> = {
  PAYMENT: 'bg-k-success',
  AGENDA: 'bg-k-periwinkle',
  ACTIVITY: 'bg-k-purple',
};

/**
 * La bitácora: **qué se hizo con esta persona**, de todos sus créditos y en orden.
 *
 * 🔴 **El servidor manda códigos, la pantalla escribe la frase.** La API devuelve `kind` + `code` +
 * `status`; el título en español (o en inglés) se arma acá. Es la misma regla que ordena el resto:
 * a `shared` va la regla, nunca el texto en un idioma.
 *
 * Se muestran las últimas; «Ver todo» lleva a la lista completa paginada.
 */
export async function TimelineSection({
  entries,
  members,
  denied,
  seeAllHref,
}: {
  entries: ClientTimelineEntry[];
  /** Para poner el nombre de quien la registró: la API manda el id, no el nombre. */
  members: Member[];
  /** Sin `client:read` no se pide; sin los permisos de cada fuente, viene incompleta y no se avisa. */
  denied?: boolean;
  /** Con esto se dibuja «Ver todo». Sin él, la bitácora es sólo el resumen (la pantalla completa). */
  seeAllHref?: string;
}) {
  const t = await getTranslations('portfolio');
  const locale = await getLocale();
  const byId = new Map(members.map((m) => [m.userId, memberName(m)]));

  return (
    <section aria-label={t('sections.timeline')}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-k-text-2">{t('sections.timeline')}</h2>
        {/* Sin esto, la bitácora corta en 8 y no hay forma de ver el resto — que es justo lo que se
            necesita para saber TODO lo que se hizo con una persona. */}
        {seeAllHref && entries.length > 0 && (
          <Link href={seeAllHref} className="text-[13px] font-medium text-k-periwinkle hover:underline">
            {t('seeAll')}
          </Link>
        )}
      </div>

      <div className="rounded-2xl border border-k-border bg-white p-4">
        {denied || entries.length === 0 ? (
          <p className="text-[13px] text-k-muted">{t('noTimeline')}</p>
        ) : (
          <ol className="space-y-4">
            {entries.map((e) => (
              <li key={`${e.kind}-${e.id}`} className="relative pl-5">
                <span aria-hidden className={`absolute left-0 top-1.5 h-2 w-2 rounded-full ${DOT[e.kind]}`} />
                <p className="text-[14px] font-medium text-k-text">{title(t, e)}</p>
                {detail(t, e, byId) && <p className="mt-0.5 text-[13px] text-k-text-2">{detail(t, e, byId)}</p>}
                <p className="mt-0.5 text-[12px] text-k-muted">{relativeDate(e.at, locale)}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

/**
 * El título: qué pasó. Sale de la fuente y del código, nunca del servidor.
 *
 * `t` entra como `(k: string) => string` porque las claves se arman con el código que mandó la API
 * (`timeline.agenda.${code}`): no son literales que el tipo pueda conocer de antemano.
 */
function title(t: (k: string) => string, e: ClientTimelineEntry): string {
  if (e.kind === 'PAYMENT') return t('timeline.payment');
  if (e.kind === 'AGENDA') return t(`timeline.agenda.${e.code}`);
  return t(`timeline.activity.${e.code}`);
}

/**
 * La línea de abajo: el monto si fue un pago, la nota si alguien escribió una, y quién.
 *
 * Un pago sin nota igual dice algo (el monto); un agendado sin nota, sólo quién — y eso ya vale,
 * porque saber quién lo hizo es la mitad de una bitácora.
 */
function detail(
  t: (k: string) => string,
  e: ClientTimelineEntry,
  byId: Map<string, string>,
): string {
  const partes: string[] = [];
  if (e.kind === 'PAYMENT' && e.amount != null) partes.push(money(e.amount, e.currency ?? 'BOB'));
  if (e.kind === 'AGENDA' && e.status) partes.push(t(`timeline.status.${e.status}`));
  if (e.notes?.trim()) partes.push(e.notes.trim());
  const quien = e.userId ? byId.get(e.userId) : undefined;
  if (quien) partes.push(quien);
  return partes.join(' · ');
}
