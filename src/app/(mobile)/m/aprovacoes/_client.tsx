"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCheck, Loader2, Send, ShoppingCart, Truck, X } from "lucide-react";
import { brl, cn } from "@/lib/utils";
import { Badge, Card } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import {
  enviarPedidoCompraAction,
  marcarAguardandoPedidoAction,
  marcarEmTransitoPedidoAction,
  cancelarPedidoCompraAction,
} from "@/app/(app)/estoque/actions";
import { encerrarCotacaoAction } from "@/app/(app)/compras/cotacoes/actions";
import type { PedidoCompraView } from "@/app/(app)/estoque/_data";
import type { CotacaoRow } from "@/app/(app)/compras/cotacoes/_types";

type Aba = "pedidos" | "cotacoes";

const STATUS_PEDIDO: Record<string, string> = {
  RASCUNHO: "Rascunho",
  ENVIADO: "Enviado",
  AGUARDANDO: "Aguardando",
};

/**
 * Aprovações. Cada cartão traz UMA ação principal e uma saída — nada de
 * formulário. O que exige montar item, escolher fornecedor e negociar preço
 * continua no computador; o celular serve para destravar o que já está pronto.
 */
export function AprovacoesClient({
  pedidos,
  cotacoes,
}: {
  pedidos: PedidoCompraView[];
  cotacoes: CotacaoRow[];
}) {
  const [aba, setAba] = React.useState<Aba>(pedidos.length > 0 ? "pedidos" : "cotacoes");

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        <AbaBotao ativo={aba === "pedidos"} onClick={() => setAba("pedidos")}>
          Pedidos {pedidos.length}
        </AbaBotao>
        <AbaBotao ativo={aba === "cotacoes"} onClick={() => setAba("cotacoes")}>
          Cotações {cotacoes.length}
        </AbaBotao>
      </div>

      {aba === "pedidos" ? (
        <ListaPedidos pedidos={pedidos} />
      ) : (
        <ListaCotacoes cotacoes={cotacoes} />
      )}
    </div>
  );
}

function ListaPedidos({ pedidos }: { pedidos: PedidoCompraView[] }) {
  const router = useRouter();
  const [ocupado, setOcupado] = React.useState<string | null>(null);

  async function agir(
    id: string,
    acao: () => Promise<unknown>,
    mensagem: string,
  ) {
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
    return <Vazio icone={ShoppingCart} texto="Nenhum pedido esperando decisão." />;
  }

  return (
    <ul className="space-y-2">
      {pedidos.map((p) => {
        const trabalhando = ocupado === p.id;
        return (
          <li key={p.id}>
            <Card className="overflow-hidden">
              <div className="p-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink">{p.supplierNome}</p>
                    <p className="truncate text-xs text-muted">
                      <span className="font-mono">{p.numero}</span> · {p.totalItems}{" "}
                      {p.totalItems === 1 ? "item" : "itens"} · {brl(p.valorTotal)}
                    </p>
                  </div>
                  <Badge tone={p.status === "RASCUNHO" ? "warn" : "neutral"}>
                    {STATUS_PEDIDO[p.status] ?? p.status}
                  </Badge>
                </div>
              </div>

              <div className="flex divide-x divide-line border-t border-line">
                {p.status === "RASCUNHO" && (
                  <Acao
                    ocupado={trabalhando}
                    onClick={() =>
                      agir(p.id, () => enviarPedidoCompraAction(p.id), "Pedido enviado.")
                    }
                  >
                    <Send className="h-4 w-4" aria-hidden />
                    Enviar
                  </Acao>
                )}

                {p.status === "ENVIADO" && (
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

                {p.status === "AGUARDANDO" && (
                  <Acao
                    ocupado={trabalhando}
                    onClick={() =>
                      agir(
                        p.id,
                        () => marcarEmTransitoPedidoAction(p.id),
                        "Pedido em trânsito.",
                      )
                    }
                  >
                    <Truck className="h-4 w-4" aria-hidden />
                    Saiu para entrega
                  </Acao>
                )}

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
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

function ListaCotacoes({ cotacoes }: { cotacoes: CotacaoRow[] }) {
  const router = useRouter();
  const [ocupado, setOcupado] = React.useState<string | null>(null);

  async function encerrar(id: string) {
    setOcupado(id);
    try {
      await encerrarCotacaoAction(id);
      toast.success("Cotação encerrada.", "Compare e decida no computador.");
      router.refresh();
    } catch (e) {
      toast.error("Não foi possível encerrar", e instanceof Error ? e.message : undefined);
    } finally {
      setOcupado(null);
    }
  }

  if (cotacoes.length === 0) {
    return <Vazio icone={ShoppingCart} texto="Nenhuma cotação em andamento." />;
  }

  return (
    <ul className="space-y-2">
      {cotacoes.map((c) => (
        <li key={c.id}>
          <Card className="overflow-hidden">
            <div className="p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">{c.titulo}</p>
                  <p className="truncate text-xs text-muted">
                    <span className="font-mono">{c.numero}</span> · {c.totalItens}{" "}
                    {c.totalItens === 1 ? "item" : "itens"}
                  </p>
                  <p className="mt-1 text-xs text-ink-2">
                    {c.totalRespondidos} de {c.totalConvidados} responderam
                    {c.melhorTotal != null && ` · melhor ${brl(c.melhorTotal)}`}
                  </p>
                </div>
                <Badge tone={c.status === "ABERTA" ? "brand" : "neutral"}>
                  {c.status === "ABERTA" ? "Aberta" : "Encerrada"}
                </Badge>
              </div>
            </div>

            <div className="flex divide-x divide-line border-t border-line">
              {c.status === "ABERTA" && (
                <Acao ocupado={ocupado === c.id} onClick={() => encerrar(c.id)}>
                  <CheckCheck className="h-4 w-4" aria-hidden />
                  Encerrar
                </Acao>
              )}
              {/* Decidir vencedor é comparação item a item — tabela larga que
                  não cabe aqui sem virar rolagem lateral em três eixos. */}
              <LinkAcao href={`/compras/cotacoes/${c.id}`}>Comparar no computador</LinkAcao>
            </div>
          </Card>
        </li>
      ))}
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
      className="flex min-h-12 flex-1 items-center justify-center gap-1.5 text-[13px] font-medium text-ink-2 hover:bg-surface-2 hover:text-ink"
    >
      {children}
    </Link>
  );
}

function Vazio({
  icone: Icone,
  texto,
}: {
  icone: React.ComponentType<{ className?: string }>;
  texto: string;
}) {
  return (
    <Card className="flex flex-col items-center gap-2 p-8 text-center">
      <Icone className="h-8 w-8 text-muted" />
      <p className="text-sm text-ink-2">{texto}</p>
    </Card>
  );
}

function AbaBotao({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        "min-h-10 flex-1 cursor-pointer rounded-full border text-[13px] font-medium",
        ativo
          ? "border-transparent bg-brand text-on-brand"
          : "border-line-button bg-surface text-ink-2",
      )}
    >
      {children}
    </button>
  );
}
