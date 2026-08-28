import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { basePrisma, comTenant, txComTenant } from "@/lib/prisma";
import { cifrar, decifrar } from "@/lib/crypto";
import { metaCloudProvider, dadosDoNumero } from "./meta-cloud";
import { simuladoProvider } from "./simulado";
import { WhatsAppProviderError, type WhatsAppProvider } from "./types";
import type { QuotationSendStatus, WhatsAppProviderKind } from "@/generated/prisma";

// ============================================================
// Canal WhatsApp (orquestração). Duas responsabilidades:
//   1. Entregar a configuração do tenant já decifrada e o provider montado.
//   2. Traduzir o status que a Meta devolve por webhook para a trilha de
//      envio (QuotationSend).
//
// O que NÃO mora aqui: a mensagem da cotação e a gravação da trilha — isso é
// das Compras, que sabem o que estão perguntando ao fornecedor. Este módulo
// não conhece cotação.
//
// `basePrisma` + `comTenant`/`txComTenant`, e não o client estendido: o webhook
// chega sem sessão e sem AsyncLocalStorage, então o tenant vem por parâmetro —
// e o `set_config('app.current_tenant')` precisa ir na MESMA transação, senão a
// RLS devolve zero linha na leitura e recusa a escrita.
// ============================================================

export { WhatsAppProviderError } from "./types";
export type { EnvioAceito, EnvioTemplate } from "./types";

export type ConfigWhatsApp = {
  tenantId: string;
  provider: WhatsAppProviderKind;
  ativo: boolean;
  phoneNumberId: string;
  wabaId: string | null;
  numeroExibicao: string | null;
  accessToken: string;
  appSecret: string | null;
  templateNome: string;
  templateIdioma: string;
};

function montar(cfg: ConfigWhatsApp): WhatsAppProvider {
  switch (cfg.provider) {
    case "META_CLOUD":
      return metaCloudProvider({
        phoneNumberId: cfg.phoneNumberId,
        accessToken: cfg.accessToken,
      });
    case "SIMULADO":
      return simuladoProvider();
  }
}

/** Configuração do tenant, com as credenciais já decifradas. */
export async function configDoTenant(tenantId: string): Promise<ConfigWhatsApp | null> {
  // `comTenant` e não `basePrisma` cru: a tabela tem RLS, e sem o
  // `set_config('app.current_tenant')` na MESMA conexão a leitura volta vazia
  // em silêncio e a escrita bate na policy.
  const c = await comTenant(
    tenantId,
    basePrisma.whatsAppConfig.findUnique({ where: { tenantId } }),
  );
  if (!c) return null;
  return {
    tenantId: c.tenantId,
    provider: c.provider,
    ativo: c.ativo,
    phoneNumberId: c.phoneNumberId,
    wabaId: c.wabaId,
    numeroExibicao: c.numeroExibicao,
    accessToken: decifrar(c.accessToken) ?? "",
    appSecret: decifrar(c.appSecret),
    templateNome: c.templateNome,
    templateIdioma: c.templateIdioma,
  };
}

/**
 * Config PRONTA PARA DISPARAR, ou null.
 *
 * Null significa "manda pela mão" — é o que a folha de envio pergunta. Quem
 * checa o add-on é quem chama (`temFeature("compras.whatsapp")`): este módulo
 * responde sobre a integração, não sobre o contrato comercial.
 */
export async function canalAtivo(tenantId: string): Promise<ConfigWhatsApp | null> {
  const cfg = await configDoTenant(tenantId);
  return cfg?.ativo && cfg.accessToken ? cfg : null;
}

export function providerDe(cfg: ConfigWhatsApp): WhatsAppProvider {
  return montar(cfg);
}

/** Testa credencial sem gravar — leitura pura, nunca devolve o token. */
export async function testarCredenciais(input: {
  provider: WhatsAppProviderKind;
  phoneNumberId: string;
  accessToken: string;
}): Promise<{ ok: boolean; numero: string | null; nome: string | null; mensagem?: string }> {
  if (input.provider === "SIMULADO") {
    return { ok: true, numero: null, nome: "Provedor simulado" };
  }
  try {
    const { numero, nome, status } = await dadosDoNumero({
      phoneNumberId: input.phoneNumberId,
      accessToken: input.accessToken,
    });
    // Token bom e número parado é o estado que mais engana: a leitura passa e
    // todo disparo volta como "não entregue". Reprovar aqui é o que manda o
    // operador registrar o número em vez de conferir telefone de fornecedor.
    if (status && status !== "CONNECTED") {
      return {
        ok: false,
        numero,
        nome,
        mensagem:
          `A credencial vale, mas o número está "${status}" na Meta — só quem está CONNECTED ` +
          "manda mensagem. Registre o número no painel da Meta (WhatsApp → API Setup → " +
          "Register) e teste de novo.",
      };
    }
    return { ok: true, numero, nome };
  } catch (e) {
    return {
      ok: false,
      numero: null,
      nome: null,
      mensagem: e instanceof Error ? e.message : "Não foi possível validar a credencial.",
    };
  }
}

