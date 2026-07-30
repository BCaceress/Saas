import type {
  CampoOferta,
  MapeamentoColunas,
  OfertaBruta,
  ResultadoConector,
} from "./types";

// ============================================================
// Tudo que chega em LINHA E COLUNA (CSV, planilha, JSON, XML, API) passa por
// aqui. O conector só entrega `Linha[]`; a leitura de cabeçalho, o parse de
// número em pt-BR e o descarte de lixo acontecem uma vez só, neste arquivo.
// ============================================================

export type Linha = Record<string, unknown>;

/** Chave de comparação de cabeçalho: sem acento, sem pontuação, minúscula. */
export function chaveColuna(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Apelidos de cabeçalho por campo. Ordem importa: o primeiro que casar vence,
 * então o mais específico vem antes ("preco promocional" antes de "preco").
 */
const ALIASES: Record<CampoOferta, string[]> = {
  precoPromocional: [
    "preco promocional",
    "preco promo",
    "promocao",
    "preco oferta",
    "oferta",
    "preco com desconto",
    "preco final",
  ],
  preco: [
    "preco",
    "preco unitario",
    "preco de tabela",
    "valor",
    "valor unitario",
    "custo",
    "preco venda",
    "vlr unit",
    "unitario",
  ],
  ean: ["ean", "gtin", "codigo de barras", "cod barras", "barras", "ean13"],
  codigoFornecedor: [
    "codigo do fornecedor",
    "codigo fornecedor",
    "cod fornecedor",
    "codigo do produto",
    "codigo",
    "cod",
    "sku",
    "referencia",
    "ref",
    "item",
  ],
  descricao: ["descricao", "produto", "nome", "item descricao", "mercadoria", "material"],
  marca: ["marca", "fabricante", "brand"],
  categoria: ["categoria", "grupo", "familia", "departamento", "secao", "linha"],
  unidade: ["unidade", "un", "embalagem", "emb", "unidade de compra", "medida"],
  fatorConversao: ["fator", "fator de conversao", "quantidade por caixa", "qtd embalagem", "multiplo"],
  quantidadeMinima: [
    "quantidade minima",
    "qtd minima",
    "minimo",
    "pedido minimo",
    "lote minimo",
    "qtde min",
  ],
  estoqueDisponivel: ["estoque", "estoque disponivel", "disponivel", "saldo", "quantidade disponivel"],
  validadeOferta: [
    "validade",
    "validade da oferta",
    "valido ate",
    "vigencia",
    "data limite",
    "fim da promocao",
  ],
};

const ORDEM_DETECCAO: CampoOferta[] = [
  "ean",
  "precoPromocional",
  "preco",
  "codigoFornecedor",
  "descricao",
  "marca",
  "categoria",
  "unidade",
  "fatorConversao",
  "quantidadeMinima",
  "estoqueDisponivel",
  "validadeOferta",
];

/**
 * Descobre qual coluna é qual. Casa por igualdade primeiro e só depois por
 * "contém" — senão "preco promocional" seria capturado por "preco".
 * Uma coluna nunca é usada por dois campos.
 */
export function detectarColunas(
  cabecalhos: string[],
  manual?: MapeamentoColunas | null,
): MapeamentoColunas {
  const mapa: MapeamentoColunas = { ...(manual ?? {}) };
  const usadas = new Set(Object.values(mapa).filter(Boolean) as string[]);
  const chaves = cabecalhos.map((h) => ({ original: h, chave: chaveColuna(h) }));

  for (const campo of ORDEM_DETECCAO) {
    if (mapa[campo]) continue;
    const aliases = ALIASES[campo];

    const exata = chaves.find((c) => !usadas.has(c.original) && aliases.includes(c.chave));
    const parcial =
      exata ??
      chaves.find(
        (c) => !usadas.has(c.original) && aliases.some((a) => c.chave.includes(a)),
      );

    if (parcial) {
      mapa[campo] = parcial.original;
      usadas.add(parcial.original);
    }
  }
  return mapa;
}

/**
 * Número em português: "1.234,56" → 1234.56. Com os dois separadores, o
 * ÚLTIMO é o decimal — regra que serve para pt-BR e en-US sem adivinhação.
 */
export function parseNumero(valor: unknown): number | null {
  if (valor == null || valor === "") return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;

  const bruto = String(valor).trim();
  if (!bruto) return null;

  const limpo = bruto.replace(/[R$\s ]/gi, "").replace(/[^0-9.,-]/g, "");
  if (!limpo || limpo === "-") return null;

  const ultimaVirgula = limpo.lastIndexOf(",");
  const ultimoPonto = limpo.lastIndexOf(".");
  let normalizado: string;

  if (ultimaVirgula === -1 && ultimoPonto === -1) {
    normalizado = limpo;
  } else if (ultimaVirgula > ultimoPonto) {
    normalizado = limpo.replace(/\./g, "").replace(",", ".");
  } else {
    normalizado = limpo.replace(/,/g, "");
  }

  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

/** Data em dd/mm/aaaa, aaaa-mm-dd ou serial do Excel. */
export function parseData(valor: unknown): Date | null {
  if (valor == null || valor === "") return null;
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor;

  const bruto = String(valor).trim();
  if (!bruto) return null;

  const br = bruto.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (br) {
    const ano = br[3].length === 2 ? 2000 + Number(br[3]) : Number(br[3]);
    const d = new Date(ano, Number(br[2]) - 1, Number(br[1]));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Serial do Excel (dias desde 30/12/1899). Só acima de 20000 (~1954) para
  // não confundir com um número solto.
  const serial = Number(bruto);
  if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
  }

  const iso = new Date(bruto);
  return Number.isNaN(iso.getTime()) ? null : iso;
}

function texto(valor: unknown): string | null {
  if (valor == null) return null;
  const s = String(valor).trim();
  return s === "" ? null : s;
}

/** Só dígitos e comprimento de GTIN — código com letra não é EAN. */
export function limparEan(valor: unknown): string | null {
  const s = texto(valor);
  if (!s) return null;
  const digitos = s.replace(/\D/g, "");
  return [8, 12, 13, 14].includes(digitos.length) ? digitos : null;
}

/**
 * Linhas + mapa de colunas → ofertas. Linha sem descrição ou sem preço é
 * descartada com aviso: é sempre cabeçalho repetido, subtotal ou rodapé.
 */
export function linhasParaOfertas(
  linhas: Linha[],
  mapa: MapeamentoColunas,
): ResultadoConector {
  const avisos: string[] = [];
  const ofertas: OfertaBruta[] = [];

  if (!mapa.descricao && !mapa.ean && !mapa.codigoFornecedor) {
    avisos.push("Nenhuma coluna de identificação encontrada (descrição, EAN ou código).");
  }
  if (!mapa.preco && !mapa.precoPromocional) {
    avisos.push("Nenhuma coluna de preço encontrada.");
  }

  let semPreco = 0;
  let semIdentificacao = 0;

  for (const linha of linhas) {
    const campo = (c: CampoOferta) => (mapa[c] ? linha[mapa[c]] : undefined);

    const descricao = texto(campo("descricao"));
    const ean = limparEan(campo("ean"));
    const codigo = texto(campo("codigoFornecedor"));
    const precoTabela = parseNumero(campo("preco"));
    const promo = parseNumero(campo("precoPromocional"));

    if (!descricao && !ean && !codigo) {
      semIdentificacao++;
      continue;
    }
    if (precoTabela == null && promo == null) {
      semPreco++;
      continue;
    }

    // Sem preço de tabela, a promoção É o preço — e aí não há desconto a exibir.
    const preco = precoTabela ?? (promo as number);
    const precoPromocional = precoTabela != null && promo != null && promo < precoTabela ? promo : null;

    ofertas.push({
      codigoFornecedor: codigo,
      ean,
      descricao: descricao ?? codigo ?? (ean as string),
      marca: texto(campo("marca")),
      categoria: texto(campo("categoria")),
      unidade: texto(campo("unidade")),
      fatorConversao: parseNumero(campo("fatorConversao")),
      preco,
      precoPromocional,
      quantidadeMinima: parseNumero(campo("quantidadeMinima")),
      estoqueDisponivel: parseNumero(campo("estoqueDisponivel")),
      validadeOferta: parseData(campo("validadeOferta")),
    });
  }

  if (semIdentificacao > 0) avisos.push(`${semIdentificacao} linha(s) sem produto identificável.`);
  if (semPreco > 0) avisos.push(`${semPreco} linha(s) sem preço.`);

  return { ofertas, totalLinhas: linhas.length, avisos };
}
