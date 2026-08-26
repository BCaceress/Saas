import "server-only";
import { db } from "@/lib/prisma";
import { custoDoItem } from "./custo";
import { fatorDaNota } from "./fator";
import { nomeDaEmbalagem } from "./embalagem-nome";
import { resolverPerfilDaNota } from "./perfil-do-xml";

// ============================================================
// O que a nota ensina sobre o produto.
//
// Relacionar um item do XML ao catálogo é a única hora em que o sistema sabe,
// ao mesmo tempo, QUAL é o produto e TUDO o que o fornecedor declarou sobre
// ele: em que embalagem vende, com que código de barras, por quanto, sob que
// código no pedido. Jogar isso fora e deixar o operador digitar "Caixa"
// à mão depois é desperdício puro.
//
// Regra de ouro: NUNCA sobrescrever o que o operador já decidiu. Campo vazio
// é preenchido; campo preenchido só muda quando ele mesmo é a informação nova
// (o custo do fornecedor, que é sempre o da última nota).
// ============================================================

export type ItemDaNotaParaEnriquecer = {
  codigoFornecedor: string;
  gtin: string | null;
  /** Classificação fiscal como o fornecedor declarou — vira perfil fiscal. */
  ncm: string | null;
  cest: string | null;
  cfop: string | null;
  unidade: string;
  quantidade: number;
  unidadeTributavel: string | null;
  quantidadeTributavel: number | null;
  valorTotal: number;
  valorDesconto: number;
  valorIcmsSt: number;
  valorFcpSt: number;
  valorIpi: number;
  valorFrete: number;
  bonificacao: boolean;
};

export type Enriquecimento = {
  /** Embalagem a gravar no de-para — pode ter acabado de ser criada aqui. */
  packagingId: string | null;
  /** O que mudou no cadastro, em português, para a tela contar ao operador. */
  preenchidos: string[];
};

/**
 * Completa o cadastro do produto com o que a nota declara e devolve a
 * embalagem que o de-para deve usar.
 *
 * Roda ANTES de gravar o de-para de propósito: quando a nota vende em caixa e
 * o produto não tem essa embalagem cadastrada, ela é criada aqui e é o id novo
 * que vai para o `SupplierItemMap`.
 */
