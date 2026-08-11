/**
 * Filtros do extrato — os mesmos nomes que `loadMovimentacoes` entende, num
 * módulo sem banco para que a página (servidor) e os chips (cliente) leiam a
 * lista da MESMA fonte. Chip que não existe no `CHIP_WHERE` do `_data` viraria
 * um filtro silenciosamente ignorado.
 */

export const CHIPS: Array<{ valor: string; label: string }> = [
  { valor: "todos", label: "Tudo" },
  { valor: "entradas", label: "Entradas" },
  { valor: "vendas", label: "Vendas" },
  { valor: "saidas", label: "Saídas" },
  { valor: "ajustes", label: "Ajustes" },
  { valor: "transferencias", label: "Transferências" },
  { valor: "producao", label: "Produção" },
];

/**
 * Atalhos de data. "Ontem" e o intervalo próprio são JANELAS (têm começo e
 * fim); os demais são "dos últimos N dias até agora" — por isso o resolvedor
 * devolve sempre um par de datas, e não um número de dias.
 */
export const PERIODOS: Array<{ valor: string; label: string }> = [
  { valor: "0", label: "Hoje" },
  { valor: "ontem", label: "Ontem" },
  { valor: "7", label: "7 dias" },
  { valor: "30", label: "30 dias" },
];

/** Teto duro da janela: acima disso o extrato de bolso vira relatório. */
export const MAX_DIAS = 30;

const DIA = 86_400_000;

const meiaNoite = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** YYYY-MM-DD local — formato do `<input type="date">`. */
export function paraInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function doInput(v: string | undefined): Date | null {
  if (!v) return null;
  const [a, m, d] = v.split("-").map(Number);
  if (!a || !m || !d) return null;
  const data = new Date(a, m - 1, d);
  return Number.isNaN(data.getTime()) ? null : data;
}

const curto = (d: Date) =>
  d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

export type PeriodoExtrato = {
  /** Valor que vai na URL: "0" | "ontem" | "7" | "30" | "custom". */
  valor: string;
  de: Date;
  /** Exclusivo — meia-noite do dia seguinte ao último dia coberto. */
  ate: Date;
  /** Rótulo do botão: "Hoje", "7 dias", "05/08 – 11/08". */
  label: string;
  /** Sementes dos campos de data do menu. */
  deInput: string;
  ateInput: string;
};

/**
 * Resolve a janela a partir da URL (`?periodo=&de=&ate=`). Sem parâmetro é 7
 * dias — a pergunta de quem abre o extrato é "o que mexeu esta semana". A
 * janela é aparada em 30 dias AQUI, e não só no menu: a URL é editável.
 */
export function resolvePeriodo(params: {
  periodo?: string;
  de?: string;
  ate?: string;
}): PeriodoExtrato {
  const hoje = meiaNoite(new Date());
  const amanha = new Date(hoje.getTime() + DIA);
  const valor = params.periodo ?? "7";

  if (valor === "ontem") {
    const de = new Date(hoje.getTime() - DIA);
    return { valor, de, ate: hoje, label: "Ontem", deInput: paraInput(de), ateInput: paraInput(de) };
  }

  if (valor === "custom") {
    const de = doInput(params.de);
    if (de) {
      const ateBruto = doInput(params.ate) ?? hoje;
      const ultimo = ateBruto > hoje ? hoje : ateBruto < de ? de : ateBruto;
      const piso = new Date(ultimo.getTime() - (MAX_DIAS - 1) * DIA);
      const inicio = de < piso ? piso : de;
      return {
        valor,
        de: inicio,
        ate: new Date(ultimo.getTime() + DIA),
        label:
          inicio.getTime() === ultimo.getTime()
            ? curto(inicio)
            : `${curto(inicio)} – ${curto(ultimo)}`,
        deInput: paraInput(inicio),
        ateInput: paraInput(ultimo),
      };
    }
  }

  const preset = PERIODOS.find((p) => p.valor === valor) ?? PERIODOS[2]!;
  const dias = Number.parseInt(preset.valor, 10) || 0;
  const de = dias === 0 ? hoje : new Date(hoje.getTime() - (dias - 1) * DIA);
  return {
    valor: preset.valor,
    de,
    ate: amanha,
    label: preset.label,
    deInput: paraInput(de),
    ateInput: paraInput(hoje),
  };
}
