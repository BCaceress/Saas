import "server-only";
import webpush, { WebPushError } from "web-push";
import { basePrisma, comTenant } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { can, parseAcessosJson, type Acesso, type Permissao } from "@/lib/permissoes";
import { computarAlertas, filtrarAlertas } from "./computar";
import type { AlertItem } from "@/lib/alerts-types";

/**
 * Disparo das notificações de alerta.
 *
 * Como não existe tabela de notificação (os alertas são computados ao vivo), o
 * job é o único momento em que o sistema pode "acordar" o aparelho de alguém.
 * Três coisas o tornam suportável:
 *
 *  1. Só tenant COM inscrição entra na conta — a computação é cara e não faz
 *     sentido pagá-la para quem não recebe push.
 *  2. Computa UMA vez por tenant e filtra N vezes, uma por inscrito.
 *  3. Deduplica pelo array `alertasEnviados` da própria inscrição, gravando a
 *     interseção com os alertas atuais — nada de repetir a mesma ruptura todo
 *     dia, e um alerta que volta notifica de novo.
 */

/** Só o que tira alguém do que está fazendo. O resto fica no sino. */
const PRIORIDADES_PUSH = new Set(["critico", "alto"]);

/** Teto de notificações por aparelho e rodada. O excedente vira um resumo. */
const MAX_POR_APARELHO = 3;

/** Falhas consecutivas antes de considerar o aparelho morto. */
const MAX_FALHAS = 5;

/** Janela civilizada padrão, em hora local — a empresa ajusta em Notificações. */
const HORA_INICIO = 7;
const HORA_FIM = 21;

/**
 * O Tenant ainda não guarda fuso horário. Como a base é de mercados no Brasil,
 * fixar aqui é melhor do que notificar às 4h. DÍVIDA: quando houver
 * `Tenant.timezone`, ler de lá.
 */
const FUSO = "America/Sao_Paulo";

function horaLocal(): number {
  return Number(
    new Intl.DateTimeFormat("pt-BR", {
      timeZone: FUSO,
      hour: "numeric",
      hour12: false,
    }).format(new Date()),
  );
}

function configurarVapid(): boolean {
  const publica = process.env.VAPID_PUBLIC_KEY?.trim();
  const privada = process.env.VAPID_PRIVATE_KEY?.trim();
  const assunto = process.env.VAPID_SUBJECT?.trim() || "mailto:suporte@nohub.market";
  if (!publica || !privada) return false;
  webpush.setVapidDetails(assunto, publica, privada);
  return true;
}

type Inscricao = {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  alertasEnviados: string[];
  falhas: number;
  silenciadoAte: Date | null;
};

export type ResumoPush = {
  tenants: number;
  aparelhos: number;
  enviadas: number;
  removidas: number;
  puladoForaDeHora: boolean;
};

/** Monta o texto da notificação a partir dos alertas novos. */
function montarMensagem(novos: AlertItem[]): {
  titulo: string;
  corpo: string;
  url: string;
  tag: string;
  prioridade: string;
} {
  const [primeiro] = novos;
  if (novos.length === 1) {
    return {
      titulo: primeiro.titulo,
      corpo: primeiro.descricao,
      url: primeiro.href ?? "/m/alertas",
      tag: primeiro.id,
      prioridade: primeiro.priority,
    };
  }
  return {
    titulo: `${novos.length} pendências precisam de você`,
    corpo: novos
      .slice(0, 3)
      .map((a) => a.titulo)
      .join(" · "),
    url: "/m/alertas",
    // Tag fixa para o resumo: uma notificação de resumo substitui a anterior em
    // vez de empilhar.
    tag: "resumo",
    prioridade: primeiro.priority,
  };
}

