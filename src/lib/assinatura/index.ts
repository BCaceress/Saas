import "server-only";
import { basePrisma } from "@/lib/prisma";
import { enviarEmail } from "@/lib/email";
import {
  emailAssinaturaAtiva,
  emailContaSuspensa,
  emailPagamentoFalhou,
  emailTrialAcabando,
} from "@/lib/email/templates";
import { logErro, logInfo } from "@/lib/log";
import { ADDONS, PLANOS, ehAddonSlug } from "@/lib/planos";
import { tenantUrl } from "@/lib/urls";
import { mercadoPagoAssinatura } from "./mercadopago";
import type { AssinaturaProvider, Cobranca } from "./types";
import type { Plan, Subscription, SubscriptionStatus, Tenant } from "@/generated/prisma";

// ============================================================
// Assinatura do SaaS — orquestração.
//
// Princípio: o gateway manda no dinheiro, esta tabela manda no ACESSO. O app
// nunca pergunta ao Mercado Pago se o cliente pagou; ele lê `Tenant.status`,
// que o webhook e o job diário mantêm em dia. Gateway fora do ar não pode
// fechar a loja de ninguém.
//
// Subscription é tabela de CONTROLE (fora do RLS, como Membership e Invite):
// basePrisma com tenantId explícito.
// ============================================================

/** Dias de acesso normal depois de uma cobrança recusada. */
export const TOLERANCIA_DIAS = 7;
/** Quando avisar que o teste está acabando. */
export const AVISO_TRIAL_DIAS = [5, 2, 0];

export class AssinaturaBloqueadaError extends Error {
  constructor(msg = "Assinatura suspensa. Regularize o pagamento para voltar a operar.") {
    super(msg);
    this.name = "AssinaturaBloqueadaError";
  }
}

// ── Preço ───────────────────────────────────────────────────

export type Contratacao = Pick<Tenant, "plano" | "addons" | "lojasExtras"> & {
  /** Totens ativos — o add-on de autoatendimento é cobrado por dispositivo. */
  totens?: number;
};

/**
 * Preço mensal do contrato. Fonte única: a tabela de src/lib/planos.ts. Nunca
 * escreva valor solto em tela — a conta que vai ao gateway é esta.
 */
export function precoMensal(c: Contratacao): number {
  let total = PLANOS[c.plano].preco;

  for (const slug of c.addons) {
    if (!ehAddonSlug(slug)) continue;
    const addon = ADDONS[slug];
    if (slug === "autoatendimento") {
      total += addon.preco * Math.max(1, c.totens ?? 1);
    } else if (slug === "loja-extra") {
      // O add-on "loja-extra" é contado por Tenant.lojasExtras, não por
      // aparecer na lista — a lista só marca que foi contratado.
      continue;
    } else {
      total += addon.preco;
    }
  }

  total += ADDONS["loja-extra"].preco * c.lojasExtras;
  return Number(total.toFixed(2));
}

/** Descrição que aparece na fatura do lojista. */
export function descricaoCobranca(c: Contratacao): string {
  const extras: string[] = [];
  if (c.addons.includes("fiscal")) extras.push("fiscal");
  if (c.addons.includes("autoatendimento")) extras.push("totem");
  if (c.lojasExtras > 0) extras.push(`${c.lojasExtras} loja(s) extra`);
  return `NoHub Market ${PLANOS[c.plano].nome}${extras.length ? ` + ${extras.join(", ")}` : ""}`;
}

// ── Provider ────────────────────────────────────────────────

function provider(): AssinaturaProvider {
  return mercadoPagoAssinatura();
}

// ── Leitura ─────────────────────────────────────────────────

export async function assinaturaDoTenant(tenantId: string): Promise<Subscription | null> {
  return basePrisma.subscription.findUnique({ where: { tenantId } });
}

/** Para onde mandar cobrança: e-mail da empresa, senão o do dono da conta. */
async function destinatario(tenantId: string): Promise<{ email: string; nome: string } | null> {
  const tenant = await basePrisma.tenant.findUnique({
    where: { id: tenantId },
    select: { nome: true, emailContato: true },
  });
  if (!tenant) return null;

  const contato = tenant.emailContato?.trim();
  if (contato) return { email: contato, nome: tenant.nome };

  const dono = await basePrisma.membership.findFirst({
    where: { tenantId, proprietario: true },
    select: { user: { select: { email: true } } },
  });
  const email = dono?.user.email;
  return email ? { email, nome: tenant.nome } : null;
}

