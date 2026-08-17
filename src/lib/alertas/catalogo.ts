/**
 * Catálogo de alertas — fonte única de verdade sobre O QUE o sistema avisa.
 *
 * Antes, a identidade de cada alerta (categoria, prioridade, ícone, e em que
 * estratégia de estoque ele faz sentido) estava espalhada: metade em
 * `lib/alertas/computar.ts`, metade em textos fixos da tela de Notificações.
 * O resultado era a tela oferecer "abaixo do ideal" para uma empresa que
 * controla por rotatividade — configuração que não liga em nada.
 *
 * Aqui cada alerta é declarado uma vez: quem consome (o motor, o sino, a tela
 * de configuração) lê deste mapa. Adicionar alerta = adicionar entrada aqui.
 *
 * Módulo client-safe: sem banco, sem `server-only`. A tela de Configurações →
 * Notificações se renderiza a partir dele.
 */

import type { AlertCategory, AlertIcon, AlertPriority } from "@/lib/alerts-types";
import { CATEGORY_ORDER } from "@/lib/alerts-types";
import {
  classificarNivel,
  descreverNivel,
  type ClassificacaoNivel,
  type DadosNivel,
  type EstoquePolicy,
  type TipoControleEstoque,
} from "@/lib/estoque-estrategia";

/**
 * Tipo do alerta — é o prefixo do `AlertItem.id` (`"minimo:<productId>"`).
 * O id completo continua identificando a OCORRÊNCIA (usado na deduplicação do
 * push); o tipo identifica a REGRA.
 */
export type AlertKind =
  | "estoque-negativo"
  | "sem-estoque"
  | "minimo"
  | "reposicao"
  | "cobertura-critica"
  | "cobertura-baixa"
  | "validade-vencida"
  | "validade-proxima"
  | "sem-preco"
  | "sem-custo"
  | "novo-sem-mov"
  | "parado"
  | "inventario"
  | "transferencia"
  | "recebimento"
  | "compra"
  | "aniversario"
  | "cliente-risco";

/** Ajuste do Tenant que o alerta lê. Serve de rastro na tela de configuração. */
export type ChaveConfig =
  | "estoqueMinimo"
  | "estoqueIdeal"
  | "diasCobertura"
  | "periodoMediaDias"
  | "coberturaCriticaPct"
  | "produtoParadoDias"
  | "cupomDiasRisco"
  | "validadeAlertaDias"
  | "inventarioAtrasoDias"
  | "novoSemMovDias";

export const CONFIG_LABEL: Record<ChaveConfig, string> = {
  estoqueMinimo: "estoque mínimo do produto",
  estoqueIdeal: "estoque ideal do produto",
  diasCobertura: "dias de cobertura",
  periodoMediaDias: "janela da média de venda",
  coberturaCriticaPct: "corte de cobertura crítica",
  produtoParadoDias: "dias sem movimentação",
  cupomDiasRisco: "dias sem comprar",
  validadeAlertaDias: "antecedência do alerta de validade",
  inventarioAtrasoDias: "dias até considerar atrasado",
  novoSemMovDias: "dias após o cadastro",
};

/**
 * Onde o ajuste é editado. Um campo, um dono: a tela de Notificações edita só
 * os limiares que nasceram com o alerta (ver `LIMIARES`) e, para o resto,
 * aponta para quem manda — senão o mesmo número teria dois donos e a última
 * tela salva venceria.
 */
export const CONFIG_ONDE: Record<ChaveConfig, { tela: string; href: string } | null> = {
  estoqueMinimo: { tela: "cada produto", href: "/produtos" },
  estoqueIdeal: { tela: "cada produto", href: "/produtos" },
  diasCobertura: { tela: "Estoque e alertas", href: "/configuracoes/estoque" },
  periodoMediaDias: { tela: "Estoque e alertas", href: "/configuracoes/estoque" },
  coberturaCriticaPct: { tela: "Estoque e alertas", href: "/configuracoes/estoque" },
  produtoParadoDias: { tela: "Estoque e alertas", href: "/configuracoes/estoque" },
  cupomDiasRisco: { tela: "Fidelização", href: "/configuracoes/fidelizacao" },
  validadeAlertaDias: { tela: "Estoque e alertas", href: "/configuracoes/estoque" },
  inventarioAtrasoDias: null, // editado aqui mesmo
  novoSemMovDias: null,
};

/** Limiares cujo dono é a tela de Notificações. */
export type ChaveLimiar = "inventarioAtrasoDias" | "novoSemMovDias";

export const LIMIARES: Record<
  ChaveLimiar,
  { label: string; sufixo: string; min: number; max: number; padrao: number }
