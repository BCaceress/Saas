/**
 * Lança o SALDO INICIAL de implantação a partir de um CSV `Nome;Estoque Atual`
 * exportado do sistema antigo.
 *
 * É o mesmo lançamento que a tela Estoque → Nova entrada → "Estoque inicial"
 * faz, só que em lote: UMA entrada (`Purchase` com `motivo = ESTOQUE_INICIAL`)
 * com todos os itens, para o extrato mostrar "Estoque inicial" e não 350
 * compras avulsas sem fornecedor.
 *
 * Primeira vez, de verdade: produto que JÁ tem saldo no site não é tocado —
 * é listado no relatório. Somar por cima transformaria "contei 39 águas" em
 * 78, e o inventário nasceria mentindo.
 *
 * O casamento é pelo nome NORMALIZADO (`normalizeBrand`), igual a
 * `classificar-produtos.ts`: acento e caixa não atrapalham, mas nome diferente
 * ("Acucar 1kg Diversos" × "Açucar 1kg Caravelas") NÃO casa — e o relatório
 * acusa, em vez de adivinhar.
 *
 * O catálogo novo foi recadastrado com gramatura e marca corrigidas, então
 * dezenas de nomes antigos não têm par exato ("Choc Lacta 80g Laka" virou
 * "Choc Lacta 90g Laka"). Essas equivalências moram num TSV à parte
 * (`scripts/data/estoque-inicial-apelidos.tsv`, `nome no CSV <TAB> nome no
 * banco`) — fora do código, porque dizer que dois nomes são o mesmo produto é
 * decisão do operador, não do script. Várias linhas podem apontar para o mesmo
 * produto: o saldo é SOMADO e o relatório mostra de onde veio.
 *
 * Duas sujeiras que todo sistema antigo entrega, e o que fazemos com elas:
 *
 *   NEGATIVO (-16 cigarros) — não é saldo, é venda sem entrada. O padrão é
 *   NÃO lançar (fica 0) e listar. Com `--negativos` o script grava um AJUSTE
 *   negativo e o saldo nasce devendo, igual ao sistema antigo.
 *
 *   FRACIONADO (3,857 garrafas) — resto de dose num produto que aqui não é
 *   fracionável. A entrada do app conta PEÇA e recusa fração, então:
 *   `--fracao=arredondar` (padrão) arredonda para o inteiro mais próximo;
 *   `--fracao=exata` lança o inteiro na entrada e a fração num AJUSTE à parte,
 *   preservando o número do sistema antigo.
 *
 * Custo: entra 0, porque o CSV não traz custo. `registrarEntrada` recalcula o
 * custo médio, então quem tinha `custoMedio = null` sairia com 0 — e null
 * ("não sei quanto custa") virando 0 ("é de graça") dá margem de 100% e curva
 * ABC zerada. Depois da entrada o script devolve o null a quem o tinha.
 *
 * Uso:
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/estoque-inicial.ts \
 *     <subdomain> [arquivo.csv] [--site "Nome"] [--apelidos arquivo.tsv]
 *     [--fracao=arredondar|exata] [--negativos] [--dry-run]
 *
 * Sem arquivo, usa `scripts/data/estoque-inicial.csv` e
 * `scripts/data/estoque-inicial-apelidos.tsv`. O `--tsconfig` é obrigatório:
 * ele mapeia `server-only` para o stub (ver `scripts/shims/server-only.ts`).
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { basePrisma, db } from "../src/lib/prisma";
import { runWithTenant } from "../src/lib/tenant-context";
import { normalizeBrand } from "../src/lib/normalize";
import { registrarEntrada, registrarAjuste } from "../src/lib/estoque";

const CSV_PADRAO = resolve(import.meta.dirname, "data", "estoque-inicial.csv");
const APELIDOS_PADRAO = resolve(import.meta.dirname, "data", "estoque-inicial-apelidos.tsv");

type Linha = { nome: string; quantidade: number; linha: number };

/** "39,0" e "39.0" são o mesmo número — o export varia com o locale do Excel. */
function parseQuantidade(bruto: string, linha: number): number {
  const t = bruto.trim();
  // 1.234,56 (pt-BR) → 1234.56 ; 1234.56 (en) fica como está.
  const norm = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  const n = Number(norm);
  if (!Number.isFinite(n)) throw new Error(`Linha ${linha}: quantidade inválida «${bruto}».`);
  return n;
}

