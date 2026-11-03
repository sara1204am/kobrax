import { redirect } from 'next/navigation';

/** `/cuenta` no es una pantalla: cae en la primera pestaña, que todo el que lee la cuenta puede abrir. */
export default function CuentaPage() {
  redirect('/cuenta/general');
}
