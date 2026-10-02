import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExportButtons } from './export-buttons';

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('sort=daysPastDue&dir=desc&page=1&branchId=b1'),
}));
vi.mock('@/components/toast', () => ({ useToast: () => toast }));

const fetchMock = vi.fn();

beforeEach(() => {
  toast.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
});

describe('ExportButtons', () => {
  it('baja lo que se está viendo: filtros y orden viajan, la página no', async () => {
    fetchMock.mockResolvedValue(new Response('a,b', { headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="x.csv"' } }));
    render(<ExportButtons />);
    await userEvent.click(screen.getByRole('button', { name: /CSV/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = new URL(String(fetchMock.mock.calls[0][0]), 'http://x');
    expect(url.pathname).toBe('/api/mora/export');
    expect(url.searchParams.get('format')).toBe('csv');
    expect(url.searchParams.get('sort')).toBe('daysPastDue');
    expect(url.searchParams.get('branchId')).toBe('b1');
    expect(url.searchParams.has('page')).toBe(false);
    expect(toast).not.toHaveBeenCalled();
  });

  it('un error de la API se muestra con su mensaje', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Demasiados créditos' } }), { status: 422 }));
    render(<ExportButtons />);
    await userEvent.click(screen.getByRole('button', { name: /PDF/i }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Demasiados créditos', 'danger'));
  });
});