function urlPlano(subdomain: string): string {
  return tenantUrl(subdomain, "/configuracoes/plano");
}

// ── Contratação ─────────────────────────────────────────────

export type ResultadoCheckout = { checkoutUrl: string; externalId: string };

/**
 * Cria (ou refaz) a assinatura no gateway e devolve a URL de checkout.
 *
 * Refazer é o caminho normal de troca de plano: o preapproval do MP não muda
 * de valor depois de autorizado, então cancelamos o antigo e criamos outro.
 */
export async function iniciarAssinatura(
  tenantId: string,
  opcoes?: { totens?: number },
): Promise<ResultadoCheckout> {
  const tenant = await basePrisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error("Loja não encontrada.");

  const alvo = await destinatario(tenantId);
  if (!alvo) {
    throw new Error(
      "Informe um e-mail de contato em Configurações → Empresa antes de assinar — é para lá que vai a cobrança.",
    );
  }

  const contratacao: Contratacao = {
    plano: tenant.plano,
    addons: tenant.addons,
    lojasExtras: tenant.lojasExtras,
    totens: opcoes?.totens,
  };
  const valor = precoMensal(contratacao);
  const p = provider();

  const atual = await assinaturaDoTenant(tenantId);
  // Assinatura ativa no gateway com outro valor vira lixo cobrando sozinho.
  if (atual?.externalId && atual.status !== "CANCELADA") {
    try {
      await p.cancelar(atual.externalId);
    } catch (e) {
      logErro("assinatura.cancelar-anterior", e, { tenantId });
    }
  }

  const checkout = await p.criarCheckout({
    tenantId,
    descricao: descricaoCobranca(contratacao),
    valorMensal: valor,
    emailPagador: alvo.email,
    urlRetorno: urlPlano(tenant.subdomain),
  });

  await basePrisma.subscription.upsert({
    where: { tenantId },
    create: {
      tenantId,
      plano: tenant.plano,
      status: "PENDENTE",
      gateway: p.nome,
      externalId: checkout.externalId,
      checkoutUrl: checkout.checkoutUrl,
      valorMensal: valor,
      addons: tenant.addons,
    },
    update: {
      plano: tenant.plano,
      status: "PENDENTE",
      gateway: p.nome,
      externalId: checkout.externalId,
      checkoutUrl: checkout.checkoutUrl,
      valorMensal: valor,
      addons: tenant.addons,
      canceladaEm: null,
      inadimplenteDesde: null,
    },
  });

  logInfo("assinatura.checkout", { tenantId, valor, plano: tenant.plano });
  return checkout;
}

/** Cancelamento pedido pelo lojista. Acesso segue até o fim do período pago. */
export async function cancelarAssinatura(tenantId: string): Promise<void> {
  const sub = await assinaturaDoTenant(tenantId);
  if (!sub) throw new Error("Não há assinatura para cancelar.");

  if (sub.externalId && sub.gateway === "mercadopago") {
    await provider().cancelar(sub.externalId);
  }

  await basePrisma.subscription.update({
    where: { tenantId },
    data: { status: "CANCELADA", canceladaEm: new Date() },
  });

  // Não suspende agora: quem pagou o mês usa o mês. O job diário derruba o
  // acesso quando a data da próxima cobrança passar.
  logInfo("assinatura.cancelada", { tenantId });
}

// ── Aplicação de estado ─────────────────────────────────────

/**
 * Traduz o estado da assinatura em acesso ao app. É o ÚNICO lugar que mexe em
 * `Tenant.status` por causa de cobrança — espalhar essa decisão é como perder
 * o controle de quem está no ar.
 */
