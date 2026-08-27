"use server";

import { requireActiveTenant } from "@/lib/current-tenant";
import { podeEmAlguma, SemPermissaoError } from "@/lib/permissoes";
import { runWithTenant } from "@/lib/tenant-context";
import { loadItensDoRecebimento, type ItemRecebido } from "./_lista";

// Leitura sob demanda da listagem de Recebimentos. Os itens de cada
// recebimento só são buscados quando alguém abre a linha — carregá-los junto
// com a página seria ler o mês inteiro de compras para desenhar uma tabela
// que mostra 25 linhas.

export async function itensDoRecebimentoAction(receiptId: string): Promise<ItemRecebido[]> {
  const ctx = await requireActiveTenant();
  if (!podeEmAlguma(ctx.acessos, "compras.receber")) throw new SemPermissaoError();
  return runWithTenant(ctx.tenant.id, () => loadItensDoRecebimento(receiptId));
}