> = {
  inventarioAtrasoDias: {
    label: "Considerar atrasado depois de",
    sufixo: "dias",
    min: 1,
    max: 60,
    padrao: 3,
  },
  novoSemMovDias: {
    label: "Avisar durante os primeiros",
    sufixo: "dias",
    min: 1,
    max: 90,
    padrao: 7,
  },
};

export type DefAlerta = {
  kind: AlertKind;
  categoria: AlertCategory;
  /** Prioridade padrão. Alguns alertas sobem/descem no contexto (ver `computar`). */
  prioridade: AlertPriority;
  icone: AlertIcon;
  /**
   * Estratégias de controle de estoque em que o alerta existe. `"todas"` para o
   * que não depende de estoque (preço, compra, inventário, cliente).
   */
  estrategias: TipoControleEstoque[] | "todas";
  /** Nome curto — é o que aparece na lista da tela de Notificações. */
  rotulo: string;
  /** Quando dispara, em uma frase. */
  ajuda: string;
  /** Ajustes que a regra lê — exibidos com o dono em `CONFIG_ONDE`. */
  config?: ChaveConfig[];
  /** Limiar editável direto no card do alerta (dono = tela de Notificações). */
  limiar?: ChaveLimiar;
};

export const CATALOGO: Record<AlertKind, DefAlerta> = {
  "estoque-negativo": {
    kind: "estoque-negativo",
    categoria: "criticos",
    prioridade: "critico",
    icone: "divergencia",
    estrategias: "todas",
    rotulo: "Estoque negativo",
    ajuda: "O saldo ficou abaixo de zero — há movimentação errada ou faltando.",
  },
  "sem-estoque": {
    kind: "sem-estoque",
    categoria: "criticos",
    prioridade: "critico",
    icone: "sem-estoque",
    estrategias: "todas",
    rotulo: "Sem estoque",
    ajuda: "O produto zerou e deixou de poder ser vendido.",
  },
  minimo: {
    kind: "minimo",
    categoria: "criticos",
    prioridade: "alto",
    icone: "minimo",
    estrategias: ["MINIMO", "MINIMO_IDEAL"],
    rotulo: "Abaixo do mínimo",
    ajuda: "O saldo chegou ao piso definido para o produto.",
    config: ["estoqueMinimo"],
  },
  reposicao: {
    kind: "reposicao",
    categoria: "operacao",
    prioridade: "medio",
    icone: "reposicao",
    estrategias: ["MINIMO_IDEAL"],
    rotulo: "Abaixo do ideal",
    ajuda: "Ainda acima do piso, mas longe do nível ideal — vale repor.",
    config: ["estoqueIdeal"],
  },
  "cobertura-critica": {
    kind: "cobertura-critica",
    categoria: "criticos",
    prioridade: "alto",
    icone: "minimo",
    estrategias: ["ROTATIVIDADE"],
    rotulo: "Cobertura crítica",
    ajuda: "No ritmo de venda atual, o estoque acaba muito antes da meta de dias.",
    config: ["diasCobertura", "coberturaCriticaPct", "periodoMediaDias"],
  },
  "cobertura-baixa": {
    kind: "cobertura-baixa",
    categoria: "operacao",
    prioridade: "medio",
    icone: "reposicao",
    estrategias: ["ROTATIVIDADE"],
    rotulo: "Cobertura baixa",
    ajuda: "O estoque não cobre todos os dias de venda que a empresa deseja.",
    config: ["diasCobertura", "periodoMediaDias"],
  },
  "validade-vencida": {
    kind: "validade-vencida",
    categoria: "criticos",
    prioridade: "critico",
    icone: "validade",
    estrategias: "todas",
    rotulo: "Lote vencido",
    ajuda: "Há saldo com a validade já passada — retire da prateleira e dê baixa.",
  },
  "validade-proxima": {
    kind: "validade-proxima",
    categoria: "operacao",
    prioridade: "medio",
    icone: "validade",
    estrategias: "todas",
    rotulo: "Lote perto de vencer",
    ajuda: "Lote dentro da janela de antecedência configurada — priorize a saída dele.",
    config: ["validadeAlertaDias"],
  },
  "sem-preco": {
    kind: "sem-preco",
    categoria: "criticos",
    prioridade: "critico",
    icone: "sem-preco",
    estrategias: "todas",
    rotulo: "Sem preço de venda",
    ajuda: "Produto sem preço não pode ser vendido no caixa.",
  },
  "sem-custo": {
    kind: "sem-custo",
    categoria: "financeiro",
    prioridade: "medio",
    icone: "custo",
    estrategias: "todas",
    rotulo: "Sem custo cadastrado",
    ajuda: "Sem custo não há margem — o produto some das análises de lucro.",
  },
  "novo-sem-mov": {
    kind: "novo-sem-mov",
    categoria: "operacao",
    prioridade: "info",
    icone: "novo",
    estrategias: "todas",
    rotulo: "Recém cadastrado sem movimentação",
    ajuda: "Produto criado há pouco e que ainda não teve entrada nem saída.",
    config: ["novoSemMovDias"],
    limiar: "novoSemMovDias",
  },
  parado: {
    kind: "parado",
    categoria: "operacao",
    prioridade: "baixo",
    icone: "parado",
    estrategias: "todas",
    rotulo: "Estoque parado",
    ajuda: "Produto com saldo e sem nenhuma movimentação há muitos dias.",
    config: ["produtoParadoDias"],
  },
  inventario: {
    kind: "inventario",
    categoria: "inventario",
    prioridade: "medio",
    icone: "inventario",
    estrategias: "todas",
    rotulo: "Inventário em aberto",
    ajuda: "Contagem iniciada e ainda não fechada — sobe de prioridade se atrasar.",
    config: ["inventarioAtrasoDias"],
    limiar: "inventarioAtrasoDias",
  },
  transferencia: {
    kind: "transferencia",
    categoria: "operacao",
    prioridade: "alto",
    icone: "transferencia",
    estrategias: "todas",
    rotulo: "Transferência aguardando",
    ajuda: "Mercadoria expedida entre lojas e ainda não confirmada no destino.",
  },
  recebimento: {
    kind: "recebimento",
    categoria: "operacao",
    prioridade: "alto",
    icone: "recebimento",
    estrategias: "todas",
    rotulo: "Entrada aguardando conferência",
    ajuda: "Pedido de compra que chegou (ou está a caminho) e falta conferir.",
  },
  compra: {
    kind: "compra",
    categoria: "financeiro",
    prioridade: "medio",
    icone: "compra",
    estrategias: "todas",
    rotulo: "Compra pendente",
    ajuda: "Pedido enviado ao fornecedor, ou rascunho que ninguém finalizou.",
  },
  aniversario: {
    kind: "aniversario",
    categoria: "inteligencia",
    prioridade: "medio",
    icone: "aniversario",
    estrategias: "todas",
    rotulo: "Aniversário de cliente",
    ajuda: "Cliente fidelizado faz aniversário — oportunidade de cupom.",
  },
  "cliente-risco": {
    kind: "cliente-risco",
    categoria: "inteligencia",
    prioridade: "baixo",
    icone: "cliente-risco",
    estrategias: "todas",
    rotulo: "Cliente em risco",
    ajuda: "Cliente fidelizado que parou de comprar há muitos dias.",
    config: ["cupomDiasRisco"],
  },
};

