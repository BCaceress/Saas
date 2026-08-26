import { onlyDigits } from "./normalize";

// ============================================================
// O que foi lido pela câmera.
//
// O scanner do `/m` é um só e a pessoa nunca escolhe modo: aponta, e o que
// decide o destino é o PAYLOAD. Este módulo é a única regra de decisão — puro,
// sem I/O, roda no cliente e no servidor, e é onde se acrescenta um formato
// novo sem mexer em tela nenhuma.
//
// Ordem importa: a chave de acesso da NF-e tem 44 dígitos e passaria por
// "código numérico qualquer" se testada depois do EAN.
// ============================================================

export type CodigoLido =
  /** EAN-8/12/13/14 ou DUN — unidade, fardo ou caixa. */
  | { tipo: "ean"; valor: string }
  /** Chave de acesso de NF-e/NFC-e, 44 dígitos. */
  | { tipo: "chave"; valor: string }
  /** QR gerado por nós: leva direto ao pedido de compra. */
  | { tipo: "pedido"; valor: string }
  /** Não é nenhum dos acima — tratado como SKU/busca livre. */
  | { tipo: "texto"; valor: string };

/** Prefixo do QR de pedido. Curto de propósito: QR menor lê de mais longe. */
export const PREFIXO_PEDIDO = "nohub://pc/";

const CHAVE_RE = /^\d{44}$/;
/** EAN-8, UPC-12, EAN-13, DUN-14. Códigos internos de balança também caem aqui. */
const EAN_RE = /^\d{8}$|^\d{12,14}$/;

/**
 * A URL de consulta da NFC-e traz a chave em `p=` (44 dígitos + campos
 * separados por `|`) ou em `chNFe=`. A NF-e modelo 55 imprime a chave no
 * Code128 da DANFE, sem URL nenhuma.
 */
function chaveDeUrl(bruto: string): string | null {
  const emP = bruto.match(/[?&]p=(\d{44})/i);
  if (emP) return emP[1];
  const emCh = bruto.match(/chNFe=(\d{44})/i);
  if (emCh) return emCh[1];
  // Alguns emissores mandam a chave crua com espaços a cada 4 dígitos.
  const solto = onlyDigits(bruto);
  return CHAVE_RE.test(solto) ? solto : null;
}

/**
 * Classifica o que a câmera (ou a digitação) entregou.
 *
 * Nunca devolve null: o que não casa vira `texto` e segue para a busca por
 * nome/SKU — um código estranho é mais bem servido por uma busca do que por
 * uma mensagem de erro.
 */
export function classificarCodigo(bruto: string): CodigoLido {
  const cru = bruto.trim();
  if (!cru) return { tipo: "texto", valor: "" };

  if (cru.toLowerCase().startsWith(PREFIXO_PEDIDO)) {
    const id = cru.slice(PREFIXO_PEDIDO.length).trim();
    if (id) return { tipo: "pedido", valor: id };
  }

  // QR do app aberto no navegador: a pessoa pode ter apontado para um link
  // nosso em vez do QR interno.
  const rota = cru.match(/\/m\/receber\/([A-Za-z0-9_-]{6,})/);
  if (rota) return { tipo: "pedido", valor: rota[1] };

  const chave = chaveDeUrl(cru);
  if (chave) return { tipo: "chave", valor: chave };

  const digitos = onlyDigits(cru);
  if (EAN_RE.test(digitos)) return { tipo: "ean", valor: digitos };

  return { tipo: "texto", valor: cru };
}

/** QR que colamos no pedido para o fornecedor trazer junto da carga. */
export function codigoDoPedido(purchaseOrderId: string): string {
  return `${PREFIXO_PEDIDO}${purchaseOrderId}`;
}

/**
 * Série e número saem da própria chave — dá para nomear a nota na tela antes
 * de qualquer consulta à SEFAZ.
 * Layout: cUF(2) AAMM(4) CNPJ(14) mod(2) serie(3) nNF(9) tpEmis(1) cNF(8) cDV(1)
 */
export function resumoDaChave(chave: string): {
  cnpjEmitente: string;
  modelo: string;
  serie: number;
  numero: number;
} {
  return {
    cnpjEmitente: chave.slice(6, 20),
    modelo: chave.slice(20, 22),
    serie: Number(chave.slice(22, 25)) || 0,
    numero: Number(chave.slice(25, 34)) || 0,
  };
}

/**
 * O dígito verificador fecha?
 *
 * Todo GTIN (EAN-8, UPC-12, EAN-13, DUN-14) termina num dígito calculado por
 * módulo 10 com pesos alternados 3 e 1, da direita para a esquerda. Scanner
 * nunca erra isso — quem erra é o dedo digitando. E um código com dígito
 * errado é um produto que NUNCA vai bipar no caixa: o erro só aparece semanas
 * depois, com fila na frente.
 *
 * `null` = não é um GTIN de comprimento conhecido, então não há o que conferir
 * (código interno de balança de 7 dígitos, SKU do fornecedor, etc.).
 */
export function gtinValido(bruto: string): boolean | null {
  const d = onlyDigits(bruto);
  if (![8, 12, 13, 14].includes(d.length)) return null;

  let soma = 0;
  // Da direita para a esquerda, ignorando o próprio dígito verificador: peso 3
  // nas posições ímpares, 1 nas pares.
  for (let i = d.length - 2, peso = 3; i >= 0; i--, peso = peso === 3 ? 1 : 3) {
    soma += Number(d[i]) * peso;
  }
  const esperado = (10 - (soma % 10)) % 10;
  return esperado === Number(d[d.length - 1]);
}
