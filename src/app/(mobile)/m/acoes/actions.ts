"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/prisma";
import { guardAction, assertSite } from "@/lib/guard";
import { podeEmAlguma } from "@/lib/permissoes";
import { runWithTenant } from "@/lib/tenant-context";
import { getActiveSiteId, listSites } from "@/lib/sites";
import { criarPedidoCompra } from "@/lib/estoque";
import { semAcento } from "@/lib/normalize";
import { completeJson, completeJsonComArquivo, llmConfigured } from "@/lib/llm";

// ============================================================
// Ações que nascem do scanner: mudar preço, pedir para o fornecedor, ler um
// encarte, ditar um comando.
//
// Cada uma existe aqui porque a de desktop não serve como está — não por
// preguiça de reusar: `updateProduct` exige o formulário inteiro (fiscal,
// embalagens, componentes) para trocar um preço, e `criarPedidosReposicaoAction`
// espera os itens JÁ agrupados por fornecedor, agrupamento que no celular
// ninguém vai fazer à mão. Onde a action de desktop cabe inteira — ajuste,
// perda, transferência — ela é chamada direto (ver components/mobile/acao-estoque).
// ============================================================

const ok = () => {
  revalidatePath("/m", "layout");
  revalidatePath("/produtos", "layout");
};

// ── Contexto para as sheets ─────────────────────────────────

export type ContextoAcoes = {
  sites: Array<{ id: string; nome: string }>;
  siteAtivo: string | null;
  podeAjustar: boolean;
  podeTransferir: boolean;
  podePreco: boolean;
  podePedir: boolean;
};

/**
 * As sheets precisam de lojas e de quem pode o quê. Uma viagem só, sob demanda:
 * a ficha do produto é montada a cada bipe e carregar isso junto dela pagaria a
 * consulta de lojas por leitura.
 */
export async function contextoAcoesAction(): Promise<ContextoAcoes> {
  const ctx = await guardAction("produto.ver", null, { mesmoSuspenso: true });

  return runWithTenant(ctx.tenant.id, async () => {
    const [sites, siteAtivo] = await Promise.all([listSites(), getActiveSiteId()]);
    return {
      sites: sites.map((s) => ({ id: s.id, nome: s.nome })),
      siteAtivo,
      podeAjustar: podeEmAlguma(ctx.acessos, "estoque.ajustar"),
      podeTransferir: podeEmAlguma(ctx.acessos, "estoque.transferir"),
      podePreco: podeEmAlguma(ctx.acessos, "produto.preco"),
      podePedir: podeEmAlguma(ctx.acessos, "compras.pedir"),
    };
  });
}

// ── Preço ───────────────────────────────────────────────────

const precoSchema = z.object({
  productId: z.string().min(1),
  // Zero é preço válido (brinde, item de degustação); negativo não é.
  preco: z.number().nonnegative("Preço não pode ser negativo.").max(9_999_999),
});

export type ResultadoPreco = {
  productId: string;
  nome: string;
  precoAnterior: number | null;
  preco: number;
  /** Margem sobre o novo preço, quando o custo é conhecido e visível. */
  margemPct: number | null;
};

/**
 * Troca o preço de venda de UM produto.
 *
 * `produto.preco` é a permissão certa e a única exigida: quem mexe em preço na
 * gôndola (dono, gerente) não necessariamente tem `produto.editar`, que abre o
 * cadastro inteiro. A margem volta calculada para a tela dizer na hora se o
 * preço novo apertou o resultado — é o dado que faz a pessoa desfazer antes de
 * sair da tela.
 */
export async function alterarPrecoAction(
  input: z.input<typeof precoSchema>,
): Promise<ResultadoPreco> {
  const d = precoSchema.parse(input);
  const ctx = await guardAction("produto.preco");
  const veCusto = podeEmAlguma(ctx.acessos, "produto.custo");

  return runWithTenant(ctx.tenant.id, async () => {
    const antes = await db.product.findFirst({
      where: { id: d.productId },
      select: { id: true, nome: true, precoVenda: true, custoMedio: true },
    });
    if (!antes) throw new Error("Produto não encontrado.");

    await db.product.update({
      where: { id: antes.id },
      data: { precoVenda: d.preco },
    });

    const custo = veCusto ? Number(antes.custoMedio ?? 0) : 0;
    ok();
    return {
      productId: antes.id,
      nome: antes.nome,
      precoAnterior: antes.precoVenda == null ? null : Number(antes.precoVenda),
      preco: d.preco,
      margemPct: custo > 0 && d.preco > 0 ? ((d.preco - custo) / d.preco) * 100 : null,
    };
  });
}

// ── Pedido de compra a partir do scanner ────────────────────

