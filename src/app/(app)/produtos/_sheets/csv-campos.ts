/**
 * Catálogo de campos da importação CSV de produtos — fonte única do que a
 * planilha aceita. Vive fora do arquivo "use server" (que só pode exportar
 * funções async) e fora do client, porque os dois lados leem daqui: a tela usa
 * para montar o mapeamento e o modelo, a server action usa para gravar.
 */

import { onlyDigits, semAcento } from "@/lib/normalize";
import type { EstoquePolicy } from "@/lib/estoque-estrategia";

export type CsvField =
  // Identificação
  | "nome"
  | "subcategoria"
  | "categoria"
  | "marca"
  | "ean"
  | "sku"
  | "imagemUrl"
  | "ativo"
  // Preço
  | "precoVenda"
  | "custo"
  // Compra
  | "fornecedor"
  | "codigoNoFornecedor"
  | "embalagem"
  | "embalagemFator"
  | "embalagemEan"
  // Utilização
  | "unidadeBase"
  | "vendaUnidade"
  | "fracionavel"
  | "conteudoPorUnidade"
  | "dosePadrao"
  // Estoque
  | "estoqueInicial"
  | "estoqueMinimo"
  | "estoqueIdeal"
  | "localizacao"
  // Fiscal
  | "perfilFiscal"
  | "restricaoIdade"
  | "gtinTributavel"
  | "unidadeTributavel"
  | "fatorConversaoTrib"
  | "codigoAnp"
  // Loja online
  | "vendeOnline"
  | "pesoGramas"
  | "alturaCm"
  | "larguraCm"
  | "comprimentoCm"
  | "descricaoOnline";

/** Linha mapeada do CSV (mapeamento de colunas feito no cliente). */
export type CsvRow = Partial<Record<CsvField, string>>;

export type GrupoKey =
  | "identificacao"
  | "preco"
  | "compra"
  | "uso"
  | "estoque"
  | "fiscal"
  | "online";

export const GRUPOS: { key: GrupoKey; label: string; desc: string }[] = [
  { key: "identificacao", label: "Identificação", desc: "Quem é o produto." },
  { key: "preco", label: "Preço", desc: "Quanto custa e por quanto sai." },
  { key: "compra", label: "Compra", desc: "De quem você compra e em que embalagem." },
  { key: "uso", label: "Utilização", desc: "Vende a unidade, rende dose, ou os dois." },
  { key: "estoque", label: "Estoque", desc: "Saldo de partida e metas de reposição." },
  { key: "fiscal", label: "Fiscal", desc: "Perfil tributário e dados por item." },
  { key: "online", label: "Loja online", desc: "Peso, medidas e descrição para venda online." },
];

export type CampoCsv = {
  key: CsvField;
  label: string;
  grupo: GrupoKey;
  /** Formato aceito — aparece na tela de mapeamento. */
  formato?: string;
  obrigatorio?: boolean;
  /** Fora do modelo básico (só entra no modelo completo). */
  avancado?: boolean;
  /** Três valores de exemplo — viram as linhas do arquivo modelo. */
  exemplo: [string, string, string];
  /** Pedaços de nome de coluna que casam com este campo no auto-mapeamento. */
  aliases: string[];
};

/**
 * Ordem aqui = ordem das colunas do modelo e da tela. Os exemplos contam três
 * casos reais: cerveja em caixa, destilado fracionado em doses, refrigerante.
 */
