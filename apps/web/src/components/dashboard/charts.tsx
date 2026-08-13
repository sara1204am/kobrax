/**
 * Los gráficos del dashboard, en SVG plano.
 *
 * **Sin librería de charts**, y no por ahorrar una dependencia: una dona, unas barras y una línea
 * son ~40 líneas de SVG cada una, se pintan **en el servidor** —no viajan como JavaScript— y usan
 * los tokens de la marca sin pelearse con el tema de nadie. Lo que una librería sí regala son
 * tooltips ricos y ejes automáticos; acá el tooltip es el `<title>` nativo del SVG, que el
 * navegador ya sabe mostrar, y los ejes son tres rótulos.
 *
 * El día que haga falta zoom, brush o cruceta, se cambia UN widget: por eso cada gráfico recibe
 * datos ya formateados y no sabe de dónde salieron.
 */

/** Una porción o una barra: su rótulo, su valor y el texto que se muestra al pasar el mouse. */
export interface Slice {
  key: string;
  label: string;
  value: number;
  /** Ya formateado por quien llama: el gráfico no sabe de monedas ni de idiomas. */
  display: string;
  color: string;
}

const GAP = 2;

/**
 * Dona con hueco.
 *
 * Las porciones se dibujan con `stroke-dasharray` sobre un único círculo: es la forma más corta de
 * hacer una dona en SVG sin calcular arcos. El hueco de 2 px entre porciones no es decoración —
 * separa dos colores contiguos cuando alguien no distingue el matiz.
 */
export function Donut({
  slices,
  size = 148,
  thickness = 22,
  center,
  caption,
}: {
  slices: Slice[];
  size?: number;
  thickness?: number;
  center?: string;
  caption?: string;
}) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;

  if (total <= 0) return null;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={caption}>
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        {slices.map((s) => {
          const len = (s.value / total) * c;
          const dash = Math.max(0, len - GAP);
          const el = (
            <circle
              key={s.key}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-offset}
            >
              <title>{`${s.label}: ${s.display}`}</title>
            </circle>
          );
          offset += len;
          return el;
        })}
      </g>
      {center && (
        <text
          x={size / 2}
          y={size / 2 + 5}
          textAnchor="middle"
          className="fill-k-navy text-[15px] font-semibold"
        >
          {center}
        </text>
      )}
    </svg>
  );
}

/** La leyenda. **Siempre**: con dos series o más, el color no puede ser lo único que identifica. */
export function Legend({ slices }: { slices: Slice[] }) {
  return (
    <ul className="min-w-0 flex-1 space-y-1.5">
      {slices.map((s) => (
        <li key={s.key} className="flex items-baseline gap-2 text-[12px]">
          <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: s.color }} aria-hidden />
          <span className="min-w-0 flex-1 truncate text-k-text-2">{s.label}</span>
          <span className="shrink-0 font-medium tabular-nums text-k-text">{s.display}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Barras verticales.
 *
 * Arrancan en la base y llevan la punta redondeada de 4 px. La escala es el máximo de la serie:
 * un eje que empezara arriba de cero exageraría las diferencias, que es la mentira más común de un
 * gráfico de barras.
 */
export function Bars({ slices, height = 132 }: { slices: Slice[]; height?: number }) {
  const max = Math.max(...slices.map((s) => s.value), 1);

  return (
    <div className="flex items-end gap-2" style={{ height }}>
      {slices.map((s) => (
        <div key={s.key} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
          <span className="text-[10px] tabular-nums text-k-text-2">{s.value > 0 ? s.display : ''}</span>
          <div
            className="w-full rounded-t"
            style={{ backgroundColor: s.color, height: `${Math.max(2, (s.value / max) * (height - 34))}px` }}
            title={`${s.label}: ${s.display}`}
          />
          <span className="w-full truncate text-center text-[10px] text-k-muted">{s.label}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Una serie en el tiempo.
 *
 * 🔴 **Una sola magnitud por gráfico.** El boceto tenía saldo y recaudación en el mismo dibujo con
 * dos ejes verticales: con 13 millones de un lado y 300 mil del otro, las dos curvas se pueden
 * hacer cruzar donde uno quiera cambiando la escala. Son dos gráficos apilados que comparten el eje
 * del tiempo, que dice lo mismo sin poder mentir.
 */
export function LineChart({
  points,
  color,
  height = 96,
  label,
}: {
  points: { x: string; y: number; display: string }[];
  color: string;
  height?: number;
  label: string;
}) {
  if (points.length < 2) return null;
  const width = 100;
  const max = Math.max(...points.map((p) => p.y), 1);
  const min = Math.min(...points.map((p) => p.y), 0);
  const span = max - min || 1;
  const x = (i: number): number => (i / (points.length - 1)) * width;
  const y = (v: number): number => height - ((v - min) / span) * (height - 12) - 6;

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(2)} ${y(p.y).toFixed(2)}`).join(' ');
  const area = `${line} L ${width} ${height} L 0 ${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height }}
      role="img"
      aria-label={label}
    >
      <path d={area} fill={color} opacity={0.12} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* Un punto por dato con su `<title>`: es el tooltip sin una línea de JavaScript. Los puntos
          son transparentes salvo el hover, para no ensuciar la curva. */}
      {points.map((p, i) => (
        <circle key={p.x} cx={x(i)} cy={y(p.y)} r={3} fill={color} opacity={0} className="hover:opacity-100">
          <title>{`${p.x}: ${p.display}`}</title>
        </circle>
      ))}
    </svg>
  );
}
