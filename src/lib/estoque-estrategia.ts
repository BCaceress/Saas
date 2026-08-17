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
 * % da meta de cobertura que separa "crítico" de "só baixo". Ajustável por
 * empresa (Configurações → Estoque): quem repõe todo dia quer o alarme mais
 * tarde; quem recebe uma vez por semana quer mais cedo.
 */
export const PCT_CRITICO_PADRAO = 30;
export const PCT_CRITICO_MIN = 10;
export const PCT_CRITICO_MAX = 80;
export const PCTS_CRITICO = [20, 30, 40, 50] as const;

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
  /** Fração da meta abaixo da qual a cobertura é crítica (0,3 = 30%). */
  fatorCritico: number;
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
  coberturaCriticaPct?: number | null;
}): EstoquePolicy {
  const tipo: TipoControleEstoque = TIPOS_CONTROLE.includes(t.tipoControleEstoque as TipoControleEstoque)
    ? (t.tipoControleEstoque as TipoControleEstoque)
    : "MINIMO_IDEAL";
  return {
    tipo,
    periodoMediaDias: clampInt(t.periodoMediaDias, 7, 365, PERIODO_MEDIA_PADRAO),
    diasCobertura: clampInt(t.diasCobertura, 1, 90, COBERTURA_PADRAO),
    fatorCritico:
      clampInt(t.coberturaCriticaPct, PCT_CRITICO_MIN, PCT_CRITICO_MAX, PCT_CRITICO_PADRAO) / 100,
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

// ── Faixas de severidade ──────────────────────────────────────
// Os fatores abaixo são a régua de TODA leitura de nível de estoque do
// sistema (sino, dashboard, reposição). Estavam repetidos e divergentes em
// três arquivos — um mesmo produto podia ser "crítico" na compra e "ok" no
// alerta. Aqui é o único lugar onde esses números existem.

/** Cobertura ≤ meta × isto → crítico. Padrão; a empresa ajusta em `policy.fatorCritico`. */
export const FATOR_CRITICO = PCT_CRITICO_PADRAO / 100;
/** Cobertura < meta × isto (e ≥ meta) → só monitorar. */
export const FATOR_MONITORAR = 1.5;
/** Saldo < piso × isto → crítico (estratégias com mínimo). */
export const FATOR_MINIMO_CRITICO = 0.5;

/** Faixas de cobertura do painel: muito baixo · atenção · ideal. */
export type NivelCobertura = "muito-baixo" | "atencao" | "ideal" | "sem-giro";

export const NIVEL_COBERTURA_LABEL: Record<NivelCobertura, string> = {
  "muito-baixo": "Muito baixo",
  atencao: "Atenção",
  ideal: "Ideal",
  "sem-giro": "Sem giro",
};

/**
 * Classifica a cobertura atual contra a meta da empresa. `fator` é o corte de
 * "muito baixo" — passe `policy.fatorCritico` quando a policy estiver à mão.
 */
export function nivelCobertura(
  cobertura: number | null,
  meta: number,
  fator: number = FATOR_CRITICO,
): NivelCobertura {
  if (cobertura == null) return "sem-giro";
  if (cobertura <= meta * fator) return "muito-baixo";
  if (cobertura < meta) return "atencao";
  return "ideal";
}

// ── Classificação única do nível de estoque ───────────────────

/**
 * Gravidade do saldo de um produto, na régua da estratégia da empresa.
 * `ok` = nada a fazer.
 */
export type NivelEstoque = "negativo" | "ruptura" | "critico" | "abaixo" | "monitorar" | "ok";

/**
 * O QUE fez o nível ser esse — é o motivo que decide o texto e o alerta:
 *  · `saldo`     → o próprio saldo (negativo ou zerado);
 *  · `minimo`    → passou do piso configurado;
 *  · `ideal`     → abaixo do alvo (só MINIMO_IDEAL);
 *  · `cobertura` → o giro de venda não cobre os dias desejados.
 */
export type MotivoNivel = "saldo" | "minimo" | "ideal" | "cobertura";

export type DadosNivel = {
  estoque: number;
  minimo?: number;
  ideal?: number;
  /** Média diária de venda. 0 = sem giro na janela. */
  mediaDia?: number;
};

export type ClassificacaoNivel = {
  nivel: NivelEstoque;
  motivo: MotivoNivel;
  cobertura: number | null;
  /** Dias de cobertura desejados pela empresa (eco de `policy.diasCobertura`). */
  meta: number;
  /**
   * Não há base para julgar: a estratégia não tem meta configurada para este
   * produto e ele também não tem giro. Saldo negativo/zerado ainda vale —
   * quem consome decide se ignora o resto (a reposição ignora, o sino não).
   */
  semBase: boolean;
};

/**
 * Classifica um produto conforme a estratégia da empresa. É a função que o
 * sino, o dashboard e a sugestão de compra compartilham — trocar a estratégia
 * em Configurações → Estoque muda os três de uma vez, sem texto divergente.
 *
 * Regras por estratégia (saldo negativo e zerado valem para todas):
 *  · MINIMO        → piso; crítico abaixo de metade dele;
 *  · MINIMO_IDEAL  → piso + alvo; o alvo só vira "monitorar";
 *  · ROTATIVIDADE  → sem metas: cobertura (saldo ÷ média diária) contra a meta.
 */
export function classificarNivel(policy: EstoquePolicy, dados: DadosNivel): ClassificacaoNivel {
  const estoque = dados.estoque;
  const minimo = dados.minimo ?? 0;
  const ideal = dados.ideal ?? 0;
  const mediaDia = dados.mediaDia ?? 0;
  const meta = policy.diasCobertura;
  const cobertura = coberturaDias(estoque, mediaDia);

  const semBase = policy.usaGiro
    ? mediaDia <= 0
    : policy.usaIdeal
      ? minimo <= 0 && ideal <= 0 && mediaDia <= 0
      : minimo <= 0 && mediaDia <= 0;

  const base = { cobertura, meta, semBase };
  if (estoque < 0) return { ...base, nivel: "negativo", motivo: "saldo" };
  if (estoque <= 0) return { ...base, nivel: "ruptura", motivo: "saldo" };
  if (semBase) return { ...base, nivel: "ok", motivo: "saldo" };

  if (policy.usaGiro) {
    if (cobertura == null) return { ...base, nivel: "ok", motivo: "cobertura" };
    if (cobertura <= meta * policy.fatorCritico) return { ...base, nivel: "critico", motivo: "cobertura" };
    if (cobertura < meta) return { ...base, nivel: "abaixo", motivo: "cobertura" };
    if (cobertura < meta * FATOR_MONITORAR) return { ...base, nivel: "monitorar", motivo: "cobertura" };
    return { ...base, nivel: "ok", motivo: "cobertura" };
  }

  // Metas fixas primeiro: o piso é a promessa que a empresa fez a si mesma.
  if (minimo > 0 && estoque < minimo * FATOR_MINIMO_CRITICO) {
    return { ...base, nivel: "critico", motivo: "minimo" };
  }
  if (minimo > 0 && estoque <= minimo) return { ...base, nivel: "abaixo", motivo: "minimo" };
  if (policy.usaIdeal && ideal > 0 && estoque < ideal) {
    return { ...base, nivel: "monitorar", motivo: "ideal" };
  }

  // Sem meta violada, o giro ainda pode antecipar o problema.
  if (cobertura != null) {
    if (cobertura <= meta * policy.fatorCritico) return { ...base, nivel: "critico", motivo: "cobertura" };
    if (cobertura < meta) return { ...base, nivel: "abaixo", motivo: "cobertura" };
    if (cobertura < meta * FATOR_MONITORAR) return { ...base, nivel: "monitorar", motivo: "cobertura" };
  }
  return { ...base, nivel: "ok", motivo: "cobertura" };
}

const un = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

/**
 * Frase que explica o nível na língua da estratégia ativa. Existe para que o
 * sino, o card do dashboard e a lista de compra digam a MESMA coisa — antes o
 * dashboard falava em "estoque mínimo" mesmo para quem controla por giro.
 */
export function descreverNivel(
  policy: EstoquePolicy,
  dados: DadosNivel,
  c: ClassificacaoNivel,
): string {
  const estoque = dados.estoque;
  switch (c.nivel) {
    case "negativo":
      return "Estoque negativo — revise as movimentações.";
    case "ruptura":
      return "Sem estoque — você está perdendo venda.";
    case "ok":
      return "Estoque em nível adequado.";
    default:
      break;
  }
  if (c.motivo === "minimo") {
    return `Abaixo do mínimo (${un(estoque)} de ${un(dados.minimo ?? 0)}).`;
  }
  if (c.motivo === "ideal") {
    return `Abaixo do ideal (${un(estoque)} de ${un(dados.ideal ?? 0)}) — considere repor.`;
  }
  const cob = fmtCobertura(c.cobertura);
  return c.nivel === "critico"
    ? `Cobertura de ${cob} — meta de ${c.meta} dias.`
    : `Cobertura de ${cob} — abaixo dos ${c.meta} dias desejados.`;
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
