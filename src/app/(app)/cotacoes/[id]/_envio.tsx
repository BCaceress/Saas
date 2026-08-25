"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowDown,
  CalendarClock,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Mail,
  MessageCircle,
  UserPlus,
  Users,
} from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { copiarTexto } from "@/lib/clipboard";
import { maskPhone } from "@/lib/masks";
import { ContatoSheet } from "@/components/app/contato-fornecedor";
import { SupplierAvatar } from "../_ui";
import type { ConviteCotacao, ContatoConvite } from "../_compra-types";
import {
  confirmarEnvioAction,
  prepararEnvioAction,
  type EnvioPreparado,
} from "../_compra-actions";

// ── Central de envio da cotação ─────────────────────────────
// Duas regras seguram esta tela inteira.
//
// 1. A cotação vai para uma PESSOA. O fornecedor é só o agrupador: o WhatsApp
//    e o e-mail usados no disparo saem do CONTATO escolhido, nunca do cadastro
//    da empresa — aquele telefone é do fiscal ou de um 0800, e cotação mandada
//    para lá some sem ninguém perceber. Sem contato com o dado do canal, o
//    envio não acontece: a tela pede outro contato ou o cadastro de um novo.
//
// 2. O NoHub NÃO manda a mensagem. Ele monta o link de resposta e o texto e
//    abre o WhatsApp ou o cliente de e-mail do operador. Quem sabe se a
//    mensagem saiu é ele — por isso "enviado" só existe depois da confirmação
//    explícita, contato por contato.
//
// Daí o desenho: uma FILA. Por fornecedor, os contatos escolhidos; por
// contato, uma ação principal só.
//
//   escolher contatos → abrir o app → enviar → confirmar → próximo contato
//
// WhatsApp é conversa individual: cada contato é um disparo, e a fila anda
// "1 de 3". E-mail tem Para e CC no mesmo envelope: um disparo só, com a
// cópia registrada na trilha.
//
// "Enviado" quer dizer "o operador confirmou que mandou". Nunca "o fornecedor
// respondeu" — são duas colunas diferentes da mesma vida.

type Canal = "whatsapp" | "email";

/** Um disparo já confirmado, por contato. */
type Feito = { canal: Canal; em: string; copias: string | null };

type Estado = {
  canal: Canal;
  /** WhatsApp: quem recebe. Cada um é um disparo. */
  selecionados: string[];
  /** E-mail: o destinatário do campo Para. Um só. */
  paraId: string | null;
  /** E-mail: quem entra em cópia. */
  ccIds: string[];
  /** Confirmados, por contactId. */
  feitos: Record<string, Feito>;
  /** Contato cuja pergunta "você enviou?" está na tela. */
  perguntando: string | null;
};

const CANAL_ROTULO: Record<Canal, string> = { whatsapp: "WhatsApp", email: "E-mail" };

const temFone = (c: ContatoConvite) => Boolean(c.telefone?.trim());
const temMail = (c: ContatoConvite) => Boolean(c.email?.trim());
/** O dado que o canal exige — a única porta de saída de cada um. */
const serve = (c: ContatoConvite, canal: Canal) => (canal === "whatsapp" ? temFone(c) : temMail(c));

/** "hoje às 11:24" / "22/08 às 09:10" — o dia só aparece quando não é hoje. */
function quando(iso: string): string {
  const d = new Date(iso);
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const hoje = new Date();
  const mesmoDia =
    d.getDate() === hoje.getDate() &&
    d.getMonth() === hoje.getMonth() &&
    d.getFullYear() === hoje.getFullYear();
  return mesmoDia
    ? `hoje às ${hora}`
    : `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} às ${hora}`;
}

/**
 * Sugestão de quem já vem marcado: o principal, se ele tiver o dado do canal;
 * senão o primeiro que tiver. É sugestão, não decisão — marcar todo mundo
 * mandaria a cotação para gente que o comprador não escolheu.
 */
function sugerido(contatos: ContatoConvite[], canal: Canal): string | null {
  const uteis = contatos.filter((c) => serve(c, canal));
  return (uteis.find((c) => c.principal) ?? uteis[0])?.id ?? null;
}

