import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { emptyWorkspace, type Workspace } from '@kobrax/shared';
import { WorkspaceProvider, useWorkspace } from './workspace';

function Probe() {
  const w = useWorkspace();
  return (
    <p>
      rutas:{String(w.showsModule('routes'))} cartera:{String(w.showsModule('portfolio'))} ingresos:{String(w.shows('client.income'))} modalidad:
      {w.fixed('credit.definition') ?? '-'}
    </p>
  );
}

describe('WorkspaceProvider / useWorkspace', () => {
  it('sin proveedor todo se muestra («Completo»)', () => {
    render(<Probe />);
    expect(screen.getByText(/rutas:true cartera:true ingresos:true modalidad:-/)).toBeInTheDocument();
  });

  it('un proveedor sin workspace (cliente viejo) también es «Completo»', () => {
    render(
      <WorkspaceProvider workspace={undefined}>
        <Probe />
      </WorkspaceProvider>,
    );
    expect(screen.getByText(/rutas:true/)).toBeInTheDocument();
  });

  it('lo oculto se reporta oculto; un troncal siempre visible; las opciones se leen', () => {
    const ws: Workspace = { ...emptyWorkspace(), hiddenModules: ['routes'], options: { 'client.income': false, 'credit.definition': 'agreed_installment' } };
    render(
      <WorkspaceProvider workspace={ws}>
        <Probe />
      </WorkspaceProvider>,
    );
    expect(screen.getByText(/rutas:false cartera:true ingresos:false modalidad:agreed_installment/)).toBeInTheDocument();
  });
});
