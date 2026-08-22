import "server-only";

// ============================================================
// Que tipo de documento é este, e ele movimenta estoque?
//
// O importador aceitava qualquer XML e tentava virar entrada de mercadoria.
// CT-e de frete e nota de serviço não têm mercadoria nenhuma — viravam itens
// impossíveis de relacionar, e a nota ficava PENDENTE para sempre esperando um
// produto que não existe.
//
// A resposta certa não é recusar: o documento É nosso, tem valor a pagar e
// precisa ficar guardado. Só não pode somar no estoque.
// ============================================================

/** Modelos que nunca carregam mercadoria. 57 = CT-e, 67 = CT-e OS. */
const MODELOS_SEM_MERCADORIA: Record<string, string> = {
  "57": "Conhecimento de Transporte (CT-e)",
  "67": "CT-e Outros Serviços",
  "21": "Nota de serviço de comunicação",
  "22": "Nota de serviço de telecomunicação",
};

/**
 * CFOPs de ENTRADA que compram serviço, não mercadoria. Uma nota cujos itens
 * são todos destes CFOPs é despesa: vira título a pagar, não estoque.
 *
 * 1352/2352…1356/2356 — aquisição de serviço de transporte/comunicação/energia
 * 1932/2932 — serviço de transporte iniciado em outra UF
 * 1933/2933 — aquisição de serviço tributado pelo ISS
 * 1949/2949 — outra entrada não especificada (usado por nota de despesa)
 */
const CFOP_SERVICO = new Set([
  "1352", "1353", "1354", "1355", "1356",
  "2352", "2353", "2354", "2355", "2356",
  "1932", "2932", "1933", "2933",
]);

export type ClassificacaoDocumento = {
  /** false = guarda o documento, mas não gera Purchase nem mexe em saldo. */
  movimentaEstoque: boolean;
  /** Texto que vai para `FiscalInbound.semEstoqueMotivo` e para a tela. */
  motivo: string | null;
};

/**
 * Classifica um XML já lido. Roda depois do parse porque precisa dos CFOPs dos
 * itens — CT-e nem chega aqui (o parser recusa antes, com mensagem própria).
 */
export function classificarDocumento(input: {
  modelo: string;
  itens: { cfop: string | null; descricao: string }[];
}): ClassificacaoDocumento {
  const porModelo = MODELOS_SEM_MERCADORIA[input.modelo];
  if (porModelo) {
    return {
      movimentaEstoque: false,
      motivo: `${porModelo} — documento de serviço, não entra no estoque.`,
    };
  }

  // Nota mista (mercadoria + frete destacado como item) continua sendo entrada:
  // só é despesa pura quando NENHUM item é mercadoria.
  const todosServico =
    input.itens.length > 0 && input.itens.every((i) => i.cfop != null && CFOP_SERVICO.has(i.cfop));

  if (todosServico) {
    return {
      movimentaEstoque: false,
      motivo: "Nota de serviço (CFOP de aquisição de serviço) — não entra no estoque.",
    };
  }

  return { movimentaEstoque: true, motivo: null };
}

/**
 * Detecta CT-e antes do parse de NF-e. O XML de CT-e tem raiz `cteProc`/`CTe`,
 * e o leitor de NF-e só saberia dizer "XML sem NF-e" — mensagem que faz o
 * operador achar que baixou o arquivo errado, quando na verdade baixou o certo.
 */
export function ehConhecimentoDeTransporte(xml: string): boolean {
  return /<(\w+:)?(cteProc|CTe)\b/.test(xml);
}
