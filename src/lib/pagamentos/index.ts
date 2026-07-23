import "server-only";
import { basePrisma, comTenant } from "@/lib/prisma";
import { onlyDigits } from "@/lib/normalize";
import { finalizarVenda, cancelarVenda } from "@/lib/vendas";
import { mercadoPagoProvider } from "./mercadopago";
import { stoneProvider } from "./stone";
import { pagseguroProvider } from "./pagseguro";
import { simuladoProvider } from "./simulado";
import type {
  DetalheCartao,
  PagamentoProvider,
  StatusCobranca,
  TerminalInfo,
} from "./types";
import type { PaymentAmbiente, PaymentProviderKind, PaymentStatus } from "@/generated/prisma";

// ============================================================
// Payment Service (orquestração). Segue o padrão de lib/vendas.ts:
// basePrisma com tenantId explícito + set_config por transação (RLS).
// Máquina de estados do Payment:
//   PENDENTE → CONFIRMADO            (PIX pago)
//   PENDENTE → EXPIRADO/CANCELADO    (PIX não pago)
//   PROCESSANDO → CONFIRMADO         (cartão aprovado no terminal)
//   PROCESSANDO → RECUSADO/CANCELADO (cartão recusado/cancelado)
// A venda SÓ finaliza (baixa de estoque + fiscal) após CONFIRMADO.
// ============================================================

export type { StatusCobranca, TerminalInfo } from "./types";

const num = (v: unknown): number => (v == null ? 0 : Number(v));

function buildProvider(cfg: {
  provider: PaymentProviderKind;
  accessToken: string;
  partnerRef: string | null;
  ambiente?: PaymentAmbiente;
}): PagamentoProvider {
  switch (cfg.provider) {
    case "MERCADO_PAGO":
      return mercadoPagoProvider(cfg.accessToken);
    case "STONE":
      return stoneProvider(cfg.accessToken, cfg.partnerRef);
    case "PAGSEGURO":
      return pagseguroProvider(cfg.accessToken, cfg.ambiente);
    case "SIMULADO":
      return simuladoProvider();
  }
}

/** Testa um token sem salvar — leitura pura no PSP, nunca volta a credencial. */
export async function testarCredenciaisProvedor(input: {
  provider: Exclude<PaymentProviderKind, "SIMULADO">;
  accessToken: string;
  partnerRef?: string | null;
  ambiente?: PaymentAmbiente;
}): Promise<{ ok: boolean; suportado: boolean; mensagem?: string }> {
  const provider = buildProvider({
    provider: input.provider,
    accessToken: input.accessToken,
    partnerRef: input.partnerRef ?? null,
    ambiente: input.ambiente,
  });
  if (!provider.validarCredenciais) return { ok: false, suportado: false };
  try {
    await provider.validarCredenciais();
    return { ok: true, suportado: true };
  } catch (e) {
    return {
      ok: false,
      suportado: true,
      mensagem: e instanceof Error ? e.message : "Não foi possível validar as credenciais.",
    };
  }
}

/** Config sem credenciais — segura para mandar à UI. */
export type ConfigPagamentoPublica = {
  provider: PaymentProviderKind;
  ativo: boolean;
  pixAutomatico: boolean;
  cartaoIntegrado: boolean;
  temWebhookSecret: boolean;
  /** Stone Connect: código do Programa de Parcerias (não é credencial secreta). */
  partnerRef: string | null;
  /** PagBank: produção x sandbox — só relevante para PAGSEGURO. */
  ambiente: PaymentAmbiente;
};

export async function getConfigPagamento(
  tenantId: string
): Promise<ConfigPagamentoPublica | null> {
  const cfg = await comTenant(tenantId, basePrisma.paymentProviderConfig.findFirst({
    where: { tenantId },
  }));
  if (!cfg) return null;
  return {
    provider: cfg.provider,
    ativo: cfg.ativo,
    pixAutomatico: cfg.pixAutomatico,
    cartaoIntegrado: cfg.cartaoIntegrado,
    temWebhookSecret: !!cfg.webhookSecret,
    partnerRef: cfg.partnerRef,
    ambiente: cfg.ambiente,
  };
}

async function getProviderCtx(tenantId: string) {
  const cfg = await comTenant(tenantId, basePrisma.paymentProviderConfig.findFirst({
    where: { tenantId, ativo: true },
  }));
  if (!cfg) return null;
  return { cfg, provider: buildProvider(cfg) };
}