export function EnvioSheet({
  alvos,
  reenvio = false,
  prazoAtual,
  onFechar,
  onConcluir,
}: {
  /** Convites que vão receber agora. */
  alvos: ConviteCotacao[];
  /** Reenvio: quem já recebeu volta para a fila com um link novo. */
  reenvio?: boolean;
  prazoAtual: string | null;
  onFechar: () => void;
  /** Fechou depois de mandar — a tela de trás recarrega. */
  onConcluir: () => void;
}) {
  const router = useRouter();
  const [trabalhando, setTrabalhando] = useState<string | null>(null);
  const [erro, setErro] = useState<Record<string, string | null>>({});
  const [, start] = useTransition();
  /** Contatos cadastrados aqui dentro — a folha não recarrega ao salvar. */
  const [novos, setNovos] = useState<Record<string, ContatoConvite[]>>({});
  const [cadastrando, setCadastrando] = useState<ConviteCotacao | null>(null);
  const cartoes = useRef<Record<string, HTMLLIElement | null>>({});
  const [destacado, setDestacado] = useState<string | null>(null);
  /** O que já foi montado por fornecedor: mensagem, link e endereço do canal. */
  const [previa, setPrevia] = useState<Record<string, EnvioPreparado>>({});
  /** Fornecedor com a mensagem aberta na tela. */
  const [vendo, setVendo] = useState<string | null>(null);
  /** Fornecedores concluídos que o operador recolheu. */
  const [recolhidos, setRecolhidos] = useState<Record<string, boolean>>({});
  const [copiado, setCopiado] = useState<string | null>(null);
  /** Saída com trabalho pela metade — pergunta antes. */
  const [confirmandoSaida, setConfirmandoSaida] = useState(false);
  /**
   * Fornecedor que acabou de ser fechado. Só ele mostra o "Próximo fornecedor"
   * — repetido em cada card concluído viraria uma coluna de botões idênticos
   * apontando todos para o mesmo lugar.
   */
  const [ultimoConcluido, setUltimoConcluido] = useState<string | null>(null);

  /**
   * Ordem da fila, congelada na abertura: pendentes primeiro.
   *
   * Congelada de propósito. Reordenar a cada confirmação faria o cartão que
   * acabou de ser marcado saltar para o fim da lista embaixo do cursor — e o
   * próximo subir para o lugar onde o operador ainda está olhando.
   */
  const [ordem] = useState(() =>
    [...alvos].sort((a, b) => {
      const feito = (c: ConviteCotacao) =>
        !reenvio && c.status !== "PENDENTE" && c.envios.some((e) => e.sucesso) ? 1 : 0;
      return feito(a) - feito(b);
    }),
  );

  const contatosDe = useMemo(
    () => (c: ConviteCotacao) => [...c.contatos, ...(novos[c.supplierId] ?? [])],
    [novos],
  );

  const [estados, setEstados] = useState<Record<string, Estado>>(() => {
    const inicial: Record<string, Estado> = {};
    for (const c of alvos) {
      // Reenvio recoloca todo mundo na fila: o link antigo vai ser trocado, e
      // "já enviado" seria sobre uma mensagem que não vale mais.
      const feitos: Record<string, Feito> = {};
      if (!reenvio) {
        for (const e of c.envios) {
          if (!e.sucesso || !e.contactId) continue;
          const canal: Canal = e.canal === "EMAIL" ? "email" : "whatsapp";
          // `envios` vem do mais novo para o mais velho: o primeiro manda.
          if (!feitos[e.contactId]) {
            feitos[e.contactId] = { canal, em: e.enviadoEm, copias: e.copias };
          }
        }
      }
      const canal: Canal = c.contatos.some(temFone) ? "whatsapp" : "email";
      const wa = sugerido(c.contatos, "whatsapp");
      const mail = sugerido(c.contatos, "email");
      inicial[c.id] = {
        canal,
        selecionados: wa && !feitos[wa] ? [wa] : [],
        paraId: mail && !feitos[mail] ? mail : (mail ?? null),
        ccIds: [],
        feitos,
        perguntando: null,
      };
    }
    return inicial;
  });

  function mexer(id: string, patch: Partial<Estado>) {
    setEstados((e) => ({ ...e, [id]: { ...e[id], ...patch } }));
  }

  /**
   * Canal em vigor. Com um só disponível ele manda, mesmo que o estado tenha
   * ficado no outro (o operador escolheu e-mail, depois o único contato com
   * e-mail saiu). É a mesma conta que o cartão faz — precisa ser uma só, ou a
   * fila conta uns contatos e a tela mostra outros.
   */
  function canalDe(c: ConviteCotacao): Canal {
    const contatos = contatosDe(c);
    const wa = contatos.some(temFone);
    const mail = contatos.some(temMail);
    if (wa && mail) return estados[c.id]?.canal ?? "whatsapp";
    return wa ? "whatsapp" : "email";
  }

  /** Contatos que este fornecedor tem para o disparo, na ordem da tela. */
  function fila(c: ConviteCotacao): ContatoConvite[] {
    const e = estados[c.id];
    const contatos = contatosDe(c);
    if (canalDe(c) === "email") {
      const para = contatos.find((x) => x.id === e?.paraId);
      return para ? [para] : [];
    }
    return contatos.filter((x) => e?.selecionados.includes(x.id));
  }

  /** Quem, na fila deste fornecedor, ainda não foi confirmado. */
  function pendentesDe(c: ConviteCotacao): ContatoConvite[] {
    const feitos = estados[c.id]?.feitos ?? {};
    return fila(c).filter((x) => !feitos[x.id]);
  }

  // Progresso pela FILA, não pelos fornecedores: com três contatos num
  // fornecedor e um noutro, "1 de 2 fornecedores" esconderia dois disparos.
  const totalFila = alvos.reduce((n, c) => n + fila(c).length, 0);
  const totalFeitos = alvos.reduce(
    (n, c) => n + fila(c).filter((x) => estados[c.id]?.feitos[x.id]).length,
    0,
  );
  const tudoEnviado = totalFila > 0 && totalFeitos === totalFila;

  /** Fornecedor que a fila está esperando — ganha a borda de destaque. */
  const vezDe = alvos.find((c) => pendentesDe(c).length > 0)?.id ?? null;

  function proximoFornecedor(depoisDe: string): ConviteCotacao | null {
    const i = alvos.findIndex((c) => c.id === depoisDe);
    const adiante = alvos.slice(i + 1).find((c) => pendentesDe(c).length > 0);
    if (adiante) return adiante;
    return alvos.find((c) => c.id !== depoisDe && pendentesDe(c).length > 0) ?? null;
  }

  function irPara(id: string) {
    cartoes.current[id]?.scrollIntoView({ block: "center", behavior: "smooth" });
    setDestacado(id);
    window.setTimeout(() => setDestacado((d) => (d === id ? null : d)), 1600);
  }

  /**
   * Monta o disparo de UM contato — mensagem, link e endereço do canal.
   *
   * `abrirApp` separa os dois usos: espiar o texto antes de mandar (o operador
   * quer saber o que vai sair antes de sair) e disparar de fato. Nenhum dos
   * dois muda status: quem decide se a mensagem saiu é ele, na pergunta.
   */
  function preparar(c: ConviteCotacao, contato: ContatoConvite, abrirApp: boolean) {
    const e = estados[c.id];
    const canal = canalDe(c);
    setErro((x) => ({ ...x, [c.id]: null }));
    setTrabalhando(c.id);
    start(async () => {
      try {
        const p = await prepararEnvioAction({
          conviteId: c.id,
          canal,
          contactId: contato.id,
          copiaIds: canal === "email" ? (e?.ccIds ?? []) : [],
        });
        setPrevia((x) => ({ ...x, [c.id]: p }));
        if (!abrirApp) {
          setVendo(c.id);
          return;
        }
        if (!p.url) {
          setErro((x) => ({ ...x, [c.id]: p.impedimento ?? "Não há para onde enviar." }));
          return;
        }
        // WhatsApp em aba nova (é web ou app); e-mail troca a navegação, que é
        // como o `mailto:` acorda o cliente do sistema sem deixar aba órfã.
        if (canal === "email") window.location.href = p.url;
        else window.open(p.url, "_blank", "noopener,noreferrer");
        mexer(c.id, { perguntando: contato.id });
      } catch (err) {
        setErro((x) => ({
          ...x,
          [c.id]: err instanceof Error ? err.message : "Não foi possível preparar o envio.",
        }));
      } finally {
        setTrabalhando(null);
      }
    });
  }

  /** Copia com aviso — o botão diz "copiado" e volta ao normal sozinho. */
  function copiar(chave: string, texto: string) {
    void copiarTexto(texto).then((ok) => {
      if (!ok) return;
      setCopiado(chave);
      window.setTimeout(() => setCopiado((k) => (k === chave ? null : k)), 1600);
    });
  }

  /** O operador confirma que mandou para este contato. Só aqui vira "enviado". */
  function confirmar(c: ConviteCotacao, contato: ContatoConvite) {
    const e = estados[c.id];
    const canal = canalDe(c);
    const contatos = contatosDe(c);
    const copias =
      canal === "email"
        ? contatos
            .filter((x) => e?.ccIds.includes(x.id) && x.id !== contato.id && temMail(x))
            .map((x) => `${x.nome} <${x.email}>`)
            .join("; ")
        : "";
    setErro((x) => ({ ...x, [c.id]: null }));
    setTrabalhando(c.id);
    start(async () => {
      try {
        const { enviadoEm } = await confirmarEnvioAction({
          conviteId: c.id,
          canal,
          contactId: contato.id,
          contatoNome: contato.nome,
          destino: canal === "email" ? contato.email : contato.telefone,
          copias: copias || null,
          reenvio,
        });
        setEstados((s) => ({
          ...s,
          [c.id]: {
            ...s[c.id],
            feitos: {
              ...s[c.id].feitos,
              [contato.id]: { canal, em: enviadoEm, copias: copias || null },
            },
            perguntando: null,
          },
        }));
        setVendo((v) => (v === c.id ? null : v));
        // Acabou este fornecedor? Ele se recolhe e o caminho segue no próximo.
        const restam = fila(c).filter((x) => x.id !== contato.id && !estados[c.id]?.feitos[x.id]);
        if (restam.length === 0) {
          setRecolhidos((r) => ({ ...r, [c.id]: true }));
          setUltimoConcluido(c.id);
          const proximo = proximoFornecedor(c.id);
          if (proximo) irPara(proximo.id);
        }
        // Sem `router.refresh()` aqui de propósito. A confirmação muda a
        // cotação de RASCUNHO para ABERTA, e recarregar no meio da fila trocaria
        // a página inteira embaixo do painel a cada contato marcado. A tela de
        // trás se atualiza quando o painel fecha — o estado da fila é local e
        // não depende do servidor para continuar.
      } catch (err) {
        setErro((x) => ({
          ...x,
          [c.id]: err instanceof Error ? err.message : "Não foi possível marcar como enviado.",
        }));
      } finally {
        setTrabalhando(null);
      }
    });
  }

  /**
   * Fechar com fila pela metade pergunta antes. Sair achando que mandou e
   * descobrir três dias depois que dois fornecedores nunca receberam é o erro
   * que este painel existe para evitar.
   */
  function tentarFechar() {
    if (totalFeitos > 0 && totalFeitos < totalFila) {
      setConfirmandoSaida(true);
      return;
    }
    onFechar();
    router.refresh();
  }

  return (
    <>
      <Sheet
        open
        onClose={tentarFechar}
        width="lg"
        title={reenvio ? "Reenviar cotação" : "Enviar cotação"}
        description={
          reenvio
            ? "Mande de novo para quem ainda não respondeu. O link antigo deixa de valer."
            : "Envie a solicitação para cada contato pelo canal escolhido."
        }
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p
              aria-live="polite"
              className={cn("text-[13px]", tudoEnviado ? "text-ok" : "text-muted")}
            >
              {tudoEnviado ? (
                <span className="flex items-center gap-1.5 font-medium">
                  <Check size={14} />
                  Todos os envios concluídos
                </span>
              ) : (
                <>
                  <span className="font-mono tabular-nums">{totalFeitos}</span> de{" "}
                  <span className="font-mono tabular-nums">{totalFila}</span>{" "}
                  {totalFila === 1 ? "contato enviado" : "contatos enviados"}
                </>
              )}
            </p>
            <button
              type="button"
              onClick={() => {
                if (tudoEnviado) {
                  onConcluir();
                  router.refresh();
                } else tentarFechar();
              }}
              className={cn(
                "cursor-pointer rounded-full px-5 py-2 text-sm font-semibold transition-colors",
                tudoEnviado
                  ? "bg-brand text-on-brand hover:bg-brand-strong"
                  : "border border-line text-ink hover:bg-surface-2",
              )}
            >
              {tudoEnviado ? "Concluir" : "Fechar"}
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <Progresso feitos={totalFeitos} total={totalFila} />

          {reenvio && prazoAtual && (
            <p className="flex items-start gap-2 rounded-[var(--radius)] border border-line bg-surface-2 px-3 py-2 text-[12px] text-ink-2">
              <CalendarClock size={13} className="mt-0.5 shrink-0 text-faint" />
              O prazo de resposta continua {new Date(prazoAtual).toLocaleDateString("pt-BR")}.
              Para esticá-lo, mude a data na cotação antes de reenviar.
            </p>
          )}

          {/* Sem prazo, a mensagem sai sem data e o fornecedor responde quando
              quiser. Vale dizer AGORA — depois de mandar não dá para corrigir
              o que já está no WhatsApp dele. */}
          {!prazoAtual && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] border border-accent/40 bg-accent-soft px-3 py-2">
              <p className="flex items-start gap-2 text-[12px] text-ink-2">
                <AlertTriangle size={13} className="mt-0.5 shrink-0 text-accent" />
                Esta cotação não tem prazo de resposta — o fornecedor não vai saber até quando.
              </p>
              <button
                type="button"
                onClick={tentarFechar}
                className="shrink-0 cursor-pointer text-[12px] font-medium text-accent underline-offset-2 hover:underline"
              >
                Definir o prazo
              </button>
            </div>
          )}

          {tudoEnviado && <TudoEnviado alvos={ordem} estados={estados} contatosDe={contatosDe} />}

          <ul className="flex flex-col gap-2.5">
            {ordem.map((c) => (
              <CartaoFornecedor
                key={c.id}
                ref={(el) => {
                  cartoes.current[c.id] = el;
                }}
                convite={c}
                contatos={contatosDe(c)}
                estado={estados[c.id]}
                erro={erro[c.id] ?? null}
                trabalhando={trabalhando === c.id}
                destacado={destacado === c.id}
                vezDele={vezDe === c.id}
                previa={previa[c.id] ?? null}
                vendo={vendo === c.id}
                recolhido={Boolean(recolhidos[c.id])}
                mostrarProximo={ultimoConcluido === c.id}
                copiado={copiado}
                onMexer={(patch) => mexer(c.id, patch)}
                onAbrir={(contato) => preparar(c, contato, true)}
                onVer={(contato) =>
                  vendo === c.id ? setVendo(null) : preparar(c, contato, false)
                }
                onCopiar={copiar}
                onConfirmar={(contato) => confirmar(c, contato)}
                onCadastrar={() => setCadastrando(c)}
                onRecolher={() => setRecolhidos((r) => ({ ...r, [c.id]: !r[c.id] }))}
                proximo={proximoFornecedor(c.id)}
                onIrPara={irPara}
              />
            ))}
          </ul>
        </div>
      </Sheet>

      {confirmandoSaida && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-ink/30 p-0 sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="sair-envio-titulo"
            className="w-full max-w-md rounded-t-[var(--radius-xl)] border border-line bg-surface p-5 shadow-[var(--shadow-float)] sm:rounded-[var(--radius-xl)]"
          >
            <h2 id="sair-envio-titulo" className="font-display text-[17px] font-semibold text-ink">
              Ainda faltam envios
            </h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
              {totalFila - totalFeitos}{" "}
              {totalFila - totalFeitos === 1
                ? "contato ainda não recebeu"
                : "contatos ainda não receberam"}{" "}
              esta cotação. O que já foi enviado continua gravado — dá para voltar aqui e
              terminar depois.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                autoFocus
                onClick={() => setConfirmandoSaida(false)}
                className="cursor-pointer rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
              >
                Continuar enviando
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmandoSaida(false);
                  onFechar();
                  router.refresh();
                }}
                className="cursor-pointer rounded-full border border-line px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
              >
                Fechar mesmo assim
              </button>
            </div>
          </div>
        </div>
      )}

      {cadastrando && (
        <ContatoSheet
          aberto
          supplierId={cadastrando.supplierId}
          primeiro={contatosDe(cadastrando).length === 0}
          onFechar={() => setCadastrando(null)}
          onSalvo={(salvo) => {
            const convite = cadastrando;
            const contato: ContatoConvite = {
              id: salvo.id,
              nome: salvo.nome,
              cargo: salvo.cargo,
              telefone: salvo.telefone,
              email: salvo.email,
              principal: salvo.principal,
            };
            // Entra na lista e já assume o envio: quem cadastra o vendedor no
            // meio do disparo quer mandar para ele agora.
            setNovos((n) => ({
              ...n,
              [convite.supplierId]: [...(n[convite.supplierId] ?? []), contato],
            }));
            setEstados((s) => {
              const e = s[convite.id];
              const canal: Canal = serve(contato, e.canal)
                ? e.canal
                : temFone(contato)
                  ? "whatsapp"
                  : "email";
              return {
                ...s,
                [convite.id]: {
                  ...e,
                  canal,
                  selecionados:
                    canal === "whatsapp" && temFone(contato)
                      ? [...new Set([...e.selecionados, contato.id])]
                      : e.selecionados,
                  paraId:
                    canal === "email" && temMail(contato) && !e.paraId ? contato.id : e.paraId,
                  perguntando: null,
                },
              };
            });
            setCadastrando(null);
          }}
        />
      )}
    </>
  );
}

