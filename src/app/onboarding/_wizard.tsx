"use client";

import { useMemo, useState, useTransition } from "react";
import { ArrowRight, ArrowLeft, Check, Store, Boxes, Wine } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/misc";
import { PRESETS, TIPO_LABELS } from "@/lib/presets";
import { saveOnboarding, type OnboardingInput } from "./actions";

type Tipo = OnboardingInput["tipoOperacao"];
type Pontos = OnboardingInput["pontos"];
type Topo = OnboardingInput["topologia"];

const TIPO_ICON: Record<Tipo, React.ReactNode> = {
  AUTONOMO: <Boxes size={20} />,
  MERCADINHO: <Store size={20} />,
  CONVENIENCIA_BEBIDAS: <Wine size={20} />,
};

const PERGUNTA_TEXTO: Record<Tipo, { q: string; sim: string; nao: string } | null> = {
  AUTONOMO: null, // pagamento — informativo, não toggla módulo nesta fase
  MERCADINHO: { q: "Você emite nota no caixa (NFC-e/SAT)?", sim: "Sim, emito nota", nao: "Ainda não" },
  CONVENIENCIA_BEBIDAS: { q: "Trabalha com vasilhame/casco retornável ou chopp?", sim: "Sim, tenho comodato", nao: "Não" },
};