const pedidoSchema = z.object({
  siteId: z.string().min(1).nullable(),
  enviar: z.boolean().default(false),
  itens: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantidade: z.number().positive(),
        /** Fornecedor escolhido na tela; ausente = usa o principal do produto. */
        supplierId: z.string().min(1).nullable().default(null),
      }),
    )
    .min(1, "Nenhum item no pedido.")
    .max(200),
});

export type ResultadoPedido = {
  criados: Array<{ id: string; numero: string; fornecedor: string; itens: number }>;
  /** Produtos que ficaram de fora por não ter fornecedor cadastrado. */
  semFornecedor: string[];
};

/**
 * Fecha o carrinho montado escaneando. Agrupa por fornecedor aqui, no servidor,
 * porque é ele quem sabe qual é o principal de cada produto — pedir isso ao
 * celular seria mandar o catálogo de vínculos para o browser.
 *
 * Nasce em RASCUNHO (`enviar: false`) por padrão: pedido disparado sem revisão
 * a partir de um bipe errado é caminhão errado na porta.
 */
export async function criarPedidoDoScannerAction(
  input: z.input<typeof pedidoSchema>,
): Promise<ResultadoPedido> {
  const d = pedidoSchema.parse(input);
  const ctx = await guardAction("compras.pedir", d.siteId ?? undefined);

  return runWithTenant(ctx.tenant.id, async () => {
    const siteId = d.siteId ?? (await getActiveSiteId());
    if (!siteId) throw new Error("Selecione a loja de destino do pedido.");
    assertSite(ctx, "compras.pedir", siteId);

    const productIds = [...new Set(d.itens.map((i) => i.productId))];
    const vinculos = await db.productSupplier.findMany({
      where: { productId: { in: productIds } },
      select: {
        productId: true,
        supplierId: true,
        isPrincipal: true,
        custoFornecedor: true,
      },
      orderBy: { isPrincipal: "desc" },
    });

    const produtos = await db.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, nome: true, custoMedio: true },
    });
    const nomePorId = new Map(produtos.map((p) => [p.id, p.nome]));

    type Linha = {
      productId: string;
      qtdPedida: number;
      custoUnitario: number;
      packagingId?: null;
    };
    const porFornecedor = new Map<string, Linha[]>();
    const semFornecedor: string[] = [];

    for (const item of d.itens) {
      const doProduto = vinculos.filter((v) => v.productId === item.productId);
      const escolhido = item.supplierId
        ? doProduto.find((v) => v.supplierId === item.supplierId)
        : (doProduto.find((v) => v.isPrincipal) ?? doProduto[0]);

      if (!escolhido) {
        semFornecedor.push(nomePorId.get(item.productId) ?? item.productId);
        continue;
      }

      const custoBase =
        escolhido.custoFornecedor != null
          ? Number(escolhido.custoFornecedor)
          : Number(produtos.find((p) => p.id === item.productId)?.custoMedio ?? 0);

      const lista = porFornecedor.get(escolhido.supplierId) ?? [];
      lista.push({
        productId: item.productId,
        qtdPedida: item.quantidade,
        custoUnitario: custoBase,
      });
      porFornecedor.set(escolhido.supplierId, lista);
    }

    const criados: ResultadoPedido["criados"] = [];
    // Sequencial: o número (PC-000NN) é gerado por tenant e criações paralelas
    // colidiriam no unique — mesma razão de `criarPedidosReposicaoAction`.
    for (const [supplierId, items] of porFornecedor) {
      const id = await criarPedidoCompra(
        ctx.tenant.id,
        { siteId, supplierId, previsaoEntrega: null, observacao: "Aberto pelo celular", items },
        { enviar: d.enviar, createdBy: ctx.user.id ?? "" },
      );
      const pedido = await db.purchaseOrder.findFirst({
        where: { id },
        select: {
          id: true,
          numero: true,
          // `nomeFantasia` é como o operador chama o fornecedor; a razão social
          // é o nome do papel. Cai para a razão quando não há fantasia.
          supplier: { select: { razaoSocial: true, nomeFantasia: true } },
        },
      });
      criados.push({
        id,
        numero: pedido?.numero ?? "",
        fornecedor:
          pedido?.supplier?.nomeFantasia ?? pedido?.supplier?.razaoSocial ?? "Fornecedor",
        itens: items.length,
      });
    }

    revalidatePath("/compras", "layout");
    ok();
    return { criados, semFornecedor };
  });
}

// ── Encarte / tabela do fornecedor pela câmera ──────────────

