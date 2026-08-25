import PDFDocument from 'pdfkit';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Los tokens de marca, los mismos de `packages/shared/src/design/tokens.ts`. Se repiten acá porque
 * `shared` no se importa desde un generador de PDF por seis colores — pero si la marca cambia,
 * cambian los dos lados.
 */
export const C = {
  navy: '#1A3A52',
  slate: '#2B5A7D',
  periwinkle: '#5B7DBE',
  purple: '#7B68D6',
  text: '#1A2B3E',
  text2: '#5B7795',
  muted: '#8FA3B8',
  border: '#D8E5F2',
  bg: '#F8F9FB',
  lightBg: '#EDF3FA',
  success: '#27AE60',
  danger: '#DC3545',
  warning: '#B7791F',
  white: '#FFFFFF',
} as const;

const MARGIN = 40;
const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const CONTENT_W = PAGE_W - MARGIN * 2;
/** Alto de la banda de marca. El contenido de cada página nueva arranca debajo. */
const HEADER_H = 74;
const FOOTER_H = 34;

/** El logo va embebido; si falta el archivo el reporte sale igual, con el monograma dibujado. */
function logoPath(): string | null {
  const p = join(process.cwd(), 'assets', 'logo.png');
  return existsSync(p) ? p : null;
}

export interface ReportMeta {
  /** Lo que el reporte ES: «Hoja de ruta», «Legajo de cliente». */
  title: string;
  /** De quién/qué: el nombre del cliente, el cobrador y la fecha de la ruta. */
  subtitle?: string;
  /** La empresa que lo emite — sale en la banda y en el pie de cada página. */
  accountName: string;
  /** Para el formato de plata. */
  currency?: string;
  locale?: string;
}

/**
 * Un reporte de Kobrax: banda de marca, cuerpo y pie numerado en todas las páginas.
 *
 * `bufferPages` es lo que permite escribir «Página 2 de 5»: sin él no se sabe cuántas hay hasta
 * terminar, y para entonces las primeras ya se emitieron. Con el buffer se vuelve sobre cada una
 * al final y recién ahí se pinta el pie.
 */
export class Report {
  readonly doc: PDFKit.PDFDocument;
  private readonly meta: ReportMeta;
  private readonly money: Intl.NumberFormat;

  constructor(meta: ReportMeta) {
    this.meta = meta;
    this.doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
    this.money = new Intl.NumberFormat(meta.locale ?? 'es-BO', {
      style: 'currency',
      currency: meta.currency ?? 'BOB',
      minimumFractionDigits: 2,
    });

    // El margen superior deja lugar a la banda; el inferior, al pie.
    this.doc.page.margins.top = HEADER_H + 24;
    this.doc.page.margins.bottom = FOOTER_H + 16;
    this.drawHeader();
    this.doc.y = HEADER_H + 24;

    // Cada salto de página repinta la banda: un reporte de 5 hojas no puede tener 4 anónimas.
    this.doc.on('pageAdded', () => {
      this.doc.page.margins.top = HEADER_H + 24;
      this.doc.page.margins.bottom = FOOTER_H + 16;
      this.drawHeader();
      this.doc.y = HEADER_H + 24;
    });
  }

  fmtMoney(n: number): string {
    return this.money.format(n);
  }

  private drawHeader(): void {
    const d = this.doc;
    d.save();
    d.rect(0, 0, PAGE_W, HEADER_H).fill(C.navy);
    // Filo de acento al pie de la banda: separa sin una línea gris más.
    d.rect(0, HEADER_H - 3, PAGE_W, 3).fill(C.purple);

    const logo = logoPath();
    if (logo) {
      d.image(logo, MARGIN, 17, { width: 40, height: 40 });
    } else {
      d.roundedRect(MARGIN, 17, 40, 40, 9).fill(C.slate);
      d.fillColor(C.white).font('Helvetica-Bold').fontSize(20).text('K', MARGIN, 28, { width: 40, align: 'center' });
    }

    const x = MARGIN + 54;
    d.fillColor(C.white).font('Helvetica-Bold').fontSize(15).text(this.meta.title, x, 22, { width: 300, lineBreak: false });
    d.fillColor('#A9C4DE').font('Helvetica').fontSize(9);
    if (this.meta.subtitle) d.text(this.meta.subtitle, x, 41, { width: 300, lineBreak: false });

    // A la derecha, quién lo emite y cuándo: los dos datos que hacen que la hoja valga sola.
    const emitted = new Date().toLocaleString(this.meta.locale ?? 'es-BO', { dateStyle: 'medium', timeStyle: 'short' });
    d.fillColor(C.white).font('Helvetica-Bold').fontSize(9.5).text(this.meta.accountName, PAGE_W - MARGIN - 220, 24, {
      width: 220,
      align: 'right',
      lineBreak: false,
    });
    d.fillColor('#A9C4DE').font('Helvetica').fontSize(8).text(`Emitido ${emitted}`, PAGE_W - MARGIN - 220, 40, {
      width: 220,
      align: 'right',
      lineBreak: false,
    });
    d.restore();
  }

