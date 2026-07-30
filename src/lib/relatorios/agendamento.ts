import { z } from "zod";

/**
 * Agendamento de relatório — ARQUITETURA, ainda sem disparo.
 *
 * O que existe hoje: o modelo (`ReportSchedule`), o formato dos destinos e o
 * cálculo do próximo horário. O que NÃO existe: o cron que varre a tabela,
 * gera o arquivo e envia. Por isso todo agendamento nasce `ativo = false` e a
 * Central mostra a ação desligada — prometer um e-mail semanal que ninguém
 * envia é pior do que não ter o botão.
 *
 * Quando o runner entrar (`/api/jobs/relatorios-agendados`, no mesmo molde dos
 * outros jobs), ele só precisa: ler os ativos com `proximaExecucao <= agora`,
 * executar com os mesmos `parametros` da execução manual, mandar pelo canal e
 * chamar `proximaExecucao()` de novo. Nada aqui muda.
 */

export const CANAIS = ["email", "whatsapp", "link"] as const;
export type Canal = (typeof CANAIS)[number];

export const CANAL_LABEL: Record<Canal, string> = {
  email: "E-mail",
  whatsapp: "WhatsApp",
  link: "Link",
};

export const destinoSchema = z.object({
  canal: z.enum(CANAIS),
  valor: z.string().trim().min(1).max(200),
});

export type Destinatario = z.infer<typeof destinoSchema>;

export const FREQUENCIAS = ["DIARIO", "SEMANAL", "MENSAL"] as const;
export type Frequencia = (typeof FREQUENCIAS)[number];

export const FREQUENCIA_LABEL: Record<Frequencia, string> = {
  DIARIO: "Todo dia",
  SEMANAL: "Toda semana",
  MENSAL: "Todo mês",
};

export const agendamentoSchema = z.object({
  relatorioId: z.string().min(1).max(60),
  nome: z.string().trim().min(2).max(80),
  frequencia: z.enum(FREQUENCIAS),
  hora: z.number().int().min(0).max(23).default(7),
  /** 0 = domingo. Só para SEMANAL. */
  diaSemana: z.number().int().min(0).max(6).optional(),
  /** 1–28: acima disso o mês curto pularia o envio. Só para MENSAL. */
  diaMes: z.number().int().min(1).max(28).optional(),
  formato: z.enum(["pdf", "csv", "xlsx"]).default("pdf"),
  destinatarios: z.array(destinoSchema).max(10).default([]),
});

export type EntradaAgendamento = z.infer<typeof agendamentoSchema>;

const DIA = 24 * 60 * 60 * 1000;

/**
 * Próximo disparo depois de `apartirDe`. Função pura — o runner e a tela usam
 * a mesma conta, então o que a tela promete é o que o job faz.
 */
export function proximaExecucao(
  regra: Pick<EntradaAgendamento, "frequencia" | "hora" | "diaSemana" | "diaMes">,
  apartirDe: Date = new Date(),
): Date {
  const base = new Date(apartirDe);
  const alvo = new Date(base.getFullYear(), base.getMonth(), base.getDate(), regra.hora, 0, 0, 0);

  if (regra.frequencia === "DIARIO") {
    return alvo > base ? alvo : new Date(alvo.getTime() + DIA);
  }

  if (regra.frequencia === "SEMANAL") {
    const desejado = regra.diaSemana ?? 1; // segunda: a semana começa com o resumo
    let dias = (desejado - alvo.getDay() + 7) % 7;
    if (dias === 0 && alvo <= base) dias = 7;
    return new Date(alvo.getTime() + dias * DIA);
  }

  const dia = regra.diaMes ?? 1;
  const esteMes = new Date(base.getFullYear(), base.getMonth(), dia, regra.hora, 0, 0, 0);
  if (esteMes > base) return esteMes;
  return new Date(base.getFullYear(), base.getMonth() + 1, dia, regra.hora, 0, 0, 0);
}

/** Frase para a tela: "Toda semana, segunda às 07h". */
export function descreverAgendamento(regra: EntradaAgendamento): string {
  const hora = `${String(regra.hora).padStart(2, "0")}h`;
  if (regra.frequencia === "DIARIO") return `Todo dia às ${hora}`;
  if (regra.frequencia === "SEMANAL") {
    const dias = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
    return `Toda ${dias[regra.diaSemana ?? 1]} às ${hora}`;
  }
  return `Todo dia ${regra.diaMes ?? 1} às ${hora}`;
}
