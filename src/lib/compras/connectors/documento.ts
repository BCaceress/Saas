import { completeJsonComArquivo, llmConfigured } from "@/lib/llm";
import {
  ConectorError,
  type ConectorFornecedor,
  type Fonte,
  type OfertaBruta,
  type ResultadoConector,
} from "../types";
import { limparEan, parseData, parseNumero } from "../tabela";

// ============================================================
// PDF e imagem — o caminho que o fornecedor de bebida realmente usa: tabela em
// PDF por e-mail, foto do encarte no WhatsApp. Aqui não há coluna para
// detectar, então quem lê é o LLM (lib/llm.ts, chave só no servidor).
//
// Extração de documento erra: o resultado NUNCA vira preço direto. Toda oferta
// vinda daqui entra com vínculo PENDENTE quando o EAN não bate — a revisão
// manual é parte do fluxo, não exceção.
// ============================================================

const SYSTEM = `Você extrai tabelas de preço de fornecedores brasileiros (bebidas, mercearia).
Devolva SOMENTE JSON no formato:
{"itens":[{"codigoFornecedor":string|null,"ean":string|null,"descricao":string,"marca":string|null,"unidade":string|null,"preco":number,"precoPromocional":number|null,"quantidadeMinima":number|null,"estoqueDisponivel":number|null,"validadeOferta":"YYYY-MM-DD"|null}],"validadeGeral":"YYYY-MM-DD"|null}
Regras:
- preco = preço de tabela (sem desconto). precoPromocional só quando houver DOIS preços no documento.
- Número em ponto decimal (5.89), nunca texto. Não invente valor que não está no documento: use null.
- Ignore cabeçalho, rodapé, telefone, CNPJ e condição de pagamento.
- Não resuma: liste TODOS os itens que conseguir ler.`;

type Resposta = {
  itens?: Array<Record<string, unknown>>;
  validadeGeral?: string | null;
};

async function extrairComLlm(fonte: Fonte, rotulo: string): Promise<ResultadoConector> {
  if (fonte.tipo !== "arquivo") throw new ConectorError(`O conector de ${rotulo} espera um arquivo.`);
  if (!llmConfigured()) {
    throw new ConectorError(
      "Leitura de PDF e imagem precisa de um provedor de IA configurado. Configure a chave ou envie a tabela em CSV/planilha.",
    );
  }

  const resposta = await completeJsonComArquivo<Resposta>({
    system: SYSTEM,
    user: `Extraia a tabela de preços deste ${rotulo}. Nome do arquivo: ${fonte.nome}.`,
    media: { mimeType: fonte.mimeType, base64: Buffer.from(fonte.bytes).toString("base64") },
  });

  const itens = Array.isArray(resposta?.itens) ? resposta.itens : [];
  const validadeGeral = parseData(resposta?.validadeGeral ?? null);
  const avisos: string[] = [
    "Itens lidos por IA a partir do documento — confira os preços antes de comprar.",
  ];

  const ofertas: OfertaBruta[] = [];
  let semPreco = 0;

  for (const item of itens) {
    const descricao = texto(item.descricao);
    const preco = parseNumero(item.preco);
    const promo = parseNumero(item.precoPromocional);

    if (!descricao) continue;
    if (preco == null && promo == null) {
      semPreco++;
      continue;
    }

    const base = preco ?? (promo as number);
    ofertas.push({
      codigoFornecedor: texto(item.codigoFornecedor),
      ean: limparEan(item.ean),
      descricao,
      marca: texto(item.marca),
      categoria: texto(item.categoria),
      unidade: texto(item.unidade),
      preco: base,
      precoPromocional: preco != null && promo != null && promo < preco ? promo : null,
      quantidadeMinima: parseNumero(item.quantidadeMinima),
      estoqueDisponivel: parseNumero(item.estoqueDisponivel),
      validadeOferta: parseData(item.validadeOferta) ?? validadeGeral,
    });
  }

  if (semPreco > 0) avisos.push(`${semPreco} item(ns) sem preço legível.`);
  if (ofertas.length === 0) {
    throw new ConectorError(
      "Não consegui ler nenhum item deste arquivo. Tente uma imagem mais nítida ou envie a tabela em CSV.",
    );
  }

  return { ofertas, totalLinhas: itens.length, avisos };
}

function texto(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" || s.toLowerCase() === "null" ? null : s;
}

export const pdfConnector: ConectorFornecedor = {
  kind: "PDF",
  rotulo: "PDF",
  extensoes: [".pdf"],
  ler: (fonte) => extrairComLlm(fonte, "PDF"),
};

export const imagemConnector: ConectorFornecedor = {
  kind: "IMAGEM",
  rotulo: "Imagem",
  extensoes: [".jpg", ".jpeg", ".png", ".webp"],
  ler: (fonte) => extrairComLlm(fonte, "imagem"),
};