export async function enriquecerProdutoComNota(input: {
  tenantId: string;
  productId: string;
  packagingId: string | null;
  /** Unidades de estoque por unidade da nota (caixa com 12 → 12). */
  fatorConversao: number;
  supplierId: string | null;
  item: ItemDaNotaParaEnriquecer;
}): Promise<Enriquecimento> {
  const { tenantId, productId, supplierId, item } = input;
  const fator = input.fatorConversao > 0 ? input.fatorConversao : 1;
  const preenchidos: string[] = [];

  const produto = await db.product.findFirst({
    where: { id: productId },
    select: {
      id: true,
      ean: true,
      custo: true,
      gtinTributavel: true,
      unidadeTributavel: true,
      fatorConversaoTrib: true,
      fiscalProfileId: true,
      // A herança da subcategoria é o perfil que vale hoje: se ela já classifica
      // com o mesmo NCM da nota, criar um perfil por produto só encheria a lista
      // do contador com duplicata.
      subcategory: {
        select: { nome: true, defaultFiscalProfile: { select: { id: true, ncm: true } } },
      },
      packagings: { select: { id: true, ean: true, fatorConversao: true, isCompraDefault: true } },
    },
  });
  if (!produto) return { packagingId: input.packagingId, preenchidos };

  const custoTotal = custoDoItem(item);
  const qtdBase = item.quantidade * fator;
  const custoBase = qtdBase > 0 ? custoTotal / qtdBase : 0;
  const custoPorUnidadeCompra = item.quantidade > 0 ? custoTotal / item.quantidade : 0;

  // ── Formato de compra ──────────────────────────────────────
  let packagingId = input.packagingId;

  if (fator > 1) {
    const escolhida =
      (packagingId && produto.packagings.find((p) => p.id === packagingId)) ||
      // Sem escolha explícita, reaproveita a embalagem de mesmo fator: criar uma
      // segunda "Caixa" de mesmo fator seria sujeira que só o operador limparia.
      produto.packagings.find((p) => Number(p.fatorConversao) === fator);

    if (escolhida) {
      packagingId = escolhida.id;
      const dados: { ean?: string; isCompraDefault?: boolean } = {};
      if (!escolhida.ean && item.gtin) dados.ean = item.gtin;
      if (!escolhida.isCompraDefault) dados.isCompraDefault = true;
      if (Object.keys(dados).length > 0) {
        await db.productPackaging.update({ where: { id: escolhida.id }, data: dados });
        if (dados.ean) preenchidos.push("código de barras da embalagem");
      }
    } else {
      const nova = await db.productPackaging.create({
        data: {
          tenantId,
          productId,
          nome: nomeDaEmbalagem(item.unidade),
          ean: item.gtin,
          fatorConversao: fator,
          isCompraDefault: true,
        },
        select: { id: true, nome: true },
      });
      packagingId = nova.id;
      preenchidos.push(`formato de compra “${nova.nome}”`);
    }
  }

  // ── Campos do produto ──────────────────────────────────────
  const dadosProduto: Record<string, unknown> = {};

  // GTIN de unidade (fator 1) é o EAN do produto; o de caixa não é — colar um
  // DUN de fardo no campo do produto faria o PDV bipar a caixa como unidade.
  if (!produto.ean && item.gtin && fator === 1) {
    dadosProduto.ean = item.gtin;
    preenchidos.push("código de barras");
  }

  // Custo de referência: só quando está vazio. Atualizar o custo de um produto
  // que já tem histórico é decisão da entrada (é lá que o dinheiro é real).
  if ((produto.custo == null || Number(produto.custo) === 0) && custoBase > 0) {
    dadosProduto.custo = custoBase;
    preenchidos.push("valor de custo");
  }

  // Unidade tributável — o que a nota declara em uTrib/qTrib. Serve à emissão
  // e ao cálculo de fator, e é campo que ninguém preenche à mão.
  const fatorTrib = fatorDaNota(item);
  if (!produto.unidadeTributavel && item.unidadeTributavel && item.unidadeTributavel !== item.unidade) {
    dadosProduto.unidadeTributavel = item.unidadeTributavel;
    if (produto.fatorConversaoTrib == null && fatorTrib) {
      dadosProduto.fatorConversaoTrib = fatorTrib;
    }
    preenchidos.push("unidade tributável");
  }
  // Classificação fiscal — NCM/CEST assinados pelo fornecedor.
  //
  // Vale enquanto o produto só carrega o perfil PADRÃO da subcategoria: aquilo
  // é template de seed ("Cerveja (ST) — revisar"), ninguém escolheu para este
  // SKU, e o NCM da nota é mais específico. Perfil escolhido à mão para o
  // produto é decisão do operador ou do contador — palpite de nota não derruba.
  const herdado = produto.subcategory?.defaultFiscalProfile ?? null;
  const soHerdado = !produto.fiscalProfileId || produto.fiscalProfileId === herdado?.id;
  if (soHerdado) {
    const ncmDaNota = (item.ncm ?? "").replace(/\D/g, "");
    const ncmHerdado = (herdado?.ncm ?? "").replace(/\D/g, "");
    if (ncmDaNota && ncmHerdado !== ncmDaNota) {
      const perfil = await resolverPerfilDaNota({
        tenantId,
        classificacao: {
          ncm: item.ncm,
          cest: item.cest,
          cfop: item.cfop,
          temSt: item.valorIcmsSt > 0 || item.valorFcpSt > 0,
        },
        rotulo: produto.subcategory?.nome ?? null,
      });
      if (perfil) {
        dadosProduto.fiscalProfileId = perfil.id;
        preenchidos.push(`perfil fiscal (NCM ${perfil.ncm})`);
      }
    }
  }

  if (!produto.gtinTributavel && item.gtin && fator > 1) {
    // Em venda por caixa, o cEAN da nota é o da caixa e o tributável é o da
    // unidade — guardamos o que veio, que é melhor que campo vazio.
    dadosProduto.gtinTributavel = item.gtin;
  }

  if (Object.keys(dadosProduto).length > 0) {
    await db.product.update({ where: { id: productId }, data: dadosProduto });
  }

  // ── Vínculo com o fornecedor ───────────────────────────────
  if (supplierId) {
    await vincularFornecedor({
      tenantId,
      productId,
      supplierId,
      codigo: item.codigoFornecedor,
      // Bonificação não define preço de compra — custo zero viraria "este
      // fornecedor vende de graça" no comparador.
      custo: item.bonificacao ? null : custoPorUnidadeCompra,
      preenchidos,
    });
  }

  return { packagingId, preenchidos };
}

async function vincularFornecedor(input: {
  tenantId: string;
  productId: string;
  supplierId: string;
  codigo: string;
  custo: number | null;
  preenchidos: string[];
}): Promise<void> {
  const { tenantId, productId, supplierId, codigo, custo, preenchidos } = input;

  const existente = await db.productSupplier.findFirst({
    where: { productId, supplierId },
    select: { id: true, codigoNoFornecedor: true },
  });

  if (existente) {
    await db.productSupplier.update({
      where: { id: existente.id },
      data: {
        codigoNoFornecedor: existente.codigoNoFornecedor ?? codigo,
        ...(custo != null && custo > 0 ? { custoFornecedor: custo } : {}),
      },
    });
    return;
  }

  // Primeiro fornecedor do produto vira o principal — é o que a tela de
  // compras usa para sugerir de quem repor.
  const outros = await db.productSupplier.count({ where: { productId } });
  await db.productSupplier.create({
    data: {
      tenantId,
      productId,
      supplierId,
      codigoNoFornecedor: codigo,
      custoFornecedor: custo != null && custo > 0 ? custo : null,
      isPrincipal: outros === 0,
    },
    select: { id: true },
  });
  preenchidos.push("fornecedor do produto");
}

/**
 * Custo de referência depois da entrada: aqui o dinheiro é real, então
 * sobrescreve mesmo. Roda no fecho do recebimento, produto a produto.
 */
export async function atualizarCustoDeReferencia(
  itens: { productId: string; custoUnitarioBase: number }[],
): Promise<void> {
  for (const i of itens) {
    if (!(i.custoUnitarioBase > 0)) continue;
    await db.product.update({
      where: { id: i.productId },
      data: { custo: i.custoUnitarioBase },
    });
  }
}
