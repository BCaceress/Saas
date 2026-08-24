import "server-only";
import { randomBytes } from "node:crypto";
import { basePrisma, db } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { rootUrl } from "@/lib/urls";
import { rotuloEmbalagem } from "@/lib/compras/cotacao-unidades";
import type { EmbalagemItem } from "@/lib/compras/rotulo-preco";
import type { Faixa } from "@/lib/compras/escalas";

// ============================================================
// Link público de resposta da cotação (/cotacao/<token>).
//
// O módulo inteiro existe para tirar a digitação da loja. Enquanto só o
// operador podia registrar a resposta, o trabalho não sumia — mudava de mão.
// Aqui o fornecedor abre o link no celular, preenche preço e prazo e acabou:
// sem conta, sem senha, sem app. É a única forma que sobrevive ao fornecedor
// de bebida real, que não vai criar login no ERP do cliente.
//
// QuotationLink é tabela de CONTROLE (ver schema): resolvida por `basePrisma`
// porque o token é justamente quem revela o tenant. A partir do momento em que
// o tenant é conhecido, tudo volta ao caminho normal — `runWithTenant` + `db`.
// ============================================================

/** Folga sobre o prazo de resposta: quem responde no dia seguinte ainda entra. */
const FOLGA_DIAS = 3;
/** Sem prazo definido, o link morre sozinho — link eterno é vazamento lento. */
const VALIDADE_PADRAO_DIAS = 30;

const DIA_MS = 24 * 60 * 60 * 1000;

/** Segredo do link. 24 bytes = 32 chars base64url, o bastante contra chute. */
export function novoTokenCotacao(): string {
  return randomBytes(24).toString("base64url");
}

/** Link no domínio RAIZ: o fornecedor não tem sessão no subdomínio do tenant. */
export function cotacaoLinkUrl(token: string): string {
  return rootUrl(`/cotacao/${token}`);
}

export function expiracaoDoLink(prazoResposta: Date | null): Date {
  if (prazoResposta) return new Date(prazoResposta.getTime() + FOLGA_DIAS * DIA_MS);
  return new Date(Date.now() + VALIDADE_PADRAO_DIAS * DIA_MS);
}

/**
 * Cria ou renova o link de um convite. Renovar TROCA o token: reenviar a
 * cotação invalida o endereço antigo, que pode ter ido parar num grupo de
 * WhatsApp inteiro.
 *
 * Roda dentro de `runWithTenant` (precisa do tenantId explícito porque
 * QuotationLink é tabela de controle).
 */
export async function emitirLinkCotacao(
  tenantId: string,
  quotationSupplierId: string,
  prazoResposta: Date | null,
): Promise<{ token: string; url: string; expiraEm: Date }> {
  const token = novoTokenCotacao();
  const expiraEm = expiracaoDoLink(prazoResposta);

  await basePrisma.quotationLink.upsert({
    where: { quotationSupplierId },
    create: { tenantId, quotationSupplierId, token, expiraEm },
    // Token novo zera os sinais de leitura: são sinais DESTE link, não do
    // anterior — senão um reenvio nasceria com "já abriu" de uma semana atrás.
    update: { token, expiraEm, abertoEm: null, respondidoEm: null },
  });

  return { token, url: cotacaoLinkUrl(token), expiraEm };
}

/**
 * Link atual do convite, se ainda valer. É o que a tela da cotação mostra para
 * o operador reenviar por outro canal ("mandei por WhatsApp, ele pediu por
 * e-mail") sem trocar o token e invalidar o que já está na mão do fornecedor.
 */
export async function linkVigente(
  quotationSupplierId: string,
): Promise<{ url: string; expiraEm: Date; abertoEm: Date | null } | null> {
  const link = await basePrisma.quotationLink.findUnique({
    where: { quotationSupplierId },
    select: { token: true, expiraEm: true, abertoEm: true },
  });
  if (!link || link.expiraEm.getTime() < Date.now()) return null;
  return { url: cotacaoLinkUrl(link.token), expiraEm: link.expiraEm, abertoEm: link.abertoEm };
}

