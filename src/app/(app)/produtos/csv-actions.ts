"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/prisma";
import { guardAction } from "@/lib/guard";
import { assertCabeProduto } from "@/lib/limites";
import { runWithTenant } from "@/lib/tenant-context";
import { normalizeBrand, normalizeSkuPrefix, onlyDigits, semAcento } from "@/lib/normalize";
import { getOrCreateDefaultSite } from "@/lib/sites";
import { generateSku } from "@/lib/sku";
import { parseBool, parseEan, parseNumero, parseUnidade, type CsvRow } from "./_sheets/csv-campos";
import { createCategory, createSubcategory } from "./actions";

export type ImportOptions = {
  /** Cria a subcategoria (e a categoria) que não existir, em vez de recusar a linha. */
  criarFaltantes?: boolean;
};

export type ImportResult = {
  criados: number;
  /** Linha recusada — nada foi gravado. */
  erros: { linha: number; motivo: string }[];
  /** Linha gravada, mas algum campo foi ignorado ou caiu no padrão. */
  avisos: { linha: number; motivo: string }[];
};

type SubComCategoria = {
  id: string;
  nome: string;
  skuPrefix: string;
  defaultFiscalProfileId: string | null;
  category: { id: string; nome: string; skuPrefix: string };
};

/**
 * Importação CSV (PRD §8.3): cria produtos em lote. Só cria — nunca atualiza o
 * que já existe; produto repetido (mesmo código de barras ou SKU) vira erro de
 * linha em vez de duplicata silenciosa.
 *
 * O que não casa com cadastro existente (fornecedor, perfil fiscal, localização)
 * não derruba a linha: vira aviso e o produto entra sem aquele vínculo. Marca
 * inexistente é criada; subcategoria só é criada com `criarFaltantes`.
 */
