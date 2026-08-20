"use client";

import { useState } from "react";
import { Copy, ExternalLink, FileText, Mail, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet } from "@/components/ui/sheet";
import {
  copiarTexto,
  escreverPdf,
  textoPedido,
  urlEmail,
  urlWhatsApp,
  type GrupoEnvio,
} from "./_solicitar";

// ── Reenviar/compartilhar um pedido já existente ──────────────
// Reaproveita o texto/canais do fluxo de criação (_solicitar.tsx), mas aqui
// o pedido já existe — nada é criado, só remontamos a mensagem e abrimos o
// canal escolhido.

export type PedidoReenvio = {
  numero: string;
  supplierId: string;
  supplierNome: string;
  supplierTelefone: string | null;
  supplierEmail: string | null;
  previsaoEntrega: string | null;
  observacao: string | null;
  items: {
    productId: string;
    nome: string;
    packagingNome: string | null;
    qtdPedida: number;
    custoUnitario: number;
  }[];
};

type Canal = "whatsapp" | "email" | "copiar" | "pdf";

const CANAIS: { key: Canal; icon: React.ElementType; titulo: string; desc: string }[] = [
  { key: "whatsapp", icon: MessageCircle, titulo: "WhatsApp", desc: "Abre a conversa com a mensagem pronta" },
  { key: "email", icon: Mail, titulo: "E-mail", desc: "Abre seu e-mail com o pedido preenchido" },
  { key: "copiar", icon: Copy, titulo: "Copiar lista", desc: "Copia o texto para colar onde quiser" },
  { key: "pdf", icon: FileText, titulo: "PDF", desc: "Versão limpa para imprimir ou anexar" },
];

function paraGrupoEnvio(p: PedidoReenvio): GrupoEnvio {
  return {
    supplierId: p.supplierId,
    supplierNome: p.supplierNome,
    telefone: p.supplierTelefone,
    email: p.supplierEmail,
    leadTimeDias: null,
    previsaoEntrega: p.previsaoEntrega,
    observacao: p.observacao,
    itens: p.items.map((it) => ({
      productId: it.productId,
      packagingId: null,
      nome: it.nome,
      qtd: it.qtdPedida,
      packagingNome: it.packagingNome,
      fatorConversao: 1,
      custoUnitCompra: it.custoUnitario,
    })),
  };
}

export function ReenviarSheet({
  pedido,
  empresa,
  onClose,
}: {
  pedido: PedidoReenvio;
  empresa: string;
  onClose: () => void;
}) {
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const grupo = paraGrupoEnvio(pedido);

  const disponivel: Record<Canal, boolean> = {
    whatsapp: !!grupo.telefone,
    email: !!grupo.email,
    copiar: true,
    pdf: true,
  };

  async function executar(c: Canal) {
    setErro(null);
    setCopiado(false);
    const texto = textoPedido(grupo, empresa, pedido.numero, c === "whatsapp");
    try {
      if (c === "whatsapp" && grupo.telefone) {
        window.open(urlWhatsApp(grupo.telefone, texto), "_blank");
      } else if (c === "email" && grupo.email) {
        window.location.href = urlEmail(grupo.email, empresa, pedido.numero, texto);
      } else if (c === "copiar") {
        await copiarTexto(textoPedido(grupo, empresa, pedido.numero, false));
        setCopiado(true);
      } else if (c === "pdf") {
        const janela = window.open("", "_blank");
        if (janela) escreverPdf(janela, [grupo], empresa, new Map([[grupo.supplierId, pedido.numero]]));
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível concluir. Tente de novo.");
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Reenviar ${pedido.numero}`}
      description={`${pedido.supplierNome} · escolha como quer compartilhar este pedido novamente.`}
      width="2xl"
    >
      <div className="flex flex-col gap-4">
        {erro && <p className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{erro}</p>}
        {copiado && <p className="rounded-lg bg-ok-soft px-3 py-2.5 text-sm text-ok">Texto copiado para a área de transferência.</p>}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {CANAIS.map(({ key, icon: Icon, titulo, desc }) => {
            const off = !disponivel[key];
            return (
              <button
                key={key}
                type="button"
                disabled={off}
                onClick={() => executar(key)}
                className={cn(
                  "group flex items-start gap-3 rounded-2xl border border-line bg-surface p-4 text-left transition-colors",
                  "hover:border-brand hover:bg-brand-soft/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)",
                  off && "opacity-45 hover:border-line hover:bg-surface",
                )}
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted transition-colors group-hover:bg-brand-soft group-hover:text-brand">
                  <Icon size={18} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink">{titulo}</span>
                  <span className="block text-xs leading-snug text-muted">
                    {off
                      ? key === "whatsapp"
                        ? "Fornecedor sem telefone cadastrado"
                        : "Fornecedor sem e-mail cadastrado"
                      : desc}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-line px-4 py-3 text-sm font-medium text-muted transition-colors hover:border-line-strong hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
        >
          <ExternalLink size={15} /> Fechar
        </button>
      </div>
    </Sheet>
  );
}