export const CAMPOS: CampoCsv[] = [
  // ── Identificação ──────────────────────────────────────────
  {
    key: "nome",
    label: "Nome",
    grupo: "identificacao",
    obrigatorio: true,
    exemplo: ["Heineken Long Neck 330ml", "Vodka Absolut 1L", "Coca-Cola 2L"],
    aliases: ["nome", "produto", "descri", "item"],
  },
  {
    key: "subcategoria",
    label: "Subcategoria",
    grupo: "identificacao",
    obrigatorio: true,
    formato: "prefixo (CER) ou nome (Cervejas) — precisa existir",
    exemplo: ["Cervejas", "Destilados", "Refrigerantes"],
    aliases: ["subcategoria", "sub categoria", "categoria", "tipo", "secao", "grupo"],
  },
  {
    key: "categoria",
    label: "Categoria",
    grupo: "identificacao",
    formato: "só usada para criar a subcategoria que faltar",
    exemplo: ["Bebidas", "Bebidas", "Bebidas"],
    aliases: ["categoria pai", "categoria principal", "departamento", "familia"],
  },
  {
    key: "marca",
    label: "Marca",
    grupo: "identificacao",
    formato: "criada automaticamente se não existir",
    exemplo: ["Heineken", "Absolut", "Coca-Cola"],
    aliases: ["marca", "fabricante", "brand"],
  },
  {
    key: "ean",
    label: "Código de barras",
    grupo: "identificacao",
    formato: "EAN/GTIN — formate a coluna como TEXTO no Excel",
    exemplo: ["7896045506873", "7312040017027", "7894900011517"],
    aliases: ["ean", "barra", "gtin", "codigo de barras", "cod barras"],
  },
  {
    key: "sku",
    label: "SKU",
    grupo: "identificacao",
    formato: "deixe vazio para o sistema gerar",
    avancado: true,
    exemplo: ["", "", ""],
    aliases: ["sku", "codigo interno", "referencia"],
  },
  {
    key: "imagemUrl",
    label: "URL da imagem",
    grupo: "identificacao",
    avancado: true,
    exemplo: ["", "", ""],
    aliases: ["imagem", "foto", "url da imagem"],
  },
  {
    key: "ativo",
    label: "Ativo",
    grupo: "identificacao",
    formato: "sim / não (padrão: sim)",
    avancado: true,
    exemplo: ["sim", "sim", "sim"],
    aliases: ["ativo", "situacao", "status"],
  },

  // ── Preço ──────────────────────────────────────────────────
  {
    key: "precoVenda",
    label: "Preço de venda",
    grupo: "preco",
    formato: "vírgula como decimal (7,90)",
    exemplo: ["7,90", "89,90", "9,50"],
    aliases: ["preco de venda", "preco venda", "venda", "preco", "valor"],
  },
  {
    key: "custo",
    label: "Custo",
    grupo: "preco",
    formato: "vírgula como decimal (5,20)",
    exemplo: ["5,20", "62,00", "6,30"],
    aliases: ["custo", "preco de custo", "compra", "entrada"],
  },

  // ── Compra ─────────────────────────────────────────────────
  {
    key: "fornecedor",
    label: "Fornecedor",
    grupo: "compra",
    formato: "CNPJ ou razão social/nome fantasia — precisa existir",
    exemplo: ["Distribuidora Sul", "Distribuidora Sul", ""],
    aliases: ["fornecedor", "distribuidor", "supplier"],
  },
  {
    key: "codigoNoFornecedor",
    label: "Código no fornecedor",
    grupo: "compra",
    avancado: true,
    exemplo: ["", "", ""],
    aliases: ["codigo no fornecedor", "cod fornecedor", "referencia fornecedor"],
  },
  {
    key: "embalagem",
    label: "Embalagem de compra",
    grupo: "compra",
    formato: "Caixa, Fardo, Engradado… (vazio = compra solto)",
    exemplo: ["Caixa", "", "Fardo"],
    aliases: ["embalagem", "caixa", "fardo", "unidade de compra"],
  },
  {
    key: "embalagemFator",
    label: "Unidades por embalagem",
    grupo: "compra",
    formato: "quantas unidades vêm na caixa/fardo",
    exemplo: ["24", "", "6"],
    aliases: ["unidades por", "fator", "qtd embalagem", "por caixa", "conversao"],
  },
  {
    key: "embalagemEan",
    label: "Código de barras da embalagem",
    grupo: "compra",
    avancado: true,
    exemplo: ["", "", ""],
    aliases: ["ean embalagem", "barra caixa", "dun"],
  },

  // ── Utilização ─────────────────────────────────────────────
  {
    key: "unidadeBase",
    label: "Unidade base",
    grupo: "uso",
    formato: "UN, ML ou G (padrão: UN)",
    exemplo: ["UN", "ML", "UN"],
    aliases: ["unidade base", "unidade", "un medida", "medida"],
  },
  {
    key: "vendaUnidade",
    label: "Vende por unidade",
    grupo: "uso",
    formato: "sim / não (padrão: sim)",
    exemplo: ["sim", "sim", "sim"],
    aliases: ["vende por unidade", "venda unidade", "vende unidade"],
  },
  {
    key: "fracionavel",
    label: "Usa em drinks/receitas",
    grupo: "uso",
    formato: "sim / não (padrão: não)",
    exemplo: ["não", "sim", "não"],
    aliases: ["fracion", "drink", "receita", "dose"],
  },
  {
    key: "conteudoPorUnidade",
    label: "Conteúdo por unidade",
    grupo: "uso",
    formato: "na unidade base (1000 = 1 L em ML)",
    exemplo: ["", "1000", ""],
    aliases: ["conteudo", "volume", "capacidade"],
  },
  {
    key: "dosePadrao",
    label: "Dose padrão",
    grupo: "uso",
    formato: "na unidade base (50 = 50 ml)",
    exemplo: ["", "50", ""],
    aliases: ["dose padrao", "dose", "porcao"],
  },

  // ── Estoque ────────────────────────────────────────────────
  {
    key: "estoqueInicial",
    label: "Estoque inicial",
    grupo: "estoque",
    exemplo: ["48", "6", "24"],
    aliases: ["estoque inicial", "inicial", "saldo", "quantidade", "qtd", "estoque"],
  },
  {
    key: "estoqueMinimo",
    label: "Estoque mínimo",
    grupo: "estoque",
    exemplo: ["24", "2", "12"],
    aliases: ["estoque minimo", "minimo", "min"],
  },
  {
    key: "estoqueIdeal",
    label: "Estoque ideal",
    grupo: "estoque",
    exemplo: ["60", "6", "36"],
    aliases: ["estoque ideal", "ideal", "maximo", "max"],
  },
  {
    key: "localizacao",
    label: "Localização",
    grupo: "estoque",
    formato: "nome do local de armazenagem — precisa existir",
    avancado: true,
    exemplo: ["", "", ""],
    aliases: ["localizacao", "local", "deposito", "geladeira", "prateleira"],
  },

  // ── Fiscal ─────────────────────────────────────────────────
  {
    key: "perfilFiscal",
    label: "Perfil fiscal",
    grupo: "fiscal",
    formato: "nome do perfil ou NCM — precisa existir",
    avancado: true,
    exemplo: ["", "", ""],
    aliases: ["perfil fiscal", "fiscal", "ncm", "tributacao"],
  },
  {
    key: "restricaoIdade",
    label: "Venda proibida para menores",
    grupo: "fiscal",
    formato: "sim / não (padrão: não)",
    exemplo: ["sim", "sim", "não"],
    aliases: ["restricao", "idade", "menor", "18"],
  },
  {
    key: "gtinTributavel",
    label: "GTIN tributável",
    grupo: "fiscal",
    avancado: true,
    exemplo: ["", "", ""],
    aliases: ["gtin trib", "ceantrib"],
  },
  {
    key: "unidadeTributavel",
    label: "Unidade tributável",
    grupo: "fiscal",
    formato: "uTrib (KG, L…) quando difere da unidade de venda",
    avancado: true,
    exemplo: ["", "", ""],
    aliases: ["unidade trib", "utrib"],
  },
  {
    key: "fatorConversaoTrib",
    label: "Fator de conversão tributável",
    grupo: "fiscal",
    avancado: true,
    exemplo: ["", "", ""],
    aliases: ["fator trib", "qtrib"],
  },
  {
    key: "codigoAnp",
    label: "Código ANP",
    grupo: "fiscal",
    formato: "só combustíveis",
    avancado: true,
    exemplo: ["", "", ""],
    aliases: ["anp", "combustivel"],
  },

  // ── Loja online ────────────────────────────────────────────
  {
    key: "vendeOnline",
    label: "Vende online",
    grupo: "online",
    formato: "sim / não (padrão: não)",
    avancado: true,
    exemplo: ["não", "não", "não"],
    aliases: ["vende online", "online", "ecommerce", "marketplace"],
  },
  {
    key: "pesoGramas",
    label: "Peso (g)",
    grupo: "online",
    avancado: true,
    exemplo: ["330", "1400", "2000"],
    aliases: ["peso", "gramas", "peso bruto"],
  },
  {
    key: "alturaCm",
    label: "Altura (cm)",
    grupo: "online",
    avancado: true,
    exemplo: ["", "", ""],
    aliases: ["altura"],
  },
  {
    key: "larguraCm",
    label: "Largura (cm)",
    grupo: "online",
    avancado: true,
    exemplo: ["", "", ""],
    aliases: ["largura"],
  },
  {
    key: "comprimentoCm",
    label: "Comprimento (cm)",
    grupo: "online",
    avancado: true,
    exemplo: ["", "", ""],
    aliases: ["comprimento", "profundidade"],
  },
  {
    key: "descricaoOnline",
    label: "Descrição online",
    grupo: "online",
    avancado: true,
    exemplo: ["", "", ""],
    aliases: ["descricao online", "descricao longa", "texto"],
  },
];