/** Sinais de leitura de vários convites de uma vez — para a lista/Central. */
export async function sinaisDosLinks(
  quotationSupplierIds: string[],
): Promise<Map<string, { abertoEm: Date | null; expiraEm: Date }>> {
  if (quotationSupplierIds.length === 0) return new Map();
  const links = await basePrisma.quotationLink.findMany({
    where: { quotationSupplierId: { in: quotationSupplierIds } },
    select: { quotationSupplierId: true, abertoEm: true, expiraEm: true },
  });
  return new Map(
    links.map((l) => [l.quotationSupplierId, { abertoEm: l.abertoEm, expiraEm: l.expiraEm }]),
  );
}

// ── Leitura pública ─────────────────────────────────────────

export type ItemPublico = {
  id: string;
  descricao: string;
  quantidade: number;
  /**
   * O QUE está sendo pedido: caixa, fardo, unidade, kg. Sai do `packagingId`
   * do item; sem ele, da unidade base do produto. É o que decide o rótulo do
   * campo de preço — "Preço da caixa (12 un.)" e não "Preço unitário".
   */
  embalagem: EmbalagemItem;
  /**
   * Código de barras da UNIDADE (EAN do produto). É por ele que o vendedor
   * confere se o item da lista é o mesmo do catálogo dele — nome de produto
   * de bebida muda de loja para loja, EAN não.
   */
  ean: string | null;
  /** EAN da própria embalagem (DUN da caixa), quando o cadastro tem. */
  eanEmbalagem: string | null;
  observacao: string | null;
  /** Foto do produto — usada na visão de computador, onde há coluna para ela. */
  imagemUrl: string | null;
};

export type RespostaPublica = {
  quotationItemId: string;
  disponivel: boolean;
  precoUnitario: number;
  quantidadeOfertada: number | null;
  marca: string | null;
  observacao: string | null;
  /** Promoção por volume que ele já informou — só quando a cotação pede. */
  faixas: Faixa[];
};

export type CotacaoPublica = {
  token: string;
  empresa: string;
  /** Logo do mercado que pediu a cotação — quem recebe o link precisa
   *  reconhecer o cliente antes de digitar preço. */
  empresaLogoUrl: string | null;
  numero: string;
  titulo: string;
  prazoResposta: string | null;
  observacao: string | null;
  fornecedor: string;
  /** Pessoa a quem o link foi mandado — null quando saiu no contato geral. */
  contato: string | null;
  /** Já enviou uma resposta? Continua editável enquanto a cotação estiver aberta. */
  respondida: boolean;
  /**
   * O comprador quer ver promoção por volume. Ligado, cada item ganha um bloco
   * recolhido de faixas; desligado, a tela segue com um preço por item — que é
   * o piso do que o vendedor aguenta responder no meio do dia.
   */
  pedeEscala: boolean;
  itens: ItemPublico[];
  cabecalho: {
    prazoEntregaDias: number | null;
    condicaoPagamento: string | null;
    frete: number | null;
    observacao: string | null;
  };
  respostas: RespostaPublica[];
};

export type LinkResolvido =
  | { estado: "invalido" }
  | { estado: "expirado"; empresa: string; numero: string }
  | { estado: "fechado"; empresa: string; numero: string; motivo: string }
  | { estado: "valido"; cotacao: CotacaoPublica };

const n = (v: unknown) => Number(v ?? 0);

/** Motivo em linguagem de gente para cada status que não aceita mais resposta. */
const MOTIVO_FECHADA: Record<string, string> = {
  RASCUNHO: "Esta cotação ainda não foi enviada.",
  ENCERRADA: "O prazo desta cotação foi encerrado.",
  DECIDIDA: "Esta cotação já foi fechada com um fornecedor.",
  CANCELADA: "Esta cotação foi cancelada.",
};

/**
 * Lê a cotação pelo token do link. NÃO exige sessão — e por isso devolve só o
 * que o fornecedor precisa ver: a lista, o prazo e a própria resposta dele.
 * Preço de concorrente jamais atravessa esta função.
 */
