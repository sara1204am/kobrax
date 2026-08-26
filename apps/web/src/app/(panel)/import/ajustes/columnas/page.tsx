import { redirect } from 'next/navigation';

/**
 * El emparejado dejó de ser una pantalla aparte: vive dentro de Ajustes, en el paso 3.
 *
 * La ruta se conserva —y no se borra— porque estaba enlazada desde la pantalla de correr y desde
 * los mensajes de error del import (`NO_CODE` manda textualmente a «Ajustes › Emparejar
 * columnas»). Un 404 ahí sería peor que una redirección.
 *
 * Partirlo nunca fue sólo incómodo: **el archivo de muestra vive en el estado de React y no
 * sobrevive a un `router.push`**, así que llegar acá por navegación significaba llegar sin
 * archivo, y sin archivo no hay una sola columna que emparejar.
 */
export default function ImportColumnsPage(): never {
  redirect('/import/ajustes');
}
