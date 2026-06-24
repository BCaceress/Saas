"use client";

import { useState } from "react";
import { Plus, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  {
    q: "Funciona offline?",
    a: "O cadastro e a gestão rodam no navegador, com sincronização contínua. O PDV (fase seguinte) mantém a venda mesmo com a internet oscilando e sincroniza quando volta.",
  },
  {
    q: "Integra com a maquininha?",
    a: "Hoje o foco é o controle de produtos e estoque. A integração com meios de pagamento e maquininhas entra junto com o módulo de PDV — o cadastro já guarda os campos necessários.",
  },
  {
    q: "Quantos pontos posso cadastrar?",
    a: "No Starter, um ponto. No Multi, vários pontos e um centro de distribuição que abastece as lojas. Você troca de plano quando precisar, sem migração.",
  },
  {
    q: "Preciso de cartão para testar?",
    a: "Não. São 14 dias completos sem cartão. O cartão só entra se você decidir continuar ao fim do teste.",
  },
  {
    q: "Meus dados são meus?",
    a: "Sim. Cada mercado tem seus dados isolados. Você pode exportar tudo a qualquer momento e pedir a exclusão completa quando quiser.",
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="divide-y divide-line rounded-[var(--radius)] border border-line bg-surface">
      {ITEMS.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={item.q}>
            <button
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
            >
              <span className="font-medium text-ink">{item.q}</span>
              {isOpen ? (
                <Minus size={18} className="shrink-0 text-brand" />
              ) : (
                <Plus size={18} className="shrink-0 text-muted" />
              )}
            </button>
            <div
              className={cn(
                "grid overflow-hidden px-5 transition-all",
                isOpen ? "grid-rows-[1fr] pb-4" : "grid-rows-[0fr]"
              )}
            >
              <p className="min-h-0 text-sm leading-relaxed text-muted">{item.a}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
