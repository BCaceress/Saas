"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckCheck,
  ClipboardCheck,
  Loader2,
  MapPin,
  Truck,
  X,
} from "lucide-react";
import { brl, cn } from "@/lib/utils";
import { Card } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { StatusBadge, SupplierAvatar } from "@/app/(app)/compras/_ui";
import {
  cancelarPedidoCompraAction,
  marcarAguardandoPedidoAction,
  marcarEmTransitoPedidoAction,
} from "@/app/(app)/estoque/actions";

/** O que a lista precisa saber de cada pedido — nem uma coluna a mais. */
export type PedidoAReceber = {
  id: string;
  numero: string;
  status: string;
  supplierNome: string;
  supplierLogoUrl: string | null;
  siteNome: string;
  totalItems: number;
  valorTotal: number;
  previsaoEntrega: string | null;
  /** Quem só confere na porta vê a lista, mas não destrava nem cancela pedido. */
  podePedir: boolean;
};

/**
 * Pedidos esperando mercadoria na porta.
 *
 * Cada cartão traz as ações de acompanhamento — mover o status e
 * cancelar —, porque a pergunta do fornecedor ("saiu para entrega?") chega
 * enquanto se está justamente nesta tela, e mandar a pessoa trocar de tela para
 * responder é o que fazia o status envelhecer.
 */
export function ReceberClient({
  pedidos,
  multiSite,
}: {
  pedidos: PedidoAReceber[];
  /** O tenant tem mais de uma loja — só aí a etiqueta de loja informa algo. */
  multiSite: boolean;
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = React.useState<string | null>(null);

  async function agir(id: string, acao: () => Promise<unknown>, mensagem: string) {
    setOcupado(id);
    try {
      await acao();
      toast.success(mensagem);
      router.refresh();
    } catch (e) {
      toast.error("Não foi possível", e instanceof Error ? e.message : undefined);
    } finally {
      setOcupado(null);
    }
  }

  if (pedidos.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-2 p-8 text-center">
        <Truck className="h-8 w-8 text-muted" aria-hidden />
        <p className="font-display text-base font-semibold text-ink">
          Nenhum pedido a receber
        </p>
        <p className="text-sm text-ink-2">
          Quando um pedido for enviado ao fornecedor, ele aparece aqui.
        </p>
      </Card>
    );
  }

  return (
    <ul className="space-y-2">
      {pedidos.map((p) => {
        const trabalhando = ocupado === p.id;
        return (
          <li key={p.id}>
            <Card className="overflow-hidden">
              {/* Logo à esquerda: na porta, quem confere reconhece o fornecedor
                  pela marca do caminhão antes de ler a razão social. O selo de
                  status usa o MESMO componente do /compras/pedidos — cor e
                  ícone de "em trânsito" não podem mudar de significado entre as
                  duas superfícies. */}
              <Link
                href={`/m/receber/${p.id}`}
                className="flex items-start gap-3 p-4 hover:bg-surface-2"
              >
                <SupplierAvatar
                  nome={p.supplierNome}
                  logoUrl={p.supplierLogoUrl}
                  size={40}
                />

                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">{p.supplierNome}</p>
                  <p className="truncate text-xs text-muted">
                    <span className="font-mono">{p.numero}</span> · {p.totalItems}{" "}
                    {p.totalItems === 1 ? "item" : "itens"} · {brl(p.valorTotal)}
                  </p>

                  {/* A loja só aparece quando existe mais de uma: numa operação
                      de ponto único ela seria a mesma etiqueta em todas as
                      linhas. */}
                  {multiSite && (
                    <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-1 text-[11px] font-medium text-ink-2">
                      <MapPin className="h-3 w-3" aria-hidden />
                      {p.siteNome}
                    </span>
                  )}

                  {p.previsaoEntrega && (
                    <p className="mt-1 text-xs text-ink-2">
                      previsto {new Date(p.previsaoEntrega).toLocaleDateString("pt-BR")}
                    </p>
                  )}
                </div>

                {/* Selo na borda direita: com dez pedidos na tela, o status é o
                    que se varre de cima a baixo, e varrer exige uma coluna. */}
                <span className="shrink-0">
                  <StatusBadge status={p.status} />
                </span>
              </Link>

              <div className="flex divide-x divide-line border-t border-line">
                <LinkAcao href={`/m/receber/${p.id}`}>
                  <ClipboardCheck className="h-4 w-4" aria-hidden />
                  Conferir
                </LinkAcao>

                {p.podePedir && p.status === "ENVIADO" && (
                  <Acao
                    ocupado={trabalhando}
                    onClick={() =>
                      agir(
                        p.id,
                        () => marcarAguardandoPedidoAction(p.id),
                        "Marcado como confirmado pelo fornecedor.",
                      )
                    }
                  >
                    <CheckCheck className="h-4 w-4" aria-hidden />
                    Confirmado
                  </Acao>
                )}

                {p.podePedir && p.status === "AGUARDANDO" && (
                  <Acao
                    ocupado={trabalhando}
                    onClick={() =>
                      agir(p.id, () => marcarEmTransitoPedidoAction(p.id), "Pedido em trânsito.")
                    }
                  >
                    <Truck className="h-4 w-4" aria-hidden />
                    Saiu para entrega
                  </Acao>
                )}

                {p.podePedir && (
                  <Acao
                    ocupado={trabalhando}
                    tom="danger"
                    onClick={() =>
                      agir(p.id, () => cancelarPedidoCompraAction(p.id), "Pedido cancelado.")
                    }
                  >
                    <X className="h-4 w-4" aria-hidden />
                    Cancelar
                  </Acao>
                )}
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

function Acao({
  onClick,
  ocupado,
  tom = "normal",
  children,
}: {
  onClick: () => void;
  ocupado: boolean;
  tom?: "normal" | "danger";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={ocupado}
      className={cn(
        "flex min-h-12 flex-1 cursor-pointer items-center justify-center gap-1.5 text-[13px] font-medium transition-colors disabled:opacity-50",
        tom === "danger"
          ? "text-muted hover:bg-danger-soft hover:text-danger"
          : "text-ink-2 hover:bg-surface-2 hover:text-ink",
      )}
    >
      {ocupado ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : children}
    </button>
  );
}

function LinkAcao({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex min-h-12 flex-1 items-center justify-center gap-1.5 text-[13px] font-medium text-brand hover:bg-brand-soft"
    >
      {children}
    </Link>
  );
}
