import type { WidgetType } from '@kobrax/shared';

/**
 * Miniatura esquemática de cómo se verá un widget, para el selector «Añadir widget».
 *
 * Es un esqueleto dibujado a mano (SVG con los tokens `k-*`), no el widget real: el real pide datos y
 * montaría gráficos y un mapa por cada tarjeta del catálogo. Decorativo: `aria-hidden`.
 */
export function WidgetPreview({ type, strip }: { type: WidgetType; strip?: boolean }) {
  return (
    <svg
      viewBox="0 0 120 56"
      aria-hidden="true"
      className="h-14 w-full rounded-lg bg-k-bg"
      preserveAspectRatio="xMidYMid meet"
    >
      <g className="text-k-light-bg" fill="currentColor">
        {shapes(type, strip)}
      </g>
    </svg>
  );
}

const ACCENT = 'fill-k-purple';
const SOFT = 'fill-k-periwinkle';

function shapes(type: WidgetType, strip?: boolean) {
  if (type === 'kpi' && strip) {
    return [8, 36, 64, 92].map((x) => (
      <g key={x}>
        <rect x={x} y="14" width="24" height="28" rx="4" />
        <rect x={x + 4} y="20" width="10" height="3" rx="1.5" className={SOFT} />
        <rect x={x + 4} y="28" width="16" height="6" rx="2" className={ACCENT} />
      </g>
    ));
  }
  switch (type) {
    case 'kpi':
      return (
        <>
          <rect x="30" y="8" width="60" height="40" rx="6" />
          <rect x="38" y="16" width="26" height="4" rx="2" className={SOFT} />
          <rect x="38" y="26" width="40" height="12" rx="3" className={ACCENT} />
        </>
      );
    case 'donut_chart':
      return (
        <>
          <circle cx="60" cy="28" r="18" fill="none" strokeWidth="8" className="stroke-k-light-bg" />
          <circle cx="60" cy="28" r="18" fill="none" strokeWidth="8" strokeDasharray="42 71" className="stroke-k-purple" transform="rotate(-90 60 28)" />
          <circle cx="60" cy="28" r="18" fill="none" strokeWidth="8" strokeDasharray="26 87" strokeDashoffset="-42" className="stroke-k-periwinkle" transform="rotate(-90 60 28)" />
        </>
      );
    case 'bar_chart':
      return [14, 30, 46, 62, 78, 94].map((x, i) => {
        const h = [14, 30, 22, 36, 18, 10][i]!;
        return <rect key={x} x={x} y={48 - h} width="12" height={h} rx="2" className={i % 2 ? SOFT : ACCENT} />;
      });
    case 'line_chart':
      return (
        <>
          <path d="M8 40 L30 30 L52 34 L74 18 L96 22 L112 10" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="stroke-k-purple" />
          <path d="M8 46 L30 42 L52 44 L74 36 L96 38 L112 30" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="stroke-k-periwinkle" />
        </>
      );
    case 'table':
      return (
        <>
          <rect x="10" y="8" width="100" height="8" rx="2" className={ACCENT} />
          {[20, 29, 38, 47].map((y) => (
            <rect key={y} x="10" y={y} width="100" height="6" rx="2" />
          ))}
        </>
      );
    case 'list':
      return [10, 22, 34].map((y) => (
        <g key={y}>
          <circle cx="16" cy={y + 4} r="4" className={ACCENT} />
          <rect x="26" y={y} width="70" height="3.5" rx="1.75" className={SOFT} />
          <rect x="26" y={y + 5} width="44" height="3" rx="1.5" />
        </g>
      ));
    case 'map':
      return (
        <>
          <rect x="8" y="6" width="104" height="44" rx="6" />
          <path d="M20 40 Q44 14 64 30 T104 16" fill="none" strokeWidth="2" strokeDasharray="3 3" className="stroke-k-periwinkle" />
          {[[24, 36], [48, 24], [70, 32], [100, 18]].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="4" className={ACCENT} />
          ))}
        </>
      );
    case 'calendar':
      return (
        <>
          <rect x="10" y="6" width="100" height="10" rx="3" className={ACCENT} />
          {[0, 1, 2].map((r) =>
            [0, 1, 2, 3, 4].map((c) => (
              <rect key={`${r}-${c}`} x={12 + c * 20} y={20 + r * 10} width="16" height="7" rx="2" className={r === 1 && c === 2 ? SOFT : undefined} />
            )),
          )}
        </>
      );
    default:
      return <rect x="30" y="14" width="60" height="28" rx="6" />;
  }
}
