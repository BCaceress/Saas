import "server-only";
import { basePrisma, db } from "@/lib/prisma";
import { requireTenantId, runWithTenant } from "@/lib/tenant-context";
import { cifrar, decifrar } from "@/lib/crypto";
import { logErro } from "@/lib/log";
import { whereFeature } from "@/lib/planos";
import type { FiscalEmailAuth } from "@/generated/prisma";
import { importarNotasXml } from "./entrada";
import { buscarMensagens, testarConexaoImap, type ImapCredenciais } from "./imap";
import { accessTokenParaImap, ehOauth } from "./email-oauth";
import { registrarFalhaCanal, registrarIgnorado, registrarImportacoes } from "./import-log";

// ============================================================
// EmailImportService — o XML que chega por e-mail.
//
// O fornecedor manda a nota para uma caixa de compras e ninguém abre o anexo:
// esta é a porta que fecha a lacuna entre "faturou" e "chegou no sistema".
//
// Idempotência em três camadas, de fora para dentro:
//   1. `FiscalEmailMessage` — Message-ID já processado não é reaberto;
//   2. `FiscalInbound.chave` única — a mesma nota em dois e-mails entra uma vez;
//   3. o log registra a duplicata, para o operador não achar que sumiu.
//
// A varredura NUNCA marca e-mail como lido nem apaga nada: a caixa é do
// lojista, e um ERP que mexe na caixa de entrada dele perde a confiança na
// primeira vez que alguém não acha uma mensagem.
// ============================================================

/** Primeira varredura: quanto do passado olhar. Depois disso, incremental. */
const JANELA_INICIAL_DIAS = 15;
/** Folga na janela incremental — servidor com relógio adiantado, e-mail atrasado. */
const FOLGA_DIAS = 2;
/** Uma varredura travada há mais que isso morreu com o processo — destrava. */
const LOCK_MINUTOS = 15;
/** Espera após falhas seguidas: 20 min, 1 h, 4 h, 12 h, 24 h (teto). */
const BACKOFF_MINUTOS = [20, 60, 240, 720, 1440];

export type ResultadoSincronizacaoEmail = {
  mensagens: number;
  anexos: number;
  importadas: number;
  duplicadas: number;
  erros: number;
};

const ZERO: ResultadoSincronizacaoEmail = {
  mensagens: 0,
  anexos: 0,
  importadas: 0,
  duplicadas: 0,
  erros: 0,
};

export type CaixaView = {
  id: string;
  nome: string;
  email: string;
  host: string;
  porta: number;
  ssl: boolean;
  usuario: string;
  pasta: string;
  ativo: boolean;
  siteId: string;
  ultimaSincronizacao: string | null;
  ultimoErro: string | null;
  mensagensLidas: number;
  autenticacao: FiscalEmailAuth;
  /** Só se existe — o token nunca volta para a tela. */
  conectada: boolean;
  oauthClientId: string | null;
  oauthTenantId: string | null;
  falhasSeguidas: number;
  proximaTentativa: string | null;
};

/** Contas configuradas. A senha nunca sai daqui — nem cifrada. */
export async function listarCaixas(): Promise<CaixaView[]> {
  const caixas = await db.fiscalEmailInbox.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      nome: true,
      email: true,
      host: true,
      porta: true,
      ssl: true,
      usuario: true,
      pasta: true,
      ativo: true,
      siteId: true,
      ultimaSincronizacao: true,
      ultimoErro: true,
      mensagensLidas: true,
      autenticacao: true,
      oauthClientId: true,
      oauthTenantId: true,
      oauthRefreshToken: true,
      falhasSeguidas: true,
      proximaTentativa: true,
    },
  });

  return caixas.map(({ oauthRefreshToken, ...c }) => ({
    ...c,
    conectada: Boolean(oauthRefreshToken),
    ultimaSincronizacao: c.ultimaSincronizacao?.toISOString() ?? null,
    proximaTentativa: c.proximaTentativa?.toISOString() ?? null,
  }));
}

export type DadosCaixa = {
  nome: string;
  email: string;
  host: string;
  porta: number;
  ssl: boolean;
  usuario: string;
  /** Vazio no update = mantém a senha já salva (ela nunca volta para a tela). */
  senha: string;
  pasta: string;
  ativo: boolean;
  siteId: string;
  autenticacao: FiscalEmailAuth;
  oauthClientId?: string | null;
  /** Vazio no update = mantém o secret já salvo. */
  oauthClientSecret?: string;
  oauthTenantId?: string | null;
};

