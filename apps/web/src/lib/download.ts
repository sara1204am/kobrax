/**
 * Descarga un texto como archivo, armado en el navegador (sin pasar por el servidor). Lo usan el plan
 * de pagos del alta —el crédito todavía no existe— y el de la ficha.
 */
export function downloadText(content: string, fileName: string, type = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
