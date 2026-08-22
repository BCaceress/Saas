"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PackageX, RotateCcw, Clock, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { carregarSaldoPedidoAction, resolverSaldoPedidoAction } from "./saldo-actions";
import { fmtMoney, fmtQtd } from "../cotacoes/_ui";
import type { SaldoPedido } from "@/lib/compras/saldo-pedido";

// ============================================================
// O saldo do pedido parcial precisa de um dono.
//
// "Recebimento parcial" descrevia o passado e não pedia nada do presente: o
// pedido ficava aberto para sempre, entulhando a fila e fazendo a reposição
// contar mercadoria que nunca chegaria.
//
// Três desfechos, e nenhum é o padrão silencioso de antes:
//   • o resto vem depois          → segue aberto, mas agora por decisão
//   • o fornecedor cortou         → encerra, e o pedido fecha pelo que chegou
//   • o resto vira pedido novo    → backorder encadeado no original
// ============================================================

type Acao = "MANTER" | "ENCERRAR" | "REPEDIR";

const ACOES: { value: Acao; label: string; desc: string; icon: React.ElementType }[] = [
  {
    value: "MANTER",
    label: "O resto ainda vem",
    desc: "O pedido segue aberto esperando a entrega do saldo.",
    icon: Clock,
  },
  {
    value: "ENCERRAR",
    label: "Não vem mais",
    desc: "O fornecedor cortou. O pedido fecha pelo que chegou.",
    icon: PackageX,
  },
  {
    value: "REPEDIR",
    label: "Pedir de novo",
    desc: "O saldo vira um pedido novo, ligado a este.",
    icon: RotateCcw,
  },
];