const SISTEMA_ENCARTE = `Você lê fotos de encartes, tabelas de preço e etiquetas de gôndola de mercados brasileiros.
Extraia SOMENTE os itens legíveis na imagem. Responda JSON puro no formato:
{"itens":[{"descricao":"texto como está na imagem","preco":0.00,"unidade":"un|kg|cx|fd|null"}]}
Regras:
- preco em reais, ponto como separador decimal, sem símbolo de moeda;
- "3 por 10,00" vira preco 3.33 e descricao mantém a observação;
- se não conseguir ler o preço de um item, não inclua o item;
- nunca invente produto que não esteja na imagem;
- máximo 60 itens.`;

const MIMES_ACEITOS = ["image/jpeg", "image/png", "image/webp"];
/** ~6 MB em base64 ≈ 4,5 MB de foto. Acima disso a leitura fica cara e lenta. */
const MAX_BASE64 = 6_000_000;

export type ItemEncarte = {
  descricao: string;
  preco: number;
  unidade: string | null;
  /** Produto do catálogo que casou, quando houve um só candidato claro. */
  sugestao: { productId: string; nome: string; sku: string; precoAtual: number | null } | null;
  /** Outros candidatos, para a pessoa escolher na tela. */
  alternativas: Array<{ productId: string; nome: string; sku: string }>;
};

export type ResultadoEncarte =
  | { ok: true; itens: ItemEncarte[] }
  | { ok: false; erro: string };

/**
 * Foto de encarte → itens com preço, já casados contra o catálogo.
 *
 * NUNCA aplica nada: devolve a lista para conferência. Leitura de imagem erra
 * vírgula e confunde "3 por 10" com "R$ 3,10" — aplicar direto transformaria um
 * erro de OCR em preço de prateleira.
 *
 * O casamento é por palavras, não por similaridade difusa: o objetivo é acertar
 * o óbvio (mesma marca, mesmo volume) e devolver o resto como alternativa, em
 * vez de escolher errado com confiança.
 */
