import "server-only";
import { db } from "@/lib/prisma";

// ============================================================
// Lista de FORNECEDORES do celular — a agenda, não o centro de gestão.
//
// Não reusa `loadFornecedores` (desktop) de propósito: aquele monta o painel do
// centro de gestão — conta catálogo, promoção, itens pendentes de match e
// compras de 30 dias, em quatro consultas que varrem tabelas grandes. Aqui a
// pergunta é de chão: "qual o telefone do fornecedor de bebidas?", "quando vem
// a próxima entrega dele?". Uma consulta de cadastro e uma de pedidos abertos
// respondem isso, e a tela abre no 4G da loja.
// ============================================================

/** Pedido que ainda não terminou — o que faz o fornecedor ser "esperado hoje". */
const PEDIDOS_ABERTOS = [
  "ENVIADO",
  "AGUARDANDO",
  "EM_TRANSITO",
  "RECEBIDO_PARCIAL",
] as const;

/** Pessoa de contato do fornecedor — é para ELA que a cotação vai. */
export type ContatoMobile = {
  id: string;
  nome: string;
  cargo: string | null;
  /** Já sem máscara — `tel:`/`wa.me` só quer dígito. */
  telefone: string | null;
  email: string | null;
  principal: boolean;
};

export type FornecedorMobile = {
  id: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  logoUrl: string | null;
  cnpj: string | null;
  /** Já sem máscara — o `tel:`/`wa.me` precisa só de dígito. */
  telefone: string | null;
  email: string | null;
  municipio: string | null;
  uf: string | null;
  ativo: boolean;
  /** Pedidos em aberto com ele. 0 = nada a caminho. */
  pedidosAbertos: number;
  /** Entrega mais próxima prevista, ISO; null quando não há previsão. */
  proximaEntrega: string | null;
  /** Última nota que entrou dele, ISO — cache do próprio cadastro. */
  ultimaCompraEm: string | null;
  /** Contatos ativos, principal primeiro. Vazio = só o telefone da empresa. */
  contatos: ContatoMobile[];
};

const soDigitos = (v: string | null): string | null => {
  const d = (v ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d : null;
};

/** Fornecedores em ordem alfabética. Roda dentro de `runWithTenant`. */
export async function loadFornecedoresMobile(): Promise<FornecedorMobile[]> {
  const [suppliers, pedidos, contatos] = await Promise.all([
    db.supplier.findMany({
      orderBy: { razaoSocial: "asc" },
      select: {
        id: true,
        razaoSocial: true,
        nomeFantasia: true,
        logoUrl: true,
        cnpj: true,
        telefone: true,
        email: true,
        municipio: true,
        uf: true,
        ativo: true,
        ultimaCompraEm: true,
      },
    }),
    db.purchaseOrder.findMany({
      where: { status: { in: [...PEDIDOS_ABERTOS] } },
      select: { supplierId: true, previsaoEntrega: true },
    }),
    // Uma consulta para a agenda inteira: no celular "com quem eu falo nesse
    // fornecedor?" vem junto com "qual o telefone dele", e buscar contato por
    // fornecedor seria uma ida ao banco por cartão aberto.
    db.supplierContact.findMany({
      where: { ativo: true },
      orderBy: [{ principal: "desc" }, { nome: "asc" }],
      select: {
        id: true,
        supplierId: true,
        nome: true,
        cargo: true,
        telefone: true,
        email: true,
        principal: true,
      },
    }),
  ]);

  const abertos = new Map<string, { total: number; proxima: Date | null }>();
  for (const p of pedidos) {
    const acc = abertos.get(p.supplierId) ?? { total: 0, proxima: null };
    acc.total++;
    // A previsão que interessa é a mais PRÓXIMA: é ela que responde "ele vem
    // hoje?". Pedido sem previsão não apaga a de quem tem.
    if (p.previsaoEntrega && (!acc.proxima || p.previsaoEntrega < acc.proxima)) {
      acc.proxima = p.previsaoEntrega;
    }
    abertos.set(p.supplierId, acc);
  }

  const contatosPor = new Map<string, ContatoMobile[]>();
  for (const c of contatos) {
    const lista = contatosPor.get(c.supplierId) ?? [];
    lista.push({
      id: c.id,
      nome: c.nome,
      cargo: c.cargo,
      telefone: soDigitos(c.telefone),
      email: c.email,
      principal: c.principal,
    });
    contatosPor.set(c.supplierId, lista);
  }

  return suppliers.map((s) => {
    const aberto = abertos.get(s.id);
    return {
      id: s.id,
      razaoSocial: s.razaoSocial,
      nomeFantasia: s.nomeFantasia,
      logoUrl: s.logoUrl,
      cnpj: s.cnpj,
      telefone: soDigitos(s.telefone),
      email: s.email,
      municipio: s.municipio,
      uf: s.uf,
      ativo: s.ativo,
      pedidosAbertos: aberto?.total ?? 0,
      proximaEntrega: aberto?.proxima?.toISOString() ?? null,
      ultimaCompraEm: s.ultimaCompraEm?.toISOString() ?? null,
      contatos: contatosPor.get(s.id) ?? [],
    };
  });
}
