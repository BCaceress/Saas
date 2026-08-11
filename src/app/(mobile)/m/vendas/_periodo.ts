/**
 * Período da tela de vendas do celular.
 *
 * Não usa `lib/periodo` de propósito: lá os presets são de RELATÓRIO (7d, 6m,
 * 1a) e existem para comparar com o período anterior. Aqui a pergunta é de
 * balcão — "e hoje?", "e ontem?" — e há um teto duro de 30 dias, porque as
 * consultas desta tela varrem venda a venda e rodam no 4G da loja.
 *
 * Funções puras, sem DB e sem `server-only`: o mesmo módulo alimenta o
 * carregamento no servidor e os rótulos do seletor no cliente.
 */

export type PresetVendas = "hoje" | "ontem" | "semana" | "mes" | "custom";

/** Teto de janela. Acima disso a tela deixa de ser consulta e vira relatório. */
export const MAX_DIAS = 30;

const DIA = 24 * 60 * 60 * 1000;

export const PRESETS: Array<{ valor: Exclude<PresetVendas, "custom">; label: string }> = [
  { valor: "hoje", label: "Hoje" },
  { valor: "ontem", label: "Ontem" },
  { valor: "semana", label: "Últimos 7 dias" },
  { valor: "mes", label: "Este mês" },
];

export type PeriodoVendas = {
  preset: PresetVendas;
  inicio: Date;
  /** Exclusivo — meia-noite do dia seguinte ao último dia do período. */
  fim: Date;
  label: string;
  /**
   * O mesmo período por extenso, com ano — "11/08/2026", "05/08/2026 –
   * 11/08/2026". Vai na linha abaixo do título: o botão diz o atalho ("Hoje"),
   * a descrição diz exatamente que dias estão na tela. Sem o ano, quem abre a
   * tela no dia 2 de janeiro não sabe se olha dezembro ou janeiro.
   */
  labelLongo: string;
  /** Dias inteiros cobertos. 1 = a curva é por hora. */
  dias: number;
  /** O período alcança o dia corrente — só aí existe "a hora de agora". */
  incluiHoje: boolean;
};

function meiaNoite(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** YYYY-MM-DD em horário local — formato do `<input type="date">`. */
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

const fmt = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

const fmtLongo = (d: Date) =>
  d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

/**
 * Descrição do período com ano. Recebe o fim EXCLUSIVO (meia-noite do dia
 * seguinte) e volta um dia para nomear o último dia realmente coberto.
 */
function porExtenso(inicio: Date, fim: Date): string {
  const ultimo = new Date(fim.getTime() - DIA);
  return inicio.getTime() === ultimo.getTime()
    ? fmtLongo(inicio)
    : `${fmtLongo(inicio)} – ${fmtLongo(ultimo)}`;
}

/**
 * Resolve o período a partir da URL (`?p=&de=&ate=`). Sem parâmetro nenhum, é
 * HOJE — a tela abre no movimento do dia, que é a pergunta de quem está no
 * balcão. Qualquer janela é aparada em 30 dias no servidor, não só no seletor:
 * a URL é editável e um `de` de 2019 travaria a tela.
 */
export function resolvePeriodoVendas(params: {
  p?: string;
  de?: string;
  ate?: string;
}): PeriodoVendas {
  const hoje = meiaNoite(new Date());
  const amanha = new Date(hoje.getTime() + DIA);
  const preset = (params.p ?? "hoje") as PresetVendas;

  if (preset === "ontem") {
    const inicio = new Date(hoje.getTime() - DIA);
    return {
      preset,
      inicio,
      fim: hoje,
      label: "Ontem",
      labelLongo: porExtenso(inicio, hoje),
      dias: 1,
      incluiHoje: false,
    };
  }

  if (preset === "semana") {
    const inicio = new Date(hoje.getTime() - 6 * DIA);
    return {
      preset,
      inicio,
      fim: amanha,
      label: "Últimos 7 dias",
      labelLongo: porExtenso(inicio, amanha),
      dias: 7,
      incluiHoje: true,
    };
  }

  if (preset === "mes") {
    const primeiro = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    // Mês de 31 dias estouraria o teto no último dia — a janela encolhe, o
    // rótulo continua "Este mês" (é o mês que a pessoa pediu).
    const piso = new Date(hoje.getTime() - (MAX_DIAS - 1) * DIA);
    const inicio = primeiro < piso ? piso : primeiro;
    return {
      preset,
      inicio,
      fim: amanha,
      label: "Este mês",
      labelLongo: porExtenso(inicio, amanha),
      dias: Math.round((amanha.getTime() - inicio.getTime()) / DIA),
      incluiHoje: true,
    };
  }

  if (preset === "custom") {
    const de = doInput(params.de);
    if (de) {
      // Fim nunca passa de hoje: vendas futuras não existem, e um `ate` de
      // dezembro só faria a curva desenhar dias vazios.
      const ateBruto = doInput(params.ate) ?? hoje;
      const ate = ateBruto > hoje ? hoje : ateBruto < de ? de : ateBruto;
      const inicioPiso = new Date(ate.getTime() - (MAX_DIAS - 1) * DIA);
      const inicio = de < inicioPiso ? inicioPiso : de;
      const fim = new Date(ate.getTime() + DIA);
      const dias = Math.round((fim.getTime() - inicio.getTime()) / DIA);
      return {
        preset,
        inicio,
        fim,
        label: dias === 1 ? fmt(inicio) : `${fmt(inicio)} – ${fmt(ate)}`,
        labelLongo: porExtenso(inicio, fim),
        dias,
        incluiHoje: ate.getTime() === hoje.getTime(),
      };
    }
  }

  return {
    preset: "hoje",
    inicio: hoje,
    fim: amanha,
    label: "Hoje",
    labelLongo: porExtenso(hoje, amanha),
    dias: 1,
    incluiHoje: true,
  };
}