export async function resolverLinkCotacao(token: string): Promise<LinkResolvido> {
  const link = await basePrisma.quotationLink.findUnique({
    where: { token },
    select: {
      id: true,
      tenantId: true,
      quotationSupplierId: true,
      expiraEm: true,
      tenant: { select: { nome: true, logoUrl: true } },
    },
  });
  if (!link) return { estado: "invalido" };

  return runWithTenant(link.tenantId, async () => {
    const convite = await db.quotationSupplier.findFirst({
      where: { id: link.quotationSupplierId },
      select: {
        status: true,
        prazoEntregaDias: true,
        condicaoPagamento: true,
        frete: true,
        observacao: true,
        supplier: { select: { razaoSocial: true, nomeFantasia: true } },
        // Quem recebeu o link. É só o nome — o telefone e o e-mail dele não
        // atravessam a fronteira pública.
        contact: { select: { nome: true } },
        responses: {
          select: {
            quotationItemId: true,
            disponivel: true,
            precoUnitario: true,
            quantidadeOfertada: true,
            marca: true,
            observacao: true,
            faixas: {
              orderBy: { quantidadeMinima: "asc" },
              select: { quantidadeMinima: true, precoUnitario: true },
            },
          },
        },
        quotation: {
          select: {
            numero: true,
            titulo: true,
            status: true,
            prazoResposta: true,
            observacao: true,
            pedeEscala: true,
            items: {
              orderBy: { ordem: "asc" },
              select: {
                id: true,
                descricao: true,
                quantidade: true,
                observacao: true,
                packagingId: true,
                productId: true,
              },
            },
          },
        },
      },
    });
    if (!convite) return { estado: "invalido" };

    const empresa = link.tenant.nome;
    const numero = convite.quotation.numero;

    if (convite.quotation.status !== "ABERTA") {
      return {
        estado: "fechado",
        empresa,
        numero,
        motivo: MOTIVO_FECHADA[convite.quotation.status] ?? "Esta cotação não está mais aberta.",
      };
    }
    // Expiração vem depois do status: "foi decidida" explica mais que "venceu".
    if (link.expiraEm.getTime() < Date.now()) return { estado: "expirado", empresa, numero };

    // Nome da embalagem pedida ("Fardo 12") — o fornecedor precisa saber se o
    // preço é por unidade ou por caixa, senão a comparação inteira mente.
    const packagingIds = [
      ...new Set(
        convite.quotation.items
          .map((i) => i.packagingId)
          .filter((id): id is string => id !== null),
      ),
    ];
    // Foto do produto: uma consulta para a lista inteira. Só o que a tela do
    // fornecedor mostra sai daqui — nada de preço, custo ou saldo do cliente.
    const productIds = [
      ...new Set(
        convite.quotation.items
          .map((i) => i.productId)
          .filter((id): id is string => id !== null),
      ),
    ];

    // Embalagem e produto não se cruzam: juntos, uma ida ao banco em vez de
    // duas em fila — é o tempo até o fornecedor ver a lista.
    const [embalagens, produtos] = await Promise.all([
      packagingIds.length
        ? db.productPackaging.findMany({
            where: { id: { in: packagingIds } },
            select: { id: true, nome: true, fatorConversao: true, ean: true },
          })
        : Promise.resolve([]),
      productIds.length
        ? db.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, imagemUrl: true, unidadeBase: true, ean: true },
          })
        : Promise.resolve([]),
    ]);

    // "Caixa (12 un.)" e não só "Caixa": o fornecedor precisa saber quantas
    // unidades vêm dentro, senão o preço que ele manda é de outra coisa. O
    // rótulo é o MESMO da mensagem de WhatsApp — uma fonte só (cotacao-unidades).
    const porEmbalagem = new Map(
      embalagens.map(
        (e) =>
          [
            e.id,
            {
              nome: e.nome,
              fator: n(e.fatorConversao) || 1,
              label: rotuloEmbalagem(e.nome, n(e.fatorConversao)),
              ean: e.ean,
            },
          ] as const,
      ),
    );
    const imagemPorProduto = new Map(produtos.map((p) => [p.id, p.imagemUrl]));
    const eanPorProduto = new Map(produtos.map((p) => [p.id, p.ean]));
    // Sem embalagem escolhida, o pedido é na unidade base do cadastro (UN, ML,
    // G). "UN" vira "Unidade" — a palavra que o vendedor lê no rótulo do preço.
    const basePorProduto = new Map(
      produtos.map((p) => [p.id, p.unidadeBase === "UN" ? "Unidade" : p.unidadeBase.toLowerCase()]),
    );
    /** Item sem produto vinculado (texto livre) é avulso: uma unidade. */
    const AVULSO: EmbalagemItem = { nome: "Unidade", fator: 1, label: "un" };

    return {
      estado: "valido",
      cotacao: {
        token,
        empresa,
        empresaLogoUrl: link.tenant.logoUrl,
        numero,
        titulo: convite.quotation.titulo,
        prazoResposta: convite.quotation.prazoResposta?.toISOString() ?? null,
        observacao: convite.quotation.observacao,
        fornecedor: convite.supplier.nomeFantasia || convite.supplier.razaoSocial,
        contato: convite.contact?.nome ?? null,
        respondida: convite.status === "RESPONDIDA",
        pedeEscala: convite.quotation.pedeEscala,
        itens: convite.quotation.items.map((i) => {
          const emb = i.packagingId ? porEmbalagem.get(i.packagingId) : undefined;
          const base = i.productId ? basePorProduto.get(i.productId) : undefined;
          return {
            id: i.id,
            descricao: i.descricao,
            quantidade: n(i.quantidade),
            embalagem: emb
              ? { nome: emb.nome, fator: emb.fator, label: emb.label }
              : base
                ? { nome: base, fator: 1, label: base === "Unidade" ? "un" : base }
                : AVULSO,
            ean: i.productId ? (eanPorProduto.get(i.productId) ?? null) : null,
            eanEmbalagem: emb?.ean ?? null,
            observacao: i.observacao,
            imagemUrl: i.productId ? (imagemPorProduto.get(i.productId) ?? null) : null,
          };
        }),
        cabecalho: {
          prazoEntregaDias: convite.prazoEntregaDias,
          condicaoPagamento: convite.condicaoPagamento,
          frete: convite.frete === null ? null : n(convite.frete),
          observacao: convite.observacao,
        },
        respostas: convite.responses.map((r) => ({
          quotationItemId: r.quotationItemId,
          disponivel: r.disponivel,
          precoUnitario: n(r.precoUnitario),
          quantidadeOfertada: r.quantidadeOfertada === null ? null : n(r.quantidadeOfertada),
          marca: r.marca,
          observacao: r.observacao,
          faixas: r.faixas.map((f) => ({
            quantidadeMinima: n(f.quantidadeMinima),
            precoUnitario: n(f.precoUnitario),
          })),
        })),
      },
    };
  });
}