export async function salvarCaixa(id: string | null, dados: DadosCaixa): Promise<string> {
  const senhaCifrada = cifrar(dados.senha) ?? "";

  if (id) {
    const atual = await db.fiscalEmailInbox.findFirst({ where: { id }, select: { id: true } });
    if (!atual) throw new Error("Conta de e-mail não encontrada.");

    await db.fiscalEmailInbox.updateMany({
      where: { id },
      data: {
        nome: dados.nome,
        email: dados.email,
        host: dados.host,
        porta: dados.porta,
        ssl: dados.ssl,
        usuario: dados.usuario,
        pasta: dados.pasta,
        ativo: dados.ativo,
        siteId: dados.siteId,
        autenticacao: dados.autenticacao,
        oauthClientId: dados.oauthClientId ?? null,
        oauthTenantId: dados.oauthTenantId ?? null,
        // Senha e secret em branco = "não mexi nesse campo".
        ...(dados.senha ? { senha: senhaCifrada } : {}),
        ...(dados.oauthClientSecret
          ? { oauthClientSecret: cifrar(dados.oauthClientSecret) }
          : {}),
        // Conta reconfigurada volta para a fila na hora: o operador acabou de
        // corrigir justamente o que estava quebrado.
        ultimoErro: null,
        falhasSeguidas: 0,
        proximaTentativa: null,
      },
    });
    return id;
  }

  if (!dados.senha && !ehOauth(dados.autenticacao)) {
    throw new Error("Informe a senha de aplicativo da conta.");
  }
  if (ehOauth(dados.autenticacao) && !dados.oauthClientId) {
    throw new Error("Informe o ID do cliente OAuth criado no painel do provedor.");
  }

  const criada = await db.fiscalEmailInbox.create({
    data: {
      tenantId: requireTenantId(),
      nome: dados.nome,
      email: dados.email,
      host: dados.host,
      porta: dados.porta,
      ssl: dados.ssl,
      usuario: dados.usuario,
      senha: senhaCifrada,
      pasta: dados.pasta,
      ativo: dados.ativo,
      siteId: dados.siteId,
      autenticacao: dados.autenticacao,
      oauthClientId: dados.oauthClientId ?? null,
      oauthClientSecret: dados.oauthClientSecret
        ? cifrar(dados.oauthClientSecret)
        : null,
      oauthTenantId: dados.oauthTenantId ?? null,
    },
    select: { id: true },
  });
  return criada.id;
}

export async function removerCaixa(id: string): Promise<void> {
  await db.fiscalEmailInbox.deleteMany({ where: { id } });
}

/**
 * Testa a conexão com o que está na tela. Quando a senha vem vazia (edição),
 * usa a que já está salva — senão testar uma conta existente exigiria digitar
 * a senha de novo.
 */
export async function testarCaixa(input: {
  id?: string | null;
  host: string;
  porta: number;
  ssl: boolean;
  usuario: string;
  senha: string;
  pasta: string;
  autenticacao: FiscalEmailAuth;
}): Promise<{ mensagens: number; pastas: string[] }> {
  let credenciais: { senha: string; accessToken: string | null };

  if (ehOauth(input.autenticacao)) {
    if (!input.id) {
      throw new Error("Salve a conta e conecte pelo provedor antes de testar.");
    }
    credenciais = { senha: "", accessToken: await tokenDaCaixa(input.id) };
  } else {
    const senha = input.senha || (input.id ? await senhaSalva(input.id) : "");
    if (!senha) throw new Error("Informe a senha de aplicativo da conta.");
    credenciais = { senha, accessToken: null };
  }

  const r = await testarConexaoImap({
    host: input.host,
    porta: input.porta,
    ssl: input.ssl,
    usuario: input.usuario,
    pasta: input.pasta,
    ...credenciais,
  });
  return { mensagens: r.mensagens, pastas: r.pastas };
}

async function senhaSalva(id: string): Promise<string> {
  const c = await db.fiscalEmailInbox.findFirst({ where: { id }, select: { senha: true } });
  if (!c) throw new Error("Conta de e-mail não encontrada.");
  return decifrar(c.senha) ?? "";
}

