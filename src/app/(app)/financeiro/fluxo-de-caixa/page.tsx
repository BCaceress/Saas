import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { projetarFluxoCaixa } from "@/lib/financeiro/fluxo-caixa";
import { FluxoCaixaView } from "./_client";

// Fluxo de caixa projetado. A única tela do módulo que lê as duas pontas na
// mesma linha do tempo — é o que responde "dia 10 eu tenho dinheiro?".

type Params = Promise<{ dias?: string; saldo?: string }>;

export default async function FluxoDeCaixaPage({ searchParams }: { searchParams: Params }) {
  const ctx = await requireActiveTenant();
  const sp = await searchParams;

  const dias = [15, 30, 60, 90].includes(Number(sp.dias)) ? Number(sp.dias) : 30;
  const saldoInicial = Number(String(sp.saldo ?? "").replace(",", ".")) || 0;

  const fluxo = await withTenant(ctx, () => projetarFluxoCaixa({ dias, saldoInicial }));

  return <FluxoCaixaView fluxo={fluxo} dias={dias} saldoInicial={saldoInicial} />;
}
