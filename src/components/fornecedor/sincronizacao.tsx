"use client";

import { useMemo, useState } from "react";
import {
  Check,
  History,
  Lightbulb,
  Mail,
  Phone,
  Sparkles,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { maskCnpj, maskPhone } from "@/lib/masks";
import { decidirSugestoesAction } from "@/app/(app)/fornecedores/sync-actions";
import type { AlteracaoSync, ResumoSincronizacao } from "@/lib/fornecedores/sincronizacao-xml";

// ============================================================
// O que o XML fez pelo cadastro do fornecedor, em uma tela.
//
// O desenho segue a regra do módulo: o operador só decide o que o sistema não
// pode decidir. Dado oficial aparece como fato consumado (lista curta, sem
// botão); telefone e e-mail aparecem como pergunta, cada um com a opção
// recomendada já escolhida — quem concorda clica uma vez, quem discorda troca.
//
// Só o que MUDOU entra na tela. Nota que não alterou nada não vira card.
// ============================================================

export type DecisaoEscolhida = "ATUALIZAR" | "CONTATO" | "PRINCIPAL" | "MANTER";

type Opcao = { valor: DecisaoEscolhida; rotulo: string };

/**
 * As opções de cada tipo de sugestão, na ordem em que fazem sentido — a
 * primeira é a recomendada e já vem marcada.
 *
 * Telefone com cadastro vazio pode entrar direto; com cadastro preenchido a
 * recomendação vira "adicionar como contato": o número do cadastro costuma ser
 * o do vendedor, e o do XML, o do faturamento.
 */
function opcoesDe(campo: string, temValorAtual: boolean): Opcao[] {
  if (campo === "telefone") {
    return temValorAtual
      ? [
          { valor: "CONTATO", rotulo: "Adicionar como contato" },
          { valor: "ATUALIZAR", rotulo: "Atualizar telefone" },
          { valor: "MANTER", rotulo: "Manter atual" },
        ]
      : [
          { valor: "ATUALIZAR", rotulo: "Usar este telefone" },
          { valor: "CONTATO", rotulo: "Adicionar como contato" },
          { valor: "MANTER", rotulo: "Ignorar" },
        ];
  }
  if (campo === "email") {
    return [
      { valor: "CONTATO", rotulo: "Adicionar como contato" },
      { valor: "PRINCIPAL", rotulo: "Definir como principal" },
      { valor: "MANTER", rotulo: "Ignorar" },
    ];
  }
  return [
    { valor: "ATUALIZAR", rotulo: "Aplicar" },
    { valor: "MANTER", rotulo: "Ignorar" },
  ];
}

const ICONE_CAMPO: Record<string, LucideIcon> = {
  telefone: Phone,
  email: Mail,
};

/** Valor legível: telefone com máscara, o resto como veio. */
function mostrar(campo: string, valor: string | null): string {
  if (!valor) return "—";
  if (campo === "telefone") return maskPhone(valor);
  if (campo === "cnpj") return maskCnpj(valor);
  return valor;
}

function LinhaAntesDepois({ campo, antes, depois }: { campo: string; antes: string | null; depois: string | null }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]">
      {antes && <span className="text-faint line-through">{mostrar(campo, antes)}</span>}
      {antes && <span className="text-faint">→</span>}
      <span className="font-medium text-ink">{mostrar(campo, depois)}</span>
    </p>
  );
}

/** Bloco de um tipo de alteração — some inteiro quando não há nada a dizer. */
function Secao({
  icone: Icone,
  titulo,
  tone,
  children,
}: {
  icone: LucideIcon;
  titulo: string;
  tone: "ok" | "accent" | "neutral";
  children: React.ReactNode;
}) {
  const cores = {
    ok: "text-ok",
    accent: "text-accent",
    neutral: "text-muted",
  } as const;

  return (
    <section className="flex flex-col gap-2">
      <h4 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
        <Icone size={13} className={cores[tone]} />
        {titulo}
      </h4>
      {children}
    </section>
  );
}

