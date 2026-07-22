import "server-only";
import { basePrisma } from "@/lib/prisma";
import { fiscalSimuladoProvider } from "./simulado";
import type { FiscalProvider } from "./types";
import type {
  FiscalAmbiente,
  FiscalModelo,
  FiscalProviderKind,
  RegimeTributario,
} from "@/generated/prisma";

// ============================================================
// Serviço fiscal (orquestração). Segue lib/vendas.ts e lib/pagamentos:
// basePrisma com tenantId explícito + set_config por transação (RLS).
//
// A emissão em si é ASSÍNCRONA (Fase 4): quem vende só enfileira um
// FiscalDocument PENDENTE e segue a vida. O worker transmite e atualiza. Nada
// no caminho crítico da venda pode depender da SEFAZ estar de pé.
// ============================================================

export type { FiscalProvider } from "./types";
export * from "./types";

/** Estados a partir dos quais ainda dá para chegar em AUTORIZADO. */
export const STATUS_EM_ANDAMENTO = ["PENDENTE", "PROCESSANDO", "CONTINGENCIA"] as const;

export const CRT_POR_REGIME: Record<RegimeTributario, 1 | 2 | 3> = {
  SIMPLES_NACIONAL: 1,
  SIMPLES_EXCESSO: 2,
  REGIME_NORMAL: 3,
};

/**
 * Simples Nacional preenche CSOSN e deixa CST vazio; Regime Normal faz o
 * contrário. Derivar do CRT evita pedir os dois ao operador — e evita a nota
 * rejeitada por mandar os dois juntos.
 */
export function usaCsosn(regime: RegimeTributario): boolean {
  return regime !== "REGIME_NORMAL";
}

function buildProvider(cfg: {
  provider: FiscalProviderKind;
  apiToken: string | null;
  ambiente: FiscalAmbiente;
}): FiscalProvider {
  switch (cfg.provider) {
    case "SIMULADO":
      return fiscalSimuladoProvider();
    // Adapters reais entram aqui (Fase 6). Até lá, falhar alto é melhor que
    // aceitar a configuração e só quebrar na hora de emitir.
    case "NUVEM_FISCAL":
    case "PLUGNOTAS":
    case "FOCUS":
    case "TECNOSPEED":
      throw new Error(
        `Provedor fiscal ${cfg.provider} ainda não implementado. Use SIMULADO em desenvolvimento.`,
      );
  }
}

export type ConfigFiscal = {
  provider: FiscalProviderKind;
  ambiente: FiscalAmbiente;
  ativo: boolean;
  apiToken: string | null;
  emissaoAutomaticaNfce: boolean;
  prazoCancelamentoMin: number;
};

/** Config do tenant, ou null quando o módulo fiscal nunca foi configurado. */
export async function carregarConfigFiscal(tenantId: string): Promise<ConfigFiscal | null> {
  const rows = await basePrisma.$transaction([
    basePrisma.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`,
    basePrisma.fiscalConfig.findFirst({
      where: { tenantId },
      select: {
        provider: true,
        ambiente: true,
        ativo: true,
        apiToken: true,
        emissaoAutomaticaNfce: true,
        prazoCancelamentoMin: true,
      },
    }),
  ]);
  return rows[1];
}

/**
 * Instancia o provedor do tenant.
 * `exigirAtivo: false` é para a própria tela de configuração — enviar o
 * certificado é justamente o que acontece ANTES de ligar o módulo.
 */
export async function providerDoTenant(
  tenantId: string,
  opts: { exigirAtivo?: boolean } = {},
): Promise<FiscalProvider> {
  const { exigirAtivo = true } = opts;
  const cfg = await carregarConfigFiscal(tenantId);
  if (!cfg) throw new Error("Módulo fiscal não está configurado nesta empresa.");
  if (exigirAtivo && !cfg.ativo) {
    throw new Error("Emissão desligada. Ative o módulo fiscal em Configurações → Fiscal.");
  }
  return buildProvider(cfg);
}

/**
 * Próximo número da série, atômico (função SQL fiscal_proximo_numero).
 * NUNCA calcule com max(numero)+1: duas vendas simultâneas pegam o mesmo
 * número e a segunda nota volta rejeitada por duplicidade.
 */
export async function proximoNumero(input: {
  tenantId: string;
  siteId: string;
  modelo: FiscalModelo;
  serie: number;
}): Promise<number> {
  const { tenantId, siteId, modelo, serie } = input;
  const rows = await basePrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`;
    return tx.$queryRaw<{ numero: number }[]>`
      SELECT fiscal_proximo_numero(${tenantId}, ${siteId}, ${modelo}::"FiscalModelo", ${serie}) AS numero
    `;
  });
  return rows[0].numero;
}

/**
 * Hook fiscal pós-pagamento, chamado por lib/vendas ao finalizar a venda.
 *
 * Contrato: NUNCA lança e NUNCA espera a SEFAZ. Aqui só se ENFILEIRA — grava
 * o FiscalDocument PENDENTE e devolve o caixa ao operador. A transmissão vem
 * depois (polling do PDV + job da fila). Venda paga não pode ficar refém de
 * rede: o dinheiro já entrou.
 */
export async function emitirHookFiscal(
  tenantId: string,
  saleId: string,
  userId?: string | null,
): Promise<void> {
  try {
    const tenant = await basePrisma.tenant.findUnique({
      where: { id: tenantId },
      select: { moduloFiscal: true },
    });
    if (!tenant?.moduloFiscal) return; // sem módulo fiscal, nada a fazer

    const cfg = await carregarConfigFiscal(tenantId);
    if (!cfg?.ativo || !cfg.emissaoAutomaticaNfce) return;

    const { enfileirarNfceDaVenda } = await import("./emissao");
    const r = await enfileirarNfceDaVenda(tenantId, saleId, userId);
    if (!r.ok && process.env.NODE_ENV === "development") {
      console.warn(`[fiscal] venda ${saleId} não gerou NFC-e: ${r.motivo}`);
    }
  } catch (e) {
    // Falha aqui não desfaz a venda — ela já está paga e com estoque baixado.
    // O documento fica de fora da fila e o operador vê a venda sem nota.
    console.error(`[fiscal] falha ao enfileirar NFC-e da venda ${saleId}:`, e);
  }
}