export async function lerEncarteAction(input: {
  mimeType: string;
  base64: string;
}): Promise<ResultadoEncarte> {
  const ctx = await guardAction("produto.preco");

  if (!llmConfigured()) {
    return { ok: false, erro: "A leitura por imagem não está configurada nesta conta." };
  }
  if (!MIMES_ACEITOS.includes(input.mimeType)) {
    return { ok: false, erro: "Envie uma foto JPEG, PNG ou WebP." };
  }
  if (!input.base64 || input.base64.length > MAX_BASE64) {
    return { ok: false, erro: "Foto muito grande. Tente de novo com menos zoom." };
  }

  let lidos: Array<{ descricao?: unknown; preco?: unknown; unidade?: unknown }>;
  try {
    const r = await completeJsonComArquivo<{ itens?: unknown }>({
      system: SISTEMA_ENCARTE,
      user: "Extraia os itens e preços desta imagem.",
      media: { mimeType: input.mimeType, base64: input.base64 },
      maxTokens: 4096,
    });
    lidos = Array.isArray(r.itens) ? (r.itens as typeof lidos) : [];
  } catch {
    return { ok: false, erro: "Não consegui ler a imagem. Tente com mais luz e de frente." };
  }

  const itens = lidos
    .map((i) => ({
      descricao: String(i.descricao ?? "").trim().slice(0, 160),
      preco: Number(i.preco),
      unidade: i.unidade == null ? null : String(i.unidade).slice(0, 8),
    }))
    .filter((i) => i.descricao.length >= 2 && Number.isFinite(i.preco) && i.preco > 0)
    .slice(0, 60);

  if (itens.length === 0) {
    return { ok: false, erro: "Nenhum preço legível na foto." };
  }

  return runWithTenant(ctx.tenant.id, async () => {
    const catalogo = await db.product.findMany({
      where: { ativo: true },
      select: { id: true, nome: true, sku: true, precoVenda: true },
      take: 5000,
    });
    const indexado = catalogo.map((p) => ({
      ...p,
      termos: tokens(p.nome),
    }));

    const casados: ItemEncarte[] = itens.map((item) => {
      const alvo = tokens(item.descricao);
      const pontuados = indexado
        .map((p) => ({ p, score: pontuar(alvo, p.termos) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 4);

      const melhor = pontuados[0];
      // Só vira sugestão quando bate a maioria das palavras E é folgadamente
      // melhor que o segundo. Empate é ambiguidade — vai como alternativa.
      const confiante =
        melhor != null &&
        melhor.score >= 0.6 &&
        (pontuados[1] == null || melhor.score - pontuados[1].score >= 0.15);

      return {
        ...item,
        sugestao: confiante
          ? {
              productId: melhor.p.id,
              nome: melhor.p.nome,
              sku: melhor.p.sku,
              precoAtual: melhor.p.precoVenda == null ? null : Number(melhor.p.precoVenda),
            }
          : null,
        alternativas: pontuados
          .filter((x) => !confiante || x.p.id !== melhor?.p.id)
          .map((x) => ({ productId: x.p.id, nome: x.p.nome, sku: x.p.sku })),
      };
    });

    return { ok: true as const, itens: casados };
  });
}

/** Palavras que valem comparação: sem acento, sem ruído de 1-2 letras. */
function tokens(s: string): string[] {
  return semAcento(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 2);
}

/** Fração das palavras do encarte encontradas no nome do produto. */
function pontuar(alvo: string[], candidato: string[]): number {
  if (alvo.length === 0) return 0;
  const set = new Set(candidato);
  const acertos = alvo.filter((t) => set.has(t)).length;
  return acertos / alvo.length;
}

// ── Aplicar os preços conferidos ────────────────────────────

const aplicarSchema = z.object({
  itens: z
    .array(
      z.object({
        productId: z.string().min(1),
        preco: z.number().nonnegative().max(9_999_999),
      }),
    )
    .min(1)
    .max(200),
});

/** Grava os preços que a pessoa confirmou na tela de conferência. */
export async function aplicarPrecosAction(
  input: z.input<typeof aplicarSchema>,
): Promise<{ alterados: number }> {
  const d = aplicarSchema.parse(input);
  const ctx = await guardAction("produto.preco");

  return runWithTenant(ctx.tenant.id, async () => {
    const ids = [...new Set(d.itens.map((i) => i.productId))];
    // Peneira pelo tenant antes de gravar: o extension filtra o WHERE, então o
    // que não for desta empresa simplesmente não volta.
    const meus = new Set(
      (await db.product.findMany({ where: { id: { in: ids } }, select: { id: true } })).map(
        (p) => p.id,
      ),
    );

    let alterados = 0;
    for (const item of d.itens) {
      if (!meus.has(item.productId)) continue;
      await db.product.update({
        where: { id: item.productId },
        data: { precoVenda: item.preco },
      });
      alterados += 1;
    }

    ok();
    return { alterados };
  });
}

// ── Ditado por voz ──────────────────────────────────────────

const SISTEMA_COMANDO = `Você interpreta comandos falados por operadores de mercado no Brasil, em português.
Responda JSON puro: {"acao":"consultar|perda|ajuste|preco|pedir|contar|nenhuma","produto":"texto ou null","quantidade":number|null,"preco":number|null,"motivo":"texto ou null"}
Regras:
- "perdi/quebrou/venceu/estragou" => perda;
- "entrou/sobrou/faltou/ajusta" => ajuste;
- "muda o preço/passa para/vai custar" => preco;
- "pede/compra/repõe" => pedir;
- "conta/contagem/inventário" => contar;
- só consulta ("quanto tem de", "qual o preço de") => consultar;
- não entendeu => nenhuma, tudo null;
- quantidade e preco são números; "três reais e cinquenta" => 3.5.`;

export type ComandoVoz = {
  acao: "consultar" | "perda" | "ajuste" | "preco" | "pedir" | "contar" | "nenhuma";
  produto: string | null;
  quantidade: number | null;
  preco: number | null;
  motivo: string | null;
};

/**
 * Transcrição da voz → intenção. A fala vira INTENÇÃO, nunca escrita: a action
 * só diz "isso parece uma perda de 3 unidades de Monster"; quem grava é a
 * mesma sheet de sempre, com o botão de confirmar. Reconhecimento de fala erra
 * número — "treze" e "três" saem parecidos — e o preço da gôndola não pode
 * depender disso.
 */
export async function interpretarComandoAction(textoRaw: string): Promise<ComandoVoz> {
  await guardAction("produto.ver", null, { mesmoSuspenso: true });

  const texto = textoRaw.trim().slice(0, 300);
  const vazio: ComandoVoz = {
    acao: "nenhuma",
    produto: null,
    quantidade: null,
    preco: null,
    motivo: null,
  };
  if (texto.length < 3 || !llmConfigured()) return vazio;

  try {
    const r = await completeJson<Partial<ComandoVoz>>({
      system: SISTEMA_COMANDO,
      user: texto,
    });
    const acoes: ComandoVoz["acao"][] = [
      "consultar",
      "perda",
      "ajuste",
      "preco",
      "pedir",
      "contar",
      "nenhuma",
    ];
    return {
      acao: acoes.includes(r.acao as ComandoVoz["acao"]) ? (r.acao as ComandoVoz["acao"]) : "nenhuma",
      produto: typeof r.produto === "string" && r.produto.trim() ? r.produto.trim() : null,
      quantidade: Number.isFinite(r.quantidade) ? Number(r.quantidade) : null,
      preco: Number.isFinite(r.preco) ? Number(r.preco) : null,
      motivo: typeof r.motivo === "string" && r.motivo.trim() ? r.motivo.trim() : null,
    };
  } catch {
    return vazio;
  }
}
