import "server-only";

// ============================================================
// Log estruturado.
//
// Uma linha JSON por evento: Vercel/Datadog/Grafana leem isso sem parser
// customizado, e `console.log("deu erro", e)` não vira agulha no palheiro.
//
// NUNCA passe por aqui: senha, token de PSP/provedor fiscal, CSC, cookie de
// sessão, corpo de webhook cru. Log é o lugar onde segredo vaza sem ninguém
// notar por meses.
//
// `ERROR_WEBHOOK_URL` (Slack/Discord/Teams) recebe cópia dos erros — é o
// mínimo de "alguém me avisa" enquanto não há APM. Envio é disparado sem
// espera: observabilidade não pode atrasar resposta ao operador.
// ============================================================

type Dados = Record<string, unknown>;

type Nivel = "info" | "aviso" | "erro";

const dev = process.env.NODE_ENV !== "production";

function emitir(nivel: Nivel, evento: string, msg: string | undefined, dados?: Dados) {
  const linha = {
    ts: new Date().toISOString(),
    nivel,
    evento,
    ...(msg ? { msg } : {}),
    ...dados,
  };

  if (dev) {
    const marca = nivel === "erro" ? "✖" : nivel === "aviso" ? "▲" : "·";
    console[nivel === "erro" ? "error" : "log"](`${marca} ${evento}${msg ? ` — ${msg}` : ""}`, dados ?? "");
    return;
  }
  console[nivel === "erro" ? "error" : "log"](JSON.stringify(linha));
}

export function logInfo(evento: string, dados?: Dados): void {
  emitir("info", evento, undefined, dados);
}

export function logAviso(evento: string, msg: string, dados?: Dados): void {
  emitir("aviso", evento, msg, dados);
}

/**
 * Registra falha. Aceita Error ou string — o segundo caso é para erro de
 * integração que já veio como mensagem (ex.: resposta 4xx de PSP).
 */
export function logErro(evento: string, erro: unknown, dados?: Dados): void {
  const msg = erro instanceof Error ? erro.message : String(erro);
  const stack = erro instanceof Error ? erro.stack : undefined;
  emitir("erro", evento, msg, { ...dados, ...(stack ? { stack } : {}) });
  notificar(evento, msg, dados);
}

let ultimaNotificacao = 0;

/** Cópia do erro no canal do time. Com trava simples contra tempestade de alerta. */
function notificar(evento: string, msg: string, dados?: Dados): void {
  const url = process.env.ERROR_WEBHOOK_URL?.trim();
  if (!url || dev) return;

  const agora = Date.now();
  if (agora - ultimaNotificacao < 30_000) return; // no máximo 1 aviso a cada 30s
  ultimaNotificacao = agora;

  const contexto = dados
    ? Object.entries(dados)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(" · ")
    : "";

  void fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: `🔴 *${evento}*\n${msg}${contexto ? `\n${contexto}` : ""}` }),
    signal: AbortSignal.timeout(5_000),
  }).catch(() => {
    // Falhar ao avisar sobre falha não pode virar outra falha.
  });
}

/**
 * Envolve uma Server Action para que erro inesperado vire log com contexto em
 * vez de sumir no "Something went wrong" do Next. Reergue o erro: quem chama
 * (a tela) continua vendo a mensagem.
 */
export async function comLog<T>(evento: string, fn: () => Promise<T>, dados?: Dados): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    logErro(evento, e, dados);
    throw e;
  }
}
