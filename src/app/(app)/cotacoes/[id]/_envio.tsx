"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
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
  Mail,
  Send,
  UserPlus,
  Users,
} from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { copiarTexto } from "@/lib/clipboard";
import { maskPhone } from "@/lib/masks";
import { ContatoSheet } from "@/components/app/contato-fornecedor";
import { IconeWhatsApp } from "@/components/app/icone-whatsapp";
import { SupplierAvatar } from "../_ui";
import type { ConviteCotacao, ContatoConvite } from "../_compra-types";
import {
  confirmarEnvioAction,
  dispararWhatsAppAction,
  prepararEnvioAction,
  statusEnvioAutomaticoAction,
  type EnvioPreparado,
  type StatusEnvioAutomatico,
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
// Daí o desenho: uma LISTA DE PESSOAS. Por fornecedor, os contatos; por
// contato, um botão só.
//
//   abrir o app na linha da pessoa → enviar → confirmar → próxima pessoa
//
// Os dois canais funcionam igual: um disparo por CONTATO, verde no WhatsApp e
// azul no e-mail. O e-mail já teve "Para" e "Cópia" no mesmo envelope — o
// envelope escondia quem tinha recebido de verdade, e cópia carbono nunca foi
// o que o comprador queria dizer. Só o disparo automático (add-on) volta a
// marcar contatos: lá o lote inteiro sai num clique.
//
// "Enviado" quer dizer "o operador confirmou que mandou". Nunca "o fornecedor
// respondeu" — são duas colunas diferentes da mesma vida.

type Canal = "whatsapp" | "email";

/** Um disparo já confirmado, por contato. */
type Feito = { canal: Canal; em: string; copias: string | null };

type Estado = {
  canal: Canal;
  /**
   * Disparo automático (add-on): quem entra no lote. No envio manual — os dois
   * canais — não há marcação: cada contato tem o botão da própria linha.
   */
  selecionados: string[];
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
   * Canal automático: `null` enquanto a folha pergunta ao servidor.
   *
   * A pergunta é feita aqui, e não recebida por prop, porque a folha abre de
   * três telas diferentes — enfiar a resposta por quatro camadas de props para
   * chegar até aqui espalharia uma regra comercial pelo caminho todo.
   */
  const [auto, setAuto] = useState<StatusEnvioAutomatico | null>(null);
  const [disparando, setDisparando] = useState(false);

  useEffect(() => {
    let vivo = true;
    void statusEnvioAutomaticoAction()
      .then((s) => {
        if (vivo) setAuto(s);
      })
      .catch(() => {
        // Falhou a pergunta: segue no manual, que é o caminho que sempre existe.
        if (vivo) setAuto({ disponivel: false, motivo: null, numero: null });
      });
    return () => {
      vivo = false;
    };
  }, []);
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
      inicial[c.id] = {
        canal,
        selecionados: wa && !feitos[wa] ? [wa] : [],
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
    const canal = canalDe(c);
    // Envio manual (todo e-mail, e o WhatsApp sem o add-on) não tem marcação
    // prévia: cada contato é enviado pelo botão da própria linha. Enquanto
    // ninguém recebeu, o fornecedor pesa UM envio pendente na conta da folha
    // (mandar para uma pessoa da empresa é o trabalho); depois do primeiro, a
    // conta passa a ser quem de fato recebeu — mandar para o segundo contato é
    // escolha, não pendência.
    if (canal === "email" || !auto?.disponivel) {
      const feitos = e?.feitos ?? {};
      const podem = contatos.filter((x) => serve(x, canal));
      const recebidos = podem.filter((x) => feitos[x.id]);
      if (recebidos.length > 0) return recebidos;
      const primeiro = podem.find((x) => x.principal) ?? podem[0];
      return primeiro ? [primeiro] : [];
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

  /** Quantos disparos automáticos ainda cabem — só WhatsApp, só com número. */
  const pendentesWhats = alvos.reduce(
    (n, c) => n + (canalDe(c) === "whatsapp" ? pendentesDe(c).filter(temFone).length : 0),
    0,
  );

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
    const canal = canalDe(c);
    setErro((x) => ({ ...x, [c.id]: null }));
    setTrabalhando(c.id);
    // A aba nasce AQUI, ainda dentro do clique: depois do await da Server
    // Action o navegador (celular, principalmente) não vê mais gesto do
    // usuário e barra o `window.open`. Abrir vazia e trocar o endereço quando
    // o link chega é o que faz o WhatsApp SEMPRE sair em aba nova, sem tirar
    // a cotação da tela — voltar do aplicativo é fechar a aba.
    //
    // Sem `noopener` nas features: com ele o navegador devolve `null` e não
    // haveria janela para endereçar. O elo com esta página é cortado logo em
    // seguida, no `opener = null`.
    const aba = abrirApp && canal !== "email" ? window.open("", "_blank") : null;
    if (aba) aba.opener = null;
    start(async () => {
      try {
        const p = await prepararEnvioAction({
          conviteId: c.id,
          canal,
          contactId: contato.id,
          // Um envelope por PESSOA, também no e-mail: a linha de cada contato
          // tem o seu botão, e o que sai é endereçado a ele. Cópia carbono
          // some junto com a marcação que a escolhia.
          copiaIds: [],
        });
        setPrevia((x) => ({ ...x, [c.id]: p }));
        if (!abrirApp) {
          aba?.close();
          setVendo(c.id);
          return;
        }
        if (!p.url) {
          aba?.close();
          setErro((x) => ({ ...x, [c.id]: p.impedimento ?? "Não há para onde enviar." }));
          return;
        }
        // E-mail troca a navegação: é como o `mailto:` acorda o cliente do
        // sistema sem deixar aba órfã. WhatsApp vai para a aba já aberta —
        // e se o navegador bloqueou até isso, uma segunda tentativa de aba
        // nova, nunca a navegação desta (que tiraria a fila da tela).
        if (canal === "email") window.location.href = p.url;
        else if (aba && !aba.closed) aba.location.replace(p.url);
        else window.open(p.url, "_blank", "noopener,noreferrer");
        mexer(c.id, { perguntando: contato.id });
      } catch (err) {
        aba?.close();
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

  // ── Disparo automático (add-on WhatsApp) ────────────────
  // Com o canal ligado, a fila muda de natureza: o NoHub manda a mensagem e o
  // "enviado" passa a ser o aceite da Meta, não a palavra do operador. O fluxo
  // manual continua inteiro ao lado — é o que atende contato sem número,
  // fornecedor de e-mail e o dia em que a Meta está fora do ar.

  /** Marca na tela o que a Meta aceitou, sem esperar o servidor de novo. */
  function marcarFeito(conviteId: string, contactId: string, em: string) {
    setEstados((s) => ({
      ...s,
      [conviteId]: {
        ...s[conviteId],
        feitos: { ...s[conviteId].feitos, [contactId]: { canal: "whatsapp", em, copias: null } },
        perguntando: null,
      },
    }));
  }

  /** Dispara pela API para os contatos escolhidos que ainda não receberam. */
  function dispararAutomatico(alvosDoDisparo: ConviteCotacao[]) {
    const lote = alvosDoDisparo
      .filter((c) => canalDe(c) === "whatsapp")
      .map((c) => ({
        conviteId: c.id,
        contactIds: pendentesDe(c)
          .filter(temFone)
          .map((x) => x.id),
      }))
      .filter((a) => a.contactIds.length > 0);
    if (lote.length === 0) return;

    for (const a of lote) setErro((x) => ({ ...x, [a.conviteId]: null }));
    setDisparando(true);
    start(async () => {
      try {
        const resultados = await dispararWhatsAppAction({ alvos: lote, reenvio });
        for (const r of resultados) {
          if (r.enviado && r.enviadoEm) marcarFeito(r.conviteId, r.contactId, r.enviadoEm);
        }
        // Erro é por CONTATO, mas o cartão é do fornecedor: junta o que falhou
        // dele numa linha só, com o nome de quem não recebeu — "falhou" sem
        // dizer para quem manda o comprador conferir três contatos na mão.
        const falhas = new Map<string, string[]>();
        for (const r of resultados) {
          if (r.enviado) continue;
          const lista = falhas.get(r.conviteId) ?? [];
          lista.push(`${r.contatoNome}: ${r.erro ?? "não foi enviado"}`);
          falhas.set(r.conviteId, lista);
        }
        for (const [conviteId, lista] of falhas) {
          setErro((x) => ({ ...x, [conviteId]: lista.join(" · ") }));
        }
      } catch (err) {
        const texto =
          err instanceof Error ? err.message : "Não foi possível disparar pelo WhatsApp.";
        for (const a of lote) setErro((x) => ({ ...x, [a.conviteId]: texto }));
      } finally {
        setDisparando(false);
      }
    });
  }

  /** O operador confirma que mandou para este contato. Só aqui vira "enviado". */
  function confirmar(c: ConviteCotacao, contato: ContatoConvite) {
    const canal = canalDe(c);
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
          // Um envelope por pessoa: não há cópia carbono a registrar.
          copias: null,
          reenvio,
        });
        setEstados((s) => ({
          ...s,
          [c.id]: {
            ...s[c.id],
            feitos: {
              ...s[c.id].feitos,
              [contato.id]: { canal, em: enviadoEm, copias: null },
            },
            perguntando: null,
          },
        }));
        setVendo((v) => (v === c.id ? null : v));
        // Acabou este fornecedor? Ele se recolhe e o caminho segue no próximo.
        // No WhatsApp manual, mandar para UMA pessoa da empresa fecha o
        // fornecedor: os outros contatos continuam na lista, com o botão de
        // cada um, mas não seguram a fila.
        const manual = canal === "whatsapp" && !auto?.disponivel;
        const restam = manual
          ? []
          : fila(c).filter((x) => x.id !== contato.id && !estados[c.id]?.feitos[x.id]);
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
            : "Envie a cotação aos fornecedores pelo canal escolhido."
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
                  {totalFila === 1 ? "envio realizado" : "envios realizados"}
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
        {/* Nem barra de progresso nem prévia da lista: a contagem de envios
            já vive no rodapé, presa à tela, e o que vai na cotação foi
            conferido na tela anterior. Aqui o trabalho é um só — mandar para
            cada contato —, e a fila de fornecedores é que precisa da altura. */}
        <div className="flex flex-col gap-4">
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

          {/* Com o canal ligado, a fila inteira cabe num clique — e a barra diz
              de qual número a mensagem sai, porque é o que o fornecedor vai ver
              chegar. Sem WhatsApp pendente ela some: botão que não tem o que
              mandar é convite para um clique que não faz nada. */}
          {auto?.disponivel && !tudoEnviado && pendentesWhats > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-brand/40 bg-brand-soft px-3.5 py-3">
              <p className="flex items-start gap-2 text-[13px] text-ink-2">
                <IconeWhatsApp size={15} className="mt-0.5 shrink-0 text-brand" />
                <span>
                  Disparo automático ligado
                  {auto.numero ? (
                    <>
                      {" "}
                      — sai de <span className="font-medium text-ink">{auto.numero}</span>
                    </>
                  ) : null}
                  . Cada mensagem é cobrada pela Meta.
                </span>
              </p>
              <button
                type="button"
                onClick={() => dispararAutomatico(ordem)}
                disabled={disparando}
                className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-[13px] font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Send size={14} />
                {disparando
                  ? "Enviando…"
                  : `Enviar para ${pendentesWhats} ${pendentesWhats === 1 ? "contato" : "contatos"}`}
              </button>
            </div>
          )}

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
                automatico={auto?.disponivel ?? false}
                disparando={disparando}
                onDisparar={() => dispararAutomatico([c])}
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
  automatico,
  disparando,
  onDisparar,
}: {
  ref: (el: HTMLLIElement | null) => void;
  convite: ConviteCotacao;
  contatos: ContatoConvite[];
  estado: Estado | undefined;
  erro: string | null;
  trabalhando: boolean;
  destacado: boolean;
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
  /** O canal automático está ligado: o botão principal manda em vez de abrir. */
  automatico: boolean;
  disparando: boolean;
  /** Dispara a fila DESTE fornecedor pela Cloud API. */
  onDisparar: () => void;
}) {
  const feitos = e?.feitos ?? {};
  const podeWhats = contatos.some(temFone);
  const podeMail = contatos.some(temMail);
  // Com um canal só, ele manda — o estado pode ter ficado no outro depois de
  // um contato novo entrar ou sair.
  const canal: Canal = podeWhats && podeMail ? (e?.canal ?? "whatsapp") : podeWhats ? "whatsapp" : "email";

  /**
   * Envio um a um: cada contato tem o seu botão na linha, ao lado do destino.
   *
   * Marcar-para-depois-enviar era um passo a mais para o caso que sempre
   * acontece: mandar para UMA pessoa do fornecedor. Quem quer mandar para a
   * segunda aperta o botão da segunda linha.
   *
   * Vale sempre no e-mail (um envelope por pessoa, sem cópia carbono) e no
   * WhatsApp sem o add-on. Só o disparo automático continua marcando: lá o
   * lote inteiro sai num clique e a folha precisa saber quem entra nele.
   */
  const individual = canal === "email" || !automatico;

  const escolhidos = individual
    ? contatos.filter((x) => serve(x, canal))
    : contatos.filter((x) => e?.selecionados.includes(x.id));
  const pendentes = escolhidos.filter((x) => !feitos[x.id]);
  const enviadosAqui = escolhidos.length - pendentes.length;

  const semContatos = contatos.length === 0;
  // No um a um, o fornecedor está resolvido assim que alguém dele recebeu: os
  // outros contatos continuam à mão, mas não são pendência.
  const concluido = individual
    ? enviadosAqui > 0
    : escolhidos.length > 0 && pendentes.length === 0;
  // Quem a folha trata como "o próximo": no lote automático é a vez dele; no
  // um a um é só de quem o texto da prévia fala.
  const alvo = pendentes[0] ?? null;

  return (
    <li
      ref={ref}
      className={cn(
        "rounded-[var(--radius-lg)] border transition-colors",
        // Pendente é pendente: o primeiro da fila não ganha borda de marca por
        // ser o primeiro — numa lista de oito cinzas, um laranja parado lia
        // como "este aqui tem alguma coisa". Laranja só no destaque, que dura
        // um segundo e responde a um clique ("Próximo fornecedor").
        concluido
          ? "border-ok/40 bg-ok-soft/40"
          : destacado
            ? "border-brand bg-brand-soft/40"
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
                ? individual
                  ? "sem WhatsApp"
                  : "ninguém escolhido"
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
                  <IconeWhatsApp
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
                titulo="Um e-mail para cada contato"
                onClick={() => onMexer({ canal: "email", perguntando: null })}
              />
            </div>
          )}

          <ListaContatos
            canal={canal}
            contatos={contatos}
            individual={individual}
            trabalhando={trabalhando}
            selecionados={e?.selecionados ?? []}
            feitos={feitos}
            onEnviar={onAbrir}
            onJaEnviei={onConfirmar}
            onAlternar={(id) => {
              const atual = e?.selecionados ?? [];
              onMexer({
                selecionados: atual.includes(id)
                  ? atual.filter((x) => x !== id)
                  : [...atual, id],
                perguntando: null,
              });
            }}
            onCadastrar={onCadastrar}
          />

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
                {/* Sem "copiar número" aqui: quem abriu a prévia quer conferir
                    o TEXTO antes de mandar. O destino já está na linha do
                    contato, e o botão de copiá-lo continua onde resolve
                    alguma coisa — na saída de emergência, quando o app não
                    abriu. */}
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
              {individual && pendentes.length > 0
                ? `Enviado para ${enviadosAqui} de ${escolhidos.length} contatos — os outros continuam ao lado, se quiser mandar.`
                : "Todos os contatos escolhidos foram enviados."}
            </p>
          ) : escolhidos.length === 0 ? (
            <p className="flex items-start gap-1.5 text-[12px] text-muted">
              <Users size={13} className="mt-0.5 shrink-0 text-faint" />
              {!individual
                ? "Marque quem vai receber no WhatsApp."
                : canal === "email"
                  ? "Nenhum contato com e-mail cadastrado. Adicione o endereço de quem recebe."
                  : "Nenhum contato com WhatsApp cadastrado. Adicione o número de quem recebe."}
            </p>
          ) : individual ? (
            // No um a um o botão principal do cartão sairia sobrando: a ação
            // está em cada linha. Fica só o que vale para o fornecedor
            // inteiro — ler o texto antes de mandar — na esquerda, e a
            // instrução na ponta oposta, onde os botões de Enviar estão.
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
              <button
                type="button"
                onClick={() => alvo && onVer(alvo)}
                disabled={trabalhando || !alvo}
                aria-expanded={vendo}
                className="cursor-pointer rounded-full border border-line px-2.5 py-1 text-[12px] font-medium text-ink-2 transition-colors hover:border-line-strong hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                {vendo ? "Ocultar mensagem" : "Ver mensagem"}
              </button>
              <span className="text-right text-[12px] text-faint">
                Toque em Enviar na linha de quem vai receber.
              </span>
            </div>
          ) : (
            alvo && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                {/* Com o canal automático ligado, o botão principal MANDA em vez
                    de abrir o aplicativo — e o disparo cobre a fila deste
                    fornecedor de uma vez, que é o ponto do add-on. Abrir o
                    WhatsApp continua um clique ao lado: é o caminho de quem
                    quer escrever alguma coisa a mais na conversa. */}
                {onDisparar ? (
                  <button
                    type="button"
                    onClick={onDisparar}
                    disabled={trabalhando || disparando}
                    className="flex cursor-pointer items-center justify-center gap-1.5 rounded-full bg-brand px-4 py-2 text-[13px] font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Send size={14} />
                    {disparando
                      ? "Enviando…"
                      : `Enviar agora · ${escolhidos.length} ${escolhidos.length === 1 ? "contato" : "contatos"}`}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => onAbrir(alvo)}
                  disabled={trabalhando}
                  // Dois botões cheios lado a lado não dizem qual é o caminho:
                  // com o disparo ligado, abrir o aplicativo é a alternativa —
                  // de quem quer escrever alguma coisa a mais na conversa.
                  className="flex cursor-pointer items-center justify-center gap-1.5 rounded-full border border-line bg-surface px-4 py-2 text-[13px] font-semibold text-ink transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <IconeWhatsApp size={14} />
                  {trabalhando ? "Preparando…" : "Abrir WhatsApp"}
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

/**
 * Rótulo da lista, com o "cadastrar contato" na ponta direita da mesma linha.
 *
 * Solto embaixo da lista, o botão competia com a ação principal do cartão —
 * "abrir WhatsApp" e "adicionar contato" com o mesmo peso, um em cima do
 * outro. Aqui ele é o que é: a saída para quando falta gente na lista, à
 * margem, na altura do título que ele completa.
 */
function RotuloContatos({
  children,
  onCadastrar,
}: {
  children: React.ReactNode;
  onCadastrar?: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">
        {children}
      </span>
      {onCadastrar && (
        <button
          type="button"
          onClick={onCadastrar}
          title="Cadastrar um contato deste fornecedor"
          className="-mr-1 flex shrink-0 cursor-pointer items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-brand"
        >
          <UserPlus size={12} aria-hidden />
          Adicionar
        </button>
      )}
    </div>
  );
}

/**
 * A lista de contatos do fornecedor — a mesma nos dois canais.
 *
 * Era uma lista por canal: o WhatsApp marcava quem recebe, o e-mail escolhia
 * "Para" e "Cópia". Duas gramáticas para o mesmo gesto ("mandar para o Jorge")
 * e, no e-mail, um envelope só que escondia quem tinha recebido de fato.
 * Agora é um botão por pessoa nos dois — o que muda é a cor, o ícone e a
 * palavra do destino.
 */
function ListaContatos({
  canal,
  contatos,
  individual,
  trabalhando,
  selecionados,
  feitos,
  onAlternar,
  onEnviar,
  onJaEnviei,
  onCadastrar,
}: {
  canal: Canal;
  contatos: ContatoConvite[];
  /** Um botão por linha (manual) em vez de marcar e disparar em lote. */
  individual: boolean;
  trabalhando: boolean;
  selecionados: string[];
  feitos: Record<string, Feito>;
  onAlternar: (id: string) => void;
  /** Abre o WhatsApp ou o cliente de e-mail DESTE contato. */
  onEnviar: (contato: ContatoConvite) => void;
  /** Mandou por fora (ligou, mandou do celular): registra sem abrir o app. */
  onJaEnviei: (contato: ContatoConvite) => void;
  /** Cadastrar mais um contato deste fornecedor, sem sair da folha. */
  onCadastrar: () => void;
}) {
  const whats = canal === "whatsapp";
  const app = whats ? "WhatsApp" : "e-mail";
  return (
    <div className="flex flex-col gap-0.5">
      <RotuloContatos onCadastrar={onCadastrar}>
        {individual ? "Enviar para" : "Contatos para envio"}
      </RotuloContatos>
      <ul>
        {contatos.map((ct) => {
          const feito = feitos[ct.id];
          const podeReceber = serve(ct, canal);
          const marcado = selecionados.includes(ct.id);
          return (
            <li key={ct.id}>
              <LinhaContato
                contato={ct}
                canal={canal}
                feito={feito}
                bloqueado={!podeReceber}
                marcado={!individual && marcado}
                // Sem marcação não há caixa para desenhar: a linha é só o
                // nome, o destino e o botão que manda para ele.
                forma={individual ? "livre" : "caixa"}
                onClick={
                  individual ? undefined : () => podeReceber && !feito && onAlternar(ct.id)
                }
                // Mandou por outro caminho (ligou, mandou do celular) e a
                // trilha precisa saber. Fica no lugar EXATO onde a marca de
                // enviado aparece depois — a caixa vazia à esquerda do nome
                // vira o check verde no mesmo ponto.
                antes={
                  individual && podeReceber && !feito ? (
                    <button
                      type="button"
                      onClick={() => onJaEnviei(ct)}
                      disabled={trabalhando}
                      title={`Marcar que ${ct.nome} já recebeu, sem abrir o ${app}`}
                      aria-label={`Marcar que ${ct.nome} já recebeu, sem abrir o ${app}`}
                      className="grid h-4 w-4 shrink-0 cursor-pointer place-items-center rounded-[4px] border border-line-strong text-faint transition-colors hover:border-ok hover:bg-ok-soft hover:text-ok disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Check size={11} />
                    </button>
                  ) : null
                }
                acoes={
                  individual && podeReceber && !feito ? (
                    <button
                      type="button"
                      onClick={() => onEnviar(ct)}
                      disabled={trabalhando}
                      // A cor do canal, não a da marca: verde do WhatsApp,
                      // azul de e-mail. São os únicos botões da folha que
                      // saem para fora do ERP, e o operador os reconhece pela
                      // cor antes de ler a palavra.
                      className={cn(
                        "flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50",
                        whats ? "bg-whatsapp text-on-whatsapp" : "bg-info text-on-info",
                      )}
                    >
                      {whats ? <IconeWhatsApp size={12} /> : <Mail size={12} />}
                      Enviar
                    </button>
                  ) : null
                }
              />
            </li>
          );
        })}
      </ul>
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
  antes,
  acoes,
}: {
  contato: ContatoConvite;
  canal: Canal;
  feito: Feito | undefined;
  bloqueado: boolean;
  marcado: boolean;
  /** Caixa = marcação do lote automático; ponto = escolha única; livre = sem marcação. */
  forma: "caixa" | "ponto" | "livre";
  /** Ausente quando a linha não marca ninguém — o botão de ação faz o trabalho. */
  onClick?: () => void;
  /** Ocupa o lugar da marca, à esquerda do nome (envio um a um). */
  antes?: React.ReactNode;
  /** Botões da ponta direita, depois do número (envio um a um). */
  acoes?: React.ReactNode;
}) {
  const dado = canal === "whatsapp" ? foneVisivel(ct) : ct.email;
  // Nome à esquerda, destino à direita, uma linha só. Empilhar nome e telefone
  // dobrava a altura de uma lista que o operador lê de relance para marcar.
  const conteudo = (
    <>
      {/* O que ocupa a coluna da esquerda: a marca do canal com fila, ou o
          botão de "já recebeu" do um a um. Enviado, sempre a marca — o check
          verde no mesmo ponto onde a caixa estava. */}
      {antes && !feito ? antes : null}
      {(forma !== "livre" || feito) && !(antes && !feito) && (
        <span
          aria-hidden
          className={cn(
            "grid h-4 w-4 shrink-0 place-items-center border",
            forma === "ponto" ? "rounded-full" : "rounded-[4px]",
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
            forma === "ponto" ? (
              <span className="h-1.5 w-1.5 rounded-full bg-surface" />
            ) : (
              <Check size={11} />
            )
          ) : null}
        </span>
      )}

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

  // Sem marcação (um a um), a linha não é botão: o alvo do clique é a ação da
  // ponta direita, e uma linha inteira clicável sem efeito só confunde.
  if (!onClick) {
    return (
      <div className="flex items-center gap-2 rounded-[var(--radius-sm)] px-1.5 py-1">
        {conteudo}
        {acoes}
      </div>
    );
  }

  // Marcar e agir são botões IRMÃOS: um dentro do outro é HTML inválido, e o
  // clique do de dentro subiria para o de fora desmarcando o contato no mesmo
  // gesto que age sobre ele.
  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-[var(--radius-sm)] pr-1 transition-colors",
        marcado && "bg-surface-2",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        aria-pressed={marcado}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-1.5 py-1 text-left transition-colors hover:bg-surface-2"
      >
        {conteudo}
      </button>
      {acoes}
    </div>
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
