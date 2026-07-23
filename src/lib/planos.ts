import type { Plan, Tenant } from "@/generated/prisma";

// ============================================================
// Planos, add-ons e limites — FONTE ÚNICA DE VERDADE comercial.
//
// Duas camadas de propósito, e elas respondem perguntas diferentes:
//   plano/add-on  → "esse tenant PODE usar isso?"  (comercial, muda na venda)
//   modulo*       → "esse tenant LIGOU isso?"      (operacional, muda no uso)
// Uma feature só vale quando as duas dizem sim. Sem essa separação, upgrade de
// plano ligaria módulo sozinho no menu de quem não pediu.
//
// Add-on existe para o que tem custo variável ou por unidade — emissão fiscal
// (a Nuvem Fiscal cobra por documento) e totem (por dispositivo). Enfiar isso
// no plano é vender prejuízo para quem emite muito.
// ============================================================

/** Capacidade vendável. Nomeada por domínio.capacidade, como as permissões. */
export type Feature =
  // Operação
  | "pdv"
  | "autoatendimento"
  | "fiscal"
  | "comodato"
  | "rota"
  // Gestão
  | "compras.recebimento" // pedido → recebimento → entrada (fluxo completo)
  | "crm.fidelizacao" // níveis, cupom automático, cliente em risco
  | "equipe.perfis" // perfis por loja além do administrador
  // Análise
  | "relatorios.avancados" // curva ABC, giro, histórico longo
  | "relatorios.exportar"
  // Escala
  | "multiloja"
  | "api";

/** Limites numéricos do plano. `null` = ilimitado. */
export type Limites = {
  sites: number | null;
  usuarios: number | null;
  produtos: number | null;
  /** Dias de histórico visível em relatórios/snapshots. */
  historicoDias: number | null;
};

export type PlanoDef = {
  nome: string;
  descricao: string;
  /** Preço-base mensal em BRL, só para exibição na tela de planos. */
  preco: number;
  features: readonly Feature[];
  limites: Limites;
};

// Prata é o piso: gestão do dia a dia sem frente de caixa. Ouro é a âncora —
// onde a maior parte da base deve cair. Diamante é rede/operador de bebidas.
export const PLANOS: Record<Plan, PlanoDef> = {
  PRATA: {
    nome: "Prata",
    descricao: "Catálogo, estoque e compras para quem está começando.",
    preco: 129,
    features: ["relatorios.exportar"],
    limites: { sites: 1, usuarios: 2, produtos: 500, historicoDias: 90 },
  },

  OURO: {
    nome: "Ouro",
    descricao: "A operação inteira: frente de caixa, fidelização e análises.",
    preco: 279,
    features: [
      "pdv",
      "compras.recebimento",
      "crm.fidelizacao",
      "equipe.perfis",
      "relatorios.avancados",
      "relatorios.exportar",
      "multiloja",
    ],
    limites: { sites: 3, usuarios: 10, produtos: 5000, historicoDias: 365 },
  },

  DIAMANTE: {
    nome: "Diamante",
    descricao: "Rede, comodato e rota de reposição, sem limite de loja.",
    preco: 599,
    features: [
      "pdv",
      "autoatendimento",
      "comodato",
      "rota",
      "compras.recebimento",
      "crm.fidelizacao",
      "equipe.perfis",
      "relatorios.avancados",
      "relatorios.exportar",
      "multiloja",
      "api",
    ],
    limites: { sites: null, usuarios: null, produtos: null, historicoDias: null },
  },
};

/** Ordem comercial — usada na tela de planos e para comparar (upgrade/downgrade). */
export const PLANOS_ORDEM: readonly Plan[] = ["PRATA", "OURO", "DIAMANTE"];

export function planoAtendeOuSuperior(atual: Plan, minimo: Plan): boolean {
  return PLANOS_ORDEM.indexOf(atual) >= PLANOS_ORDEM.indexOf(minimo);
}

/** Menor plano que já inclui a feature. `null` = só existe como add-on. */
export function planoMinimo(feature: Feature): Plan | null {
  return PLANOS_ORDEM.find((p) => PLANOS[p].features.includes(feature)) ?? null;
}

// ── Add-ons ─────────────────────────────────────────────────

export type AddonSlug = "fiscal" | "autoatendimento" | "loja-extra";

