/**
 * Classifica produtos já cadastrados em categoria › subcategoria a partir de um
 * mapa TSV (`nome <TAB> categoria <TAB> subcategoria`).
 *
 * Serve o caso em que o catálogo entrou por importação e caiu todo numa
 * subcategoria só: aqui o operador entrega a planilha de classificação e o
 * script aplica de uma vez. A categoria/subcategoria TEM de existir — este
 * script não cria taxonomia, isso é papel de `ajustar-categorias.ts`.
 *
 * O casamento é pelo nome NORMALIZADO (`normalizeBrand`: maiúsculas, sem
 * acento, pontuação virando espaço). Sem isso "Whisky Jack Daniel's 1l Fire" no
 * banco e "Jack Daniels" na planilha nunca se encontrariam — e o relatório
 * acusaria falta onde não há.
 *
 * O SKU NÃO é regravado. `Product.sku` é string gravada, não derivada: a
 * etiqueta "BEB-CER-6489" já está na prateleira e nas notas que saíram. Trocar
 * o SKU junto com a subcategoria quebraria a leitura do código na gôndola.
 * Produto novo nasce com o prefixo certo; o antigo guarda o seu.
 *
 * Uso:
 *   npx tsx scripts/classificar-produtos.ts <subdomain> [arquivo.tsv] [--dry-run]
 *
 * Sem arquivo, usa `scripts/data/produtos-categorias.tsv`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { basePrisma, db } from "../src/lib/prisma";
import { runWithTenant } from "../src/lib/tenant-context";
import { normalizeBrand } from "../src/lib/normalize";

const TSV_PADRAO = resolve(import.meta.dirname, "data", "produtos-categorias.tsv");

type Linha = { nome: string; categoria: string; subcategoria: string; linha: number };

function lerMapa(arquivo: string): Linha[] {
  // ﻿: o arquivo é UTF-8 com BOM para o Excel não comer os acentos ao abrir.
  const texto = readFileSync(arquivo, "utf8").replace(/^﻿/, "");
  const linhas: Linha[] = [];
  texto.split(/\r?\n/).forEach((raw, i) => {
    const l = raw.trim();
    if (!l || l.startsWith("#")) return;
    const [nome, categoria, subcategoria] = raw.split("\t").map((c) => (c ?? "").trim());
    if (!nome || !categoria || !subcategoria) {
      throw new Error(`Linha ${i + 1} do mapa não tem as 3 colunas: «${l}»`);
    }
    linhas.push({ nome, categoria, subcategoria, linha: i + 1 });
  });
  return linhas;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const [subdomain, arquivoArg] = args.filter((a) => !a.startsWith("--"));
  const arquivo = arquivoArg ? resolve(arquivoArg) : TSV_PADRAO;

  if (!subdomain) {
    console.error(
      "Uso: npx tsx scripts/classificar-produtos.ts <subdomain> [arquivo.tsv] [--dry-run]",
    );
    process.exit(1);
  }

  const tenant = await basePrisma.tenant.findFirst({ where: { subdomain } });
  if (!tenant) {
    console.error(`Tenant não encontrado para subdomain "${subdomain}".`);
    process.exit(1);
  }

  const mapa = lerMapa(arquivo);

  await runWithTenant(tenant.id, async () => {
    // ── Taxonomia: "CATEGORIA|SUBCATEGORIA" normalizado → id ──
    const subs = await db.subcategory.findMany({
      select: { id: true, nome: true, category: { select: { nome: true } } },
    });
    const subPorChave = new Map(
      subs.map((s) => [`${normalizeBrand(s.category.nome)}|${normalizeBrand(s.nome)}`, s]),
    );

    // ── Produtos: nome normalizado → produto ──
    const produtos = await db.product.findMany({
      select: {
        id: true,
        nome: true,
        sku: true,
        subcategoryId: true,
        subcategory: { select: { nome: true, category: { select: { nome: true } } } },
      },
    });
    const prodPorNome = new Map<string, typeof produtos>();
    for (const p of produtos) {
      const k = normalizeBrand(p.nome);
      const lista = prodPorNome.get(k);
      if (lista) lista.push(p);
      else prodPorNome.set(k, [p]);
    }

    const aplicados: string[] = [];
    const jaCorretos: string[] = [];
    const semSubcategoria: string[] = [];
    const semProduto: string[] = [];
    const ambiguos: string[] = [];
    const casados = new Set<string>();

    for (const l of mapa) {
      const chaveSub = `${normalizeBrand(l.categoria)}|${normalizeBrand(l.subcategoria)}`;
      const sub = subPorChave.get(chaveSub);
      if (!sub) {
        semSubcategoria.push(`linha ${l.linha}: «${l.categoria} › ${l.subcategoria}» (${l.nome})`);
        continue;
      }

      const achados = prodPorNome.get(normalizeBrand(l.nome));
      if (!achados || achados.length === 0) {
        semProduto.push(`${l.nome}  →  ${l.categoria} › ${l.subcategoria}`);
        continue;
      }
      if (achados.length > 1) {
        ambiguos.push(`${l.nome} — ${achados.length} produtos com este nome (${achados.map((p) => p.sku).join(", ")})`);
        continue;
      }

      const p = achados[0];
      casados.add(p.id);
      if (p.subcategoryId === sub.id) {
        jaCorretos.push(p.nome);
        continue;
      }
      const de = p.subcategory
        ? `${p.subcategory.category.nome} › ${p.subcategory.nome}`
        : "(sem subcategoria)";
      if (!dryRun) {
        await db.product.update({ where: { id: p.id }, data: { subcategoryId: sub.id } });
      }
      aplicados.push(`${p.nome} [${p.sku}]: ${de} → ${l.categoria} › ${l.subcategoria}`);
    }

    const naoListados = produtos.filter((p) => !casados.has(p.id));

    // ── Relatório ──
    const cab = dryRun ? "[DRY-RUN] " : "";
    console.log(`\n${cab}${tenant.nome} (${subdomain})`);
    console.log(`  mapa: ${mapa.length} linha(s) · banco: ${produtos.length} produto(s)`);
    console.log(`  classificados agora: ${aplicados.length}`);
    console.log(`  já estavam certos:   ${jaCorretos.length}`);
    console.log(`  no mapa, sem produto no banco: ${semProduto.length}`);
    console.log(`  no banco, fora do mapa:        ${naoListados.length}`);
    if (semSubcategoria.length) console.log(`  subcategoria inexistente:      ${semSubcategoria.length}`);
    if (ambiguos.length) console.log(`  nome ambíguo (não tocado):     ${ambiguos.length}`);

    const bloco = (titulo: string, itens: string[]) => {
      if (itens.length === 0) return;
      console.log(`\n  ${titulo} (${itens.length}):`);
      for (const i of itens) console.log(`    - ${i}`);
    };

    bloco("SUBCATEGORIA NÃO EXISTE no banco — rode ajustar-categorias.ts", semSubcategoria);
    bloco("NOME AMBÍGUO — classifique à mão, há mais de um produto com o nome", ambiguos);
    bloco("NO MAPA MAS NÃO NO BANCO — produto não cadastrado (ou nome diferente)", semProduto);
    bloco(
      "NO BANCO MAS FORA DO MAPA — ficou com a classificação que já tinha",
      naoListados.map(
        (p) =>
          `${p.nome} [${p.sku}] — hoje em ${p.subcategory ? `${p.subcategory.category.nome} › ${p.subcategory.nome}` : "(sem subcategoria)"}`,
      ),
    );
    bloco("CLASSIFICADOS", aplicados);
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => basePrisma.$disconnect());