/** Grava a configuração. Credenciais entram cifradas; vazio = manter a atual. */
export async function salvarConfig(input: {
  tenantId: string;
  provider: WhatsAppProviderKind;
  ativo: boolean;
  phoneNumberId: string;
  wabaId: string | null;
  numeroExibicao: string | null;
  /** Vazio mantém o token guardado — a tela nunca mostra o que já existe. */
  accessToken: string | null;
  appSecret: string | null;
  templateNome: string;
  templateIdioma: string;
}): Promise<void> {
  // Ler o que já existe e gravar precisam do MESMO contexto de tenant: com RLS
  // ligada, o `set_config` vale por transação. Daí a transação interativa.
  await txComTenant(input.tenantId, async (tx) => {
    const atual = await tx.whatsAppConfig.findUnique({
      where: { tenantId: input.tenantId },
      select: { accessToken: true, appSecret: true },
    });
    const accessToken = input.accessToken ? cifrar(input.accessToken) : atual?.accessToken;
    if (!accessToken) {
      throw new WhatsAppProviderError("Informe o token de acesso da Meta.", true);
    }
    const appSecret =
      input.appSecret === null ? (atual?.appSecret ?? null) : cifrar(input.appSecret);

    const dados = {
      provider: input.provider,
      ativo: input.ativo,
      phoneNumberId: input.phoneNumberId,
      wabaId: input.wabaId,
      numeroExibicao: input.numeroExibicao,
      accessToken,
      appSecret,
      templateNome: input.templateNome,
      templateIdioma: input.templateIdioma,
    };
    await tx.whatsAppConfig.upsert({
      where: { tenantId: input.tenantId },
      create: { tenantId: input.tenantId, ...dados },
      update: dados,
    });
  });
}

export async function desligarCanal(tenantId: string): Promise<void> {
  await comTenant(
    tenantId,
    basePrisma.whatsAppConfig.updateMany({ where: { tenantId }, data: { ativo: false } }),
  );
}

// ── Webhook ─────────────────────────────────────────────────

/**
 * Token de verificação do webhook, por tenant.
 *
 * A Meta pede um segredo qualquer no handshake e devolve ele em toda
 * configuração — e cada cliente configura o SEU app na Meta. Um token global
 * seria o mesmo segredo na mão de todos os tenants; um token guardado no banco
 * exigiria consultar por segredo (que está cifrado). Derivar do id do tenant
 * resolve os dois: é estável, é diferente para cada um e o servidor recalcula
 * na hora de conferir, sem guardar nada.
 */
export function tokenDeVerificacao(tenantId: string): string {
  const chave = process.env.AUTH_SECRET ?? "";
  return createHmac("sha256", chave).update(`whatsapp:${tenantId}`).digest("base64url").slice(0, 32);
}

/** Confere o token do handshake — comparação em tempo constante. */
export function verificacaoConfere(tenantId: string, recebido: string | null): boolean {
  if (!recebido) return false;
  const esperado = tokenDeVerificacao(tenantId);
  const a = Buffer.from(esperado);
  const b = Buffer.from(recebido);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Não existe busca por `phoneNumberId` solto: com RLS ligada, procurar sem
// saber o tenant devolveria zero linhas em silêncio. Quem diz de quem é o
// evento é o endereço do webhook (`/api/webhooks/whatsapp/[tenant]`), e o
// número que veio no corpo é conferido contra a configuração desse tenant.

/** Ordem dos estados: um "entregue" atrasado não pode apagar um "lida". */
const PESO: Record<QuotationSendStatus, number> = {
  ENVIADA: 0,
  ENTREGUE: 1,
  LIDA: 2,
  FALHOU: 3,
};

export function statusDaMeta(valor: string): QuotationSendStatus | null {
  switch (valor) {
    case "sent":
      return "ENVIADA";
    case "delivered":
      return "ENTREGUE";
    case "read":
      return "LIDA";
    case "failed":
      return "FALHOU";
    default:
      return null; // "deleted", "warning" e o que a Meta inventar depois
  }
}

/**
 * Anota na trilha o que a Meta contou sobre uma mensagem.
 *
 * Os avisos chegam fora de ordem e repetidos — a Meta garante "pelo menos uma
 * vez", não "na ordem". Por isso só avança: `entregue` que chega depois de
 * `lida` é ignorado, e o retrocesso não some com a informação melhor. `FALHOU`
 * é a exceção que sempre grava: é o único que muda o que o comprador precisa
 * fazer.
 */
export async function registrarStatus(input: {
  tenantId: string;
  externalId: string;
  status: QuotationSendStatus;
  erro?: string | null;
  em: Date;
}): Promise<void> {
  // Achar a linha e atualizar no MESMO contexto de tenant: `QuotationSend`
  // também tem RLS, e o webhook chega sem sessão nenhuma.
  await txComTenant(input.tenantId, async (tx) => {
    const linha = await tx.quotationSend.findFirst({
      where: { tenantId: input.tenantId, externalId: input.externalId },
      select: { id: true, status: true },
    });
    if (!linha) return; // mensagem que não saiu daqui — nada a fazer

    const atual = linha.status ? PESO[linha.status] : -1;
    const novo = PESO[input.status];
    if (input.status !== "FALHOU" && novo <= atual) return;

    await tx.quotationSend.update({
      where: { id: linha.id },
      data: {
        status: input.status,
        statusEm: input.em,
        ...(input.status === "FALHOU"
          ? { sucesso: false, erro: input.erro ?? "A Meta não conseguiu entregar a mensagem." }
          : {}),
      },
    });
  });
}
