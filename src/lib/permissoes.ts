import { z } from "zod";
import type { Perfil } from "@/generated/prisma";

// ============================================================
// Permissões — o papel de uma pessoa é a UNIÃO dos seus acessos.
// Cada acesso é um perfil, opcionalmente restrito a uma loja (siteId).
// ADMINISTRADOR é sempre global (siteId null) e concentra o que antes era
// proprietário + administrador + gerente de loja.
// ============================================================

/** Ação verificável. Nomeada por domínio.ação, em português. */
export type Permissao =
  // Configurações e equipe
  | "config.gerenciar"
  // Catálogo
  | "produto.ver"
  | "produto.editar"
  | "produto.preco"
  | "produto.custo"
  // Estoque
  | "estoque.ver"
  | "estoque.ajustar"
  | "estoque.inventario"
  | "estoque.transferir"
  // Compras
  | "compras.ver"
  | "compras.pedir"
  | "compras.receber"
  // Fornecedores
  | "fornecedor.ver"
  | "fornecedor.editar"
  // Venda / PDV
  | "venda.registrar"
  | "venda.cancelar"
  | "venda.desconto"
  // Caixa
  | "caixa.abrir"
  | "caixa.fechar"
  | "caixa.sangria"
  // Clientes
  | "cliente.ver"
  | "cliente.editar"
  // Relatórios
  | "relatorio.ver"
  | "relatorio.financeiro"
  | "relatorio.exportar"
  // Fiscal — separadas de propósito: emitir é rotina de caixa, cancelar e
  // mexer em certificado/dados fiscais é coisa de quem responde pela empresa.
  | "fiscal.ver"
  | "fiscal.emitir"
  | "fiscal.cancelar"
  | "fiscal.corrigir" // carta de correção e inutilização
  | "fiscal.importar" // XML de fornecedor
  | "fiscal.baixar" // XML/DANFE — o contador vive disso
  | "fiscal.configurar"; // certificado, série, CSC, provedor

const TODAS: readonly Permissao[] = [
  "config.gerenciar",
  "produto.ver",
  "produto.editar",
  "produto.preco",
  "produto.custo",
  "estoque.ver",
  "estoque.ajustar",
  "estoque.inventario",
  "estoque.transferir",
  "compras.ver",
  "compras.pedir",
  "compras.receber",
  "fornecedor.ver",
  "fornecedor.editar",
  "venda.registrar",
  "venda.cancelar",
  "venda.desconto",
  "caixa.abrir",
  "caixa.fechar",
  "caixa.sangria",
  "cliente.ver",
  "cliente.editar",
  "relatorio.ver",
  "relatorio.financeiro",
  "relatorio.exportar",
  "fiscal.ver",
  "fiscal.emitir",
  "fiscal.cancelar",
  "fiscal.corrigir",
  "fiscal.importar",
  "fiscal.baixar",
  "fiscal.configurar",
];

/** O que cada perfil pode. Fonte única de verdade. */
export const MATRIZ: Record<Perfil, readonly Permissao[]> = {
  ADMINISTRADOR: TODAS,

  ESTOQUISTA: [
    "produto.ver",
    "estoque.ver",
    "estoque.ajustar",
    "estoque.inventario",
    "estoque.transferir",
    "compras.ver",
    "compras.receber",
    "fornecedor.ver",
    // Entrada por XML é recebimento de mercadoria — quem confere, importa.
    "fiscal.ver",
    "fiscal.importar",
  ],

  CAIXA: [
    // Consulta de produto acontece dentro do PDV; o módulo Estoque e o cadastro
    // de produtos são de quem cuida deles.
    "produto.ver",
    "venda.registrar",
    // Descartar venda da fila do autoatendimento é rotina do caixa. Se um dia
    // virar controle antifraude, tire daqui — o guard já está no lugar.
    "venda.cancelar",
    "caixa.abrir",
    "caixa.fechar",
    "caixa.sangria",
    "cliente.ver",
    "cliente.editar",
    // Emitir o cupom faz parte de fechar a venda. Cancelar nota, não: é
    // irreversível e some do faturamento — fica com o administrador.
    "fiscal.emitir",
  ],

  FINANCEIRO: [
    "produto.ver",
    "produto.custo",
    "compras.ver",
    "compras.pedir",
    "fornecedor.ver",
    "fornecedor.editar",
    "cliente.ver",
    "relatorio.ver",
    "relatorio.financeiro",
    "relatorio.exportar",
    "fiscal.ver",
    "fiscal.importar",
    "fiscal.baixar",
  ],

  CONTADOR: [
    "produto.ver",
    "relatorio.ver",
    "relatorio.exportar",
    "fiscal.ver",
    "fiscal.baixar",
  ],
};

/** Um acesso concedido. `siteId` null = vale para todas as lojas. */
export type Acesso = { perfil: Perfil; siteId: string | null };

export const PERFIL_LABEL: Record<Perfil, string> = {
  ADMINISTRADOR: "Administrador",
  ESTOQUISTA: "Estoquista",
  CAIXA: "Operador de caixa",
  FINANCEIRO: "Financeiro",
  CONTADOR: "Contador",
};