export async function aplicarStatus(
  tenantId: string,
  status: SubscriptionStatus,
  extra?: { proximaCobranca?: Date | null; ultimaCobranca?: Date | null },
): Promise<void> {
  const tenant = await basePrisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, nome: true, subdomain: true, status: true, trialEndsAt: true },
  });
  if (!tenant) return;

  const sub = await basePrisma.subscription.update({
    where: { tenantId },
    data: {
      status,
      ...(extra?.proximaCobranca !== undefined ? { proximaCobranca: extra.proximaCobranca } : {}),
      ...(extra?.ultimaCobranca !== undefined ? { ultimaCobranca: extra.ultimaCobranca } : {}),
      ...(status === "INADIMPLENTE" ? {} : { inadimplenteDesde: null }),
      ...(status === "ATIVA" ? { checkoutUrl: null } : {}),
    },
  });

  // INADIMPLENTE marca o início da tolerância uma vez só — reescrever a data a
  // cada retentativa do gateway daria carência infinita a quem não paga.
  if (status === "INADIMPLENTE" && !sub.inadimplenteDesde) {
    await basePrisma.subscription.update({
      where: { tenantId },
      data: { inadimplenteDesde: new Date() },
    });
  }

  const novoStatusTenant = statusDoTenant(status, {
    trialEndsAt: tenant.trialEndsAt,
    inadimplenteDesde: status === "INADIMPLENTE" ? (sub.inadimplenteDesde ?? new Date()) : null,
  });

  if (novoStatusTenant !== tenant.status) {
    await basePrisma.tenant.update({
      where: { id: tenantId },
      data: { status: novoStatusTenant },
    });
    logInfo("assinatura.status-tenant", {
      tenantId,
      de: tenant.status,
      para: novoStatusTenant,
      assinatura: status,
    });
  }

  await avisar(status, novoStatusTenant, tenantId, tenant);
}

/** Regra de acesso a partir do estado de cobrança. */
export function statusDoTenant(
  status: SubscriptionStatus,
  ctx: { trialEndsAt: Date | null; inadimplenteDesde: Date | null },
): Tenant["status"] {
  const agora = Date.now();

  switch (status) {
    case "ATIVA":
      return "ACTIVE";

    case "INADIMPLENTE": {
      const desde = ctx.inadimplenteDesde?.getTime() ?? agora;
      const limite = desde + TOLERANCIA_DIAS * 24 * 60 * 60 * 1000;
      return agora <= limite ? "ACTIVE" : "SUSPENDED";
    }

    case "PENDENTE": {
      // Ainda não pagou o primeiro mês: vale o teste, enquanto durar.
      const fim = ctx.trialEndsAt?.getTime();
      return fim && agora <= fim ? "TRIAL" : "SUSPENDED";
    }

    case "CANCELADA":
      return "SUSPENDED";
  }
}

async function avisar(
  status: SubscriptionStatus,
  statusTenant: Tenant["status"],
  tenantId: string,
  tenant: { nome: string; subdomain: string; status: Tenant["status"] },
): Promise<void> {
  if (statusTenant === tenant.status && status !== "ATIVA") return;

  const alvo = await destinatario(tenantId);
  if (!alvo) return;

  const url = urlPlano(tenant.subdomain);
  const sub = await assinaturaDoTenant(tenantId);

  const msg =
    status === "ATIVA"
      ? emailAssinaturaAtiva({
          para: alvo.email,
          loja: tenant.nome,
          plano: PLANOS[sub?.plano ?? "PRATA"].nome,
          url,
        })
      : status === "INADIMPLENTE"
        ? emailPagamentoFalhou({
            para: alvo.email,
            loja: tenant.nome,
            url,
            diasAteSuspender: TOLERANCIA_DIAS,
          })
        : statusTenant === "SUSPENDED"
          ? emailContaSuspensa({ para: alvo.email, loja: tenant.nome, url })
          : null;

  if (!msg) return;
  const envio = await enviarEmail(msg);
  if (!envio.ok) logErro("assinatura.email", envio.erro, { tenantId });
}

// ── Webhook / sincronização ─────────────────────────────────

/** Puxa o estado do gateway e aplica. Usado pelo webhook e pela tela de plano. */
export async function sincronizarAssinatura(tenantId: string): Promise<SubscriptionStatus | null> {
  const sub = await assinaturaDoTenant(tenantId);
  if (!sub?.externalId || sub.gateway !== "mercadopago") return sub?.status ?? null;

  const estado = await provider().consultar(sub.externalId);
  await aplicarStatus(tenantId, estado.status, { proximaCobranca: estado.proximaCobranca });
  return estado.status;
}

/** Encontra o tenant de um preapproval sem depender do corpo do webhook. */
export async function tenantPorExternalId(externalId: string): Promise<string | null> {
  const sub = await basePrisma.subscription.findFirst({
    where: { externalId },
    select: { tenantId: true },
  });
  return sub?.tenantId ?? null;
}