/**
 * Access token da caixa, pedido ao provedor na hora. O refresh token guardado
 * é a credencial de verdade — o access token vale minutos.
 */
async function tokenDaCaixa(inboxId: string): Promise<string> {
  const c = await db.fiscalEmailInbox.findFirst({
    where: { id: inboxId },
    select: {
      autenticacao: true,
      oauthClientId: true,
      oauthClientSecret: true,
      oauthRefreshToken: true,
      oauthTenantId: true,
    },
  });
  if (!c) throw new Error("Conta de e-mail não encontrada.");
  if (!ehOauth(c.autenticacao)) throw new Error("Esta conta não usa OAuth.");
  if (!c.oauthClientId || !c.oauthClientSecret || !c.oauthRefreshToken) {
    throw new Error("Conta ainda não conectada ao provedor. Use o botão \"Conectar\".");
  }

  return accessTokenParaImap({
    provider: c.autenticacao,
    clientId: c.oauthClientId,
    clientSecret: decifrar(c.oauthClientSecret) ?? "",
    refreshToken: decifrar(c.oauthRefreshToken) ?? "",
    oauthTenantId: c.oauthTenantId,
  });
}

/** Guarda o refresh token que voltou do consentimento. */
export async function salvarRefreshToken(inboxId: string, refreshToken: string): Promise<void> {
  await db.fiscalEmailInbox.updateMany({
    where: { id: inboxId },
    data: {
      oauthRefreshToken: cifrar(refreshToken),
      ultimoErro: null,
      falhasSeguidas: 0,
      proximaTentativa: null,
    },
  });
}

/** Dados que a tela precisa para montar a URL de consentimento. */
export async function dadosOauthDaCaixa(inboxId: string): Promise<{
  autenticacao: FiscalEmailAuth;
  clientId: string | null;
  oauthTenantId: string | null;
  email: string;
}> {
  const c = await db.fiscalEmailInbox.findFirst({
    where: { id: inboxId },
    select: { autenticacao: true, oauthClientId: true, oauthTenantId: true, email: true },
  });
  if (!c) throw new Error("Conta de e-mail não encontrada.");
  return {
    autenticacao: c.autenticacao,
    clientId: c.oauthClientId,
    oauthTenantId: c.oauthTenantId,
    email: c.email,
  };
}

/**
 * Varre uma caixa. Assume contexto de tenant ativo.
 *
 * Falha de uma mensagem não derruba a varredura: e-mail com anexo corrompido é
 * rotina, e uma nota quebrada não pode impedir as outras vinte de entrar.
 */
export async function sincronizarCaixa(
  tenantId: string,
  inboxId: string,
  opcoes?: { forcar?: boolean },
): Promise<ResultadoSincronizacaoEmail> {
  const caixa = await db.fiscalEmailInbox.findFirst({
    where: { id: inboxId },
    select: {
      id: true,
      siteId: true,
      host: true,
      porta: true,
      ssl: true,
      usuario: true,
      senha: true,
      pasta: true,
      ativo: true,
      ultimaSincronizacao: true,
      autenticacao: true,
      falhasSeguidas: true,
      proximaTentativa: true,
    },
  });
  if (!caixa) throw new Error("Conta de e-mail não encontrada.");
  if (!caixa.ativo) throw new Error("Esta conta está pausada. Ative-a para verificar a caixa.");

  // "Verificar agora" na tela ignora o backoff — o operador acabou de corrigir
  // a senha e quer ver funcionar. O job, não: insistir de 20 em 20 minutos numa
  // conta com credencial revogada é o que faz o provedor bloquear o IP.
  if (!opcoes?.forcar && caixa.proximaTentativa && caixa.proximaTentativa > new Date()) {
    return { ...ZERO };
  }

  if (!(await travar(inboxId))) return { ...ZERO };

  try {
    return await varrer(tenantId, caixa);
  } finally {
    await db.fiscalEmailInbox.updateMany({
      where: { id: inboxId },
      data: { sincronizandoEm: null },
    });
  }
}

/**
 * Trava a caixa para esta varredura. Dois workers na mesma conta baixariam o
 * mesmo anexo duas vezes — o unique de Message-ID salva a idempotência, mas não
 * o tráfego nem o limite de conexões simultâneas que o Gmail impõe.
 *
 * `updateMany` condicional é o lock: quem conseguir escrever, corre.
 */