export async function dispararAlertasPush(
  opcoes: { ignorarHorario?: boolean } = {},
): Promise<ResumoPush> {
  const vazio: ResumoPush = {
    tenants: 0,
    aparelhos: 0,
    enviadas: 0,
    removidas: 0,
    puladoForaDeHora: false,
  };

  if (!configurarVapid()) {
    throw new Error("VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY não configurados.");
  }

  const h = horaLocal();

  // Mesmo recorte de `lib/snapshot.ts`. Conta suspensa ou cancelada não recebe
  // push: ela ainda consulta os próprios dados, mas não é hora de o sistema
  // tocar o celular de quem parou de pagar.
  const tenants = await basePrisma.tenant.findMany({
    where: { status: { in: ["TRIAL", "ACTIVE"] } },
  });

  const resumo = { ...vazio };
  const agora = new Date();

  for (const tenant of tenants) {
    // A janela de silêncio é de cada empresa (Configurações → Notificações):
    // mercadinho de bairro e conveniência 24h não querem o mesmo horário.
    const inicio = tenant.pushHoraInicio ?? HORA_INICIO;
    const fim = tenant.pushHoraFim ?? HORA_FIM;
    if (!opcoes.ignorarHorario && (h < inicio || h >= fim)) {
      resumo.puladoForaDeHora = true;
      continue;
    }

    const inscricoes = (await comTenant(
      tenant.id,
      basePrisma.pushSubscription.findMany({
        where: { OR: [{ silenciadoAte: null }, { silenciadoAte: { lt: agora } }] },
        select: {
          id: true,
          userId: true,
          endpoint: true,
          p256dh: true,
          auth: true,
          alertasEnviados: true,
          falhas: true,
          silenciadoAte: true,
        },
      }),
    )) as Inscricao[];

    // O filtro que segura o custo: sem aparelho inscrito, nem computa.
    if (inscricoes.length === 0) continue;

    const todos = await runWithTenant(tenant.id, () => computarAlertas(tenant));
    resumo.tenants += 1;

    // Acessos por usuário — uma consulta por tenant, não por inscrição.
    const userIds = [...new Set(inscricoes.map((i) => i.userId))];
    const memberships = await comTenant(
      tenant.id,
      basePrisma.membership.findMany({
        where: { userId: { in: userIds }, ativo: true },
        select: { userId: true, acessos: { select: { perfil: true, siteId: true } } },
      }),
    );
    const acessosPorUsuario = new Map<string, Acesso[]>(
      memberships.map((m) => [m.userId, parseAcessosJson(m.acessos)]),
    );

    for (const inscricao of inscricoes) {
      resumo.aparelhos += 1;

      const acessos = acessosPorUsuario.get(inscricao.userId) ?? [];
      const visiveis = filtrarAlertas(todos, tenant, acessos).filter((a) =>
        PRIORIDADES_PUSH.has(a.priority),
      );

      const jaEnviados = new Set(inscricao.alertasEnviados);
      const novos = visiveis.filter((a) => !jaEnviados.has(a.id));

      // INTERSEÇÃO, não união: o que sumiu da lista sai daqui e volta a
      // notificar se reaparecer — e o array não cresce sem limite.
      const paraGravar = visiveis.map((a) => a.id);

      if (novos.length === 0) {
        if (paraGravar.length !== inscricao.alertasEnviados.length) {
          await comTenant(
            tenant.id,
            basePrisma.pushSubscription.updateMany({
              where: { id: inscricao.id },
              data: { alertasEnviados: paraGravar },
            }),
          );
        }
        continue;
      }

      const lote = novos.slice(0, MAX_POR_APARELHO);
      const payload = JSON.stringify(montarMensagem(lote));

      try {
        await webpush.sendNotification(
          {
            endpoint: inscricao.endpoint,
            keys: { p256dh: inscricao.p256dh, auth: inscricao.auth },
          },
          payload,
        );
        resumo.enviadas += 1;

        await comTenant(
          tenant.id,
          basePrisma.pushSubscription.updateMany({
            where: { id: inscricao.id },
            data: { alertasEnviados: paraGravar, falhas: 0, ultimoEnvio: new Date() },
          }),
        );
      } catch (e) {
        const status = e instanceof WebPushError ? e.statusCode : 0;

        // 404/410 = inscrição morta (app desinstalado, permissão revogada).
        if (status === 404 || status === 410) {
          await comTenant(
            tenant.id,
            basePrisma.pushSubscription.deleteMany({ where: { id: inscricao.id } }),
          );
          resumo.removidas += 1;
          continue;
        }

        // 429 é limite do serviço de push, não defeito do aparelho: não conta.
        if (status === 429) continue;

        const falhas = inscricao.falhas + 1;
        if (falhas >= MAX_FALHAS) {
          await comTenant(
            tenant.id,
            basePrisma.pushSubscription.deleteMany({ where: { id: inscricao.id } }),
          );
          resumo.removidas += 1;
        } else {
          await comTenant(
            tenant.id,
            basePrisma.pushSubscription.updateMany({
              where: { id: inscricao.id },
              data: { falhas },
            }),
          );
        }
      }
    }
  }

  return resumo;
}