/**
 * Registra uma cobrança do ciclo. Idempotente pelo id do gateway: webhook
 * repetido (e o MP repete) não pode virar dois eventos nem dois e-mails.
 */
export async function registrarCobranca(cobranca: Cobranca): Promise<void> {
  const sub = await basePrisma.subscription.findFirst({
    where: { externalId: cobranca.externalIdAssinatura },
  });
  if (!sub) return;

  const idEvento = `${cobranca.externalIdAssinatura}:${cobranca.data?.toISOString() ?? ""}:${
    cobranca.aprovada ? "ok" : "falha"
  }`;

  const jaVisto = await basePrisma.subscriptionEvent.findUnique({
    where: { externalId: idEvento },
  });
  if (jaVisto) return;

  await basePrisma.subscriptionEvent.create({
    data: {
      subscriptionId: sub.id,
      tipo: cobranca.aprovada ? "cobranca.aprovada" : "cobranca.recusada",
      externalId: idEvento,
      valor: cobranca.valor ?? undefined,
      detalhe: cobranca.detalhe,
    },
  });

  await aplicarStatus(sub.tenantId, cobranca.aprovada ? "ATIVA" : "INADIMPLENTE", {
    ultimaCobranca: cobranca.aprovada ? (cobranca.data ?? new Date()) : undefined,
  });
}

/** Registra evento de assinatura (autorizada, pausada, cancelada). */
export async function registrarEventoAssinatura(input: {
  externalId: string;
  tipo: string;
  detalhe?: string;
}): Promise<void> {
  const sub = await basePrisma.subscription.findFirst({ where: { externalId: input.externalId } });
  if (!sub) return;
  await basePrisma.subscriptionEvent.create({
    data: { subscriptionId: sub.id, tipo: input.tipo, detalhe: input.detalhe },
  });
}

// ── Job diário ──────────────────────────────────────────────

export type ResumoJob = {
  avisosTrial: number;
  suspensos: number;
  sincronizados: number;
};

/**
 * Varre as contas e faz o que o tempo exige: avisa quem está no fim do teste,
 * suspende quem venceu, e reconsulta quem está pendente/inadimplente (webhook
 * perdido não pode significar cliente pagando sem acesso).
 */