/** O que o PDV precisa saber ao montar a tela (por site). */
export type IntegracaoPdv = {
  pixAutomatico: boolean;
  cartaoIntegrado: boolean;
  terminais: { id: string; nome: string }[];
};

export async function integracaoPdv(
  tenantId: string,
  siteId: string
): Promise<IntegracaoPdv> {
  const ctx = await getProviderCtx(tenantId);
  if (!ctx) return { pixAutomatico: false, cartaoIntegrado: false, terminais: [] };
  // além do toggle, o provedor precisa suportar (Stone exige partnerRef)
  const cartaoHabilitado = ctx.cfg.cartaoIntegrado && ctx.provider.suportaCartaoIntegrado;
  const terminais = cartaoHabilitado
    ? await comTenant(tenantId, basePrisma.paymentTerminal.findMany({
        where: { tenantId, siteId, ativo: true, provider: ctx.cfg.provider },
        select: { id: true, nome: true },
        orderBy: { nome: "asc" },
      }))
    : [];
  return {
    pixAutomatico: ctx.cfg.pixAutomatico,
    cartaoIntegrado: cartaoHabilitado && terminais.length > 0,
    terminais,
  };
}

// ── PIX dinâmico ────────────────────────────────────────────
// A venda (ABERTA) e o Payment PENDENTE já existem; aqui criamos a
// cobrança no PSP e gravamos QR + copia-e-cola no Payment.
export async function criarCobrancaPixVenda(
  tenantId: string,
  saleId: string
): Promise<{
  paymentId: string;
  copiaECola: string;
  qrCodeBase64: string | null;
  expiraEm: string | null;
} | null> {
  const ctx = await getProviderCtx(tenantId);
  if (!ctx || !ctx.cfg.pixAutomatico) return null;

  const payment = await comTenant(tenantId, basePrisma.payment.findFirst({
    where: { saleId, tenantId, metodo: "PIX", status: "PENDENTE" },
    select: {
      id: true,
      valor: true,
      sale: { select: { customer: { select: { cpf: true } } } },
    },
  }));
  if (!payment) throw new Error("Pagamento PIX pendente não encontrado na venda.");

  const tenant = await basePrisma.tenant.findUnique({
    where: { id: tenantId },
    select: { emailContato: true, nome: true, cnpj: true },
  });

  // PagBank exige customer.tax_id. PDV é anônimo na maioria das vendas —
  // usa o CPF do cliente vinculado (fidelização) quando existir, senão cai
  // pro CNPJ da própria empresa (não é o pagador de verdade, mas satisfaz
  // a API sem exigir cadastro de documento no fechamento do caixa).
  const payerDocument =
    onlyDigits(payment.sale.customer?.cpf ?? "") || onlyDigits(tenant?.cnpj ?? "") || undefined;

  const cobranca = await ctx.provider.criarCobrancaPix({
    valor: num(payment.valor),
    descricao: `Venda ${saleId.slice(-4).toUpperCase()} — ${tenant?.nome ?? "PDV"}`,
    // Só rótulo informativo no PSP — nunca usado de volta pra lookup (o
    // webhook resolve pelo externalId do PSP). PagBank limita a 64 chars,
    // então não concatena tenantId/saleId — o payment.id já é único.
    referencia: payment.id,
    idempotencyKey: payment.id,
    payerEmail: tenant?.emailContato ?? "cliente@nohub.market",
    payerDocument,
  });

  await basePrisma.$transaction([
    basePrisma.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`,
    basePrisma.payment.update({
      where: { id: payment.id },
      data: {
        gateway: ctx.cfg.provider,
        externalId: cobranca.externalId,
        pixCopiaECola: cobranca.copiaECola,
        pixQrCode: cobranca.qrCodeBase64,
        expiraEm: cobranca.expiraEm,
      },
    }),
  ]);

  return {
    paymentId: payment.id,
    copiaECola: cobranca.copiaECola,
    qrCodeBase64: cobranca.qrCodeBase64,
    expiraEm: cobranca.expiraEm?.toISOString() ?? null,
  };
}

// ── Cartão integrado (terminal) ─────────────────────────────
// Envia o valor à maquininha; o Payment vai a PROCESSANDO até o
// adquirente responder.
export async function criarIntencaoCartaoVenda(
  tenantId: string,
  saleId: string,
  input: { terminalId: string; tipo: "CREDITO" | "DEBITO"; parcelas?: number }
): Promise<{ paymentId: string } | null> {
  const ctx = await getProviderCtx(tenantId);
  if (!ctx || !ctx.cfg.cartaoIntegrado) return null;
  if (!ctx.provider.criarIntencaoCartao) return null;

  const metodo = input.tipo === "CREDITO" ? "CARTAO_CREDITO" : "CARTAO_DEBITO";
  const [payment, terminal] = await Promise.all([
    comTenant(
      tenantId,
      basePrisma.payment.findFirst({
        where: { saleId, tenantId, metodo, status: "PENDENTE" },
        select: { id: true, valor: true },
      }),
    ),
    comTenant(
      tenantId,
      basePrisma.paymentTerminal.findFirst({
        where: { id: input.terminalId, tenantId, ativo: true },
        select: { id: true, externalId: true },
      }),
    ),
  ]);
  if (!payment) throw new Error("Pagamento de cartão pendente não encontrado na venda.");
  if (!terminal) throw new Error("Maquininha não encontrada — vincule um terminal em Configurações.");

  const enviar = () =>
    ctx.provider.criarIntencaoCartao!({
      deviceId: terminal.externalId,
      valor: num(payment.valor),
      tipo: input.tipo,
      parcelas: input.parcelas,
      // Só rótulo informativo no PSP — nunca usado de volta pra lookup (o
      // webhook resolve pelo externalId do PSP). PagBank limita a 64 chars,
      // então não concatena tenantId/saleId — o payment.id já é único.
      referencia: payment.id,
    });

  // A Point precisa estar em operating_mode "PDV" para receber intenções. Se
  // alguém tirou a maquininha desse modo (mexeu no menu, reiniciou), a primeira
  // intenção falha e ficava assim até re-cadastrar. Re-prepara e tenta de novo,
  // uma vez — transparente para o operador.
  let intencao;
  try {
    intencao = await enviar();
  } catch (e) {
    if (!ctx.provider.prepararTerminal) throw e;
    try {
      await ctx.provider.prepararTerminal(terminal.externalId);
    } catch {
      throw e; // re-preparo falhou — devolve o erro original, mais informativo
    }
    intencao = await enviar();
  }

  await basePrisma.$transaction([
    basePrisma.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`,
    basePrisma.payment.update({
      where: { id: payment.id },
      data: {
        status: "PROCESSANDO",
        gateway: ctx.cfg.provider,
        externalId: intencao.externalId,
        terminalId: terminal.id,
      },
    }),
  ]);

  return { paymentId: payment.id };
}

