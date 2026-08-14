import { requirePermissao } from "@/lib/guard";
import { carregarOpcoesFiltro } from "./_query";
import { OpcoesProvider } from "./_opcoes";

/**
 * Guard do módulo: sem a permissão, nem a URL direta abre a tela.
 *
 * As opções dos filtros são carregadas aqui de propósito — layout não
 * re-renderiza a cada mudança de query string, então a listagem filtra sem
 * repetir as consultas de categoria/marca/loja/etiqueta.
 *
 * Sem `runWithTenant` em volta: a consulta é cacheada e abre o próprio contexto
 * a partir do tenantId que recebe (ver `carregarOpcoesFiltro`).
 */
export default async function ProdutosLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePermissao("produto.editar");
  const opcoes = await carregarOpcoesFiltro(ctx.tenant.id);

  return <OpcoesProvider valor={opcoes}>{children}</OpcoesProvider>;
}
