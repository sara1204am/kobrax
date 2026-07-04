'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { postJson } from '@/lib/client';

export function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function logout() {
    setLoading(true);
    await postJson('/api/auth/logout', {});
    router.replace('/login');
  }

  return (
    <button
      onClick={logout}
      disabled={loading}
      className="rounded-[8px] border border-white/20 px-3 py-1.5 text-[13px] font-medium text-white/90 transition-colors hover:bg-white/10 disabled:opacity-50"
    >
      {loading ? 'Saliendo…' : 'Cerrar sesión'}
    </button>
  );
}