// ── Sincronização (polling do PDV + webhook) — idempotente ──
export type ResultadoSync = {
  status: PaymentStatus;
  /** Pagamento confirmado mas a finalização falhou (ex.: saldo insuficiente). */
  erroFinalizacao?: string;
};

export async function sincronizarPagamentoIntegrado(
  tenantId: string,
  paymentId: string,
  createdBy?: string
): Promise<ResultadoSync> {
  const payment = await comTenant(tenantId, basePrisma.payment.findFirst({
    where: { id: paymentId, tenantId },
    select: {
      id: true,
      saleId: true,
      metodo: true,
      status: true,
      gateway: true,
      externalId: true,
      expiraEm: true,
      sale: { select: { status: true } },
    },
  }));
  if (!payment) throw new Error("Pagamento não encontrado.");

  // estados finais: nada a consultar
  if (payment.status === "CONFIRMADO") {
    if (payment.sale.status === "ABERTA") {
      return finalizarSeCoberta(tenantId, payment.saleId, createdBy);
    }
    return { status: "CONFIRMADO" };
  }
  if (payment.status !== "PENDENTE" && payment.status !== "PROCESSANDO") {
    return { status: payment.status };
  }
  if (!payment.gateway || !payment.externalId) return { status: payment.status };

  const ctx = await getProviderCtx(tenantId);
  if (!ctx) return { status: payment.status };

  const ehPix = payment.metodo === "PIX";
  let remoto: StatusCobranca;
  let detalhe: DetalheCartao | null = null;
  if (ehPix) {
    remoto = await ctx.provider.consultarCobranca(payment.externalId);
  } else if (ctx.provider.consultarIntencao) {
    const r = await ctx.provider.consultarIntencao(payment.externalId);
    remoto = r.status;
    detalhe = r.detalhe ?? null;
  } else {
    remoto = "PROCESSANDO";
  }

  // PIX vencido no relógio local e ainda pendente no PSP → expira
  if (
    ehPix &&
    remoto === "PENDENTE" &&
    payment.expiraEm &&
    payment.expiraEm.getTime() < Date.now()
  ) {
    remoto = "EXPIRADO";
  }

  if (remoto === "PENDENTE" || remoto === "PROCESSANDO") {
    if (remoto !== payment.status) {
      await atualizarStatus(tenantId, payment.id, remoto);
    }
    return { status: remoto };
  }

  // Grava o detalhe do adquirente JUNTO com o status: a NFC-e é enfileirada
  // logo abaixo, dentro de finalizarVenda, e lê o Payment do banco. Gravar
  // depois seria emitir a nota sem bandeira nem autorização.
  await atualizarStatus(tenantId, payment.id, remoto, detalhe);
  if (remoto === "CONFIRMADO") {
    return finalizarSeCoberta(tenantId, payment.saleId, createdBy);
  }
  return { status: remoto };
}

