import "server-only";
import { WhatsAppProviderError, type EnvioTemplate, type WhatsAppProvider } from "./types";

// ============================================================
// Adapter WhatsApp Cloud API (Meta). O resto do ERP não sabe que este arquivo
// existe — ver `./types`.
//
// Três coisas que mudam de forma em relação a um gateway comum:
//   1. Não existe "mandar texto para quem nunca falou com você". A empresa
//      inicia com TEMPLATE aprovado; o texto livre só vale dentro da janela de
//      24h que o contato abre respondendo.
//   2. O aceite não é a entrega. O POST devolve um `wamid` dizendo "aceitei";
//      entregue/lido chegam depois, por webhook.
//   3. Erro vem 200-com-corpo-de-erro em alguns casos e 4xx em outros, sempre
//      no mesmo formato `{ error: { message, code, error_subcode } }`.
// ============================================================

const API = "https://graph.facebook.com";
const VERSAO = "v21.0";

/** Códigos que não melhoram com nova tentativa — dizem para parar e consertar. */
const PERMANENTES = new Set([
  100, // parâmetro inválido (template errado, idioma inexistente)
  133_004, // número da empresa indisponível
  133_005, // PIN de verificação errado no registro
  133_010, // número da empresa não registrado na Cloud API
  131_030, // destinatário fora da lista de teste (app em desenvolvimento)
  131_008, // parâmetro obrigatório faltando
  131_009, // valor de parâmetro inválido
  131_026, // mensagem não entregue (número, registro do remetente ou template)
  132_000, // número de parâmetros diferente do template aprovado
  132_001, // template não existe nesse idioma
  132_005, // texto do parâmetro maior que o aprovado
  132_007, // template com formato reprovado
  190, // token expirado/revogado
]);

type ErroMeta = {
  error?: { message?: string; code?: number; error_subcode?: number; error_data?: { details?: string } };
};

/** A mensagem que a Meta manda é para desenvolvedor. Aqui vira recado de tela. */
function traduzir(corpo: ErroMeta, http: number): WhatsAppProviderError {
  const e = corpo.error ?? {};
  const codigo = e.code ?? null;
  const detalhe = e.error_data?.details || e.message || `Erro HTTP ${http} na Meta.`;
  const permanente = codigo !== null && PERMANENTES.has(codigo);

  if (codigo === 190) {
    return new WhatsAppProviderError(
      "O token de acesso da Meta expirou ou foi revogado. Gere outro em Configurações → WhatsApp.",
      true,
      String(codigo),
    );
  }
  if (codigo === 131_026) {
    // 131026 é o "não entregue" genérico da Meta, e quase nunca quer dizer o
    // que parece. Já foi lido como "esse número não tem WhatsApp" — e o
    // operador conferia o telefone, que estava certo, e travava. As três
    // causas reais vêm nomeadas, na ordem em que dá para checar.
    return new WhatsAppProviderError(
      "A Meta recusou a entrega para este número (131026). Confira, nesta ordem: " +
        "o número da SUA empresa está registrado na Cloud API (Configurações → WhatsApp → " +
        "testar credencial); o template está APROVADO no idioma configurado; e o número do " +
        "contato tem WhatsApp ativo.",
      true,
      String(codigo),
    );
  }
  if (codigo === 131_030) {
    return new WhatsAppProviderError(
      "Seu app na Meta ainda está em desenvolvimento: só recebem os números da lista de " +
        "teste. Publique o app ou adicione este número lá.",
      true,
      String(codigo),
    );
  }
  if (codigo === 133_010 || codigo === 133_005 || codigo === 133_004) {
    return new WhatsAppProviderError(
      "O número da sua empresa não está registrado na Cloud API. Registre-o no painel da Meta " +
        "(WhatsApp → API Setup → Register, com o PIN de verificação em duas etapas).",
      true,
      codigo === null ? null : String(codigo),
    );
  }
  if (codigo === 132_001) {
    return new WhatsAppProviderError(
      "O template configurado não existe nesse idioma na sua conta da Meta. Confira o nome e o idioma em Configurações → WhatsApp.",
      true,
      String(codigo),
    );
  }
  if (codigo === 131_047) {
    return new WhatsAppProviderError(
      "A janela de 24 horas com este contato fechou — só template aprovado sai agora.",
      true,
      String(codigo),
    );
  }
  if (http === 429 || codigo === 131_048 || codigo === 80_007) {
    return new WhatsAppProviderError(
      "A Meta limitou a velocidade de envio deste número. Espere alguns minutos e mande o resto.",
      false,
      codigo === null ? null : String(codigo),
    );
  }
  return new WhatsAppProviderError(detalhe, permanente, codigo === null ? null : String(codigo));
}