export type AddonDef = {
  nome: string;
  descricao: string;
  /** Preço mensal em BRL. Em `porUnidade`, é o preço de cada unidade. */
  preco: number;
  porUnidade?: boolean;
  /** Feature destravada. `null` = só mexe em limite (ex.: loja extra). */
  feature: Feature | null;
  /** Plano mínimo para contratar — add-on não substitui o plano-base. */
  requerPlano: Plan;
};

export const ADDONS: Record<AddonSlug, AddonDef> = {
  fiscal: {
    nome: "Emissão fiscal",
    descricao:
      "NFC-e e NF-e com certificado próprio. Inclui 300 documentos/mês; excedente cobrado por documento.",
    preco: 89,
    feature: "fiscal",
    requerPlano: "OURO", // emitir nota pressupõe frente de caixa
  },
  autoatendimento: {
    nome: "Autoatendimento (totem)",
    descricao: "Modo quiosque para o cliente comprar sozinho. Cobrado por dispositivo.",
    preco: 79,
    porUnidade: true,
    feature: "autoatendimento",
    requerPlano: "OURO",
  },
  "loja-extra": {
    nome: "Loja adicional",
    descricao: "Uma loja além das incluídas no plano.",
    preco: 59,
    porUnidade: true,
    feature: null,
    requerPlano: "OURO",
  },
};

export const ADDONS_SLUGS = Object.keys(ADDONS) as AddonSlug[];

export function ehAddonSlug(v: string): v is AddonSlug {
  return v in ADDONS;
}

// ── Consulta ────────────────────────────────────────────────

/** O mínimo do Tenant que as funções abaixo precisam — facilita testar e chamar. */
export type Assinatura = Pick<Tenant, "plano" | "addons" | "lojasExtras">;

/** O tenant PODE usar essa feature (por plano ou por add-on)? */
export function temFeature(t: Assinatura, feature: Feature): boolean {
  if (PLANOS[t.plano].features.includes(feature)) return true;
  return t.addons.some((slug) => ehAddonSlug(slug) && ADDONS[slug].feature === feature);
}

/** Features efetivas — plano + add-ons. Use para pintar tela de plano/upsell. */
export function featuresDe(t: Assinatura): Feature[] {
  const set = new Set<Feature>(PLANOS[t.plano].features);
  for (const slug of t.addons) {
    if (!ehAddonSlug(slug)) continue;
    const f = ADDONS[slug].feature;
    if (f) set.add(f);
  }
  return [...set];
}

/**
 * Limites efetivos. `sites` soma as lojas extras contratadas; plano ilimitado
 * continua ilimitado.
 */
export function limitesDe(t: Assinatura): Limites {
  const base = PLANOS[t.plano].limites;
  return {
    ...base,
    sites: base.sites === null ? null : base.sites + t.lojasExtras,
  };
}

/**
 * Ainda cabe mais um? `usados` é a contagem ATUAL — a checagem é feita antes de
 * criar, então o novo registro cabe quando `usados < limite`.
 */
export function cabeMais(
  t: Assinatura,
  chave: keyof Limites,
  usados: number,
): boolean {
  const limite = limitesDe(t)[chave];
  return limite === null || usados < limite;
}

// ── Ponte plano ↔ toggles de módulo ─────────────────────────

/**
 * Features que têm um toggle correspondente no Tenant. Só elas aparecem em
 * Configurações → Módulos; o resto vale direto pelo plano.
 */
export const FEATURE_TOGGLE = {
  pdv: "moduloPdv",
  fiscal: "moduloFiscal",
  comodato: "moduloComodato",
  rota: "moduloRota",
  autoatendimento: "moduloAutoatendimento",
} as const satisfies Partial<Record<Feature, keyof Tenant>>;

export type FeatureComToggle = keyof typeof FEATURE_TOGGLE;

export const FEATURES_COM_TOGGLE = Object.keys(FEATURE_TOGGLE) as FeatureComToggle[];

/**
 * Toggles parciais de propósito: quem só precisa de uma feature não deveria
 * carregar o Tenant inteiro do banco. Toggle ausente conta como desligado —
 * fail-closed é o lado certo de errar aqui.
 */
type ComToggles = Assinatura &
  Partial<Record<(typeof FEATURE_TOGGLE)[FeatureComToggle], boolean>>;

/**
 * Feature ATIVA = o plano libera E o operador ligou. É o que menu, guard e
 * regra de negócio devem perguntar — nunca o toggle cru, que sobrevive a um
 * downgrade e reabriria o módulo de graça.
 */
