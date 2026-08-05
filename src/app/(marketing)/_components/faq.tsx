"use client";

import { useId, useState } from "react";
import { Plus, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { PLANOS, TRIAL_DIAS } from "@/lib/planos";

const ITEMS = [
  {
    q: "O PDV funciona se a internet cair?",
    a: "Funciona. A venda em dinheiro continua no caixa mesmo sem conexão e sincroniza quando a internet volta. Cartão e Pix dependem do meio de pagamento estar online.",
  },
  {
    q: "Integra com maquininha e Pix?",
    a: "Sim. Pix dinâmico e maquininha pelo Mercado Pago já funcionam no PDV, com confirmação automática do pagamento. Na versão desktop também há integração com pinpad via TEF.",
  },
  {
    q: "Emite nota fiscal?",
    a: "Emite NFC-e e NF-e com o seu certificado digital, e também recebe a nota do fornecedor pelo XML — a entrada de estoque sai direto dela. A emissão é um add-on, porque o custo por documento é variável.",
  },
  {
    q: "Quantas lojas posso ter?",
    a: `No ${PLANOS.PRATA.nome}, uma. No ${PLANOS.OURO.nome}, até três, com transferência entre elas. No ${PLANOS.DIAMANTE.nome}, sem limite, com centro de distribuição e rota de reposição. Você troca de plano por dentro do sistema, sem migração.`,
  },
  {
    q: "Dá para trazer meu cadastro atual?",
    a: "Dá. A importação por CSV traz a planilha antiga, e o cadastro por código de barras completa o que faltar com nome, marca, categoria e dados fiscais.",
  },
  {
    q: `Preciso de cartão para testar?`,
    a: `Não. São ${TRIAL_DIAS} dias completos sem cartão. Ele só entra se você decidir continuar ao fim do teste.`,
  },
  {
    q: "Meus dados são meus?",
    a: "São. Cada mercado tem os dados isolados dos demais. Você exporta tudo quando quiser e pode pedir a exclusão completa a qualquer momento.",
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  const id = useId();

  return (
    <div className="divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
      {ITEMS.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={item.q}>
            <button
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
              aria-controls={`${id}-${i}`}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-surface-2"
            >
              <span className="font-medium text-ink">{item.q}</span>
              {isOpen ? (
                <Minus size={18} className="shrink-0 text-brand" />
              ) : (
                <Plus size={18} className="shrink-0 text-muted" />
              )}
            </button>
            <div
              id={`${id}-${i}`}
              className={cn(
                "grid overflow-hidden px-5 transition-all",
                isOpen ? "grid-rows-[1fr] pb-4" : "grid-rows-[0fr]",
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
