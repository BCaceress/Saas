"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { cn, brl } from "@/lib/utils";
import { Card, Badge } from "@/components/ui/misc";

type Plan = {
  nome: string;
  destaque?: boolean;
  trial?: boolean;
  mensal: number;
  anual: number;
  limite: string;
  recursos: string[];
};

const PLANS: Plan[] = [
  {
    nome: "Starter",
    trial: true,
    mensal: 79,
    anual: 69,
    limite: "Até 50 produtos · 1 ponto",
    recursos: ["Cadastro de produtos", "Controle de estoque", "Busca por código de barras", "Importação por CSV"],
  },
  {
    nome: "Pro",
    destaque: true,
    trial: true,
    mensal: 149,
    anual: 129,
    limite: "Produtos ilimitados · 1 ponto",
    recursos: ["Tudo do Starter", "Combos e receitas", "Fornecedores e custos", "Perfis fiscais", "Venda online por canal"],
  },
  {
    nome: "Multi",
    mensal: 299,
    anual: 259,
    limite: "Vários pontos · CD",
    recursos: ["Tudo do Pro", "Multi-loja e transferências", "Reposição por rota", "Relatórios consolidados", "Usuários por papel"],
  },
];

export function Pricing() {
  const [anual, setAnual] = useState(true);

  return (
    <div>
      <div className="mb-8 flex items-center justify-center gap-3">
        <span className={cn("text-sm", !anual ? "text-ink font-medium" : "text-muted")}>Mensal</span>
        <button
          role="switch"
          aria-checked={anual}
          aria-label="Alternar cobrança anual"
          onClick={() => setAnual((v) => !v)}
          className={cn(
            "relative h-6 w-11 rounded-full border border-line-strong transition-colors",
            anual ? "bg-brand" : "bg-surface-2"
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow transition-all",
              anual ? "left-5.5" : "left-0.5"
            )}
            style={{ height: 18, width: 18 }}
          />
        </button>
        <span className={cn("text-sm", anual ? "text-ink font-medium" : "text-muted")}>
          Anual <span className="text-accent">−2 meses</span>
        </span>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        {PLANS.map((p) => (
          <Card
            key={p.nome}
            className={cn(
              "flex flex-col p-6",
              p.destaque && "border-brand ring-1 ring-brand"
            )}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-xl font-semibold text-ink">{p.nome}</h3>
              {p.destaque && <Badge tone="brand">Mais escolhido</Badge>}
            </div>
            <div className="mt-3 flex items-baseline gap-1">
              <span className="font-display text-3xl font-bold text-ink tnum">
                {brl(anual ? p.anual : p.mensal)}
              </span>
              <span className="text-sm text-muted">/mês</span>
            </div>
            <p className="mt-1 text-[13px] text-muted">{p.limite}</p>

            <Link
              href="/cadastro"
              className={cn(
                "mt-5 inline-flex h-10 items-center justify-center rounded-[var(--radius)] text-sm font-medium transition-colors",
                p.destaque
                  ? "bg-brand text-on-brand hover:bg-brand-strong"
                  : "border border-line-strong bg-surface text-ink hover:bg-surface-2"
              )}
            >
              {p.trial ? "Testar grátis 14 dias" : "Falar com vendas"}
            </Link>

            <ul className="mt-6 flex flex-col gap-2.5">
              {p.recursos.map((r) => (
                <li key={r} className="flex items-start gap-2 text-[13px] text-ink-2">
                  <Check size={15} className="mt-0.5 shrink-0 text-brand" />
                  {r}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}