export const TODOS_ALERTAS: DefAlerta[] = Object.values(CATALOGO);

/** Tipo a partir do id da ocorrência (`"minimo:abc"` → `"minimo"`). */
export function kindDeAlerta(id: string): AlertKind | null {
  const prefixo = id.split(":")[0];
  return prefixo in CATALOGO ? (prefixo as AlertKind) : null;
}

/** O alerta faz sentido na estratégia escolhida pela empresa? */
export function alertaAplica(def: DefAlerta, policy: EstoquePolicy): boolean {
  return def.estrategias === "todas" || def.estrategias.includes(policy.tipo);
}

/** Alertas que a empresa pode receber hoje, dada a estratégia ativa. */
export function alertasDaEstrategia(policy: EstoquePolicy): DefAlerta[] {
  return TODOS_ALERTAS.filter((d) => alertaAplica(d, policy));
}

/** Alertas de uma categoria, na estratégia ativa — na ordem de gravidade. */
export function alertasDaCategoria(categoria: AlertCategory, policy: EstoquePolicy): DefAlerta[] {
  const ordem: AlertPriority[] = ["critico", "alto", "medio", "baixo", "info"];
  return alertasDaEstrategia(policy)
    .filter((d) => d.categoria === categoria)
    .sort((a, b) => ordem.indexOf(a.prioridade) - ordem.indexOf(b.prioridade));
}

/**
 * Categorias que realmente produzem alerta na estratégia ativa. A tela de
 * Notificações se monta a partir disto — categoria sem alerta nenhum (hoje:
 * "Consumo aberto") não vira um interruptor que não faz nada.
 */
export function categoriasComAlertas(policy: EstoquePolicy): AlertCategory[] {
  return CATEGORY_ORDER.filter((c) => alertasDaCategoria(c, policy).length > 0);
}

// ── Preferência por tipo de alerta ────────────────────────────

/** O que a empresa escolheu para UM tipo de alerta. */
export type PrefAlerta = {
  ligado?: boolean;
  /** Sobe ou desce a urgência sem mexer na regra que dispara o alerta. */
  prioridade?: AlertPriority;
};

/** Conteúdo de `Tenant.alertasConfig`. */
export type AlertasConfig = Partial<Record<AlertKind, PrefAlerta>>;