export function OnboardingWizard({ nomeAtual }: { nomeAtual: string }) {
  const [step, setStep] = useState(0);
  const [tipo, setTipo] = useState<Tipo | null>(null);
  const [pontos, setPontos] = useState<Pontos | null>(null);
  const [topologia, setTopologia] = useState<Topo | null>(null);
  const [perguntaSim, setPerguntaSim] = useState<boolean | null>(null);
  const [nome, setNome] = useState(nomeAtual);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  // Step 3 (topologia) só aparece se >1 ponto ou autônomo.
  const precisaTopologia = pontos !== "1" || tipo === "AUTONOMO";
  const pergunta = tipo ? PERGUNTA_TEXTO[tipo] : null;

  // Sequência dinâmica de steps.
  const steps = useMemo(() => {
    const s: string[] = ["tipo", "pontos"];
    if (precisaTopologia) s.push("topologia");
    if (pergunta) s.push("pergunta");
    s.push("nome");
    return s;
  }, [precisaTopologia, pergunta]);

  const current = steps[Math.min(step, steps.length - 1)];
  const progress = Math.round(((step + 1) / steps.length) * 100);

  function next() {
    setError(undefined);
    if (current === "tipo" && tipo) {
      // pré-seleciona defaults do preset
      setTopologia((t) => t ?? PRESETS[tipo].topologia);
    }
    setStep((s) => Math.min(s + 1, steps.length - 1));
  }
  function back() {
    setError(undefined);
    setStep((s) => Math.max(s - 1, 0));
  }

  function finish() {
    if (!tipo || !pontos) return;
    const topo: Topo = precisaTopologia ? topologia ?? "LOCAL" : "LOCAL";
    start(async () => {
      try {
        await saveOnboarding({
          tipoOperacao: tipo,
          pontos,
          topologia: topo,
          perguntaSim: perguntaSim ?? false,
          nomeMercado: nome.trim() || undefined,
        });
      } catch (e) {
        // redirect() lança NEXT_REDIRECT — não é erro real
        if (e instanceof Error && e.message.includes("NEXT_REDIRECT")) return;
        setError("Não foi possível salvar. Tente de novo.");
      }
    });
  }

  const canAdvance =
    (current === "tipo" && !!tipo) ||
    (current === "pontos" && !!pontos) ||
    (current === "topologia" && !!topologia) ||
    (current === "pergunta" && perguntaSim !== null) ||
    current === "nome";

  const isLast = current === "nome";

  return (
    <div className="w-full max-w-xl">
      {/* progresso */}
      <div className="mb-8">
        <div className="mb-2 flex items-center justify-between text-xs text-muted">
          <span className="font-mono uppercase tracking-wider">
            Passo {step + 1} de {steps.length}
          </span>
          <span>{progress}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-line">
          <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {current === "tipo" && (
        <Step title="Que tipo de operação você toca?" sub="Isso só define os padrões — dá para mudar tudo depois.">
          <div className="grid gap-3">
            {(Object.keys(TIPO_LABELS) as Tipo[]).map((t) => (
              <Choice
                key={t}
                selected={tipo === t}
                onClick={() => setTipo(t)}
                icon={TIPO_ICON[t]}
                title={TIPO_LABELS[t].nome}
                desc={TIPO_LABELS[t].desc}
              />
            ))}
          </div>
        </Step>
      )}

      {current === "pontos" && (
        <Step title="Quantos pontos ou lojas?" sub="Define o plano sugerido e liga a visão multi-loja.">
          <div className="grid grid-cols-3 gap-3">
            {(["1", "2-5", "6+"] as Pontos[]).map((p) => (
              <Pill key={p} selected={pontos === p} onClick={() => setPontos(p)}>
                {p === "1" ? "1 ponto" : p === "2-5" ? "2 a 5" : "6 ou mais"}
              </Pill>
            ))}
          </div>
        </Step>
      )}

      {current === "topologia" && (
        <Step title="Como o estoque é organizado?" sub="Quem guarda e abastece o produto.">
          <div className="grid gap-3">
            <Choice selected={topologia === "LOCAL"} onClick={() => setTopologia("LOCAL")} title="Cada ponto tem o seu" desc="O estoque vive em cada loja." />
            <Choice selected={topologia === "CD_ABASTECE"} onClick={() => setTopologia("CD_ABASTECE")} title="Um CD/base abastece" desc="Centro de distribuição manda para os pontos." />
            <Choice selected={topologia === "MISTO"} onClick={() => setTopologia("MISTO")} title="Misto" desc="Parte local, parte centralizado." />
          </div>
        </Step>
      )}

      {current === "pergunta" && pergunta && (
        <Step title={pergunta.q} sub="Liga o módulo certo desde o começo.">
          <div className="grid grid-cols-2 gap-3">
            <Pill selected={perguntaSim === true} onClick={() => setPerguntaSim(true)}>{pergunta.sim}</Pill>
            <Pill selected={perguntaSim === false} onClick={() => setPerguntaSim(false)}>{pergunta.nao}</Pill>
          </div>
        </Step>
      )}

      {current === "nome" && (
        <Step title="Como chama seu mercado?" sub="Aparece no painel. Pode ajustar depois nas configurações.">
          <Field label="Nome do mercado" htmlFor="nome">
            <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Adega do Bairro" />
          </Field>
        </Step>
      )}

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}

      <div className="mt-8 flex items-center justify-between">
        <Button variant="ghost" onClick={back} disabled={step === 0 || pending} className="gap-1.5">
          <ArrowLeft size={16} /> Voltar
        </Button>
        {isLast ? (
          <Button onClick={finish} disabled={pending} className="gap-2">
            {pending ? "Salvando…" : "Concluir setup"} <Check size={16} />
          </Button>
        ) : (
          <Button onClick={next} disabled={!canAdvance} className="gap-2">
            Continuar <ArrowRight size={16} />
          </Button>
        )}
      </div>
    </div>
  );
}

function Step({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="font-display text-2xl font-semibold text-ink">{title}</h2>
      <p className="mt-1 mb-6 text-sm text-muted">{sub}</p>
      {children}
    </div>
  );
}

function Choice({
  selected,
  onClick,
  icon,
  title,
  desc,
}: {
  selected: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "flex items-start gap-3 rounded-[var(--radius)] border bg-surface p-4 text-left transition-colors",
        selected ? "border-brand ring-1 ring-brand" : "border-line-strong hover:bg-surface-2"
      )}
    >
      {icon && (
        <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-sm)]", selected ? "bg-brand text-on-brand" : "bg-surface-2 text-muted")}>
          {icon}
        </span>
      )}
      <span>
        <span className="block font-medium text-ink">{title}</span>
        <span className="mt-0.5 block text-sm text-muted">{desc}</span>
      </span>
    </button>
  );
}

function Pill({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "rounded-[var(--radius)] border px-4 py-3 text-sm font-medium transition-colors",
        selected ? "border-brand bg-brand-soft text-brand-strong ring-1 ring-brand" : "border-line-strong bg-surface text-ink hover:bg-surface-2"
      )}
    >
      {children}
    </button>
  );
}
