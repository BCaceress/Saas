import type { TipoValor, ValorCelula } from "./definicao";

/**
 * Formatação de célula por tipo — o dialeto pt-BR do módulo inteiro.
 *
 * Duas saídas, de propósito diferentes:
 *  · `formatarValor` — para os olhos (tela e PDF): "R$ 1.240,50", "12,5%".
 *  · `valorCru`      — para a máquina (CSV e Excel): número sem símbolo e sem
 *                      separador de milhar, para a planilha SOMAR a coluna em
 *                      vez de tratá-la como texto.
 *
 * Módulo puro: a prévia no client e o export no servidor formatam igual, então
 * o que o operador vê na tela é exatamente o que sai no arquivo.
 */

const MOEDA = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
});

const NUMERO = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const INTEIRO = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

export function formatarValor(valor: ValorCelula, tipo: TipoValor): string {
  if (valor === null || valor === undefined || valor === "") return "—";

  switch (tipo) {
    case "moeda":
      return MOEDA.format(numero(valor));
    case "numero":
      return NUMERO.format(numero(valor));
    case "inteiro":
      return INTEIRO.format(Math.round(numero(valor)));
    case "percentual":
      return `${NUMERO.format(numero(valor))}%`;
    case "data": {
      const d = data(valor);
      return d ? d.toLocaleDateString("pt-BR") : String(valor);
    }
    case "datahora": {
      const d = data(valor);
      return d
        ? `${d.toLocaleDateString("pt-BR")} ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
        : String(valor);
    }
    case "booleano":
      return valor ? "Sim" : "Não";
    default:
      return String(valor);
  }
}

/** Valor para planilha: número cru quando é número, texto quando é texto. */
export function valorCru(valor: ValorCelula, tipo: TipoValor): string | number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  if (tipo === "moeda" || tipo === "numero" || tipo === "inteiro" || tipo === "percentual") {
    return arredonda(numero(valor));
  }
  if (tipo === "booleano") return valor ? "Sim" : "Não";
  if (tipo === "data" || tipo === "datahora") return formatarValor(valor, tipo);
  return String(valor);
}

export function numero(valor: ValorCelula): number {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : 0;
  if (typeof valor === "boolean") return valor ? 1 : 0;
  if (valor instanceof Date) return valor.getTime();
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

export function texto(valor: ValorCelula): string {
  if (valor === null || valor === undefined) return "";
  if (valor instanceof Date) return valor.toISOString();
  return String(valor);
}

function data(valor: ValorCelula): Date | null {
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor;
  if (typeof valor === "string" || typeof valor === "number") {
    const d = new Date(valor);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function arredonda(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Compara duas células no tipo certo. Ordenar "Valor" por texto colocaria
 * R$ 9,00 acima de R$ 80,00 — e o operador confiaria no ranking errado.
 */
export function compararValores(a: ValorCelula, b: ValorCelula, tipo: TipoValor): number {
  const vazioA = a === null || a === undefined || a === "";
  const vazioB = b === null || b === undefined || b === "";
  // Vazio sempre por último, suba ou desça a ordenação.
  if (vazioA || vazioB) return vazioA && vazioB ? 0 : vazioA ? 1 : -1;

  if (tipo === "texto" || tipo === "codigo") {
    return texto(a).localeCompare(texto(b), "pt-BR", { sensitivity: "base", numeric: true });
  }
  return numero(a) - numero(b);
}
