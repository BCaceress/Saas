import "server-only";

// ============================================================
// E-mail transacional (Resend, via REST — sem SDK).
//
// Regra: e-mail NUNCA derruba a operação que o disparou. Convite gravado é
// convite válido mesmo se o envio falhar (o link continua copiável na tela);
// venda finalizada não volta atrás porque o SMTP caiu. Por isso todo envio
// devolve um resultado em vez de estourar — quem chama decide o que avisar.
//
// Sem RESEND_API_KEY:
//   dev  → imprime no console (dá para clicar o link do terminal)
//   prod → devolve erro; o log estruturado registra o que não saiu
// ============================================================

export type ResultadoEnvio = { ok: true; id?: string } | { ok: false; erro: string };

export type Mensagem = {
  para: string | string[];
  assunto: string;
  html: string;
  /** Alternativa em texto puro — cliente de e-mail antigo e antispam gostam. */
  texto?: string;
  /** Para onde a resposta vai (suporte), quando diferente do remetente. */
  responderPara?: string;
};

const API = "https://api.resend.com/emails";

function remetente(): string {
  return process.env.EMAIL_FROM?.trim() || "NoHub Market <nao-responda@nohub.market>";
}

/** Texto puro derivado do HTML — evita manter dois corpos por template. */
function textoDoHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h1|h2|h3|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function enviarEmail(msg: Mensagem): Promise<ResultadoEnvio> {
  const key = process.env.RESEND_API_KEY?.trim();
  const destinatarios = Array.isArray(msg.para) ? msg.para : [msg.para];

  if (!key) {
    if (process.env.NODE_ENV === "production") {
      return { ok: false, erro: "RESEND_API_KEY não configurada — e-mail não enviado." };
    }
    console.info(
      `\n── e-mail (dev, não enviado) ──\npara: ${destinatarios.join(", ")}\n` +
        `assunto: ${msg.assunto}\n\n${msg.texto ?? textoDoHtml(msg.html)}\n───────────────\n`,
    );
    return { ok: true };
  }

  try {
    const res = await fetch(API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: remetente(),
        to: destinatarios,
        subject: msg.assunto,
        html: msg.html,
        text: msg.texto ?? textoDoHtml(msg.html),
        ...(msg.responderPara ? { reply_to: msg.responderPara } : {}),
      }),
      // Envio não pode segurar a resposta da Server Action indefinidamente.
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const corpo = await res.text().catch(() => "");
      return { ok: false, erro: `Resend ${res.status}: ${corpo.slice(0, 300)}` };
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, id: json.id };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : "Falha ao enviar e-mail." };
  }
}

export { textoDoHtml };