  /** Título de sección con su filo de color: ordena la lectura sin recuadrar todo. */
  section(title: string): this {
    const d = this.doc;
    this.ensureRoom(40);
    const y = d.y + 8;
    d.save();
    d.rect(MARGIN, y, 3, 13).fill(C.purple);
    d.fillColor(C.navy).font('Helvetica-Bold').fontSize(11.5).text(title.toUpperCase(), MARGIN + 10, y + 1, {
      characterSpacing: 0.6,
    });
    d.restore();
    d.y = y + 22;
    return this;
  }

  /**
   * La fila de cifras del encabezado. Es lo que se mira primero y por eso va en tarjetas: el número
   * grande en navy, el rótulo chico arriba, y el color sólo en el filo inferior — nunca en la cifra,
   * que a 18 px sobre estos tintes queda por debajo del contraste mínimo.
   */
  kpis(items: { label: string; value: string; tone?: keyof typeof KPI_TONES }[]): this {
    if (items.length === 0) return this;
    const d = this.doc;
    this.ensureRoom(70);
    const gap = 10;
    const w = (CONTENT_W - gap * (items.length - 1)) / items.length;
    const y = d.y;
    const h = 54;

    items.forEach((item, i) => {
      const x = MARGIN + i * (w + gap);
      const tone = KPI_TONES[item.tone ?? 'neutral'];
      d.save();
      d.roundedRect(x, y, w, h, 6).fill(tone.bg);
      d.rect(x, y + h - 3, w, 3).fill(tone.edge);
      d.fillColor(C.slate).font('Helvetica-Bold').fontSize(7).text(item.label.toUpperCase(), x + 10, y + 10, {
        width: w - 20,
        characterSpacing: 0.5,
        lineBreak: false,
      });
      d.fillColor(C.navy).font('Helvetica-Bold').fontSize(15).text(item.value, x + 10, y + 24, {
        width: w - 20,
        lineBreak: false,
      });
      d.restore();
    });

    d.y = y + h + 16;
    return this;
  }

  /**
   * Pares dato/valor en dos columnas. Para la identificación de una ficha: es lectura, no tabla,
   * y una tabla de dos columnas con cabecera para «Documento: 1234» es ruido.
   */
  facts(rows: { label: string; value: string }[], columns = 2): this {
    const d = this.doc;
    const colW = CONTENT_W / columns;
    const rowH = 26;

    rows.forEach((r, i) => {
      const col = i % columns;
      if (col === 0) this.ensureRoom(rowH);
      const y = d.y;
      const x = MARGIN + col * colW;
      d.fillColor(C.muted).font('Helvetica').fontSize(7.5).text(r.label.toUpperCase(), x, y, {
        width: colW - 12,
        characterSpacing: 0.4,
        lineBreak: false,
      });
      d.fillColor(C.text).font('Helvetica-Bold').fontSize(10).text(r.value || '—', x, y + 10, {
        width: colW - 12,
        lineBreak: false,
      });
      // La `y` sólo avanza al cerrar la fila, para que las dos columnas queden alineadas.
      if (col === columns - 1 || i === rows.length - 1) d.y = y + rowH;
      else d.y = y;
    });

    d.y += 6;
    return this;
  }