export const PERFIL_DESCRICAO: Record<Perfil, string> = {
  ADMINISTRADOR: "Acesso total: configurações, equipe, preços, custos e todas as lojas.",
  ESTOQUISTA: "Contagem, recebimento, ajuste e transferência de estoque.",
  CAIXA: "Abre e fecha caixa, registra vendas e sangrias.",
  FINANCEIRO: "Compras, fornecedores, custos e relatórios financeiros.",
  CONTADOR: "Somente leitura: relatórios e dados fiscais para exportação.",
};

/** Ordem de exibição na tela de usuários. */
export const PERFIS: readonly Perfil[] = [
  "ADMINISTRADOR",
  "ESTOQUISTA",
  "CAIXA",
  "FINANCEIRO",
  "CONTADOR",
];

/** ADMINISTRADOR vale para o tenant inteiro — nunca é preso a uma loja. */
export function perfilEhGlobal(perfil: Perfil): boolean {
  return perfil === "ADMINISTRADOR";
}

export function isAdmin(acessos: Acesso[]): boolean {
  return acessos.some((a) => a.perfil === "ADMINISTRADOR");
}

/**
 * Pode fazer `permissao` NA loja `siteId`?
 * `siteId` é obrigatório de propósito: sem ele não dá para saber o escopo, e o
 * default silencioso seria inseguro. Para gating de menu use `podeEmAlguma`.
 */
export function can(acessos: Acesso[], permissao: Permissao, siteId: string): boolean {
  return acessos.some(
    (a) =>
      (a.siteId === null || a.siteId === siteId) &&
      MATRIZ[a.perfil].includes(permissao),
  );
}

/** Pode fazer `permissao` em pelo menos uma loja. Use para menu/UI, nunca para autorizar escrita. */
export function podeEmAlguma(acessos: Acesso[], permissao: Permissao): boolean {
  return acessos.some((a) => MATRIZ[a.perfil].includes(permissao));
}

/**
 * Lojas onde a pessoa tem `permissao`.
 * "todas" = acesso global (não filtra por site).
 */
export function sitesPermitidos(
  acessos: Acesso[],
  permissao: Permissao,
): "todas" | string[] {
  const ids = new Set<string>();
  for (const a of acessos) {
    if (!MATRIZ[a.perfil].includes(permissao)) continue;
    if (a.siteId === null) return "todas";
    ids.add(a.siteId);
  }
  return [...ids];
}

/**
 * Filtro Prisma pronto para listagens: `where: { ...whereSite(acessos, "estoque.ver") }`.
 * Sem nenhuma loja permitida devolve `{ siteId: { in: [] } }` — não vaza nada.
 */
export function whereSite(
  acessos: Acesso[],
  permissao: Permissao,
): Record<string, never> | { siteId: { in: string[] } } {
  const s = sitesPermitidos(acessos, permissao);
  return s === "todas" ? {} : { siteId: { in: s } };
}

/** Todas as permissões efetivas de um perfil — usado na tela de detalhe. */
export function permissoesDoPerfil(perfil: Perfil): readonly Permissao[] {
  return MATRIZ[perfil];
}

// ── Validação / normalização ────────────────────────────────

export const acessoSchema = z.object({
  perfil: z.enum(["ADMINISTRADOR", "ESTOQUISTA", "CAIXA", "FINANCEIRO", "CONTADOR"]),
  siteId: z.string().min(1).nullable(),
});

export const acessosSchema = z
  .array(acessoSchema)
  .min(1, "Escolha pelo menos um perfil.")
  .max(40)
  .transform(normalizarAcessos)
  .refine((a) => a.length > 0, "Escolha pelo menos um perfil.");

/**
 * Regras de sanidade dos acessos:
 * 1. ADMINISTRADOR é sempre global — vira siteId null e apaga todo o resto
 *    (com acesso total, acesso por loja é ruído).
 * 2. Perfil com acesso global dispensa as linhas por loja do mesmo perfil.
 * 3. Sem duplicatas.
 */
export function normalizarAcessos(acessos: Acesso[]): Acesso[] {
  if (acessos.some((a) => a.perfil === "ADMINISTRADOR")) {
    return [{ perfil: "ADMINISTRADOR", siteId: null }];
  }
  const globais = new Set(
    acessos.filter((a) => a.siteId === null).map((a) => a.perfil),
  );
  const vistos = new Set<string>();
  const saida: Acesso[] = [];
  for (const a of acessos) {
    if (a.siteId !== null && globais.has(a.perfil)) continue;
    const chave = `${a.perfil}:${a.siteId ?? "*"}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(a);
  }
  return saida;
}

/** Lê o campo Json de Invite.acessos com fallback seguro (lista vazia). */
export function parseAcessosJson(valor: unknown): Acesso[] {
  const r = z.array(acessoSchema).safeParse(valor);
  return r.success ? normalizarAcessos(r.data) : [];
}

/** Erro de autorização — as actions convertem em mensagem para o operador. */
export class SemPermissaoError extends Error {
  constructor(mensagem = "Você não tem permissão para essa ação.") {
    super(mensagem);
    this.name = "SemPermissaoError";
  }
}

/** Versão que lança. Use no topo das server actions. */
export function assertCan(acessos: Acesso[], permissao: Permissao, siteId: string): void {
  if (!can(acessos, permissao, siteId)) throw new SemPermissaoError();
}

export function assertAdmin(acessos: Acesso[]): void {
  if (!isAdmin(acessos)) {
    throw new SemPermissaoError("Apenas um administrador pode fazer isso.");
  }
}