// ── Cartão de um fornecedor ─────────────────────────────────

function CartaoFornecedor({
  ref,
  convite: c,
  contatos,
  estado: e,
  erro,
  trabalhando,
  destacado,
  vezDele,
  previa,
  vendo,
  recolhido,
  mostrarProximo,
  copiado,
  onMexer,
  onAbrir,
  onVer,
  onCopiar,
  onConfirmar,
  onCadastrar,
  onRecolher,
  proximo,
  onIrPara,
}: {
  ref: (el: HTMLLIElement | null) => void;
  convite: ConviteCotacao;
  contatos: ContatoConvite[];
  estado: Estado | undefined;
  erro: string | null;
  trabalhando: boolean;
  destacado: boolean;
  vezDele: boolean;
  /** Último disparo montado para este fornecedor — mensagem, link, endereço. */
  previa: EnvioPreparado | null;
  vendo: boolean;
  recolhido: boolean;
  /** Só o fornecedor recém-fechado convida a ir para o próximo. */
  mostrarProximo: boolean;
  /** Chave do botão que acabou de copiar, para o aviso de "copiado". */
  copiado: string | null;
  onMexer: (patch: Partial<Estado>) => void;
  onAbrir: (contato: ContatoConvite) => void;
  onVer: (contato: ContatoConvite) => void;
  onCopiar: (chave: string, texto: string) => void;
  onConfirmar: (contato: ContatoConvite) => void;
  onCadastrar: () => void;
  onRecolher: () => void;
  proximo: ConviteCotacao | null;
  onIrPara: (id: string) => void;
}) {
  const feitos = e?.feitos ?? {};
  const podeWhats = contatos.some(temFone);
  const podeMail = contatos.some(temMail);
  // Com um canal só, ele manda — o estado pode ter ficado no outro depois de
  // um contato novo entrar ou sair.
  const canal: Canal = podeWhats && podeMail ? (e?.canal ?? "whatsapp") : podeWhats ? "whatsapp" : "email";

  const escolhidos =
    canal === "email"
      ? contatos.filter((x) => x.id === e?.paraId)
      : contatos.filter((x) => e?.selecionados.includes(x.id));
  const pendentes = escolhidos.filter((x) => !feitos[x.id]);
  const enviadosAqui = escolhidos.length - pendentes.length;

  const semContatos = contatos.length === 0;
  const concluido = escolhidos.length > 0 && pendentes.length === 0;
  // A fila do WhatsApp anda de um em um: o botão diz em qual passo está.
  const alvo = pendentes[0] ?? null;
  const posicao = alvo ? escolhidos.findIndex((x) => x.id === alvo.id) + 1 : 0;

  return (
    <li
      ref={ref}
      className={cn(
        "rounded-[var(--radius-lg)] border transition-colors",
        concluido
          ? "border-ok/40 bg-ok-soft/40"
          : destacado
            ? "border-brand bg-brand-soft/40"
            : vezDele
              ? "border-brand/40 bg-surface"
              : "border-line bg-surface",
      )}
    >
      {/* Nome e contagem na MESMA linha: são a mesma pergunta ("como está este
          fornecedor?") e ocupavam duas. Concluído, a linha inteira vira o
          botão que recolhe — numa fila de oito, o que já foi não precisa da
          mesma altura do que falta. */}
      <div className="flex items-center gap-2 px-3 py-2">
        <SupplierAvatar nome={c.supplierNome} logoUrl={c.supplierLogoUrl} size={26} />
        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">
          {c.supplierNome}
          <span
            className={cn(
              "ml-1.5 text-[11px] font-normal",
              concluido ? "text-ok" : enviadosAqui > 0 ? "text-brand" : "text-faint",
            )}
          >
            {semContatos
              ? "sem contatos"
              : escolhidos.length === 0
                ? "ninguém escolhido"
                : `${enviadosAqui}/${escolhidos.length}`}
          </span>
        </p>
        <Etiqueta
          concluido={concluido}
          andando={enviadosAqui > 0 && !concluido}
          semContatos={semContatos}
        />
        {concluido && (
          <button
            type="button"
            onClick={onRecolher}
            aria-expanded={!recolhido}
            aria-label={recolhido ? `Abrir ${c.supplierNome}` : `Recolher ${c.supplierNome}`}
            className="grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            {recolhido ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        )}
      </div>

      {concluido && recolhido ? null : semContatos ? (
        // Sem contato NÃO existe fallback para o cadastro da empresa: o
        // telefone do fornecedor é do fiscal, e mandar para lá é perder a
        // cotação em silêncio.
        <div className="flex flex-col items-start gap-2 border-t border-line px-3 py-3">
          <p className="text-[13px] font-medium text-ink">Nenhum contato disponível</p>
          <p className="text-[12px] text-muted">
            Este fornecedor ainda não possui contatos para envio. A cotação vai para uma pessoa,
            não para a empresa.
          </p>
          <button
            type="button"
            onClick={onCadastrar}
            className="flex cursor-pointer items-center gap-1.5 rounded-full bg-accent px-3.5 py-2 text-[13px] font-semibold text-on-brand transition-colors hover:opacity-90"
          >
            <UserPlus size={14} />
            Adicionar contato
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 border-t border-line px-3 py-2.5">
          {/* A escolha de canal só existe quando há escolha. Com os contatos
              deste fornecedor só tendo WhatsApp, um par de botões com metade
              apagada é uma pergunta já respondida ocupando uma linha. */}
          {podeWhats && podeMail && (
            <div className="flex gap-1 rounded-full border border-line bg-surface-2 p-0.5">
              <BotaoCanal
                ativo={canal === "whatsapp"}
                // Verde só quando o botão está apagado: ativo, o fundo é da
                // marca e o ícone precisa contrastar com ele.
                icone={
                  <MessageCircle
                    size={13}
                    className={canal === "whatsapp" ? undefined : "text-whatsapp"}
                  />
                }
                rotulo="WhatsApp"
                titulo="Uma conversa por contato"
                onClick={() => onMexer({ canal: "whatsapp", perguntando: null })}
              />
              <BotaoCanal
                ativo={canal === "email"}
                icone={<Mail size={13} />}
                rotulo="E-mail"
                titulo="Um envelope, com cópia"
                onClick={() => onMexer({ canal: "email", perguntando: null })}
              />
            </div>
          )}

          {canal === "whatsapp" ? (
            <ListaWhatsApp
              contatos={contatos}
              selecionados={e?.selecionados ?? []}
              feitos={feitos}
              onAlternar={(id) => {
                const atual = e?.selecionados ?? [];
                onMexer({
                  selecionados: atual.includes(id)
                    ? atual.filter((x) => x !== id)
                    : [...atual, id],
                  perguntando: null,
                });
              }}
            />
          ) : (
            <ListaEmail
              contatos={contatos}
              paraId={e?.paraId ?? null}
              ccIds={e?.ccIds ?? []}
              feitos={feitos}
              onPara={(id) =>
                onMexer({
                  paraId: id,
                  ccIds: (e?.ccIds ?? []).filter((x) => x !== id),
                  perguntando: null,
                })
              }
              onCc={(id) => {
                const atual = e?.ccIds ?? [];
                onMexer({
                  ccIds: atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id],
                  perguntando: null,
                });
              }}
            />
          )}

          <button
            type="button"
            onClick={onCadastrar}
            className="cursor-pointer self-start rounded-[var(--radius-sm)] px-1.5 text-left text-[12px] font-medium text-brand transition-colors hover:underline"
          >
            + Adicionar contato
          </button>

          {erro && (
            <p className="flex items-start gap-1.5 text-[12px] text-danger">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {erro}
            </p>
          )}

          {/* A pergunta que separa "abri o WhatsApp" de "mandei". Só ela vira
              o status. */}
          {/* O texto que vai sair, antes de sair. Sem isso o operador aperta o
              botão sem saber o que está mandando — e descobre o prazo em
              branco na conversa do fornecedor. */}
          {vendo && previa && (
            <div className="flex flex-col gap-1.5 rounded-[var(--radius)] border border-line bg-surface-2 p-2.5">
              <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-ink-2">
                {previa.mensagem}
              </p>
              <div className="flex flex-wrap gap-1.5 border-t border-line pt-1.5">
                <BotaoCopiar
                  chave={`msg:${c.id}`}
                  copiado={copiado}
                  rotulo="Copiar mensagem"
                  onClick={() => onCopiar(`msg:${c.id}`, previa.mensagem)}
                />
                {previa.link && (
                  <BotaoCopiar
                    chave={`link:${c.id}`}
                    copiado={copiado}
                    rotulo="Copiar link"
                    onClick={() => onCopiar(`link:${c.id}`, previa.link!)}
                  />
                )}
                {previa.destino && (
                  <BotaoCopiar
                    chave={`dest:${c.id}`}
                    copiado={copiado}
                    rotulo={canal === "email" ? "Copiar e-mail" : "Copiar número"}
                    onClick={() => onCopiar(`dest:${c.id}`, previa.destino!)}
                  />
                )}
              </div>
            </div>
          )}

          {e?.perguntando ? (
            <Confirmacao
              contato={contatos.find((x) => x.id === e.perguntando) ?? null}
              canal={canal}
              previa={previa}
              copiado={copiado}
              trabalhando={trabalhando}
              onCopiar={onCopiar}
              onSim={(contato) => onConfirmar(contato)}
              onNao={() => onMexer({ perguntando: null })}
            />
          ) : concluido ? (
            <p className="flex items-center gap-1.5 text-[12px] font-medium text-ok">
              <CheckCheck size={13} />
              Todos os contatos escolhidos foram enviados.
            </p>
          ) : escolhidos.length === 0 ? (
            <p className="flex items-start gap-1.5 text-[12px] text-muted">
              <Users size={13} className="mt-0.5 shrink-0 text-faint" />
              {canal === "whatsapp"
                ? "Marque quem vai receber no WhatsApp."
                : "Escolha o destinatário do campo Para."}
            </p>
          ) : (
            alvo && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <button
                  type="button"
                  onClick={() => onAbrir(alvo)}
                  disabled={trabalhando}
                  className="flex cursor-pointer items-center justify-center gap-1.5 rounded-full bg-brand px-4 py-2 text-[13px] font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {canal === "email" ? <Mail size={14} /> : <MessageCircle size={14} />}
                  {trabalhando
                    ? "Preparando…"
                    : canal === "email"
                      ? "Abrir e-mail"
                      : `Abrir WhatsApp · ${posicao} de ${escolhidos.length}`}
                  <ExternalLink size={12} className="opacity-70" />
                </button>

                <button
                  type="button"
                  onClick={() => onVer(alvo)}
                  disabled={trabalhando}
                  aria-expanded={vendo}
                  className="cursor-pointer text-[12px] font-medium text-muted underline-offset-2 transition-colors hover:text-ink hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {vendo ? "Ocultar mensagem" : "Ver mensagem"}
                </button>

                {/* Mandou por outro caminho (ligou, mandou do celular, colou
                    num grupo): o trabalho aconteceu e a trilha precisa saber.
                    Sem isso o único caminho até "enviado" passa por abrir o
                    app de novo — e o operador acaba deixando a fila mentindo. */}
                <button
                  type="button"
                  onClick={() => onConfirmar(alvo)}
                  disabled={trabalhando}
                  title={`Registrar que ${alvo.nome} já recebeu, sem abrir o aplicativo`}
                  className="cursor-pointer text-[12px] font-medium text-muted underline-offset-2 transition-colors hover:text-ink hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Já enviei
                </button>
              </div>
            )
          )}
        </div>
      )}

      {/* Depois de fechar este fornecedor, para onde ir agora. Quem manda para
          oito não deveria ter de procurar o próximo na lista. */}
      {concluido && mostrarProximo && proximo && (
        <button
          type="button"
          onClick={() => onIrPara(proximo.id)}
          className="flex w-full cursor-pointer items-center justify-center gap-1.5 border-t border-ok/30 px-3 py-2 text-[12px] font-medium text-brand transition-colors hover:bg-brand-soft/50"
        >
          Próximo fornecedor
          <ArrowDown size={12} />
        </button>
      )}
    </li>
  );
}

