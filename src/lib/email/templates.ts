import "server-only";
import type { Mensagem } from "./index";

// ============================================================
// Templates transacionais.
//
// HTML de e-mail é outro planeta: nada de flexbox, grid ou CSS externo —
// tabela e estilo inline, que é o que Gmail/Outlook renderizam igual. As cores
// vêm da mesma direção da interface (cyan frio × âmbar), escritas à mão porque
// tokens de `globals.css` não chegam na caixa de entrada de ninguém.
//
// Toda mensagem tem UMA ação. Se o operador precisa decidir entre dois botões,
// o e-mail está fazendo trabalho que é da tela.
// ============================================================

const TINTA = "#0d1b21";
const MUDO = "#5b7078";
const MARCA = "#0891a8";
const AMBAR = "#d97706";
const LINHA = "#dde5e8";
const FUNDO = "#f4f7f8";

function escape(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type Envelope = {
  titulo: string;
  /** Parágrafos do corpo, já em HTML seguro. */
  corpo: string[];
  cta?: { rotulo: string; url: string };
  /** Linha discreta no rodapé — validade do link, aviso de segurança. */
  nota?: string;
  destaque?: "marca" | "ambar";
};

function envelope({ titulo, corpo, cta, nota, destaque = "marca" }: Envelope): string {
  const cor = destaque === "ambar" ? AMBAR : MARCA;
  const paragrafos = corpo
    .map(
      (p) =>
        `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${TINTA};">${p}</p>`,
    )
    .join("");

  const botao = cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;">
         <tr><td style="border-radius:12px;background:${cor};">
           <a href="${escape(cta.url)}" style="display:inline-block;padding:14px 26px;font-family:'Helvetica Neue',Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${escape(cta.rotulo)}</a>
         </td></tr>
       </table>
       <p style="margin:8px 0 0;font-size:12px;line-height:1.5;color:${MUDO};word-break:break-all;">
         Se o botão não abrir, copie este endereço:<br>${escape(cta.url)}
       </p>`
    : "";

  return `<!doctype html>
<html lang="pt-BR"><body style="margin:0;padding:24px 0;background:${FUNDO};font-family:'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:92%;background:#ffffff;border:1px solid ${LINHA};border-radius:16px;">
      <tr><td style="padding:26px 30px 0;">
        <span style="font-size:13px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${MARCA};">NoHub Market</span>
      </td></tr>
      <tr><td style="padding:14px 30px 0;">
        <h1 style="margin:0 0 16px;font-size:21px;line-height:1.3;font-weight:700;color:${TINTA};">${escape(titulo)}</h1>
        ${paragrafos}
        ${botao}
      </td></tr>
      <tr><td style="padding:24px 30px 26px;">
        <div style="border-top:1px solid ${LINHA};padding-top:14px;font-size:12px;line-height:1.5;color:${MUDO};">
          ${nota ? `${escape(nota)}<br><br>` : ""}
          NoHub Market — gestão para mercados autônomos e mercadinhos.
        </div>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

const b = (v: string) => `<strong style="color:${TINTA};">${escape(v)}</strong>`;

// ── Equipe ──────────────────────────────────────────────────

export function emailConvite(input: {
  para: string;
  loja: string;
  convidadoPor: string;
  url: string;
  validadeDias: number;
}): Mensagem {
  return {
    para: input.para,
    assunto: `Você foi convidado para ${input.loja} no NoHub Market`,
    html: envelope({
      titulo: `Entre na equipe de ${input.loja}`,
      corpo: [
        `${b(input.convidadoPor)} convidou você para acessar o NoHub Market da loja ${b(input.loja)}.`,
        "Aceite o convite para criar sua senha e começar a usar.",
      ],
      cta: { rotulo: "Aceitar convite", url: input.url },
      nota: `O link vale ${input.validadeDias} dias. Se você não esperava este convite, ignore este e-mail.`,
    }),
  };
}

// ── Conta ───────────────────────────────────────────────────

export function emailResetSenha(input: {
  para: string;
  nome?: string | null;
  url: string;
  validadeMin: number;
}): Mensagem {
  return {
    para: input.para,
    assunto: "Redefinir sua senha do NoHub Market",
    html: envelope({
      titulo: "Redefinir senha",
      corpo: [
        input.nome ? `Olá, ${escape(input.nome)}.` : "Olá.",
        "Recebemos um pedido para redefinir a senha desta conta. Clique no botão para escolher uma nova.",
      ],
      cta: { rotulo: "Criar nova senha", url: input.url },
      nota:
        `O link expira em ${input.validadeMin} minutos e só pode ser usado uma vez. ` +
        "Se não foi você que pediu, ignore — sua senha continua a mesma.",
    }),
  };
}

export function emailBoasVindas(input: {
  para: string;
  loja: string;
  url: string;
  trialDias: number;
}): Mensagem {
  return {
    para: input.para,
    assunto: `${input.loja} está no ar no NoHub Market`,
    html: envelope({
      titulo: `${input.loja} está pronta para operar`,
      corpo: [
        `Sua loja já tem endereço próprio: ${b(input.url)}.`,
        `Você tem ${b(`${input.trialDias} dias`)} de teste com tudo liberado. Comece cadastrando os produtos que mais giram — o resto (estoque, compras, caixa) segue esse cadastro.`,
      ],
      cta: { rotulo: "Abrir minha loja", url: input.url },
      nota: "Dúvida na configuração? Responda este e-mail que a gente ajuda.",
    }),
  };
}

// ── Assinatura ──────────────────────────────────────────────

export function emailTrialAcabando(input: {
  para: string;
  loja: string;
  diasRestantes: number;
  url: string;
}): Mensagem {
  const dias =
    input.diasRestantes <= 0
      ? "hoje"
      : input.diasRestantes === 1
        ? "amanhã"
        : `em ${input.diasRestantes} dias`;
  return {
    para: input.para,
    assunto: `Seu teste do NoHub Market termina ${dias}`,
    html: envelope({
      titulo: `O teste de ${input.loja} termina ${dias}`,
      corpo: [
        "Para continuar vendendo, controlando estoque e emitindo relatórios sem interrupção, ative a assinatura.",
        "Seus dados continuam onde estão — nada é apagado quando o teste acaba.",
      ],
      cta: { rotulo: "Ativar assinatura", url: input.url },
      destaque: "ambar",
    }),
  };
}

export function emailAssinaturaAtiva(input: {
  para: string;
  loja: string;
  plano: string;
  url: string;
}): Mensagem {
  return {
    para: input.para,
    assunto: "Assinatura ativada — NoHub Market",
    html: envelope({
      titulo: `Assinatura ${input.plano} ativa`,
      corpo: [
        `A assinatura de ${b(input.loja)} está confirmada. Acesso liberado sem limite de tempo.`,
        "A cobrança se repete todo mês na mesma forma de pagamento. Você pode ver e cancelar quando quiser em Configurações → Plano.",
      ],
      cta: { rotulo: "Ver meu plano", url: input.url },
    }),
  };
}

export function emailPagamentoFalhou(input: {
  para: string;
  loja: string;
  url: string;
  diasAteSuspender: number;
}): Mensagem {
  return {
    para: input.para,
    assunto: "Não conseguimos processar seu pagamento — NoHub Market",
    html: envelope({
      titulo: "Pagamento não aprovado",
      corpo: [
        `A cobrança da assinatura de ${b(input.loja)} não foi aprovada pelo banco.`,
        `Atualize a forma de pagamento nos próximos ${b(`${input.diasAteSuspender} dias`)} para o acesso continuar liberado.`,
      ],
      cta: { rotulo: "Atualizar pagamento", url: input.url },
      destaque: "ambar",
      nota: "Se você já regularizou, pode ignorar este aviso.",
    }),
  };
}

export function emailContaSuspensa(input: { para: string; loja: string; url: string }): Mensagem {
  return {
    para: input.para,
    assunto: "Acesso suspenso — NoHub Market",
    html: envelope({
      titulo: `O acesso de ${input.loja} foi suspenso`,
      corpo: [
        "A assinatura está em aberto, então o sistema entrou em modo somente leitura: dá para consultar, mas não para vender ou movimentar estoque.",
        "Seus dados estão preservados. Assim que o pagamento for confirmado, tudo volta no mesmo lugar.",
      ],
      cta: { rotulo: "Regularizar assinatura", url: input.url },
      destaque: "ambar",
    }),
  };
}