function lerCsv(arquivo: string): Linha[] {
  const texto = readFileSync(arquivo, "utf8").replace(/^﻿/, "");
  const linhas: Linha[] = [];
  texto.split(/\r?\n/).forEach((raw, i) => {
    const n = i + 1;
    if (!raw.trim()) return;
    const [nomeBruto, qtdBruta] = raw.split(";");
    const nome = (nomeBruto ?? "").trim();
    // Cabeçalho e a linha de total do rodapé (nome vazio) não são produto.
    if (!nome) return;
    if (n === 1 && !/^-?[\d.,]+$/.test((qtdBruta ?? "").trim())) return;
    linhas.push({ nome, quantidade: parseQuantidade(qtdBruta ?? "", n), linha: n });
  });
  return linhas;
}

/** `nome no CSV <TAB> nome no banco` → mapa por nome normalizado. */
function lerApelidos(arquivo: string): Map<string, string> {
  const m = new Map<string, string>();
  if (!existsSync(arquivo)) return m;
  const texto = readFileSync(arquivo, "utf8").replace(/^﻿/, "");
  texto.split(/\r?\n/).forEach((raw, i) => {
    const l = raw.trim();
    if (!l || l.startsWith("#")) return;
    const [de, para] = raw.split("\t").map((c) => (c ?? "").trim());
    if (!de || !para) throw new Error(`Linha ${i + 1} dos apelidos não tem as 2 colunas: «${l}»`);
    m.set(normalizeBrand(de), para);
  });
  return m;
}