// ── Listas de contato ───────────────────────────────────────

function ListaWhatsApp({
  contatos,
  selecionados,
  feitos,
  onAlternar,
}: {
  contatos: ContatoConvite[];
  selecionados: string[];
  feitos: Record<string, Feito>;
  onAlternar: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="px-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
        Contatos para envio
      </span>
      <ul>
        {contatos.map((ct) => {
          const feito = feitos[ct.id];
          const podeReceber = temFone(ct);
          const marcado = selecionados.includes(ct.id);
          return (
            <li key={ct.id}>
              <LinhaContato
                contato={ct}
                canal="whatsapp"
                feito={feito}
                bloqueado={!podeReceber}
                marcado={marcado}
                forma="caixa"
                onClick={() => podeReceber && !feito && onAlternar(ct.id)}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ListaEmail({
  contatos,
  paraId,
  ccIds,
  feitos,
  onPara,
  onCc,
}: {
  contatos: ContatoConvite[];
  paraId: string | null;
  ccIds: string[];
  feitos: Record<string, Feito>;
  onPara: (id: string) => void;
  onCc: (id: string) => void;
}) {
  const comEmail = contatos.filter(temMail);
  const semEmail = contatos.filter((c) => !temMail(c));
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-col gap-0.5">
        <span className="px-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
          Para
        </span>
        <ul>
          {comEmail.map((ct) => (
            <li key={ct.id}>
              <LinhaContato
                contato={ct}
                canal="email"
                feito={feitos[ct.id]}
                bloqueado={false}
                marcado={paraId === ct.id}
                forma="ponto"
                onClick={() => onPara(ct.id)}
              />
            </li>
          ))}
          {comEmail.length === 0 && (
            <li className="px-1 py-1 text-[12px] text-accent">
              Nenhum contato deste fornecedor tem e-mail cadastrado.
            </li>
          )}
        </ul>
      </div>

      {comEmail.length > 1 && (
        <div className="flex flex-col gap-0.5">
          <span className="px-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
            Cópia
          </span>
          <ul>
            {comEmail
              .filter((ct) => ct.id !== paraId)
              .map((ct) => (
                <li key={ct.id}>
                  <LinhaContato
                    contato={ct}
                    canal="email"
                    feito={undefined}
                    bloqueado={false}
                    marcado={ccIds.includes(ct.id)}
                    forma="caixa"
                    onClick={() => onCc(ct.id)}
                  />
                </li>
              ))}
          </ul>
        </div>
      )}

      {/* Quem não tem e-mail continua visível, e o motivo junto: some da lista
          seria o operador procurando um contato que existe. */}
      {semEmail.map((ct) => (
        <p key={ct.id} className="px-1 text-[11px] text-faint">
          {ct.nome} · e-mail não cadastrado
        </p>
      ))}
    </div>
  );
}

function LinhaContato({
  contato: ct,
  canal,
  feito,
  bloqueado,
  marcado,
  forma,
  onClick,
}: {
  contato: ContatoConvite;
  canal: Canal;
  feito: Feito | undefined;
  bloqueado: boolean;
  marcado: boolean;
  /** Caixa = vários (WhatsApp, CC); ponto = um só (Para). */
  forma: "caixa" | "ponto";
  onClick: () => void;
}) {
  const dado = canal === "whatsapp" ? foneVisivel(ct) : ct.email;
  // Nome à esquerda, destino à direita, uma linha só. Empilhar nome e telefone
  // dobrava a altura de uma lista que o operador lê de relance para marcar.
  const conteudo = (
    <>
      <span
        aria-hidden
        className={cn(
          "grid h-4 w-4 shrink-0 place-items-center border",
          forma === "caixa" ? "rounded-[4px]" : "rounded-full",
          feito
            ? "border-ok bg-ok text-on-brand"
            : marcado && !bloqueado
              ? "border-brand bg-brand text-on-brand"
              : "border-line-strong",
        )}
      >
        {feito ? (
          <Check size={11} />
        ) : marcado && !bloqueado ? (
          forma === "caixa" ? (
            <Check size={11} />
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-surface" />
          )
        ) : null}
      </span>

      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
        {ct.nome}
        {ct.principal && <span className="ml-1 text-[10px] text-faint">principal</span>}
      </span>

      {feito ? (
        <span className="shrink-0 text-[11px] text-ok">
          {CANAL_ROTULO[feito.canal]} · {quando(feito.em)}
        </span>
      ) : dado ? (
        <span className="max-w-[45%] shrink-0 truncate font-mono text-[11px] text-muted">
          {dado}
        </span>
      ) : (
        <span className="shrink-0 text-[11px] text-accent">
          {canal === "whatsapp" ? "sem WhatsApp" : "sem e-mail"}
        </span>
      )}
    </>
  );

  // Contato já enviado ou sem o dado do canal não é alvo de clique: no
  // primeiro caso o trabalho está feito, no segundo não há para onde mandar.
  if (feito || bloqueado) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-[var(--radius-sm)] px-1.5 py-1",
          bloqueado && !feito && "opacity-60",
        )}
      >
        {conteudo}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={marcado}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-1.5 py-1 text-left transition-colors hover:bg-surface-2",
        marcado && "bg-surface-2",
      )}
    >
      {conteudo}
    </button>
  );
}