/** Campos do Tenant que a resolução usa (aceita o registro cru do Prisma). */
export type TenantAlertas = {
  alertasDesativados?: string[] | null;
  alertasConfig?: unknown;
};

const PRIORIDADES: AlertPriority[] = ["critico", "alto", "medio", "baixo", "info"];

/**
 * Lê o JSON cru sem confiar nele. O campo é gravado por uma Server Action
 * validada, mas o banco é mais velho que o código: chave desconhecida (alerta
 * removido do catálogo) e valor fora do tipo são descartados em silêncio, e a
 * preferência ausente cai no padrão — nunca derruba o sino.
 */
export function parseAlertasConfig(valor: unknown): AlertasConfig {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return {};
  const saida: AlertasConfig = {};
  for (const [chave, bruto] of Object.entries(valor as Record<string, unknown>)) {
    if (!(chave in CATALOGO)) continue;
    if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) continue;
    const p = bruto as Record<string, unknown>;
    const pref: PrefAlerta = {};
    if (typeof p.ligado === "boolean") pref.ligado = p.ligado;
    if (typeof p.prioridade === "string" && PRIORIDADES.includes(p.prioridade as AlertPriority)) {
      pref.prioridade = p.prioridade as AlertPriority;
    }
    saida[chave as AlertKind] = pref;
  }
  return saida;
}

export type ResolucaoAlerta = { ligado: boolean; prioridade: AlertPriority };

/**
 * Preferência efetiva de cada tipo de alerta, na ordem:
 *  1. estratégia de estoque — o que não existe nela nunca liga;
 *  2. escolha por tipo (`alertasConfig`);
 *  3. LEGADO: categoria desligada em `alertasDesativados`;
 *  4. padrão do catálogo.
 *
 * O passo 3 é o que mantém a promessa antiga viva: quem desligou "Financeiro"
 * antes desta tela continua sem os alertas de financeiro, sem precisar salvar
 * nada de novo.
 */
export function resolverAlertas(
  tenant: TenantAlertas,
  policy: EstoquePolicy,
): Record<AlertKind, ResolucaoAlerta> {
  const cfg = parseAlertasConfig(tenant.alertasConfig);
  const categoriasOff = new Set(tenant.alertasDesativados ?? []);
  const saida = {} as Record<AlertKind, ResolucaoAlerta>;
  for (const def of TODOS_ALERTAS) {
    const pref = cfg[def.kind];
    const ligado = !alertaAplica(def, policy)
      ? false
      : (pref?.ligado ?? !categoriasOff.has(def.categoria));
    saida[def.kind] = { ligado, prioridade: pref?.prioridade ?? def.prioridade };
  }
  return saida;
}

// ── Alerta de nível de estoque ────────────────────────────────

export type AlertaEstoque = {
  kind: AlertKind;
  prioridade: AlertPriority;
  categoria: AlertCategory;
  icone: AlertIcon;
  descricao: string;
  classificacao: ClassificacaoNivel;
};

/**
 * Traduz o nível de estoque de um produto no alerta correspondente — ou `null`
 * quando não há o que avisar. É AQUI que a estratégia vira alerta: o motor
 * (`computar.ts`) não decide mais nada sobre mínimo, ideal ou cobertura.
 *
 * Duas regras que o `null` esconde:
 *  1. `monitorar` só vira alerta quando o motivo é o ideal — cobertura ainda
 *     dentro da margem é assunto da tela de compras, não de notificação.
 *  2. Fora da rotatividade, motivo `cobertura` nunca notifica: a empresa
 *     escolheu governar por metas fixas, e avisar por giro seria contrabandear
 *     de volta a estratégia que ela desligou (a sugestão de compra continua
 *     usando o giro — lá é conselho, aqui seria cobrança).
 */
export function alertaDeEstoque(policy: EstoquePolicy, dados: DadosNivel): AlertaEstoque | null {
  const c = classificarNivel(policy, dados);
  const kind = kindDoNivel(policy, c);
  if (!kind) return null;
  const def = CATALOGO[kind];
  return {
    kind,
    prioridade: def.prioridade,
    categoria: def.categoria,
    icone: def.icone,
    descricao: descreverNivel(policy, dados, c),
    classificacao: c,
  };
}

function kindDoNivel(policy: EstoquePolicy, c: ClassificacaoNivel): AlertKind | null {
  switch (c.nivel) {
    case "negativo":
      return "estoque-negativo";
    case "ruptura":
      return "sem-estoque";
    case "critico":
      if (c.motivo === "minimo") return "minimo";
      return policy.usaGiro ? "cobertura-critica" : null;
    case "abaixo":
      if (c.motivo === "minimo") return "minimo";
      return policy.usaGiro ? "cobertura-baixa" : null;
    case "monitorar":
      return c.motivo === "ideal" ? "reposicao" : null;
    default:
      return null;
  }
}