export function featureAtiva(t: ComToggles, feature: Feature): boolean {
  if (!temFeature(t, feature)) return false;
  const toggle = FEATURE_TOGGLE[feature as FeatureComToggle];
  return toggle ? (t[toggle] ?? false) : true;
}

/** Toggles já cruzados com o plano — é o que a navegação consome. */
export function togglesEfetivos(
  t: Assinatura &
    Pick<
      Tenant,
      "moduloPdv" | "moduloFiscal" | "moduloComodato" | "moduloRota" | "moduloAutoatendimento"
    >,
) {
  return {
    moduloPdv: featureAtiva(t, "pdv"),
    moduloFiscal: featureAtiva(t, "fiscal"),
    moduloComodato: featureAtiva(t, "comodato"),
    moduloRota: featureAtiva(t, "rota"),
    moduloAutoatendimento: featureAtiva(t, "autoatendimento"),
  };
}

/**
 * Menor combinação plano + add-ons que cobre as features pedidas, nunca abaixo
 * de `minimo`. Usado no onboarding: o preset diz o que a operação precisa e o
 * plano sai daí — em vez de o preset ligar módulo que o plano não cobre.
 */
export function assinaturaParaFeatures(
  features: readonly Feature[],
  minimo: Plan = "PRATA",
): { plano: Plan; addons: AddonSlug[] } {
  const addons = new Set<AddonSlug>();
  let plano = minimo;

  for (const f of features) {
    // Feature que só existe como add-on não empurra o plano além do que o
    // próprio add-on exige — é o caso do fiscal.
    const addon = ADDONS_SLUGS.find((s) => ADDONS[s].feature === f);
    const viaPlano = planoMinimo(f);

    if (viaPlano && planoAtendeOuSuperior(plano, viaPlano)) continue; // já coberto

    if (addon) {
      addons.add(addon);
      if (!planoAtendeOuSuperior(plano, ADDONS[addon].requerPlano)) {
        plano = ADDONS[addon].requerPlano;
      }
      continue;
    }
    if (viaPlano) plano = viaPlano;
  }

  // Subir de plano pode ter tornado um add-on redundante (a feature passou a
  // vir inclusa) — não cobre duas vezes pela mesma coisa.
  for (const s of [...addons]) {
    const f = ADDONS[s].feature;
    if (f && PLANOS[plano].features.includes(f)) addons.delete(s);
  }

  return { plano, addons: [...addons] };
}

/**
 * Filtro Prisma para varreduras CROSS-TENANT (jobs, filas): só tenants que
 * podem usar a feature — por plano ou por add-on. Combine com o toggle:
 * `where: { moduloFiscal: true, ...whereFeature("fiscal") }`.
 */
export function whereFeature(feature: Feature) {
  const planos = PLANOS_ORDEM.filter((p) => PLANOS[p].features.includes(feature));
  const addon = ADDONS_SLUGS.find((s) => ADDONS[s].feature === feature);
  const or: object[] = [{ plano: { in: planos } }];
  if (addon) or.push({ addons: { has: addon } });
  return { OR: or };
}

// ── Erro ────────────────────────────────────────────────────

/** Bloqueio comercial (≠ falta de permissão). As actions viram toast com upsell. */
export class PlanoInsuficienteError extends Error {
  /** `feature` é null quando o bloqueio foi por limite (loja, usuário, produto). */
  constructor(
    readonly feature: Feature | null,
    mensagem?: string,
  ) {
    super(mensagem ?? (feature ? mensagemUpgrade(feature) : "Limite do plano atingido."));
    this.name = "PlanoInsuficienteError";
  }
}

/** Texto de upsell: diz o que falta e como resolver, sem pedir desculpas. */
export function mensagemUpgrade(feature: Feature): string {
  const addon = ADDONS_SLUGS.find((s) => ADDONS[s].feature === feature);
  if (addon) return `Contrate o add-on ${ADDONS[addon].nome} para usar este recurso.`;
  const min = planoMinimo(feature);
  return min
    ? `Este recurso faz parte do plano ${PLANOS[min].nome}. Faça upgrade para liberar.`
    : "Este recurso não está disponível no seu plano.";
}

export function mensagemLimite(chave: keyof Limites, limite: number): string {
  const rotulo: Record<keyof Limites, string> = {
    sites: "lojas",
    usuarios: "usuários",
    produtos: "produtos",
    historicoDias: "dias de histórico",
  };
  return `Seu plano permite ${limite} ${rotulo[chave]}. Faça upgrade para adicionar mais.`;
}
