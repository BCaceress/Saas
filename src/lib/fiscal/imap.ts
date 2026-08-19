import "server-only";
import { ImapFlow, type FetchMessageObject } from "imapflow";

// ============================================================
// Cliente IMAP — a camada que fala com a caixa de e-mail e nada mais.
//
// Regra deste arquivo: ele não conhece tenant, banco nem NF-e. Entra
// credencial, sai mensagem com anexos em bytes. O serviço
// (`email-inbox.ts`) é quem decide o que fazer com isso — assim dá para
// testar a importação sem servidor IMAP e trocar o transporte depois
// (Microsoft Graph, POP3) sem mexer na regra de negócio.
//
// Só o que interessa é baixado: a varredura pede envelope + estrutura do
// corpo (barato) e só busca o corpo dos anexos que parecem XML. Caixa de
// compras costuma ter PDF de boleto de 3 MB em todo e-mail.
// ============================================================

export type ImapCredenciais = {
  host: string;
  porta: number;
  ssl: boolean;
  usuario: string;
  /** Senha de aplicativo. Ignorada quando `accessToken` vem preenchido. */
  senha: string;
  /** Access token OAuth2 (XOAUTH2) — o caminho do Microsoft 365 e do Google. */
  accessToken?: string | null;
  pasta: string;
};

export type AnexoEmail = {
  nome: string;
  bytes: Uint8Array;
};

export type MensagemEmail = {
  uid: number;
  messageId: string;
  assunto: string | null;
  remetente: string | null;
  recebidoEm: Date | null;
  /** Anexos que podem conter NF-e (.xml/.zip). */
  anexos: AnexoEmail[];
  /** Anexos descartados por extensão — viram linha "ignorada" no log. */
  descartados: string[];
};

/** Anexo maior que isso não é nota fiscal; é catálogo, foto ou vídeo. */
const LIMITE_ANEXO_BYTES = 10 * 1024 * 1024;

/** Teto por varredura: uma caixa esquecida não pode travar o job dos outros. */
export const LIMITE_MENSAGENS = 60;