export async function avaliarAssinaturas(): Promise<ResumoJob> {
  const resumo: ResumoJob = { avisosTrial: 0, suspensos: 0, sincronizados: 0 };
  const agora = new Date();

  // 1. Teste terminando ou terminado.
  const emTeste = await basePrisma.tenant.findMany({
    where: { status: "TRIAL" },
    select: { id: true, nome: true, subdomain: true, trialEndsAt: true, emailContato: true },
  });

  for (const t of emTeste) {
    if (!t.trialEndsAt) continue;
    const dias = Math.ceil((t.trialEndsAt.getTime() - agora.getTime()) / (24 * 60 * 60 * 1000));

    if (dias < 0) {
      await basePrisma.tenant.update({ where: { id: t.id }, data: { status: "SUSPENDED" } });
      resumo.suspensos++;
      const alvo = await destinatario(t.id);
      if (alvo) {
        const envio = await enviarEmail(
          emailContaSuspensa({ para: alvo.email, loja: t.nome, url: urlPlano(t.subdomain) }),
        );
        if (!envio.ok) logErro("assinatura.email-suspensao", envio.erro, { tenantId: t.id });
      }
      continue;
    }

    if (AVISO_TRIAL_DIAS.includes(dias)) {
      const alvo = await destinatario(t.id);
      if (alvo) {
        const envio = await enviarEmail(
          emailTrialAcabando({
            para: alvo.email,
            loja: t.nome,
            diasRestantes: dias,
            url: urlPlano(t.subdomain),
          }),
        );
        if (envio.ok) resumo.avisosTrial++;
        else logErro("assinatura.email-trial", envio.erro, { tenantId: t.id });
      }
    }
  }

  // 2. Assinaturas que dependem do gateway para saber onde estão.
  const pendentes = await basePrisma.subscription.findMany({
    where: { status: { in: ["PENDENTE", "INADIMPLENTE"] }, gateway: "mercadopago" },
    select: { tenantId: true },
  });

  for (const s of pendentes) {
    try {
      await sincronizarAssinatura(s.tenantId);
      resumo.sincronizados++;
    } catch (e) {
      logErro("assinatura.sincronizar", e, { tenantId: s.tenantId });
    }
  }

  // 3. Tolerância vencida vira suspensão de fato.
  const inadimplentes = await basePrisma.subscription.findMany({
    where: { status: "INADIMPLENTE", inadimplenteDesde: { not: null } },
    select: { tenantId: true, inadimplenteDesde: true },
  });

  for (const s of inadimplentes) {
    const limite = new Date(
      (s.inadimplenteDesde as Date).getTime() + TOLERANCIA_DIAS * 24 * 60 * 60 * 1000,
    );
    if (agora <= limite) continue;

    const t = await basePrisma.tenant.findUnique({
      where: { id: s.tenantId },
      select: { status: true, nome: true, subdomain: true },
    });
    if (!t || t.status === "SUSPENDED") continue;

    await basePrisma.tenant.update({ where: { id: s.tenantId }, data: { status: "SUSPENDED" } });
    resumo.suspensos++;

    const alvo = await destinatario(s.tenantId);
    if (alvo) {
      const envio = await enviarEmail(
        emailContaSuspensa({ para: alvo.email, loja: t.nome, url: urlPlano(t.subdomain) }),
      );
      if (!envio.ok) logErro("assinatura.email-suspensao", envio.erro, { tenantId: s.tenantId });
    }
  }

  // 4. Cancelada cujo período pago acabou.
  const canceladas = await basePrisma.subscription.findMany({
    where: { status: "CANCELADA" },
    select: { tenantId: true, proximaCobranca: true },
  });
  for (const s of canceladas) {
    if (s.proximaCobranca && s.proximaCobranca > agora) continue;
    const t = await basePrisma.tenant.findUnique({
      where: { id: s.tenantId },
      select: { status: true },
    });
    if (!t || t.status === "SUSPENDED" || t.status === "CANCELED") continue;
    await basePrisma.tenant.update({ where: { id: s.tenantId }, data: { status: "SUSPENDED" } });
    resumo.suspensos++;
  }

  logInfo("assinatura.job", { ...resumo });
  return resumo;
}

// ── Gate de acesso ──────────────────────────────────────────

export type EstadoAcesso = {
  /** Pode gravar (vender, movimentar estoque, cadastrar)? */
  podeEscrever: boolean;
  /** Faixa a mostrar no topo do app. `null` = nada a dizer. */
  aviso: { tom: "info" | "alerta" | "bloqueio"; texto: string } | null;
  diasTrial: number | null;
};

/**
 * Estado de cobrança para a interface e para o guard. Trabalha só com o que já
 * está no Tenant — nenhuma ida ao gateway no caminho da requisição.
 */
export function estadoAcesso(
  tenant: Pick<Tenant, "status" | "trialEndsAt" | "plano">,
): EstadoAcesso {
  const diasTrial =
    tenant.status === "TRIAL" && tenant.trialEndsAt
      ? Math.max(
          0,
          Math.ceil((tenant.trialEndsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
        )
      : null;

  if (tenant.status === "SUSPENDED" || tenant.status === "CANCELED") {
    return {
      podeEscrever: false,
      aviso: {
        tom: "bloqueio",
        texto:
          "Acesso suspenso por falta de pagamento. Você pode consultar seus dados, mas não registrar novas operações.",
      },
      diasTrial,
    };
  }

  if (diasTrial !== null && diasTrial <= 5) {
    return {
      podeEscrever: true,
      aviso: {
        tom: diasTrial <= 2 ? "alerta" : "info",
        texto:
          diasTrial === 0
            ? "Seu teste termina hoje. Ative a assinatura para continuar operando."
            : `Seu teste termina em ${diasTrial} ${diasTrial === 1 ? "dia" : "dias"}.`,
      },
      diasTrial,
    };
  }

  return { podeEscrever: true, aviso: null, diasTrial };
}

/** Barra a escrita quando a conta está suspensa. Usado no guard de action. */
export function assertPodeEscrever(tenant: Pick<Tenant, "status" | "trialEndsAt" | "plano">): void {
  if (!estadoAcesso(tenant).podeEscrever) throw new AssinaturaBloqueadaError();
}

export type { Plan };
