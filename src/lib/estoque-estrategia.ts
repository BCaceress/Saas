/**
 * Estratégia de controle de estoque — fonte única de verdade.
 *
 * Cada empresa escolhe no onboarding (e troca em Configurações → Estoque) como
 * decide o que comprar:
 *
 *  · MINIMO        — um piso por produto. Chegou no piso, repõe até o piso.
 *  · MINIMO_IDEAL  — piso + alvo. Repõe até o ideal (comportamento histórico).
 *  · ROTATIVIDADE  — sem metas fixas: estatística simples sobre o histórico de
 *                    venda (média diária × dias de cobertura desejados).
 *
 * Trocar de estratégia nunca apaga dado: `estoqueMinimo`/`estoqueIdeal` seguem
 * gravados no Stock, só deixam de aparecer e de entrar no cálculo.
 *
 * Sem client/server: este módulo é importável de RSC, Server Action e client.
 */

export type TipoControleEstoque = "MINIMO" | "MINIMO_IDEAL" | "ROTATIVIDADE";

export const TIPOS_CONTROLE: TipoControleEstoque[] = ["MINIMO", "MINIMO_IDEAL", "ROTATIVIDADE"];

export const CONTROLE_LABELS: Record<TipoControleEstoque, { nome: string; desc: string }> = {
  MINIMO: {
    nome: "Estoque mínimo",
    desc: "Você define um piso por produto. Chegou no piso, ele entra na lista de reposição.",
  },
  MINIMO_IDEAL: {
    nome: "Estoque mínimo + ideal",
    desc: "Além do piso, um nível ideal. A sugestão de compra recompõe até o ideal.",
  },
  ROTATIVIDADE: {
    nome: "Controle por rotatividade",
    desc: "Sem metas fixas: o sistema olha o giro de venda e calcula quanto comprar para cobrir os próximos dias.",
  },
};

/** Janelas de histórico oferecidas para a média diária. */
export const PERIODOS_MEDIA = [15, 30, 60, 90] as const;
/** Coberturas oferecidas (de quantos em quantos dias a empresa compra). */
export const COBERTURAS = [7, 14, 21, 30] as const;

export const PERIODO_MEDIA_PADRAO = 30;
export const COBERTURA_PADRAO = 7;

/**
 * Histórico mínimo para a sugestão por rotatividade fazer sentido. Abaixo
 * disso o sistema informa que ainda está aprendendo — sem bloquear nada.
 */
export const APRENDIZADO_DIAS = 14;

export const MSG_APRENDIZADO =
  "A sugestão automática de compra ficará disponível após acumular histórico suficiente de vendas.";

export type EstoquePolicy = {
  tipo: TipoControleEstoque;
  /** Janela (dias) do histórico de venda usada na média diária. */
  periodoMediaDias: number;
  /** Dias de venda que a compra deve cobrir. */
  diasCobertura: number;
  /** Mostra e usa o campo "estoque mínimo". */
  usaMinimo: boolean;
  /** Mostra e usa o campo "estoque ideal". */
  usaIdeal: boolean;
  /** Decide pelo giro (média diária × cobertura) em vez de metas fixas. */
  usaGiro: boolean;
};

const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const nn = Math.round(Number(v));
  return Number.isFinite(nn) ? Math.min(max, Math.max(min, nn)) : fallback;
};

/** Policy a partir do Tenant (aceita o registro cru do Prisma). */
export function policyDoTenant(t: {
  tipoControleEstoque?: string | null;
  periodoMediaDias?: number | null;
  diasCobertura?: number | null;
}): EstoquePolicy {
  const tipo: TipoControleEstoque = TIPOS_CONTROLE.includes(t.tipoControleEstoque as TipoControleEstoque)
    ? (t.tipoControleEstoque as TipoControleEstoque)
    : "MINIMO_IDEAL";
  return {
    tipo,
    periodoMediaDias: clampInt(t.periodoMediaDias, 7, 365, PERIODO_MEDIA_PADRAO),
    diasCobertura: clampInt(t.diasCobertura, 1, 90, COBERTURA_PADRAO),
    usaMinimo: tipo !== "ROTATIVIDADE",
    usaIdeal: tipo === "MINIMO_IDEAL",
    usaGiro: tipo === "ROTATIVIDADE",
  };
}