  /**
   * Una tabla. `width` es proporción, no puntos: así las columnas se reparten el ancho útil y
   * cambiar el margen no obliga a recalcular cada número a mano.
   *
   * La cabecera se repite en cada página nueva — una tabla de 4 hojas con la cabecera sólo en la
   * primera obliga a volver atrás para saber qué columna se está leyendo.
   */
  table<T>(
    columns: TableColumn<T>[],
    rows: T[],
    opts: { empty?: string } = {},
  ): this {
    const d = this.doc;
    if (rows.length === 0) {
      this.ensureRoom(30);
      d.fillColor(C.muted).font('Helvetica-Oblique').fontSize(9.5).text(opts.empty ?? 'Sin datos', MARGIN, d.y);
      d.y += 20;
      return this;
    }

    const totalUnits = columns.reduce((s, c) => s + c.width, 0);
    const widths = columns.map((c) => (c.width / totalUnits) * CONTENT_W);
    const drawHead = () => {
      const y = d.y;
      d.save();
      d.rect(MARGIN, y, CONTENT_W, 20).fill(C.navy);
      let x = MARGIN;
      columns.forEach((c, i) => {
        d.fillColor(C.white).font('Helvetica-Bold').fontSize(7.5).text(c.header.toUpperCase(), x + 7, y + 6.5, {
          width: widths[i]! - 14,
          align: c.align ?? 'left',
          characterSpacing: 0.4,
          lineBreak: false,
        });
        x += widths[i]!;
      });
      d.restore();
      d.y = y + 20;
    };

    this.ensureRoom(20 + 22);
    drawHead();

    rows.forEach((row, ri) => {
      const cells = columns.map((c) => c.value(row));
      // El alto lo manda la celda más alta: una dirección larga no puede pisar la fila siguiente.
      const h = Math.max(
        20,
        ...cells.map((text, i) => {
          d.font('Helvetica').fontSize(8.5);
          return d.heightOfString(text || '—', { width: widths[i]! - 14 }) + 11;
        }),
      );

      if (!this.roomFor(h)) {
        d.addPage();
        drawHead();
      }

      const y = d.y;
      d.save();
      if (ri % 2 === 1) d.rect(MARGIN, y, CONTENT_W, h).fill(C.bg);
      let x = MARGIN;
      columns.forEach((c, i) => {
        const tone = c.tone?.(row);
        d.fillColor(tone ?? C.text)
          .font(c.strong ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(8.5)
          .text(cells[i] || '—', x + 7, y + 6, { width: widths[i]! - 14, align: c.align ?? 'left' });
        x += widths[i]!;
      });
      // Línea fina de separación, no una grilla completa: la grilla compite con los datos.
      d.moveTo(MARGIN, y + h).lineTo(MARGIN + CONTENT_W, y + h).lineWidth(0.5).stroke(C.border);
      d.restore();
      d.y = y + h;
    });

    d.y += 12;
    return this;
  }

  /** Una lista simple con viñeta, para lo que no merece tabla (garantías, referencias). */
  bullets(items: string[], empty = 'Sin datos'): this {
    const d = this.doc;
    if (items.length === 0) {
      this.ensureRoom(24);
      d.fillColor(C.muted).font('Helvetica-Oblique').fontSize(9.5).text(empty, MARGIN, d.y);
      d.y += 20;
      return this;
    }
    items.forEach((item) => {
      d.font('Helvetica').fontSize(9);
      const h = d.heightOfString(item, { width: CONTENT_W - 16 }) + 6;
      this.ensureRoom(h);
      const y = d.y;
      d.save();
      d.circle(MARGIN + 3, y + 5, 2).fill(C.periwinkle);
      d.fillColor(C.text).font('Helvetica').fontSize(9).text(item, MARGIN + 14, y, { width: CONTENT_W - 16 });
      d.restore();
      d.y = y + h;
    });
    d.y += 8;
    return this;
  }

  /** Nota al pie de una sección: contexto que no es un dato. */
  note(text: string): this {
    const d = this.doc;
    this.ensureRoom(24);
    d.fillColor(C.muted).font('Helvetica-Oblique').fontSize(8).text(text, MARGIN, d.y, { width: CONTENT_W });
    d.y += 14;
    return this;
  }

  private roomFor(h: number): boolean {
    return this.doc.y + h <= PAGE_H - this.doc.page.margins.bottom;
  }

  private ensureRoom(h: number): void {
    if (!this.roomFor(h)) this.doc.addPage();
  }

  /** Cierra el documento y devuelve el archivo, con el pie numerado ya escrito en cada página. */
  finish(): Promise<Buffer> {
    const d = this.doc;
    const chunks: Buffer[] = [];
    const done = new Promise<Buffer>((resolve, reject) => {
      d.on('data', (c: Buffer) => chunks.push(c));
      d.on('end', () => resolve(Buffer.concat(chunks)));
      d.on('error', reject);
    });

    const range = d.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      d.switchToPage(range.start + i);
      /*
       * 🔴 El pie se escribe **por debajo del margen inferior**, y para pdfkit eso es «se acabó la
       * página»: agregaba una hoja nueva por cada línea del pie. Un reporte de una página salía con
       * tres, dos de ellas vacías salvo la banda, y el contador quedaba en «Página 1 de 1» porque
       * `bufferedPageRange()` ya se había leído antes de que nacieran. Bajar el margen a cero para
       * esta escritura es lo que deja poner tinta en esa franja.
       */
      d.page.margins.bottom = 0;
      const y = PAGE_H - FOOTER_H;
      d.save();
      d.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).lineWidth(0.5).stroke(C.border);
      d.fillColor(C.muted).font('Helvetica').fontSize(7.5);
      d.text(`${this.meta.accountName} · Kobrax`, MARGIN, y + 9, { width: CONTENT_W / 2, lineBreak: false });
      d.text(`Página ${i + 1} de ${range.count}`, MARGIN + CONTENT_W / 2, y + 9, {
        width: CONTENT_W / 2,
        align: 'right',
        lineBreak: false,
      });
      d.restore();
    }

    d.end();
    return done;
  }
}

const KPI_TONES = {
  neutral: { bg: C.lightBg, edge: C.periwinkle },
  money: { bg: '#E8F8F0', edge: C.success },
  warn: { bg: '#FFF3CD', edge: C.warning },
  danger: { bg: '#FCE8E8', edge: C.danger },
  accent: { bg: '#F0ECFF', edge: C.purple },
} as const;

export interface TableColumn<T> {
  header: string;
  /** Proporción del ancho útil, no puntos. */
  width: number;
  value: (row: T) => string;
  align?: 'left' | 'right' | 'center';
  strong?: boolean;
  /** Color del texto según la fila — para la mora, el estado, el saldo. */
  tone?: (row: T) => string | undefined;
}

/** El color de la mora: verde al día, ámbar temprana, rojo de verdad. */
export function arrearsTone(days: number): string {
  if (days <= 0) return C.success;
  if (days <= 30) return C.warning;
  return C.danger;
}
