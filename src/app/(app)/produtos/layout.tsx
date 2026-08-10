import { requirePermissao } from "@/lib/guard";
import { runWithTenant } from "@/lib/tenant-context";
import { carregarOpcoesFiltro } from "./_query";
import { OpcoesProvider } from "./_opcoes";

/**
 * Guard do módulo: sem a permissão, nem a URL direta abre a tela.
 *
 * As opções dos filtros são carregadas aqui de propósito — layout não
 * re-renderiza a cada mudança de query string, então a listagem filtra sem
 * repetir as consultas de categoria/marca/loja/etiqueta.
 */
export default async function ProdutosLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePermissao("produto.editar");
  const opcoes = await runWithTenant(ctx.tenant.id, () => carregarOpcoesFiltro());

  return <OpcoesProvider valor={opcoes}>{children}</OpcoesProvider>;
}