/** Primeiro acesso do fornecedor. Silencioso: falhar aqui não pode fechar a porta. */
export async function marcarLinkAberto(token: string): Promise<void> {
  try {
    await basePrisma.quotationLink.updateMany({
      where: { token, abertoEm: null },
      data: { abertoEm: new Date() },
    });
  } catch {
    // sinal de leitura é conveniência; a resposta é que importa
  }
}

/** Contexto mínimo para a action pública gravar sem confiar no cliente. */
export type LinkGravavel = {
  linkId: string;
  tenantId: string;
  quotationSupplierId: string;
};

/** Resolve o token para escrita: só devolve quando o link ainda aceita resposta. */
export async function linkParaGravar(token: string): Promise<LinkGravavel | null> {
  const link = await basePrisma.quotationLink.findUnique({
    where: { token },
    select: { id: true, tenantId: true, quotationSupplierId: true, expiraEm: true },
  });
  if (!link || link.expiraEm.getTime() < Date.now()) return null;
  return {
    linkId: link.id,
    tenantId: link.tenantId,
    quotationSupplierId: link.quotationSupplierId,
  };
}

export async function marcarLinkRespondido(linkId: string): Promise<void> {
  await basePrisma.quotationLink.update({
    where: { id: linkId },
    data: { respondidoEm: new Date() },
  });
}
