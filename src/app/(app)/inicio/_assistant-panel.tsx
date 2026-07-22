"use client";

import { useEffect, useRef, useState } from "react";
import { X, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { polirResumoAssistente, registrarFeedbackInsight } from "./actions";
import { TrackedLink } from "./_tracked-link";
import { RobotAvatar } from "@/components/app/robot-avatar";
import { ICON_MAP, type Insight } from "./_insights";

/** Janela pra desfazer antes de gravar o feedback (que rebaixa o insight no futuro). */
const UNDO_MS = 6000;
/** Máximo de botões de ação — o painel é digest, não lista de tarefas. */
const MAX_ACOES = 3;

type InsightChipData = Pick<Insight, "id" | "tom" | "icone" | "titulo" | "corpo" | "cta">;

/**
 * Painel do Assistente — banner compacto (PRD: "IA atua como copiloto
 * silencioso"). O card diz UMA coisa: o resumo do assistente. Os pontos
 * encontrados não viram texto repetido ao lado — viram botões de ação, um por
 * insight acionável, que levam direto pra tela onde se resolve o problema
 * (o detalhe de cada ponto continua nos cards da seção de Insights).
 *
 * O mascote reflete o estado real: `humor` vem do tom dos insights (calmo /
 * atento / alerta) e vira "pensando" enquanto a IA reescreve o resumo.
 *
 * Dispensar grava feedback (InsightFeedback) — que rebaixa a regra nos cards
 * futuros (ver _insights.ts:ordenar), então nada é gravado na hora: fica
 * numa faixa de "Desfazer" por UNDO_MS.
 */
export function AssistantPanel({
  resumoInicial,
  topInsights,
  resumoNumeros,
  insightsParaIA,
  humor,
}: {
  resumoInicial: string;
  topInsights: InsightChipData[];
  resumoNumeros: { faturamento: number; margemBruta: number };
  insightsParaIA: Pick<Insight, "titulo" | "corpo" | "tom">[];
  humor: "calmo" | "atento" | "alerta";
}) {
  const [texto, setTexto] = useState(resumoInicial);
  const [pensando, setPensando] = useState(false);
  const [fechado, setFechado] = useState(false);
  const [undo, setUndo] = useState<{ ids: string[] } | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendentesRef = useRef<string[]>([]);

  useEffect(() => {
    if (insightsParaIA.length === 0) return;
    let ativo = true;
    // Só mostra "pensando" se a IA demorar — quando não está configurada, a
    // action volta na hora e o estado nem chega a aparecer.
    const t = setTimeout(() => {
      if (ativo) setPensando(true);
    }, 300);

    polirResumoAssistente(insightsParaIA, resumoNumeros)
      .then((polido) => {
        if (ativo && polido) setTexto(polido);
      })
      .catch(() => {})
      .finally(() => {
        clearTimeout(t);
        if (ativo) setPensando(false);
      });

    return () => {
      ativo = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sair da página não pode engolir o feedback pendente — grava na saída.
  useEffect(() => {
    return () => {
      if (!timerRef.current) return;
      clearTimeout(timerRef.current);
      for (const id of pendentesRef.current) void registrarFeedbackInsight(id, "IGNORADO");
    };
  }, []);

  function fecharCard() {
    const ids = topInsights.map((i) => i.id);
    pendentesRef.current = ids;
    setFechado(true);
    setUndo({ ids });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      pendentesRef.current = [];
      for (const id of ids) void registrarFeedbackInsight(id, "IGNORADO");
      setUndo(null);
    }, UNDO_MS);
  }

  function desfazer() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    pendentesRef.current = [];
    setFechado(false);
    setUndo(null);
  }

  // Fechado ainda renderiza a faixa de desfazer — sumir de vez sem chance de
  // voltar atrás é o que torna o dispensar irreversível.
  if (fechado) {
    return undo ? <BarraDesfazer onDesfazer={desfazer} className="fade-up" /> : null;
  }

  const humorAtual = pensando ? "pensando" : humor;
  const destaque = humor === "alerta";
  const acoes = acoesDeInsights(topInsights);

  return (
    <section
      className={cn(
        "fade-up relative overflow-hidden rounded-[var(--radius-lg)] border p-5 transition-opacity",
        destaque ? "border-brand/30 bg-brand-softer" : "border-line bg-surface",
      )}
    >
      {destaque && (
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-brand/25 blur-3xl print:hidden"
        />
      )}

      <button
        type="button"
        onClick={fecharCard}
        aria-label="Dispensar o assistente por hoje"
        className="absolute right-3 top-3 z-10 grid h-7 w-7 place-items-center rounded-full text-faint transition-colors hover:bg-black/5 hover:text-ink print:hidden"
      >
        <X size={15} />
      </button>

      <div className="relative flex items-start gap-4">
        <RobotAvatar size={72} humor={humorAtual} className="-my-1 -ml-2" />

        <div className="min-w-0 flex-1 pt-1">
          {/* O `pr-8` fica só no título: o X é absoluto no canto e só a primeira
              linha esbarra nele — o parágrafo abaixo usa a largura inteira. */}
          <h2 className="flex items-center gap-1 pr-8 font-display text-sm font-semibold text-ink">
            Assistente da operação
            <Sparkles size={13} className="text-brand" />
          </h2>

          {/* A região viva precisa existir ANTES do texto mudar — por isso o
              `key` (que remonta pra reanimar) fica no filho, não no <p>.
              `whitespace-pre-line` preserva as quebras do texto de regra
              (resumoAssistente monta bullets com \n). */}
          <p aria-live="polite" className="mt-1 whitespace-pre-line text-sm leading-relaxed text-muted">
            <span key={texto} className={cn("assistant-fade block", pensando && "assistant-thinking")}>
              {/* Sem destaque durante o shimmer: `assistant-thinking` pinta o
                  texto via background-clip, e um <strong> com cor própria
                  furaria o efeito. */}
              {pensando ? texto : destacar(texto)}
            </span>
          </p>

          {acoes.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2 print:hidden">
              {acoes.map((acao, i) => (
                <BotaoAcao key={acao.id} acao={acao} primario={i === 0} delay={60 * i} />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Trechos que carregam o número da operação — valor em R$, percentual e
 * quantidade com unidade. Só isso vira negrito: o resumo é lido em diagonal e
 * o que o operador procura é a grandeza, não a frase inteira.
 *
 * Vale pros dois textos (regra e o reescrito pela IA), por isso é regex sobre
 * o texto pronto em vez de marcação — a action de IA devolve texto puro, e
 * pedir markdown pra ela seria mais uma coisa pra dar errado no parse.
 */
const DESTAQUE =
  /(R\$\s?\d[\d.]*(?:,\d{2})?|\d+(?:,\d+)?\s?%|\d+(?:\.\d{3})*(?:,\d+)?\s?(?:unidades|unidade|un|produtos|produto|pedidos|pedido|dias|dia))/gi;

function destacar(texto: string) {
  // split com grupo de captura: índices ímpares são os trechos casados.
  return texto
    .split(DESTAQUE)
    .map((parte, i) =>
      i % 2 === 1 ? (
        <strong key={i} className="font-semibold text-ink">
          {parte}
        </strong>
      ) : (
        parte
      ),
    );
}

type Acao = { id: string; label: string; href: string; icone: Insight["icone"]; tom: Insight["tom"] };

/** Um botão por insight acionável, sem repetir destino (ruptura e ruptura-produto caem na mesma tela). */
function acoesDeInsights(insights: InsightChipData[]): Acao[] {
  const vistos = new Set<string>();
  const acoes: Acao[] = [];
  for (const i of insights) {
    if (!i.cta || vistos.has(i.cta.href)) continue;
    vistos.add(i.cta.href);
    acoes.push({ id: i.id, label: i.cta.label, href: i.cta.href, icone: i.icone, tom: i.tom });
    if (acoes.length === MAX_ACOES) break;
  }
  return acoes;
}

function BotaoAcao({ acao, primario, delay }: { acao: Acao; primario: boolean; delay: number }) {
  const Icone = ICON_MAP[acao.icone];
  return (
    <TrackedLink
      insightId={acao.id}
      href={acao.href}
      style={{ animationDelay: `${delay}ms` }}
      className={cn(
        "fade-up inline-flex items-center gap-2 rounded-[var(--radius-pill)] px-3.5 py-2 text-xs font-medium transition-colors",
        // `text-on-brand` é o par de contraste do laranja no design system —
        // branco no claro, quase preto no escuro.
        primario
          ? "bg-brand text-on-brand hover:bg-brand-strong"
          : "border border-line bg-surface text-ink hover:border-brand/40 hover:text-brand",
      )}
    >
      <Icone size={14} className={primario ? undefined : "text-faint transition-colors"} aria-hidden />
      {acao.label}
    </TrackedLink>
  );
}

function BarraDesfazer({ onDesfazer, className }: { onDesfazer: () => void; className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-line bg-surface px-3 py-2 text-xs text-muted print:hidden",
        className,
      )}
    >
      <span>Assistente dispensado até amanhã.</span>
      <button type="button" onClick={onDesfazer} className="shrink-0 font-medium text-brand hover:underline">
        Desfazer
      </button>
    </div>
  );
}