async function travar(inboxId: string): Promise<boolean> {
  const limite = new Date(Date.now() - LOCK_MINUTOS * 60_000);
  const r = await db.fiscalEmailInbox.updateMany({
    where: {
      id: inboxId,
      OR: [{ sincronizandoEm: null }, { sincronizandoEm: { lt: limite } }],
    },
    data: { sincronizandoEm: new Date() },
  });
  return r.count > 0;
}

type CaixaParaVarrer = {
  id: string;
  siteId: string;
  host: string;
  porta: number;
  ssl: boolean;
  usuario: string;
  senha: string;
  pasta: string;
  ultimaSincronizacao: Date | null;
  autenticacao: FiscalEmailAuth;
  falhasSeguidas: number;
};

async function varrer(
  tenantId: string,
  caixa: CaixaParaVarrer,
): Promise<ResultadoSincronizacaoEmail> {
  const inboxId = caixa.id;

  const cred: ImapCredenciais = {
    host: caixa.host,
    porta: caixa.porta,
    ssl: caixa.ssl,
    usuario: caixa.usuario,
    senha: ehOauth(caixa.autenticacao) ? "" : (decifrar(caixa.senha) ?? ""),
    accessToken: ehOauth(caixa.autenticacao) ? await tokenDaCaixa(inboxId) : null,
    pasta: caixa.pasta,
  };

  const desde = janela(caixa.ultimaSincronizacao);
  const jaVistos = await messageIdsProcessados(inboxId);

  let mensagens;
  try {
    mensagens = await buscarMensagens(cred, {
      desde,
      ignorar: (messageId) => jaVistos.has(messageId),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha ao conectar na caixa de e-mail.";
    const falhas = caixa.falhasSeguidas + 1;
    await db.fiscalEmailInbox.updateMany({
      where: { id: inboxId },
      data: {
        ultimoErro: msg.slice(0, 300),
        ultimaSincronizacao: new Date(),
        falhasSeguidas: falhas,
        proximaTentativa: proximaTentativa(falhas),
      },
    });
    await registrarFalhaCanal({ origem: "EMAIL", inboxId, siteId: caixa.siteId }, msg);
    throw new Error(msg);
  }

  const emitente = await db.fiscalEmitente.findFirst({
    where: { siteId: caixa.siteId },
    select: { cnpj: true },
  });

  const total = { ...ZERO, mensagens: mensagens.length };

  for (const msg of mensagens) {
    const ctxLog = {
      origem: "EMAIL" as const,
      inboxId,
      siteId: caixa.siteId,
      remetente: msg.remetente,
    };
    let importadosNaMensagem = 0;

    try {
      for (const nome of msg.descartados) {
        await registrarIgnorado(ctxLog, nome, "Anexo sem XML de NF-e — não importado.");
      }

      if (msg.anexos.length > 0) {
        total.anexos += msg.anexos.length;
        const resultados = await importarNotasXml({
          tenantId,
          siteId: caixa.siteId,
          arquivos: msg.anexos,
          userId: null,
          cnpjDestino: emitente?.cnpj ?? null,
        });

        await registrarImportacoes(ctxLog, resultados);
        for (const r of resultados) {
          if (r.status === "IMPORTADA") {
            total.importadas += 1;
            importadosNaMensagem += 1;
          } else if (r.status === "DUPLICADA") total.duplicadas += 1;
          else total.erros += 1;
        }
      }
    } catch (e) {
      total.erros += 1;
      logErro("fiscal.email.mensagem", e);
      await registrarFalhaCanal(
        ctxLog,
        e instanceof Error ? e.message : "Falha ao processar a mensagem.",
      );
    }

    // Marca processada mesmo com erro: reprocessar em loop a mesma mensagem
    // quebrada a cada varredura só enche o log. O operador vê a falha no
    // histórico e resolve pelo upload manual.
    await marcarProcessada(inboxId, msg, importadosNaMensagem);
  }

  await db.fiscalEmailInbox.updateMany({
    where: { id: inboxId },
    data: {
      ultimaSincronizacao: new Date(),
      ultimoErro: null,
      falhasSeguidas: 0,
      proximaTentativa: null,
      mensagensLidas: { increment: mensagens.length },
    },
  });

  return total;
}

/** Espera crescente, com teto de um dia. */
function proximaTentativa(falhas: number): Date {
  const minutos = BACKOFF_MINUTOS[Math.min(falhas, BACKOFF_MINUTOS.length) - 1];
  return new Date(Date.now() + minutos * 60_000);
}

function janela(ultima: Date | null): Date {
  const base = ultima
    ? new Date(ultima.getTime() - FOLGA_DIAS * 24 * 3600 * 1000)
    : new Date(Date.now() - JANELA_INICIAL_DIAS * 24 * 3600 * 1000);
  // IMAP SEARCH SINCE compara só a data — hora aqui é decorativa.
  base.setHours(0, 0, 0, 0);
  return base;
}

async function messageIdsProcessados(inboxId: string): Promise<Set<string>> {
  const linhas = await db.fiscalEmailMessage.findMany({
    where: { inboxId },
    orderBy: { processadoEm: "desc" },
    take: 500,
    select: { messageId: true },
  });
  return new Set(linhas.map((l) => l.messageId));
}

async function marcarProcessada(
  inboxId: string,
  msg: { uid: number; messageId: string; assunto: string | null; remetente: string | null; recebidoEm: Date | null; anexos: unknown[] },
  importados: number,
): Promise<void> {
  try {
    await db.fiscalEmailMessage.create({
      data: {
        tenantId: requireTenantId(),
        inboxId,
        uid: msg.uid,
        messageId: msg.messageId,
        assunto: msg.assunto?.slice(0, 300) ?? null,
        remetente: msg.remetente?.slice(0, 200) ?? null,
        recebidoEm: msg.recebidoEm,
        anexos: msg.anexos.length,
        importados,
      },
    });
  } catch {
    // Corrida entre duas varreturas simultâneas: o unique (inboxId, messageId)
    // já garantiu que ninguém processa duas vezes.
  }
}

/** Todas as caixas ativas do tenant — o botão "Verificar agora" da tela. */
export async function sincronizarCaixasDoTenant(
  tenantId: string,
  opcoes?: { forcar?: boolean },
): Promise<ResultadoSincronizacaoEmail & { caixas: number }> {
  const caixas = await db.fiscalEmailInbox.findMany({
    where: { ativo: true },
    select: { id: true },
  });

  const total = { ...ZERO, caixas: caixas.length };
  for (const c of caixas) {
    try {
      const r = await sincronizarCaixa(tenantId, c.id, opcoes);
      total.mensagens += r.mensagens;
      total.anexos += r.anexos;
      total.importadas += r.importadas;
      total.duplicadas += r.duplicadas;
      total.erros += r.erros;
    } catch {
      // O erro já ficou gravado em `ultimoErro` e no log da caixa.
      total.erros += 1;
    }
  }
  return total;
}

/**
 * Job agendado: varre a caixa de todo mundo. Cross-tenant, então roda por
 * `basePrisma` para listar e entra em `runWithTenant` para trabalhar.
 */
export async function sincronizarCaixasTodos(): Promise<{
  tenants: number;
  caixas: number;
  importadas: number;
  erros: number;
}> {
  // Filtrar por `fiscalEmailInboxes: { some: … }` seria mais direto, mas a
  // subconsulta cairia na RLS de FiscalEmailInbox sem `app.current_tenant`
  // setado — e RLS sem contexto devolve zero linha em silêncio, não erro. A
  // varredura simplesmente pararia de rodar sem ninguém perceber. Por isso a
  // lista sai de Tenant (tabela sem policy) e o filtro de caixa acontece
  // dentro do `runWithTenant`.
  const tenants = await basePrisma.tenant.findMany({
    where: { moduloFiscal: true, ...whereFeature("fiscal") },
    select: { id: true },
  });

  let caixas = 0;
  let importadas = 0;
  let erros = 0;

  for (const t of tenants) {
    try {
      const r = await runWithTenant(t.id, () => sincronizarCaixasDoTenant(t.id));
      caixas += r.caixas;
      importadas += r.importadas;
      erros += r.erros;
    } catch (e) {
      erros += 1;
      logErro("fiscal.email.tenant", e);
    }
  }

  return { tenants: tenants.length, caixas, importadas, erros };
}