export function SaldoPedidoSheet({
  pedidoId,
  onClose,
}: {
  pedidoId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [saldo, setSaldo] = useState<SaldoPedido | null | "carregando">("carregando");
  const [acao, setAcao] = useState<Acao>("MANTER");
  const [motivo, setMotivo] = useState("");
  const [enviarNovo, setEnviarNovo] = useState(true);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let vivo = true;
    carregarSaldoPedidoAction(pedidoId)
      .then((r) => {
        if (!vivo) return;
        setSaldo(r);
        // Todas as linhas marcadas por padrão: o corte total é o caso comum, e
        // desmarcar duas é menos trabalho do que marcar dez.
        setSelecionados(new Set(r?.linhas.map((l) => l.itemId) ?? []));
      })
      .catch(() => vivo && setSaldo(null));
    return () => {
      vivo = false;
    };
  }, [pedidoId]);

  if (saldo === "carregando") {
    return (
      <Sheet open onClose={onClose} title="Saldo do pedido" width="xl">
        <div className="flex items-center justify-center py-16">
          <Loader2 size={20} className="animate-spin text-faint" />
        </div>
      </Sheet>
    );
  }

  if (!saldo || saldo.linhas.length === 0) {
    return (
      <Sheet open onClose={onClose} title="Saldo do pedido" width="xl">
        <p className="py-10 text-center text-sm text-muted">
          Este pedido não tem saldo pendente — tudo o que foi pedido já chegou.
        </p>
      </Sheet>
    );
  }

  const escolhidas = saldo.linhas.filter((l) => selecionados.has(l.itemId));
  const valorEscolhido = escolhidas.reduce((a, l) => a + l.saldo * l.custoUnitario, 0);

  function submit() {
    setErro(null);
    if (motivo.trim().length < 3) {
      setErro("Diga o que aconteceu com o saldo — é o que o fornecedor vai ouvir.");
      return;
    }
    if (acao !== "MANTER" && escolhidas.length === 0) {
      setErro("Marque ao menos uma linha.");
      return;
    }

    start(async () => {
      try {
        const r = await resolverSaldoPedidoAction({
          pedidoId,
          acao,
          motivo,
          itemIds: acao === "MANTER" ? [] : escolhidas.map((l) => l.itemId),
          enviarNovoPedido: enviarNovo,
        });
        toast.success(
          r.acao === "REPEDIR"
            ? `Saldo virou o pedido ${r.novoPedidoNumero}.`
            : r.acao === "ENCERRAR"
              ? "Saldo encerrado — o pedido fechou pelo que chegou."
              : "Pedido segue aguardando o saldo.",
        );
        onClose();
        router.refresh();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Erro ao resolver o saldo.");
      }
    });
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Saldo do pedido ${saldo.numero}`}
      description={`${saldo.supplierNome} · ${saldo.linhas.length} ${saldo.linhas.length === 1 ? "item pendente" : "itens pendentes"}`}
      width="xl"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-muted">
            Saldo{" "}
            <span className="font-display text-[16px] font-semibold text-ink">
              {fmtMoney(acao === "MANTER" ? saldo.valorSaldo : valorEscolhido)}
            </span>
          </span>
          <Button size="sm" disabled={pending} onClick={submit}>
            {pending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            Confirmar
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {erro && (
          <p className="rounded-[var(--radius)] border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
            {erro}
          </p>
        )}

        <div className="grid gap-2 sm:grid-cols-3">
          {ACOES.map((a) => (
            <button
              key={a.value}
              type="button"
              onClick={() => setAcao(a.value)}
              className={cn(
                "flex flex-col gap-1 rounded-[var(--radius)] border px-3.5 py-3 text-left transition-colors",
                acao === a.value
                  ? "border-brand bg-brand-soft/50"
                  : "border-line bg-surface hover:bg-surface-2",
              )}
            >
              <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                <a.icon size={14} className="text-muted" />
                {a.label}
              </span>
              <span className="text-[11px] text-muted">{a.desc}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-wide text-faint">
            O que aconteceu
          </label>
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder={
              acao === "ENCERRAR"
                ? "Ex: fornecedor cortou — sem estoque na fábrica"
                : acao === "REPEDIR"
                  ? "Ex: pedir de novo com previsão para a semana que vem"
                  : "Ex: transportadora refaz a entrega na sexta"
            }
            className="w-full rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          />
          <p className="text-[11px] text-muted">
            Fica na linha do tempo do pedido — é o que responde “por que faltou?” daqui a um mês.
          </p>
        </div>

        {acao === "REPEDIR" && (
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={enviarNovo}
              onChange={(e) => setEnviarNovo(e.target.checked)}
              className="h-4 w-4 rounded border-line accent-[var(--color-brand)]"
            />
            Já enviar o pedido novo ao fornecedor
          </label>
        )}

        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-faint">
            {acao === "MANTER" ? "O que falta chegar" : "Linhas afetadas"}
          </label>
          <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
            {saldo.linhas.map((l) => {
              const marcada = selecionados.has(l.itemId);
              return (
                <li key={l.itemId} className="flex items-center gap-3 px-3.5 py-2.5">
                  {acao !== "MANTER" && (
                    <input
                      type="checkbox"
                      checked={marcada}
                      aria-label={`Incluir ${l.descricao}`}
                      onChange={(e) =>
                        setSelecionados((prev) => {
                          const s = new Set(prev);
                          if (e.target.checked) s.add(l.itemId);
                          else s.delete(l.itemId);
                          return s;
                        })
                      }
                      className="h-4 w-4 shrink-0 rounded border-line accent-[var(--color-brand)]"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">{l.descricao}</p>
                    <p className="text-[11px] text-muted">
                      Pedido {fmtQtd(l.qtdPedida)} · recebido {fmtQtd(l.qtdRecebida)}
                      {l.sku && <span className="ml-2 font-mono">{l.sku}</span>}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-display text-sm font-semibold text-ink">
                      falta {fmtQtd(l.saldo)}
                    </p>
                    <p className="text-[11px] text-muted">{fmtMoney(l.saldo * l.custoUnitario)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </Sheet>
  );
}
