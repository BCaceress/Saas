// ============================================================
// EAN-8 / EAN-13 desenhado como SVG, sem dependência.
//
// Existe porque etiqueta de prateleira sem código de barras é meia etiqueta: a
// pessoa reimprime o preço e o caixa continua digitando o código na mão. A
// alternativa seria mais uma biblioteca no bundle para desenhar 95 retângulos.
//
// O desenho sai em unidades de MÓDULO (a barra fina) e o SVG usa `viewBox` com
// `preserveAspectRatio`, então quem imprime escolhe o tamanho em mm sem que as
// barras saiam de proporção — proporção errada é código que o leitor recusa.
// ============================================================

/** Padrões de 7 módulos por dígito, nas três codificações do EAN. */
const L = [
  "0001101", "0011001", "0010011", "0111101", "0100011",
  "0110001", "0101111", "0111011", "0110111", "0001011",
];
const G = [
  "0100111", "0110011", "0011011", "0100001", "0011101",
  "0111001", "0000101", "0010001", "0001001", "0010111",
];
const R = [
  "1110010", "1100110", "1101100", "1000010", "1011100",
  "1001110", "1010000", "1000100", "1001000", "1110100",
];

/**
 * O primeiro dígito do EAN-13 não é desenhado: ele é codificado no PADRÃO de
 * L/G dos seis dígitos da esquerda. É por isso que o EAN-13 cabe em 95 módulos
 * como o UPC-A.
 */
const PARIDADE = [
  "LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG",
  "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL",
];

const GUARDA = "101";
const CENTRO = "01010";

/** Só dígitos, e só os tamanhos que este desenhista sabe fazer. */
export function ehEanDesenhavel(codigo: string): boolean {
  return /^\d{8}$/.test(codigo) || /^\d{13}$/.test(codigo);
}

function modulosEan13(d: number[]): string {
  const paridade = PARIDADE[d[0]];
  let bits = GUARDA;
  for (let i = 1; i <= 6; i += 1) {
    bits += paridade[i - 1] === "L" ? L[d[i]] : G[d[i]];
  }
  bits += CENTRO;
  for (let i = 7; i <= 12; i += 1) bits += R[d[i]];
  return bits + GUARDA;
}

function modulosEan8(d: number[]): string {
  let bits = GUARDA;
  for (let i = 0; i < 4; i += 1) bits += L[d[i]];
  bits += CENTRO;
  for (let i = 4; i < 8; i += 1) bits += R[d[i]];
  return bits + GUARDA;
}

/**
 * SVG pronto para `dangerouslySetInnerHTML` ou para um `<img src="data:...">`.
 *
 * `null` quando o código não é um EAN desenhável — quem chama mostra só o SKU,
 * que é o que a etiqueta já tinha antes.
 */
export function eanParaSvg(
  codigo: string,
  opcoes?: { altura?: number; comLegenda?: boolean },
): string | null {
  if (!ehEanDesenhavel(codigo)) return null;

  const digitos = [...codigo].map(Number);
  const bits = codigo.length === 13 ? modulosEan13(digitos) : modulosEan8(digitos);

  const alturaBarra = opcoes?.altura ?? 40;
  const comLegenda = opcoes?.comLegenda ?? true;
  // Zona de silêncio: sem os módulos vazios nas pontas o leitor não acha o
  // início do código. A norma pede 9 à esquerda e 7 à direita no EAN-13.
  const margem = 9;
  const largura = bits.length + margem * 2;
  const alturaTotal = alturaBarra + (comLegenda ? 10 : 2);

  const barras: string[] = [];
  let i = 0;
  while (i < bits.length) {
    if (bits[i] === "0") {
      i += 1;
      continue;
    }
    let fim = i;
    while (fim < bits.length && bits[fim] === "1") fim += 1;
    // Guardas e barra central descem abaixo dos dígitos, como no padrão.
    const guarda =
      i <= 2 || (i >= bits.length - 3) || (i >= 45 && i <= 49);
    barras.push(
      `<rect x="${i + margem}" y="0" width="${fim - i}" height="${
        alturaBarra + (comLegenda && guarda ? 5 : 0)
      }" />`,
    );
    i = fim;
  }

  const legenda = comLegenda
    ? `<text x="${largura / 2}" y="${alturaTotal - 1}" font-family="monospace" font-size="9" text-anchor="middle" fill="#000">${codigo}</text>`
    : "";

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${largura} ${alturaTotal}"`,
    ` width="100%" height="100%" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges">`,
    `<rect width="${largura}" height="${alturaTotal}" fill="#fff" />`,
    `<g fill="#000">${barras.join("")}</g>`,
    legenda,
    `</svg>`,
  ].join("");
}