async function chamar(
  caminho: string,
  token: string,
  init?: { method?: string; body?: unknown },
): Promise<unknown> {
  let resposta: Response;
  try {
    resposta = await fetch(`${API}/${VERSAO}/${caminho}`, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      // Rede parada é falha de transporte, não de negócio: 20s e desiste.
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new WhatsAppProviderError(
      e instanceof Error && e.name === "TimeoutError"
        ? "A Meta não respondeu a tempo. Tente de novo."
        : "Não foi possível falar com a Meta. Verifique a conexão.",
      false,
    );
  }

  const texto = await resposta.text();
  const corpo: unknown = texto ? JSON.parse(texto) : {};
  if (!resposta.ok || (corpo as ErroMeta).error) {
    throw traduzir(corpo as ErroMeta, resposta.status);
  }
  return corpo;
}

export function metaCloudProvider(cfg: {
  phoneNumberId: string;
  accessToken: string;
}): WhatsAppProvider {
  return {
    kind: "META_CLOUD",

    async enviarTemplate(envio: EnvioTemplate) {
      // Uma tentativa por grafia do número. Só o 131026 ("não entregue") faz
      // passar para a próxima: token vencido ou template reprovado não melhora
      // trocando o telefone, e repetir só gastaria chamada.
      const destinos = [envio.para, ...(envio.alternativos ?? [])].filter(
        (n, i, todos) => n && todos.indexOf(n) === i,
      );
      let ultimo: WhatsAppProviderError | null = null;

      for (const to of destinos) {
        let corpo: unknown;
        try {
          corpo = await chamar(`${cfg.phoneNumberId}/messages`, cfg.accessToken, {
            method: "POST",
            body: {
              messaging_product: "whatsapp",
              recipient_type: "individual",
              to,
              type: "template",
              template: {
                name: envio.template,
                language: { code: envio.idioma },
                components: [
                  {
                    type: "body",
                    parameters: envio.parametros.map((text) => ({ type: "text", text })),
                  },
                ],
              },
            },
          });
        } catch (e) {
          if (e instanceof WhatsAppProviderError && e.codigo === "131026") {
            ultimo = e;
            continue;
          }
          throw e;
        }

        const wamid = (corpo as { messages?: { id?: string }[] }).messages?.[0]?.id;
        if (!wamid) {
          throw new WhatsAppProviderError(
            "A Meta aceitou o envio sem devolver o identificador.",
            false,
          );
        }
        return { externalId: wamid };
      }

      throw (
        ultimo ??
        new WhatsAppProviderError("Não há número de destino para enviar.", true)
      );
    },

    async validarCredenciais() {
      // Ler o próprio número é o teste mais barato que prova as duas coisas de
      // uma vez: o token vale E ele enxerga ESTE phoneNumberId.
      await chamar(`${cfg.phoneNumberId}?fields=${CAMPOS_NUMERO}`, cfg.accessToken);
    },
  };
}

const CAMPOS_NUMERO = "display_phone_number,verified_name,status,code_verification_status";

/**
 * Dados de exibição do número — usados na tela de configuração.
 *
 * `status` é o que separa "credencial válida" de "credencial válida e o número
 * manda mensagem": número não registrado na Cloud API responde a leitura
 * normalmente e recusa TODO disparo com 131026. Sem isso, o operador testava a
 * credencial, via "válida" e passava a culpar o telefone do fornecedor.
 */
export async function dadosDoNumero(cfg: {
  phoneNumberId: string;
  accessToken: string;
}): Promise<{ numero: string | null; nome: string | null; status: string | null }> {
  const corpo = (await chamar(`${cfg.phoneNumberId}?fields=${CAMPOS_NUMERO}`, cfg.accessToken)) as {
    display_phone_number?: string;
    verified_name?: string;
    status?: string;
  };
  return {
    numero: corpo.display_phone_number ?? null,
    nome: corpo.verified_name ?? null,
    status: corpo.status ?? null,
  };
}