export async function commitImport(
  rows: CsvRow[],
  opts: ImportOptions = {},
): Promise<ImportResult> {
  const ctx = await guardAction("produto.editar");
  const tid = ctx.tenant.id;

  return runWithTenant(tid, async () => {
    const result: ImportResult = { criados: 0, erros: [], avisos: [] };

    // Limite conferido de uma vez, antes de gravar: importar metade da planilha
    // e parar no meio deixaria o catálogo num estado que ninguém pediu.
    await assertCabeProduto(tid, rows.length);

    const eansArquivo = [
      ...new Set(
        rows
          .map((r) => parseEan(r.ean).ean)
          .filter((e): e is string => !!e && e.length >= 8),
      ),
    ];
    const skusArquivo = [
      ...new Set(rows.map((r) => (r.sku ?? "").trim().toUpperCase()).filter(Boolean)),
    ];

    // Tudo que a planilha pode referenciar entra em memória de uma vez — 500
    // linhas × 6 consultas cada seria meia hora de round-trip ao Neon.
    const [subs, cats, brands, suppliers, fiscais, site, eansUsados, skusUsados] =
      await Promise.all([
        db.subcategory.findMany({
          select: {
            id: true,
            nome: true,
            skuPrefix: true,
            defaultFiscalProfileId: true,
            category: { select: { id: true, nome: true, skuPrefix: true } },
          },
        }),
        db.category.findMany({ select: { id: true, nome: true } }),
        db.brand.findMany({ select: { id: true, nomeNormalizado: true } }),
        db.supplier.findMany({
          select: { id: true, cnpj: true, razaoSocial: true, nomeFantasia: true },
        }),
        db.fiscalProfile.findMany({ select: { id: true, nome: true, ncm: true } }),
        getOrCreateDefaultSite(tid),
        eansArquivo.length
          ? db.product.findMany({ where: { ean: { in: eansArquivo } }, select: { ean: true } })
          : Promise.resolve([]),
        skusArquivo.length
          ? db.product.findMany({ where: { sku: { in: skusArquivo } }, select: { sku: true } })
          : Promise.resolve([]),
      ]);

    const locais = await db.storageLocation.findMany({
      where: { siteId: site.id },
      select: { id: true, nome: true },
    });

    const listaSubs: SubComCategoria[] = [...subs];
    const listaCats = [...cats];
    const brandCache = new Map(brands.map((b) => [b.nomeNormalizado, b.id]));
    // Guarda o que já foi visto no banco E no próprio arquivo — a segunda linha
    // com o mesmo código de barras é tão duplicata quanto a que já estava lá.
    const eansVistos = new Set(eansUsados.map((p) => p.ean!).filter(Boolean));
    const skusVistos = new Set(skusUsados.map((p) => p.sku));

    function acharSub(key: string): SubComCategoria | undefined {
      const prefixo = normalizeSkuPrefix(key);
      return (
        listaSubs.find((s) => s.skuPrefix === prefixo) ??
        listaSubs.find((s) => semAcento(s.nome) === semAcento(key))
      );
    }

    /** Cria categoria (se preciso) + subcategoria e devolve já com a categoria junto. */
    async function criarSub(nomeSub: string, nomeCat: string): Promise<SubComCategoria> {
      const cat =
        listaCats.find((c) => semAcento(c.nome) === semAcento(nomeCat)) ??
        (await createCategory(nomeCat));
      if (!listaCats.some((c) => c.id === cat.id)) listaCats.push({ id: cat.id, nome: cat.nome });

      const id = await createSubcategory({ categoryId: cat.id, nome: nomeSub });
      const criada = await db.subcategory.findFirst({
        where: { id },
        select: {
          id: true,
          nome: true,
          skuPrefix: true,
          defaultFiscalProfileId: true,
          category: { select: { id: true, nome: true, skuPrefix: true } },
        },
      });
      if (!criada) throw new Error("Falha ao criar a subcategoria.");
      listaSubs.push(criada);
      return criada;
    }

    async function acharBrandId(marca: string): Promise<string> {
      const norm = normalizeBrand(marca);
      const cached = brandCache.get(norm);
      if (cached) return cached;
      const existente = await db.brand.findFirst({ where: { nomeNormalizado: norm } });
      const b =
        existente ??
        (await db.brand.create({ data: { tenantId: tid, nome: marca, nomeNormalizado: norm } }));
      brandCache.set(norm, b.id);
      return b.id;
    }

    function acharFornecedor(valor: string) {
      const digitos = onlyDigits(valor);
      if (digitos.length === 14) {
        const porCnpj = suppliers.find((s) => onlyDigits(s.cnpj ?? "") === digitos);
        if (porCnpj) return porCnpj;
      }
      const alvo = semAcento(valor);
      return suppliers.find(
        (s) => semAcento(s.razaoSocial) === alvo || semAcento(s.nomeFantasia ?? "") === alvo,
      );
    }

    function acharFiscal(valor: string) {
      const alvo = semAcento(valor);
      const digitos = onlyDigits(valor);
      return (
        fiscais.find((f) => semAcento(f.nome) === alvo) ??
        (digitos.length >= 6 ? fiscais.find((f) => onlyDigits(f.ncm) === digitos) : undefined)
      );
    }

    for (let i = 0; i < rows.length; i++) {
      const linha = i + 2; // +1 cabeçalho, +1 base-1
      const row = rows[i];
      const erro = (motivo: string) => result.erros.push({ linha, motivo });
      const aviso = (motivo: string) => result.avisos.push({ linha, motivo });

      const nome = row.nome?.trim();
      if (!nome || nome.length < 2) {
        erro("Sem nome.");
        continue;
      }

      // ── Subcategoria ────────────────────────────────────────
      const chaveSub = (row.subcategoria ?? "").trim();
      if (!chaveSub) {
        erro("Sem subcategoria.");
        continue;
      }
      let sub = acharSub(chaveSub);
      if (!sub) {
        const nomeCat = (row.categoria ?? "").trim();
        if (!opts.criarFaltantes) {
          erro(`Subcategoria "${chaveSub}" não encontrada.`);
          continue;
        }
        if (!nomeCat) {
          erro(`Subcategoria "${chaveSub}" não existe e a linha não traz a categoria dela.`);
          continue;
        }
        try {
          sub = await criarSub(chaveSub, nomeCat);
          aviso(`Subcategoria "${sub.nome}" criada em "${nomeCat}".`);
        } catch (e) {
          erro(e instanceof Error ? e.message : `Não foi possível criar "${chaveSub}".`);
          continue;
        }
      }

      // ── Códigos ─────────────────────────────────────────────
      const eanBruto = (row.ean ?? "").trim();
      let ean: string | null = null;
      if (eanBruto) {
        const lido = parseEan(eanBruto);
        if (lido.problema === "cientifico") {
          aviso(
            `Código de barras "${eanBruto}" veio em notação científica (a planilha o tratou como número) — produto criado sem código. Formate a coluna como texto e importe de novo.`,
          );
        } else if (!lido.ean || lido.ean.length < 8 || lido.ean.length > 14) {
          aviso(`Código de barras "${eanBruto}" inválido — produto criado sem código.`);
        } else if (eansVistos.has(lido.ean)) {
          erro(`Código de barras ${lido.ean} já cadastrado.`);
          continue;
        } else {
          ean = lido.ean;
          if (lido.ajustado) aviso(`Código de barras "${eanBruto}" corrigido para ${ean}.`);
          if (lido.problema === "digito") {
            aviso(`Código de barras ${ean} tem dígito verificador inválido — confira o cadastro.`);
          }
        }
      }

      const skuInformado = (row.sku ?? "").trim().toUpperCase();
      if (skuInformado && skusVistos.has(skuInformado)) {
        erro(`SKU "${skuInformado}" já está em uso.`);
        continue;
      }

      // ── Utilização ──────────────────────────────────────────
      const unidade = parseUnidade(row.unidadeBase);
      if (unidade === null) aviso(`Unidade "${row.unidadeBase}" desconhecida — usei UN.`);
      const fracionavel = parseBool(row.fracionavel, false);
      let vendaUnidade = parseBool(row.vendaUnidade, true);
      if (!vendaUnidade && !fracionavel) {
        vendaUnidade = true;
        aviso("Sem utilização marcada — deixei como venda por unidade.");
      }
      const conteudo = parseNumero(row.conteudoPorUnidade);
      const dose = parseNumero(row.dosePadrao);
      if (fracionavel && !conteudo) {
        aviso("Produto fracionável sem conteúdo por unidade — o rendimento em doses fica em branco.");
      }

      // ── Vínculos opcionais ──────────────────────────────────
      let brandId: string | null = null;
      const marca = row.marca?.trim();
      if (marca) brandId = await acharBrandId(marca);

      let fornecedorId: string | null = null;
      const fornecedor = (row.fornecedor ?? "").trim();
      if (fornecedor) {
        const s = acharFornecedor(fornecedor);
        if (s) fornecedorId = s.id;
        else aviso(`Fornecedor "${fornecedor}" não encontrado — produto criado sem fornecedor.`);
      }

      let fiscalProfileId: string | null = sub.defaultFiscalProfileId;
      const perfil = (row.perfilFiscal ?? "").trim();
      if (perfil) {
        const f = acharFiscal(perfil);
        if (f) fiscalProfileId = f.id;
        else aviso(`Perfil fiscal "${perfil}" não encontrado — usei o padrão da subcategoria.`);
      }

      let locationId: string | null = null;
      const local = (row.localizacao ?? "").trim();
      if (local) {
        const l = locais.find((x) => semAcento(x.nome) === semAcento(local));
        if (l) locationId = l.id;
        else aviso(`Localização "${local}" não encontrada — produto criado sem local.`);
      }

      // ── Embalagem de compra ─────────────────────────────────
      const embalagem = (row.embalagem ?? "").trim();
      const fator = parseNumero(row.embalagemFator);
      const temEmbalagem = !!embalagem && !!fator && fator > 0;
      if (embalagem && !temEmbalagem) {
        aviso(`Embalagem "${embalagem}" sem quantidade de unidades — ignorada.`);
      }

      const peso = parseNumero(row.pesoGramas);

      try {
        const sku =
          skuInformado || (await generateSku(sub.category.skuPrefix, sub.skuPrefix));

        const product = await db.product.create({
          data: {
            tenantId: tid,
            tipo: "SIMPLES",
            nome,
            sku,
            ean,
            subcategoryId: sub.id,
            brandId,
            imagemUrl: row.imagemUrl?.trim() || null,
            ativo: parseBool(row.ativo, true),

            unidadeBase: unidade ?? "UN",
            vendaUnidade,
            fracionavel,
            conteudoPorUnidade: conteudo,
            dosePadrao: fracionavel ? dose : null,

            precoVenda: parseNumero(row.precoVenda),
            custo: parseNumero(row.custo),

            fiscalProfileId,
            restricaoIdade: parseBool(row.restricaoIdade, false),
            gtinTributavel: row.gtinTributavel?.trim() || null,
            unidadeTributavel: row.unidadeTributavel?.trim().toUpperCase() || null,
            fatorConversaoTrib: parseNumero(row.fatorConversaoTrib),
            codigoAnp: row.codigoAnp?.trim() || null,

            vendeOnline: parseBool(row.vendeOnline, false),
            pesoGramas: peso ? Math.round(peso) : null,
            alturaCm: parseNumero(row.alturaCm),
            larguraCm: parseNumero(row.larguraCm),
            comprimentoCm: parseNumero(row.comprimentoCm),
            descricaoOnline: row.descricaoOnline?.trim() || null,

            stocks: {
              create: [
                {
                  tenantId: tid,
                  siteId: site.id,
                  locationId,
                  estoqueFechado: parseNumero(row.estoqueInicial) ?? 0,
                  estoqueMinimo: parseNumero(row.estoqueMinimo) ?? 0,
                  estoqueIdeal: parseNumero(row.estoqueIdeal) ?? 0,
                },
              ],
            },
          },
        });

        if (temEmbalagem) {
          await db.productPackaging.create({
            data: {
              tenantId: tid,
              productId: product.id,
              nome: embalagem,
              ean: parseEan(row.embalagemEan).ean,
              fatorConversao: fator!,
              isCompraDefault: true,
            },
          });
        }
        if (fornecedorId) {
          await db.productSupplier.create({
            data: {
              tenantId: tid,
              productId: product.id,
              supplierId: fornecedorId,
              codigoNoFornecedor: row.codigoNoFornecedor?.trim() || null,
              custoFornecedor: parseNumero(row.custo),
              isPrincipal: true,
            },
          });
        }

        if (ean) eansVistos.add(ean);
        skusVistos.add(sku);
        result.criados++;
      } catch (e) {
        erro(e instanceof Error ? e.message : "Falha ao gravar.");
      }
    }

    revalidatePath("/produtos");
    revalidatePath("/estoque");
    return result;
  });
}