/** Campos obrigatórios — usados na prévia para marcar a linha que será pulada. */
export const OBRIGATORIOS = CAMPOS.filter((c) => c.obrigatorio).map((c) => c.key);

/**
 * Campos que a empresa enxerga: quem controla por giro não preenche mínimo nem
 * ideal (o sistema calcula a necessidade pelo histórico). `completo` liga os
 * campos avançados (fiscal por item, medidas, SKU próprio).
 */
export function camposVisiveis(
  policy: EstoquePolicy,
  opts?: { completo?: boolean },
): CampoCsv[] {
  return CAMPOS.filter((c) => {
    if (c.key === "estoqueMinimo" && !policy.usaMinimo) return false;
    if (c.key === "estoqueIdeal" && !policy.usaIdeal) return false;
    if (c.avancado && !opts?.completo) return false;
    return true;
  });
}

// ── Arquivo modelo ───────────────────────────────────────────

/** Excel pt-BR abre CSV separado por ponto e vírgula — e libera a vírgula decimal. */
const SEP = ";";

function escapar(v: string): string {
  return /[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Modelo com cabeçalho + três linhas de exemplo, na ordem de `campos`. */
export function templateCsv(campos: CampoCsv[]): string {
  const linhas: string[][] = [campos.map((c) => c.key as string)];
  for (let i = 0; i < 3; i++) linhas.push(campos.map((c) => c.exemplo[i]));
  // BOM: sem ele o Excel come os acentos do cabeçalho.
  return "﻿" + linhas.map((l) => l.map(escapar).join(SEP)).join("\r\n") + "\r\n";
}

// ── Auto-mapeamento ──────────────────────────────────────────

const chave = (s: string) => semAcento(s).replace(/[^a-z0-9]/g, "");

/**
 * Casa as colunas do arquivo com os campos: primeiro nome idêntico ao campo
 * (quem baixou o modelo acerta 100%), depois apelidos. Uma coluna só serve a um
 * campo — senão "custo" rouba a coluna "custo fornecedor".
 */
export function autoMapear(headers: string[], campos: CampoCsv[]): Record<string, string> {
  const map: Record<string, string> = {};
  const usados = new Set<string>();

  for (const c of campos) {
    const alvo = chave(c.key);
    const hit = headers.find((h) => !usados.has(h) && (chave(h) === alvo || chave(h) === chave(c.label)));
    if (hit) {
      map[c.key] = hit;
      usados.add(hit);
    }
  }
  for (const c of campos) {
    if (map[c.key]) continue;
    const hit = headers.find(
      (h) => !usados.has(h) && c.aliases.some((a) => semAcento(h).includes(a)),
    );
    if (hit) {
      map[c.key] = hit;
      usados.add(hit);
    }
  }
  return map;
}

// ── Leitura de valores ───────────────────────────────────────

/**
 * Número em formato brasileiro, tolerante ao que sai de planilha: "R$ 1.234,56",
 * "7,90", "48 un". Com vírgula, ela é o decimal e os pontos são milhar. Sem
 * vírgula, um ponto só é decimal ("7.90" = 7,90) e vários são milhar.
 */
export function parseNumero(v?: string): number | null {
  const limpo = (v ?? "").trim().replace(/[^\d,.-]/g, "");
  if (!limpo) return null;
  const normalizado = limpo.includes(",")
    ? limpo.replace(/\./g, "").replace(",", ".")
    : limpo.split(".").length > 2
      ? limpo.replace(/\./g, "")
      : limpo;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

const SIM = ["sim", "s", "true", "1", "x", "v", "verdadeiro", "y", "yes", "ativo"];
const NAO = ["nao", "n", "false", "0", "f", "no", "inativo", "-"];

/** Sim/não em qualquer grafia que planilha produz. Valor estranho cai no padrão. */
export function parseBool(v: string | undefined, padrao: boolean): boolean {
  const s = semAcento(v ?? "");
  if (!s) return padrao;
  if (SIM.includes(s)) return true;
  if (NAO.includes(s)) return false;
  return padrao;
}

// ── Código de barras ─────────────────────────────────────────

/** Comprimentos válidos de GTIN (EAN-8, UPC-A, EAN-13, DUN-14). */
const TAMANHOS_GTIN = [8, 12, 13, 14];

/**
 * Dígito verificador do GTIN (mod 10). É o que separa código de barras de
 * número parecido com um: sem ele não dá para saber se a planilha estragou o
 * valor no caminho.
 */
export function eanValido(ean: string): boolean {
  if (!TAMANHOS_GTIN.includes(ean.length) || !/^\d+$/.test(ean)) return false;
  const d = ean.split("").map(Number);
  const dv = d.pop()!;
  d.reverse();
  const soma = d.reduce((acc, n, i) => acc + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (soma % 10)) % 10 === dv;
}

/**
 * Repõe os zeros à esquerda que a planilha comeu ao tratar o código como número.
 * No máximo dois: com três ou mais, o dígito verificador fecha por coincidência
 * (1 em 10) e o resultado é um código inventado — código curto demais é código
 * truncado de verdade, e aí não há o que restaurar.
 */
const MAX_ZEROS_REPOSTOS = 2;

function comZerosAEsquerda(digitos: string): string | null {
  for (const alvo of TAMANHOS_GTIN) {
    const faltam = alvo - digitos.length;
    if (faltam <= 0 || faltam > MAX_ZEROS_REPOSTOS) continue;
    const cand = digitos.padStart(alvo, "0");
    if (eanValido(cand)) return cand;
  }
  return null;
}

export type EanLido = {
  /** Código pronto para gravar — `null` quando não sobrou nada utilizável. */
  ean: string | null;
  /** Precisou consertar o que a planilha estragou. */
  ajustado: boolean;
  /** Só quando o resultado é duvidoso: dígito verificador não fecha. */
  problema?: "cientifico" | "digito";
};

/**
 * Lê o código de barras como planilha entrega, não como deveria ser.
 *
 * Excel trata EAN como número: "7891050000101" vira "7891050000101,0" (o ",0"
 * colado no fim quebra o código), zeros à esquerda somem ("070847033301" →
 * "70847033301") e códigos longos viram notação científica ("7,89105E+12" —
 * esse não tem conserto, os dígitos se perderam de verdade).
 *
 * Cada correção é confirmada pelo dígito verificador antes de valer: ajuste que
 * não fecha a conta não é ajuste, é chute.
 */
export function parseEan(bruto?: string): EanLido {
  const texto = (bruto ?? "").trim();
  if (!texto) return { ean: null, ajustado: false };

  // Notação científica: os dígitos do meio não existem mais no arquivo.
  if (/\d[.,]?\d*e[+-]?\d+/i.test(texto)) {
    return { ean: null, ajustado: false, problema: "cientifico" };
  }

  const digitosCru = onlyDigits(texto);
  if (!digitosCru) return { ean: null, ajustado: false };
  // Código íntegro (inclusive "7.891.050.000.101" com ponto de milhar) passa direto.
  if (eanValido(digitosCru)) return { ean: digitosCru, ajustado: false };

  // Parte decimal curta ("...,0", "...,00") é artefato de planilha — EAN não tem
  // fração. Fração de 3 dígitos seria separador de milhar, não decimal.
  const digitos = onlyDigits(texto.replace(/[.,]\d{1,2}$/, ""));
  if (digitos && digitos !== digitosCru && eanValido(digitos)) {
    return { ean: digitos, ajustado: true };
  }

  const comZeros = comZerosAEsquerda(digitosCru);
  if (comZeros) return { ean: comZeros, ajustado: true };

  // Caso combinado: perdeu zero à esquerda E ganhou o dígito da fração no fim
  // (o ",0" pode ter chegado aqui já colado, vindo de uma importação anterior).
  // Só derruba o último dígito quando ele é o "0" da fração: cortar o fim de um
  // código que só tem o verificador errado inventaria um EAN que não é o dele.
  const semZeroFinal = digitosCru.endsWith("0") ? digitosCru.slice(0, -1) : "";
  for (const cand of [digitos, semZeroFinal]) {
    if (cand.length < 2) continue;
    if (eanValido(cand)) return { ean: cand, ajustado: true };
    const preenchido = comZerosAEsquerda(cand);
    if (preenchido) return { ean: preenchido, ajustado: true };
  }

  // Nada fecha: grava como veio, mas avisa — pode ser código interno da loja.
  return { ean: digitosCru, ajustado: false, problema: "digito" };
}

/** UN/ML/G — `null` quando o valor não é reconhecido (vira aviso na importação). */
export function parseUnidade(v?: string): "UN" | "ML" | "G" | null {
  const s = semAcento(v ?? "");
  if (!s) return "UN";
  if (["un", "und", "unidade", "pc", "pç"].includes(s)) return "UN";
  if (["ml", "mililitro", "mililitros"].includes(s)) return "ML";
  if (["g", "gr", "grama", "gramas"].includes(s)) return "G";
  return null;
}