/** Telefone mascarado, quando existe. */
function foneVisivel(ct: ContatoConvite): string | null {
  return ct.telefone?.trim() ? maskPhone(ct.telefone) : null;
}

// ── Confirmação ─────────────────────────────────────────────

function Confirmacao({
  contato,
  canal,
  previa,
  copiado,
  trabalhando,
  onCopiar,
  onSim,
  onNao,
}: {
  contato: ContatoConvite | null;
  canal: Canal;
  previa: EnvioPreparado | null;
  copiado: string | null;
  trabalhando: boolean;
  onCopiar: (chave: string, texto: string) => void;
  onSim: (c: ContatoConvite) => void;
  onNao: () => void;
}) {
  if (!contato) return null;
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-brand/40 bg-brand-soft/40 p-2.5">
      <p className="text-[13px] font-medium text-ink">Você enviou esta cotação?</p>
      <p className="text-[11px] text-muted">
        Para <span className="font-medium text-ink-2">{contato.nome}</span>. Marque só depois de a
        mensagem ter saído de fato — isso não quer dizer que o fornecedor respondeu.
      </p>
      <div className="flex flex-wrap gap-2">
        {/* `autoFocus`: voltar do WhatsApp e apertar Enter fecha o passo, sem
            procurar o botão com o mouse. */}
        <button
          type="button"
          autoFocus
          onClick={() => onSim(contato)}
          disabled={trabalhando}
          className="flex cursor-pointer items-center gap-1.5 rounded-full bg-brand px-3.5 py-1.5 text-[13px] font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Check size={14} />
          {trabalhando ? "Marcando…" : "Sim, marcar como enviado"}
        </button>
        <button
          type="button"
          onClick={onNao}
          className="cursor-pointer rounded-full px-3 py-1.5 text-[13px] font-medium text-muted transition-colors hover:text-ink"
        >
          Não
        </button>
      </div>

      {/* Saída de emergência. `mailto:` sem cliente configurado não faz NADA —
          nem erro, nem aba: a tela parece travada. O WhatsApp Web também pode
          ser barrado por bloqueador de pop-up. Copiar resolve os dois. */}
      {previa && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-brand/30 pt-2">
          <span className="text-[11px] text-muted">
            {canal === "email" ? "O e-mail não abriu?" : "O WhatsApp não abriu?"}
          </span>
          <BotaoCopiar
            chave={`cmsg:${contato.id}`}
            copiado={copiado}
            rotulo="Copiar mensagem"
            onClick={() => onCopiar(`cmsg:${contato.id}`, previa.mensagem)}
          />
          {previa.destino && (
            <BotaoCopiar
              chave={`cdest:${contato.id}`}
              copiado={copiado}
              rotulo={canal === "email" ? "Copiar e-mail" : "Copiar número"}
              onClick={() => onCopiar(`cdest:${contato.id}`, previa.destino!)}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** Botão de copiar que confirma o que fez — "copiado" por um instante. */
function BotaoCopiar({
  chave,
  copiado,
  rotulo,
  onClick,
}: {
  chave: string;
  copiado: string | null;
  rotulo: string;
  onClick: () => void;
}) {
  const feito = copiado === chave;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
        feito
          ? "border-ok/40 bg-ok-soft text-ok"
          : "border-line bg-surface text-muted hover:text-ink",
      )}
    >
      {feito ? <Check size={11} /> : <Copy size={11} />}
      {feito ? "Copiado" : rotulo}
    </button>
  );
}

// ── Progresso ───────────────────────────────────────────────

function Progresso({ feitos, total }: { feitos: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((feitos / total) * 100);
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[13px] font-medium text-ink">
        <span className="font-mono tabular-nums">{feitos}</span> de{" "}
        <span className="font-mono tabular-nums">{total}</span>{" "}
        {total === 1 ? "contato enviado" : "contatos enviados"}
      </p>
      <div
        role="progressbar"
        aria-valuenow={feitos}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label="Contatos já enviados"
        className="h-1.5 overflow-hidden rounded-full bg-surface-2"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-300",
            feitos === total && total > 0 ? "bg-ok" : "bg-brand",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── Estado final ────────────────────────────────────────────

function TudoEnviado({
  alvos,
  estados,
  contatosDe,
}: {
  alvos: ConviteCotacao[];
  estados: Record<string, Estado>;
  contatosDe: (c: ConviteCotacao) => ContatoConvite[];
}) {
  return (
    <section className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-ok/40 bg-ok-soft px-4 py-3">
      <p className="flex items-center gap-2 text-[14px] font-semibold text-ok">
        <CheckCheck size={16} className="shrink-0" />
        Cotação enviada
      </p>
      <p className="text-[12px] text-ink-2">
        Todos os contatos escolhidos foram marcados como enviados. A cotação segue em{" "}
        <strong className="font-semibold">aguardando respostas</strong> até alguém responder.
      </p>
      <ul className="flex flex-col gap-1.5 border-t border-ok/30 pt-2">
        {alvos.map((c) => {
          const e = estados[c.id];
          const contatos = contatosDe(c);
          const linhas = Object.entries(e?.feitos ?? {}).flatMap(([id, f]) => {
            const ct = contatos.find((x) => x.id === id);
            return ct ? [{ ct, f }] : [];
          });
          if (linhas.length === 0) return null;
          return (
            <li key={c.id} className="text-[12px]">
              <span className="font-medium text-ink">{c.supplierNome}</span>
              <ul className="mt-0.5 flex flex-col gap-0.5">
                {linhas.map(({ ct, f }) => (
                  <li key={ct.id} className="text-muted">
                    {ct.nome} · {CANAL_ROTULO[f.canal]} · enviado {quando(f.em)}
                    {f.copias && (
                      <span className="block text-faint">cópia: {f.copias}</span>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ── Peças ───────────────────────────────────────────────────

function Etiqueta({
  concluido,
  andando,
  semContatos,
}: {
  concluido: boolean;
  andando: boolean;
  semContatos: boolean;
}) {
  const { label, classe } = semContatos
    ? { label: "Sem contato", classe: "bg-accent-soft text-accent" }
    : concluido
      ? { label: "Enviado", classe: "bg-ok-soft text-ok" }
      : andando
        ? { label: "Em andamento", classe: "bg-brand-soft text-brand" }
        : { label: "Pendente", classe: "bg-accent-soft text-accent" };
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        classe,
      )}
    >
      {label}
    </span>
  );
}

function BotaoCanal({
  ativo,
  icone,
  rotulo,
  titulo,
  onClick,
}: {
  ativo: boolean;
  icone: React.ReactNode;
  rotulo: string;
  titulo: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      title={titulo}
      className={cn(
        "flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium transition-colors",
        ativo ? "bg-brand text-on-brand" : "text-muted hover:text-ink",
      )}
    >
      {icone}
      {rotulo}
    </button>
  );
}