/** Fallback para telas que ainda não receberam a policy do servidor. */
export const POLICY_PADRAO: EstoquePolicy = policyDoTenant({});

// ── Estatística de giro ───────────────────────────────────────
// Sem IA, sem modelo: média aritmética sobre a janela escolhida.

/** Média diária de venda = consumo da janela ÷ dias da janela. */
export function mediaDiaria(consumoJanela: number, diasJanela: number): number {
  if (diasJanela <= 0 || consumoJanela <= 0) return 0;
  return consumoJanela / diasJanela;
}

/** Cobertura em dias = saldo ÷ média diária. null = sem giro na janela. */
export function coberturaDias(estoque: number, mediaDia: number): number | null {
  if (mediaDia <= 0) return null;
  return Math.max(0, estoque / mediaDia);
}

/** Quanto comprar para cobrir `diasCobertura` de venda, descontando o que já vem. */
export function necessidadeGiro(args: {
  mediaDia: number;
  estoque: number;
  pendente?: number;
  diasCobertura: number;
}): number {
  const alvo = Math.ceil(args.mediaDia * args.diasCobertura);
  return Math.max(0, alvo - args.estoque - (args.pendente ?? 0));
}

/**
 * Alvo de reposição (em unidades base) conforme a estratégia:
 *  · MINIMO       → recompõe o piso e cobre o próximo período de venda
 *                   (comprar só até o piso daria sugestão zero justamente
 *                   quando o produto acabou de atingi-lo);
 *  · MINIMO_IDEAL → o ideal; sem ideal, cobre `diasCobertura` de venda ou 2× o piso;
 *  · ROTATIVIDADE → média diária × dias de cobertura.
 */
export function alvoReposicao(
  policy: EstoquePolicy,
  args: { minimo: number; ideal: number; mediaDia: number },
): number {
  if (policy.usaGiro) return Math.ceil(args.mediaDia * policy.diasCobertura);
  if (policy.tipo === "MINIMO") {
    const giro = Math.ceil(args.mediaDia * policy.diasCobertura);
    // Sem giro registrado, dobrar o piso é o que sobra como referência.
    return Math.max(0, args.minimo + (giro > 0 ? giro : args.minimo));
  }
  return Math.max(
    args.ideal,
    Math.ceil(args.mediaDia * policy.diasCobertura),
    args.minimo > 0 ? args.minimo * 2 : 0,
  );
}

/** Faixas de cobertura do painel: muito baixo · atenção · ideal. */
export type NivelCobertura = "muito-baixo" | "atencao" | "ideal" | "sem-giro";

export const NIVEL_COBERTURA_LABEL: Record<NivelCobertura, string> = {
  "muito-baixo": "Muito baixo",
  atencao: "Atenção",
  ideal: "Ideal",
  "sem-giro": "Sem giro",
};

/** Classifica a cobertura atual contra a meta da empresa. */
export function nivelCobertura(cobertura: number | null, meta: number): NivelCobertura {
  if (cobertura == null) return "sem-giro";
  if (cobertura <= meta * 0.3) return "muito-baixo";
  if (cobertura < meta) return "atencao";
  return "ideal";
}

/** Rótulo curto de cobertura para célula de tabela. */
export function fmtCobertura(cobertura: number | null): string {
  if (cobertura == null) return "sem giro";
  if (cobertura < 1) return "menos de 1 dia";
  const d = Math.floor(cobertura);
  return `${d} ${d === 1 ? "dia" : "dias"}`;
}

/** Sistema ainda sem histórico suficiente para a sugestão por giro. */
export function estaAprendendo(policy: EstoquePolicy, diasDeHistorico: number | null): boolean {
  return policy.usaGiro && (diasDeHistorico == null || diasDeHistorico < APRENDIZADO_DIAS);
}