type Fracao = "arredondar" | "exata";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const comNegativos = args.includes("--negativos");
  const fracao: Fracao = args.includes("--fracao=exata") ? "exata" : "arredondar";
  const valorDe = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const siteArg = valorDe("--site");
  const apelidosArg = valorDe("--apelidos");
  const comValor = new Set(["--site", "--apelidos"]);
  const posicionais = args.filter((a, i) => !a.startsWith("--") && !comValor.has(args[i - 1] ?? ""));
  const [subdomain, arquivoArg] = posicionais;
  const arquivo = arquivoArg ? resolve(arquivoArg) : CSV_PADRAO;
  const arquivoApelidos = apelidosArg ? resolve(apelidosArg) : APELIDOS_PADRAO;

  if (!subdomain) {
    console.error(
      "Uso: npx tsx --tsconfig scripts/tsconfig.json scripts/estoque-inicial.ts <subdomain> " +
        "[arquivo.csv] [--site \"Nome\"] [--apelidos arquivo.tsv] " +
        "[--fracao=arredondar|exata] [--negativos] [--dry-run]",
    );
    process.exit(1);
  }

  const tenant = await basePrisma.tenant.findFirst({ where: { subdomain } });
  if (!tenant) {
    console.error(`Tenant não encontrado para subdomain "${subdomain}".`);
    process.exit(1);
  }

  const csv = lerCsv(arquivo);
  const apelidos = lerApelidos(arquivoApelidos);

  await runWithTenant(tenant.id, async () => {
    // ── Site de destino ──────────────────────────────────────
    const sites = await db.site.findMany({
      where: { ativo: true },
      select: { id: true, nome: true },
      orderBy: { createdAt: "asc" },
    });
    if (sites.length === 0) {
      throw new Error(`Tenant "${subdomain}" não tem nenhuma loja ativa.`);
    }
    const site = siteArg
      ? sites.find((s) => normalizeBrand(s.nome) === normalizeBrand(siteArg))
      : sites[0];
    if (!site) {
      throw new Error(
        `Loja "${siteArg}" não encontrada. Ativas: ${sites.map((s) => s.nome).join(", ")}.`,
      );
    }
    if (!siteArg && sites.length > 1) {
      console.warn(
        `Tenant tem ${sites.length} lojas ativas — o saldo inteiro vai para "${site.nome}". ` +
          `Use --site "Nome" para escolher outra.`,
      );
    }

    // ── Índice: nome normalizado → produto(s) ────────────────
    const produtos = await db.product.findMany({
      select: { id: true, nome: true, sku: true, ativo: true, controlaEstoque: true, custo: true, custoMedio: true },
    });
    const porNome = new Map<string, typeof produtos>();
    for (const p of produtos) {
      const k = normalizeBrand(p.nome);
      const lista = porNome.get(k);
      if (lista) lista.push(p);
      else porNome.set(k, [p]);
    }

    // ── Saldo atual no site (o guarda da "primeira vez") ─────
    const saldos = await db.stock.findMany({
      where: { siteId: site.id },
      select: { productId: true, estoqueFechado: true, estoqueAberto: true },
    });
    const saldoPorProduto = new Map(
      saldos.map((s) => [s.productId, Number(s.estoqueFechado) + Number(s.estoqueAberto)]),
    );

    // ── Classificação ────────────────────────────────────────
    type Item = { productId: string; nome: string; sku: string; quantidade: number };
    const entrada: Item[] = []; // vai na Purchase ESTOQUE_INICIAL (inteiro > 0)
    const ajustes: { item: Item; motivo: string }[] = []; // fração e negativo
    const zerados: string[] = [];
    const naoEncontrados: string[] = [];
    const ambiguos: string[] = [];
    const jaComSaldo: string[] = [];
    const semControle: string[] = [];
    const inativos: string[] = [];
    const arredondados: string[] = [];
    const fracionadosExatos: string[] = [];
    const negativosIgnorados: string[] = [];
    const casados = new Set<string>();

    // 1ª passada: resolve nome → produto e SOMA as linhas que caem no mesmo
    // produto (o apelido pode apontar 9 sabores de essência para um só).
    type Alvo = { produto: (typeof produtos)[number]; quantidade: number; origens: string[] };
    const porProduto = new Map<string, Alvo>();
    const apelidosUsados: string[] = [];
    const apelidosSemDestino: string[] = [];

    for (const l of csv) {
      const chave = normalizeBrand(l.nome);
      const destino = apelidos.get(chave);
      const alvoNome = destino ?? l.nome;
      const achados = porNome.get(normalizeBrand(alvoNome));
      if (!achados || achados.length === 0) {
        if (destino) apelidosSemDestino.push(`${l.nome} → «${destino}» não existe no banco`);
        else naoEncontrados.push(`${l.nome}  (${l.quantidade})`);
        continue;
      }
      if (achados.length > 1) {
        ambiguos.push(`${alvoNome} — ${achados.length} produtos (${achados.map((p) => p.sku).join(", ")})`);
        continue;
      }
      const produto = achados[0];
      if (destino) apelidosUsados.push(`${l.nome}  →  ${produto.nome} [${produto.sku}]  (${l.quantidade})`);
      const atual = porProduto.get(produto.id);
      if (atual) {
        atual.quantidade += l.quantidade;
        atual.origens.push(`${l.nome} (${l.quantidade})`);
      } else {
        porProduto.set(produto.id, { produto, quantidade: l.quantidade, origens: [`${l.nome} (${l.quantidade})`] });
      }
    }

    const somados = [...porProduto.values()]
      .filter((a) => a.origens.length > 1)
      .map((a) => `${a.produto.nome} [${a.produto.sku}] = ${a.quantidade} ← ${a.origens.join(" + ")}`);

    // 2ª passada: as guardas e o destino de cada saldo já consolidado.
    for (const { produto: p, quantidade } of porProduto.values()) {
      casados.add(p.id);

      if (!p.controlaEstoque) {
        semControle.push(`${p.nome} [${p.sku}]  (${quantidade})`);
        continue;
      }
      const saldoAtual = saldoPorProduto.get(p.id) ?? 0;
      if (saldoAtual !== 0) {
        jaComSaldo.push(`${p.nome} [${p.sku}] — já tem ${saldoAtual} em ${site.nome}, CSV diz ${quantidade}`);
        continue;
      }
      if (quantidade === 0) {
        zerados.push(p.nome);
        continue;
      }
      if (!p.ativo) inativos.push(`${p.nome} [${p.sku}]`);

      const base = { productId: p.id, nome: p.nome, sku: p.sku };
      const l = { quantidade };

      if (l.quantidade < 0) {
        if (!comNegativos) {
          negativosIgnorados.push(`${p.nome} [${p.sku}]  ${l.quantidade}`);
          continue;
        }
        ajustes.push({
          item: { ...base, quantidade: l.quantidade },
          motivo: "Saldo inicial negativo herdado do sistema antigo (venda sem entrada).",
        });
        continue;
      }

      const inteiro = Number.isInteger(l.quantidade);
      if (inteiro) {
        entrada.push({ ...base, quantidade: l.quantidade });
        continue;
      }

      if (fracao === "arredondar") {
        const q = Math.round(l.quantidade);
        arredondados.push(`${p.nome} [${p.sku}]  ${l.quantidade} → ${q}`);
        if (q > 0) entrada.push({ ...base, quantidade: q });
        else zerados.push(p.nome);
      } else {
        const piso = Math.floor(l.quantidade);
        const resto = Number((l.quantidade - piso).toFixed(3));
        fracionadosExatos.push(`${p.nome} [${p.sku}]  ${l.quantidade} = ${piso} + ${resto}`);
        if (piso > 0) entrada.push({ ...base, quantidade: piso });
        if (resto > 0) {
          ajustes.push({
            item: { ...base, quantidade: resto },
            motivo: `Fração do saldo inicial do sistema antigo (${l.quantidade}).`,
          });
        }
      }
    }

    const foraDoCsv = produtos.filter((p) => !casados.has(p.id));

    // ── Relatório ────────────────────────────────────────────
    const cab = dryRun ? "[DRY-RUN] " : "";
    const totalEntrada = entrada.reduce((a, i) => a + i.quantidade, 0);
    console.log(`\n${cab}${tenant.nome} (${subdomain}) → loja "${site.nome}"`);
    console.log(`  CSV: ${csv.length} linha(s) · banco: ${produtos.length} produto(s)`);
    console.log(`  apelidos aplicados: ${apelidosUsados.length} (${apelidos.size} no arquivo)`);
    console.log(`  fração: ${fracao} · negativos: ${comNegativos ? "lançar" : "ignorar"}`);
    console.log(`  entrada ESTOQUE_INICIAL: ${entrada.length} item(ns), ${totalEntrada} peça(s)`);
    console.log(`  ajustes à parte:         ${ajustes.length}`);
    console.log(`  zerados no CSV (nada a lançar): ${zerados.length}`);
    console.log(`  já tinham saldo (NÃO tocados):  ${jaComSaldo.length}`);
    console.log(`  no CSV, sem produto no banco:   ${naoEncontrados.length}`);
    console.log(`  no banco, fora do CSV:          ${foraDoCsv.length}`);
    if (ambiguos.length) console.log(`  nome ambíguo (não tocado):      ${ambiguos.length}`);
    if (semControle.length) console.log(`  sem controle de estoque:        ${semControle.length}`);

    const bloco = (titulo: string, itens: string[]) => {
      if (itens.length === 0) return;
      console.log(`\n  ${titulo} (${itens.length}):`);
      for (const i of itens) console.log(`    - ${i}`);
    };

    bloco("APELIDO COM DESTINO INEXISTENTE — corrija o TSV de apelidos", apelidosSemDestino);
    bloco("SOMADOS — mais de uma linha do CSV caiu no mesmo produto", somados);
    bloco("NO CSV MAS NÃO NO BANCO — cadastre, apelide no TSV, e rode de novo", naoEncontrados);
    bloco("NOME AMBÍGUO — lance à mão, há mais de um produto com o nome", ambiguos);
    bloco("JÁ TINHAM SALDO — o script não soma por cima", jaComSaldo);
    bloco("SEM CONTROLE DE ESTOQUE — produto não entra em /estoque", semControle);
    bloco("NEGATIVOS IGNORADOS — ficam em 0 (use --negativos para lançar)", negativosIgnorados);
    bloco("ARREDONDADOS — use --fracao=exata para preservar a fração", arredondados);
    bloco("FRAÇÃO LANÇADA À PARTE (AJUSTE)", fracionadosExatos);
    bloco("INATIVOS QUE VÃO RECEBER SALDO — confira se é isso mesmo", inativos);
    bloco("APELIDOS APLICADOS", apelidosUsados);
    bloco("NO BANCO MAS FORA DO CSV — ficam em 0", foraDoCsv.map((p) => `${p.nome} [${p.sku}]`));

    if (dryRun) {
      console.log(`\n  Nada foi gravado (--dry-run). Rode sem a flag para lançar de verdade.`);
      return;
    }
    if (entrada.length === 0 && ajustes.length === 0) {
      console.log(`\n  Nada a lançar.`);
      return;
    }

    // ── Gravação ─────────────────────────────────────────────
    // Custo 0: o CSV não traz custo. A entrada do app faria o mesmo.
    if (entrada.length > 0) {
      const purchaseId = await registrarEntrada(
        tenant.id,
        site.id,
        entrada.map((i) => ({ productId: i.productId, quantidade: i.quantidade, custoTotal: 0 })),
        {
          tipo: "MANUAL",
          motivo: "ESTOQUE_INICIAL",
          observacao: `Saldo inicial de implantação importado de ${arquivo.split(/[\\/]/).pop()}.`,
        },
      );
      console.log(`\n  Entrada de estoque inicial gravada (${entrada.length} itens) — purchase ${purchaseId}.`);

      // Devolve o null a quem o tinha: custo 0 não é informação, é ruído.
      const semCusto = entrada
        .map((i) => i.productId)
        .filter((id) => produtos.find((p) => p.id === id)?.custoMedio == null);
      if (semCusto.length > 0) {
        const r = await db.product.updateMany({
          where: { id: { in: semCusto }, custoMedio: 0 },
          data: { custoMedio: null },
        });
        console.log(`  custoMedio devolvido a null em ${r.count} produto(s) (o CSV não traz custo).`);
      }
    }

    for (const a of ajustes) {
      await registrarAjuste(tenant.id, site.id, a.item.productId, { fechado: a.item.quantidade }, a.motivo);
    }
    if (ajustes.length > 0) console.log(`  ${ajustes.length} ajuste(s) gravado(s).`);
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => basePrisma.$disconnect());