function cliente(cred: ImapCredenciais): ImapFlow {
  return new ImapFlow({
    host: cred.host,
    port: cred.porta,
    secure: cred.ssl,
    // imapflow escolhe XOAUTH2 quando recebe accessToken em vez de pass.
    auth: cred.accessToken
      ? { user: cred.usuario, accessToken: cred.accessToken }
      : { user: cred.usuario, pass: cred.senha },
    logger: false,
    // Servidor lento não pode segurar a função serverless até o limite.
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
}

/**
 * Erro de IMAP vem em inglês e cru ("Invalid credentials (Failure)"). Quem lê
 * é o dono do mercadinho configurando o Gmail — a mensagem precisa dizer o que
 * fazer, não o que o servidor respondeu.
 */
function traduzir(e: unknown): string {
  const bruto = e instanceof Error ? e.message : String(e);
  const m = bruto.toLowerCase();

  if (m.includes("invalid credentials") || m.includes("authenticationfailed") || m.includes("auth")) {
    return (
      "Usuário ou senha recusados pelo servidor. Em contas Google e Microsoft com " +
      "verificação em duas etapas é preciso usar uma senha de aplicativo — e o " +
      "Microsoft 365 já desligou senha no IMAP em boa parte das contas: nesses casos, " +
      "conecte por OAuth."
    );
  }
  if (m.includes("enotfound") || m.includes("getaddrinfo")) {
    return "Servidor IMAP não encontrado. Confira o endereço (ex.: imap.gmail.com).";
  }
  if (m.includes("econnrefused")) {
    return "Conexão recusada. Confira a porta (993 com SSL, 143 sem) e se o IMAP está habilitado na conta.";
  }
  if (m.includes("timeout") || m.includes("etimedout")) {
    return "O servidor não respondeu a tempo. Confira endereço, porta e se a rede libera a saída IMAP.";
  }
  if (m.includes("does not exist") || m.includes("nonexistent") || m.includes("[trycreate]")) {
    return "A pasta monitorada não existe nesta conta. Use o nome exato (ex.: INBOX).";
  }
  return bruto;
}

async function conectado<T>(cred: ImapCredenciais, fn: (c: ImapFlow) => Promise<T>): Promise<T> {
  const c = cliente(cred);
  try {
    await c.connect();
    return await fn(c);
  } catch (e) {
    throw new Error(traduzir(e));
  } finally {
    // logout() pode falhar se a conexão já caiu — não interessa mais.
    try {
      await c.logout();
    } catch {
      c.close();
    }
  }
}

export type TesteConexao = {
  pasta: string;
  mensagens: number;
  pastas: string[];
};

/** Conecta, abre a pasta e devolve o que o operador precisa ver para confiar. */
export async function testarConexaoImap(cred: ImapCredenciais): Promise<TesteConexao> {
  return conectado(cred, async (c) => {
    const lista = await c.list();
    const lock = await c.getMailboxLock(cred.pasta);
    try {
      const caixa = c.mailbox;
      return {
        pasta: cred.pasta,
        mensagens: typeof caixa === "object" ? caixa.exists : 0,
        pastas: lista.map((p) => p.path).slice(0, 50),
      };
    } finally {
      lock.release();
    }
  });
}

const EXT_ACEITAS = [".xml", ".zip"];

function nomeDoAnexo(node: { parameters?: unknown; dispositionParameters?: unknown }): string | null {
  const disp = node.dispositionParameters as Record<string, string> | undefined;
  const par = node.parameters as Record<string, string> | undefined;
  const nome = disp?.filename ?? par?.name ?? null;
  return nome ? nome.trim() : null;
}

export type NoCorpo = {
  part?: string;
  type?: string;
  disposition?: string;
  size?: number;
  parameters?: Record<string, string>;
  dispositionParameters?: Record<string, string>;
  childNodes?: NoCorpo[];
};

export type AnexoCandidato = { part: string; nome: string; size: number };

/** Achata a árvore MIME e fica só com o que tem cara de anexo nomeado. */
export function anexosCandidatos(no: NoCorpo | undefined, saida: AnexoCandidato[] = []): AnexoCandidato[] {
  if (!no) return saida;
  for (const filho of no.childNodes ?? []) anexosCandidatos(filho, saida);

  const nome = nomeDoAnexo(no);
  const anexo = no.disposition?.toLowerCase() === "attachment" || nome != null;
  if (anexo && nome && no.part) {
    saida.push({ part: no.part, nome, size: no.size ?? 0 });
  }
  return saida;
}

/**
 * Só XML e ZIP são baixados. DANFE em PDF não traz item — importá-lo daria
 * uma nota sem produto, que é pior que nota nenhuma.
 */
export function aceitaAnexo(nome: string, size: number): boolean {
  const n = nome.trim().toLowerCase();
  if (!EXT_ACEITAS.some((ext) => n.endsWith(ext))) return false;
  return size <= LIMITE_ANEXO_BYTES;
}

async function baixar(c: ImapFlow, uid: number, part: string): Promise<Uint8Array> {
  const { content } = await c.download(String(uid), part, { uid: true });
  const pedacos: Buffer[] = [];
  for await (const pedaco of content) {
    pedacos.push(Buffer.isBuffer(pedaco) ? pedaco : Buffer.from(pedaco as string));
  }
  return new Uint8Array(Buffer.concat(pedacos));
}

function remetenteDe(msg: FetchMessageObject): string | null {
  const de = msg.envelope?.from?.[0];
  if (!de) return null;
  return de.address ? de.address : (de.name ?? null);
}

/**
 * Varre a pasta a partir de `desde` e devolve as mensagens com os anexos já
 * em bytes.
 *
 * Busca por DATA, não por flag `\Seen`: o operador abre o e-mail no celular e
 * a caixa inteira voltaria a ser reprocessada (ou pior, deixaria de ser). A
 * idempotência real mora no `Message-ID` guardado em `FiscalEmailMessage`.
 */
export async function buscarMensagens(
  cred: ImapCredenciais,
  opcoes: { desde: Date; limite?: number; ignorar?: (messageId: string) => boolean },
): Promise<MensagemEmail[]> {
  const limite = Math.min(opcoes.limite ?? LIMITE_MENSAGENS, LIMITE_MENSAGENS);

  return conectado(cred, async (c) => {
    const lock = await c.getMailboxLock(cred.pasta);
    try {
      const uids = await c.search({ since: opcoes.desde }, { uid: true });
      if (!uids || uids.length === 0) return [];

      // Do mais novo para o mais velho: numa caixa acumulada, o que importa é
      // a nota de hoje, não a de três meses atrás.
      const alvo = uids.slice(-limite).reverse();
      const saida: MensagemEmail[] = [];

      for await (const msg of c.fetch(
        alvo,
        { uid: true, envelope: true, bodyStructure: true },
        { uid: true },
      )) {
        const messageId = msg.envelope?.messageId ?? `uid:${msg.uid}`;
        if (opcoes.ignorar?.(messageId)) continue;

        const anexos: AnexoEmail[] = [];
        const descartados: string[] = [];

        for (const cand of anexosCandidatos(msg.bodyStructure as NoCorpo | undefined)) {
          if (!aceitaAnexo(cand.nome, cand.size)) {
            descartados.push(cand.nome);
            continue;
          }
          anexos.push({ nome: cand.nome, bytes: await baixar(c, msg.uid, cand.part) });
        }

        saida.push({
          uid: msg.uid,
          messageId,
          assunto: msg.envelope?.subject ?? null,
          remetente: remetenteDe(msg),
          recebidoEm: msg.envelope?.date ?? null,
          anexos,
          descartados,
        });
      }

      return saida;
    } finally {
      lock.release();
    }
  });
}