async function atualizarStatus(
  tenantId: string,
  paymentId: string,
  status: PaymentStatus,
  detalhe?: DetalheCartao | null
) {
  await basePrisma.$transaction([
    basePrisma.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`,
    basePrisma.payment.update({
      where: { id: paymentId },
      data: {
        status,
        ...(detalhe
          ? {
              bandeira: detalhe.bandeira,
              parcelas: detalhe.parcelas,
              nsu: detalhe.nsu,
              autorizacao: detalhe.autorizacao,
              adquirenteCnpj: detalhe.adquirenteCnpj,
              pspPaymentId: detalhe.pspPaymentId,
            }
          : {}),
      },
    }),
  ]);
}

/** Finaliza a venda (baixa + fiscal) se os pagamentos confirmados cobrem o total. */
async function finalizarSeCoberta(
  tenantId: string,
  saleId: string,
  createdBy?: string
): Promise<ResultadoSync> {
  const sale = await comTenant(tenantId, basePrisma.sale.findFirst({
    where: { id: saleId, tenantId },
    select: { status: true },
  }));
  if (!sale || sale.status !== "ABERTA") return { status: "CONFIRMADO" };
  try {
    await finalizarVenda(tenantId, saleId, createdBy);
    return { status: "CONFIRMADO" };
  } catch (e) {
    // pagamento já entrou — a venda fica ABERTA para o operador resolver
    return {
      status: "CONFIRMADO",
      erroFinalizacao: e instanceof Error ? e.message : "Erro ao finalizar a venda.",
    };
  }
}

// ── Cancelamento antes da confirmação ───────────────────────
export async function cancelarPagamentoIntegrado(
  tenantId: string,
  paymentId: string,
  opts?: { cancelarVendaTambem?: boolean; createdBy?: string }
): Promise<void> {
  const payment = await comTenant(tenantId, basePrisma.payment.findFirst({
    where: { id: paymentId, tenantId },
    select: {
      id: true,
      saleId: true,
      metodo: true,
      status: true,
      externalId: true,
      terminal: { select: { externalId: true } },
    },
  }));
  if (!payment) throw new Error("Pagamento não encontrado.");
  if (payment.status === "CONFIRMADO") {
    throw new Error("Pagamento já confirmado — use o estorno da venda.");
  }

  const ctx = await getProviderCtx(tenantId);
  if (ctx && payment.externalId) {
    try {
      if (payment.metodo === "PIX") {
        await ctx.provider.cancelarCobranca(payment.externalId);
      } else if (payment.terminal && ctx.provider.cancelarIntencao) {
        await ctx.provider.cancelarIntencao(payment.terminal.externalId, payment.externalId);
      }
    } catch {
      // cancelamento no PSP é best-effort; o estado local manda
    }
  }

  await atualizarStatus(tenantId, payment.id, "CANCELADO");
  if (opts?.cancelarVendaTambem) {
    await cancelarVenda(tenantId, payment.saleId, opts.createdBy);
  }
}

// ── Estorno depois de confirmado ────────────────────────────
// Cancelar uma venda PAGA sem devolver o dinheiro no PSP deixa o cliente
// cobrado com a venda cancelada no sistema. Esta função devolve de verdade e
// reporta o que NÃO deu — quem cancela precisa saber para resolver no painel.

export type ResultadoEstorno = {
  /** Pagamentos devolvidos no PSP (ou que não precisavam: dinheiro, manual). */
  estornados: number;
  /**
   * Falhas por pagamento — o cancelamento segue mesmo assim (o estoque já
   * voltou), mas o operador precisa ver isso na tela, não no log.
   */
  pendencias: string[];
};

export async function estornarPagamentosDaVenda(
  tenantId: string,
  saleId: string
): Promise<ResultadoEstorno> {
  const payments = await comTenant(tenantId, basePrisma.payment.findMany({
    where: { saleId, tenantId, status: "CONFIRMADO" },
    select: {
      id: true,
      metodo: true,
      valor: true,
      gateway: true,
      externalId: true,
      pspPaymentId: true,
    },
  }));
  if (payments.length === 0) return { estornados: 0, pendencias: [] };

  // Sem gateway = recebimento manual (dinheiro, maquininha solta): não há o
  // que estornar por API — o operador devolve no caixa ou na própria máquina.
  const integrados = payments.filter((p) => p.gateway && p.externalId);
  const manuais = payments.length - integrados.length;
  if (integrados.length === 0) return { estornados: manuais, pendencias: [] };

  const ctx = await getProviderCtx(tenantId);
  const pendencias: string[] = [];
  let estornados = manuais;

  for (const p of integrados) {
    const rotulo = `${p.metodo} de ${num(p.valor).toFixed(2)}`;
    if (!ctx?.provider.estornarCobranca) {
      pendencias.push(`${rotulo}: provedor sem estorno por API — devolva pelo painel.`);
      continue;
    }
    // Provedor trocado depois da venda: o token atual não fala com a cobrança antiga.
    if (p.gateway !== ctx.cfg.provider) {
      pendencias.push(`${rotulo}: cobrado no ${p.gateway}, hoje ativo o ${ctx.cfg.provider} — devolva pelo painel.`);
      continue;
    }
    try {
      await ctx.provider.estornarCobranca({
        externalId: p.externalId as string,
        pspPaymentId: p.pspPaymentId,
        cartao: p.metodo !== "PIX",
        valor: num(p.valor),
      });
      estornados++;
    } catch (e) {
      pendencias.push(`${rotulo}: ${e instanceof Error ? e.message : "falha ao estornar"}`);
    }
  }

  return { estornados, pendencias };
}

// ── Webhook: acha o pagamento pelo id do PSP e sincroniza ───
export async function processarWebhookPagamento(input: {
  externalId: string;
  /** Valida a assinatura com o secret do tenant (chamado só se houver secret). */
  verificarAssinatura?: (secret: string) => boolean;
}): Promise<{ found: boolean; unauthorized?: boolean; status?: PaymentStatus }> {
  // ÚNICA leitura cross-tenant proposital do sistema: o webhook do PSP chega
  // sem subdomínio, então o tenant só pode sair do próprio Payment. Por isso
  // NÃO leva set_config — e por isso é a única query que vai precisar de um
  // caminho privilegiado (SECURITY DEFINER) quando o RLS passar a valer.
  // Daqui para baixo, tudo usa payment.tenantId.
  const payment = await basePrisma.payment.findFirst({
    where: { externalId: input.externalId },
    select: { id: true, tenantId: true },
  });
  if (!payment) return { found: false };

  const cfg = await comTenant(
    payment.tenantId,
    basePrisma.paymentProviderConfig.findFirst({
      where: { tenantId: payment.tenantId },
      select: { webhookSecret: true },
    }),
  );
  if (cfg?.webhookSecret && input.verificarAssinatura) {
    if (!input.verificarAssinatura(cfg.webhookSecret)) {
      return { found: true, unauthorized: true };
    }
  }

  const r = await sincronizarPagamentoIntegrado(payment.tenantId, payment.id);
  return { found: true, status: r.status };
}

// ── Terminais (Configurações) ───────────────────────────────
export async function listarTerminaisDoProvedor(
  tenantId: string
): Promise<TerminalInfo[]> {
  const ctx = await getProviderCtx(tenantId);
  if (!ctx?.provider.listarTerminais) return [];
  return ctx.provider.listarTerminais();
}

export async function prepararTerminalNoProvedor(
  tenantId: string,
  deviceId: string
): Promise<void> {
  const ctx = await getProviderCtx(tenantId);
  await ctx?.provider.prepararTerminal?.(deviceId);
}
