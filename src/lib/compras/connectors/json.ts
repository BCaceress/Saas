import {
  ConectorError,
  type ConectorFornecedor,
  type Fonte,
  type MapeamentoColunas,
} from "../types";
import { detectarColunas, linhasParaOfertas, type Linha } from "../tabela";
import { decodificar } from "./csv";

// ============================================================
// JSON de fornecedor não tem forma fixa: às vezes é um array na raiz, às vezes
// vem embrulhado em { data: [...] } / { produtos: [...] }. `extrairLista`
// acha a primeira lista de objetos em qualquer profundidade razoável — daí em
// diante é tabela como qualquer outra.
// ============================================================

export const jsonConnector: ConectorFornecedor = {
  kind: "JSON",
  rotulo: "JSON",
  extensoes: [".json"],

  async ler(fonte: Fonte, ctx) {
    if (fonte.tipo !== "arquivo") throw new ConectorError("O conector JSON espera um arquivo.");

    let dados: unknown;
    try {
      dados = JSON.parse(decodificar(fonte.bytes));
    } catch {
      throw new ConectorError("JSON inválido.");
    }

    return lerJsonNormalizado(dados, ctx.mapeamento);
  },
};

/** Usado também pelo conector de API — a resposta chega já parseada. */
export function lerJsonNormalizado(dados: unknown, mapeamento?: MapeamentoColunas | null) {
  const lista = extrairLista(dados);
  if (!lista) throw new ConectorError("Não encontrei uma lista de produtos no JSON.");

  const linhas = lista.map((item) => achatar(item as Record<string, unknown>));
  const cabecalhos = [...new Set(linhas.flatMap((l) => Object.keys(l)))];
  const mapa = detectarColunas(cabecalhos, mapeamento);
  return linhasParaOfertas(linhas, mapa);
}

function extrairLista(dados: unknown, profundidade = 0): unknown[] | null {
  if (profundidade > 4) return null;
  if (Array.isArray(dados)) {
    return dados.length === 0 || typeof dados[0] === "object" ? dados : null;
  }
  if (dados && typeof dados === "object") {
    for (const valor of Object.values(dados as Record<string, unknown>)) {
      const achado = extrairLista(valor, profundidade + 1);
      if (achado) return achado;
    }
  }
  return null;
}

/** { preco: { tabela: 5.9 } } → { "preco.tabela": 5.9 } — o detector só lê plano. */
function achatar(obj: Record<string, unknown>, prefixo = ""): Linha {
  const saida: Linha = {};
  for (const [chave, valor] of Object.entries(obj ?? {})) {
    const nome = prefixo ? `${prefixo}.${chave}` : chave;
    if (valor && typeof valor === "object" && !Array.isArray(valor) && !(valor instanceof Date)) {
      Object.assign(saida, achatar(valor as Record<string, unknown>, nome));
    } else {
      saida[nome] = valor as unknown;
    }
  }
  return saida;
}
