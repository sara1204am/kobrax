/**
 * Los colores de los gráficos, **medidos y no elegidos a ojo**.
 *
 * Se validaron con el script del skill de visualización, que mide separación en OKLab simulando
 * daltonismo. Lo que salió de ahí:
 *
 * - 🔴 **Periwinkle + púrpura (los dos azules de la marca) NO se pueden usar juntos**: ΔE 4.9 en
 *   deuteranopía y 8.1 con visión normal —el piso es 15—. En la dona de agenda, un daltónico no
 *   distinguía «visitas» de «llamadas», y con visión normal costaba igual.
 * - ✅ **Periwinkle + verde de marca**: ΔE 19.3 en deuteranopía, 23.2 con visión normal. Es el par
 *   que se usa, y además es el que ya tenía el boceto.
 * - El verde queda por debajo de 3:1 contra el blanco, así que **la leyenda con su valor no es
 *   opcional**: es el relieve que compensa el contraste bajo.
 */

/**
 * La mora es una **rampa secuencial**, no seis categorías: 1-30 y >450 no son dos cosas distintas,
 * son la misma cosa peor. Por eso un solo tono de la marca de claro a oscuro, y por eso el orden
 * importa. Un arcoíris acá haría que «31-90» y «361-450» se vean igual de graves.
 */
export const AGING_COLORS: Record<string, string> = {
  D1_30: '#A8C4E0',
  D31_90: '#7BA3CE',
  D91_180: '#5B7DBE',
  D181_360: '#3F6FA5',
  D361_450: '#2B5A7D',
  D450_PLUS: '#1A3A52',
};

/** Los tipos de agendado. Sólo dos son categorías de verdad; el resto comparte la escala fría. */
export const AGENDA_COLORS: Record<string, string> = {
  VISIT: '#27AE60',
  CALL: '#5B7DBE',
  WHATSAPP: '#7BA3CE',
  REMINDER: '#A8C4E0',
  PROMISE_TO_PAY: '#2B5A7D',
};

/** La serie de plata y la de trabajo, cada una en su propio gráfico (nunca dos ejes). */
export const TREND_COLORS = { outstanding: '#5B7DBE', collected: '#27AE60' };