/**
 * Uma sugestão com suas opções. O estado da escolha vive no pai: o botão
 * "Aplicar sugestões" precisa saber o que cada linha decidiu.
 */
function LinhaSugestao({
  sugestao,
  escolha,
  onEscolher,
  desabilitado,
}: {
  sugestao: AlteracaoSync;
  escolha: DecisaoEscolhida;
  onEscolher: (d: DecisaoEscolhida) => void;
  desabilitado: boolean;
}) {
  const Icone = ICONE_CAMPO[sugestao.campo] ?? Lightbulb;
  const opcoes = opcoesDe(sugestao.campo, Boolean(sugestao.antes));

  return (
    <div className="rounded-[var(--radius)] border border-line bg-surface-2/50 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <Icone size={14} className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-ink">{sugestao.rotulo}</p>
          <LinhaAntesDepois campo={sugestao.campo} antes={sugestao.antes} depois={sugestao.depois} />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5 pl-6">
        {opcoes.map((o) => (
          <button
            key={o.valor}
            type="button"
            disabled={desabilitado}
            aria-pressed={escolha === o.valor}
            onClick={() => onEscolher(o.valor)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[12px] transition-colors disabled:opacity-50",
              escolha === o.valor
                ? "border-brand bg-brand-soft font-medium text-brand-strong"
                : "border-line text-muted hover:bg-surface-2 hover:text-ink",
            )}
          >
            {o.rotulo}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Card de um fornecedor sincronizado. Serve tanto ao painel pós-importação
 * quanto à ficha do fornecedor — em ambos a pergunta é a mesma.
 */
export function CardSincronizacao({
  resumo,
  onResolvido,
}: {
  resumo: ResumoSincronizacao;
  /** Chamado quando as sugestões deste fornecedor foram decididas. */
  onResolvido?: () => void;
}) {
  const [escolhas, setEscolhas] = useState<Record<string, DecisaoEscolhida>>(() =>
    Object.fromEntries(
      resumo.sugestoes.map((s) => [s.id, opcoesDe(s.campo, Boolean(s.antes))[0].valor]),
    ),
  );
  const [salvando, setSalvando] = useState(false);
  const [resolvidas, setResolvidas] = useState(false);

  const pendentes = resolvidas ? [] : resumo.sugestoes;
  const h = resumo.historico;

  async function aplicar() {
    setSalvando(true);
    try {
      const r = await decidirSugestoesAction(
        pendentes.map((s) => ({ id: s.id, decisao: escolhas[s.id] })),
      );
      if (r.falhas.length > 0) {
        toast.error("Nem tudo foi aplicado.", r.falhas[0]);
      } else {
        toast.success(
          `${r.aplicadas} sugestão(ões) aplicada(s).`,
          "O cadastro do fornecedor já está com os dados novos.",
        );
      }
      setResolvidas(true);
      onResolvido?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao aplicar as sugestões.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <article className="flex flex-col gap-3.5 rounded-[var(--radius-lg)] border border-line bg-surface p-4">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate font-display text-[15px] font-semibold text-ink">
          {resumo.nome}
        </h3>
        {resumo.criado ? (
          <Badge tone="brand">Fornecedor criado</Badge>
        ) : (
          <span className="font-mono text-[11px] text-faint">{maskCnpj(resumo.cnpj)}</span>
        )}
      </header>

      {resumo.automaticas.length > 0 && (
        <Secao icone={Check} titulo="Atualizado automaticamente" tone="ok">
          <ul className="flex flex-col gap-1.5">
            {resumo.automaticas.map((a) => (
              <li key={a.id} className="text-[13px] text-ink-2">
                {a.rotulo}
                {a.depois && (
                  <LinhaAntesDepois campo={a.campo} antes={a.antes} depois={a.depois} />
                )}
              </li>
            ))}
          </ul>
        </Secao>
      )}

      {pendentes.length > 0 && (
        <Secao icone={Sparkles} titulo="Precisa da sua decisão" tone="accent">
          <div className="flex flex-col gap-2">
            {pendentes.map((s) => (
              <LinhaSugestao
                key={s.id}
                sugestao={s}
                escolha={escolhas[s.id] ?? "MANTER"}
                onEscolher={(d) => setEscolhas((e) => ({ ...e, [s.id]: d }))}
                desabilitado={salvando}
              />
            ))}
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={aplicar} disabled={salvando}>
              <UserPlus size={14} />
              {salvando ? "Aplicando…" : "Aplicar sugestões"}
            </Button>
          </div>
        </Secao>
      )}

      {resolvidas && (
        <p className="flex items-center gap-1.5 text-[13px] text-ok">
          <Check size={14} /> Sugestões resolvidas.
        </p>
      )}

      <Secao icone={History} titulo="Histórico atualizado" tone="neutral">
        <ul className="flex flex-col gap-1 text-[13px] text-ink-2">
          <li>
            Última compra registrada — NF-e{" "}
            <span className="font-mono text-ink">{h.notaNumero}</span> ·{" "}
            {new Date(h.dataEmissao).toLocaleDateString("pt-BR")} ·{" "}
            {h.valorTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          </li>
          <li>
            {h.produtosTotal} item(ns) no histórico deste fornecedor
            {h.produtosNovos > 0 ? ` — ${h.produtosNovos} novo(s)` : ""}
          </li>
          {h.prazoMedioDias != null && <li>Prazo praticado recalculado: {h.prazoMedioDias} dias</li>}
        </ul>
      </Secao>
    </article>
  );
}

/**
 * A fila de sugestões da ficha do fornecedor. Mesma decisão do painel, sem o
 * resto do resumo — quem abre a ficha já sabe de quem se trata.
 */
export function SugestoesPendentes({
  sugestoes,
  onResolvido,
}: {
  sugestoes: AlteracaoSync[];
  onResolvido?: () => void;
}) {
  const [escolhas, setEscolhas] = useState<Record<string, DecisaoEscolhida>>(() =>
    Object.fromEntries(sugestoes.map((s) => [s.id, opcoesDe(s.campo, Boolean(s.antes))[0].valor])),
  );
  const [salvando, setSalvando] = useState(false);

  const vazio = sugestoes.length === 0;
  const titulo = useMemo(
    () =>
      sugestoes.length === 1
        ? "1 informação do XML esperando sua decisão"
        : `${sugestoes.length} informações do XML esperando sua decisão`,
    [sugestoes.length],
  );

  if (vazio) return null;

  async function aplicar() {
    setSalvando(true);
    try {
      const r = await decidirSugestoesAction(
        sugestoes.map((s) => ({ id: s.id, decisao: escolhas[s.id] })),
      );
      if (r.falhas.length > 0) toast.error("Nem tudo foi aplicado.", r.falhas[0]);
      else toast.success(`${r.aplicadas} sugestão(ões) aplicada(s).`);
      onResolvido?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao aplicar as sugestões.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-accent/40 bg-accent-soft/40 p-4">
      <h3 className="flex items-center gap-2 text-sm font-medium text-ink">
        <Sparkles size={15} className="text-accent" />
        {titulo}
      </h3>

      <div className="flex flex-col gap-2">
        {sugestoes.map((s) => (
          <LinhaSugestao
            key={s.id}
            sugestao={s}
            escolha={escolhas[s.id] ?? "MANTER"}
            onEscolher={(d) => setEscolhas((e) => ({ ...e, [s.id]: d }))}
            desabilitado={salvando}
          />
        ))}
      </div>

      <div className="flex justify-end">
        <Button size="sm" onClick={aplicar} disabled={salvando}>
          {salvando ? "Aplicando…" : "Aplicar sugestões"}
        </Button>
      </div>
    </section>
  );
}