// ── Disparo imediato ────────────────────────────────────────
// O cron acima roda duas vezes por dia e só enxerga o que o computador de alertas
// vê. Alguns fatos não podem esperar a próxima rodada — a proposta que o
// fornecedor acabou de mandar pelo link é o caso: a pessoa está com o
// celular no bolso e o concorrente dele também está respondendo.
//
// Mesmas regras do cron: janela de silêncio da empresa, conta ativa, só quem
// tem a permissão NA loja do fato. O `alertaId` entra no `alertasEnviados` da
// inscrição para a rodada do cron não repetir a mesma notícia uma hora depois.

export type PushImediato = {
  tenantId: string;
  permissao: Permissao;
  siteId: string;
  mensagem: { titulo: string; corpo: string; url: string; tag: string };
  /** Id do alerta equivalente no sino (`kind:sujeito`). */
  alertaId?: string;
  /** Não notificar quem causou o fato (o operador que digitou a resposta). */
  excetoUserId?: string | null;
};

/** Devolve quantos aparelhos receberam. Nunca lança: push é aviso, não fluxo. */
export async function enviarPushImediato(p: PushImediato): Promise<number> {
  try {
    if (!configurarVapid()) return 0;

    const tenant = await basePrisma.tenant.findFirst({
      where: { id: p.tenantId, status: { in: ["TRIAL", "ACTIVE"] } },
      select: { pushHoraInicio: true, pushHoraFim: true },
    });
    if (!tenant) return 0;
    const h = horaLocal();
    const inicio = tenant.pushHoraInicio ?? HORA_INICIO;
    const fim = tenant.pushHoraFim ?? HORA_FIM;
    // Fora da janela o sino guarda a notícia; o cron da manhã a leva.
    if (h < inicio || h >= fim) return 0;

    const agora = new Date();
    const inscricoes = (await comTenant(
      p.tenantId,
      basePrisma.pushSubscription.findMany({
        where: {
          OR: [{ silenciadoAte: null }, { silenciadoAte: { lt: agora } }],
          ...(p.excetoUserId ? { userId: { not: p.excetoUserId } } : {}),
        },
        select: {
          id: true,
          userId: true,
          endpoint: true,
          p256dh: true,
          auth: true,
          alertasEnviados: true,
          falhas: true,
          silenciadoAte: true,
        },
      }),
    )) as Inscricao[];
    if (inscricoes.length === 0) return 0;

    const userIds = [...new Set(inscricoes.map((i) => i.userId))];
    const memberships = await comTenant(
      p.tenantId,
      basePrisma.membership.findMany({
        where: { userId: { in: userIds }, ativo: true },
        select: { userId: true, acessos: { select: { perfil: true, siteId: true } } },
      }),
    );
    const autorizados = new Set(
      memberships
        .filter((m) => can(parseAcessosJson(m.acessos), p.permissao, p.siteId))
        .map((m) => m.userId),
    );

    const payload = JSON.stringify({ ...p.mensagem, prioridade: "alto" });
    let enviadas = 0;
    for (const inscricao of inscricoes) {
      if (!autorizados.has(inscricao.userId)) continue;
      if (p.alertaId && inscricao.alertasEnviados.includes(p.alertaId)) continue;
      try {
        await webpush.sendNotification(
          { endpoint: inscricao.endpoint, keys: { p256dh: inscricao.p256dh, auth: inscricao.auth } },
          payload,
        );
        enviadas += 1;
        await comTenant(
          p.tenantId,
          basePrisma.pushSubscription.updateMany({
            where: { id: inscricao.id },
            data: {
              falhas: 0,
              ultimoEnvio: new Date(),
              ...(p.alertaId
                ? { alertasEnviados: [...inscricao.alertasEnviados, p.alertaId] }
                : {}),
            },
          }),
        );
      } catch (e) {
        const status = e instanceof WebPushError ? e.statusCode : 0;
        if (status === 404 || status === 410) {
          await comTenant(
            p.tenantId,
            basePrisma.pushSubscription.deleteMany({ where: { id: inscricao.id } }),
          );
        }
        // Outras falhas ficam para o cron contar — ele é quem aposenta aparelho.
      }
    }
    return enviadas;
  } catch {
    return 0;
  }
}
