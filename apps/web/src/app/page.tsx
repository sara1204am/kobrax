import { redirect } from 'next/navigation';

/** El landing redirige al dashboard; el middleware decide login si no hay sesión. */
export default function Home() {
  redirect('/dashboard');
}
