"use client";

import {
  ChevronLeft,
  ChevronRight,
  CircleX,
  Copy,
  Eye,
  FileText,
  Gift,
  Loader2,
  MoreHorizontal,
  PackageX,
  Pencil,
  Receipt,
  Trash2,
  TriangleAlert,
  Truck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Menu, MenuItem } from "@/components/ui/menu";
import {
  fmtMoney,
  previsaoLabel,
  relTempo,
  PurchaseOrderStatusBadge,
  SupplierAvatar,
  PEDIDO_A_RECEBER,
} from "../cotacoes/_ui";
import type { PedidoView } from "./_pedidos";

// ── Visualização em lista — análise, busca e produtividade ─────
//
// Só ações do PEDIDO moram aqui. "Iniciar recebimento" saiu da linha de
// propósito: receber é uma operação com fila, conferência e divergência
// próprias, e ela vive inteira em /recebimento. Esta tela responde "quais
// pedidos eu tenho e em que situação estão?" — a coluna Recebimento mostra o
// RESULTADO da outra tela, sem virar um atalho para executá-la.

export type PoAcoes = {
  onVer: (p: PedidoView) => void;
  onEditar: (p: PedidoView) => void;
  onDuplicar: (p: PedidoView) => void;
  onCancelar: (p: PedidoView) => void;
  onExcluir: (p: PedidoView) => void;
};

/**
 * "60/100 — 60%": quanto do pedido já chegou.
 *
 * A conta sai de `qtdRecebida` dos itens, que só se move quando um recebimento
 * é FINALIZADO. Contar recebimentos daria outro número (e o errado): dois
 * podem somar 40%, um só pode somar 100%.
 */
function progressoDoPedido(p: PedidoView): { pedido: number; recebido: number; pct: number } {
  const pedido = p.items.reduce((a, i) => a + i.qtdPedida, 0);
  const recebido = p.items.reduce((a, i) => a + Math.min(i.qtdRecebida, i.qtdPedida), 0);
  return { pedido, recebido, pct: pedido > 0 ? Math.round((recebido / pedido) * 100) : 0 };
}

const fmtQtdCurta = (v: number) =>
  Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, "").replace(/[.,]$/, "");

/**
 * O medidor do recebimento — a resposta de "já chegou?" sem abrir o pedido.
 *
 * Informativo, e só. Ele mostra o que a tela de Recebimentos produziu; clicar
 * nele não inicia nada, porque o pedido não vira recebimento — ele ganha
 * recebimentos, que nascem do outro lado.
 */
function ProgressoRecebimento({ pedido: p }: { pedido: PedidoView }) {
  const { pedido, recebido, pct } = progressoDoPedido(p);
  if (pedido <= 0) return <span className="text-[11px] text-faint">—</span>;

  const completo = pct >= 100;
  return (
    <span className="flex min-w-24 flex-col gap-1">
      <span className="whitespace-nowrap text-[12px] tabular-nums text-ink-2">
        {fmtQtdCurta(recebido)}/{fmtQtdCurta(pedido)} un.
        <span className={cn("ml-1", completo ? "text-ok" : recebido > 0 ? "text-accent" : "text-faint")}>
          {pct}%
        </span>
      </span>
      <span className="flex h-1 w-full overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <span
          className={cn("h-full transition-[width] duration-300 motion-reduce:transition-none", completo ? "bg-ok" : "bg-accent")}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </span>
    </span>
  );
}

function previsaoComAno(iso: string | null): string {
  if (!iso) return previsaoLabel(iso);
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const diaDe = (x: Date) =>
  Math.floor(new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime() / 86400000);

/** Dias de atraso; 0 = vence hoje; null = sem previsão ou ainda no prazo. */
function atrasoEmDias(iso: string | null): number | null {
  if (!iso) return null;
  const diff = diaDe(new Date(iso)) - diaDe(new Date());
  return diff <= 0 ? -diff : null;
}

/** Só o sinal do prazo — ícone vermelho p/ atraso, âmbar p/ entrega hoje. */
function sinalPrazo(iso: string | null): { icon: React.ElementType; cls: string; title: string } | null {
  const atraso = atrasoEmDias(iso);
  if (atraso == null) return null;
  if (atraso === 0) return { icon: Truck, cls: "text-accent", title: "Previsto para hoje" };
  return {
    icon: TriangleAlert,
    cls: "text-danger",
    title: `Atrasado há ${atraso} ${atraso === 1 ? "dia" : "dias"}`,
  };
}

/**
 * Sinais do pedido, colados no número. Cada um responde a uma pergunta
 * diferente, e é por isso que têm cores diferentes:
 *   violeta — o QUE tem dentro (bonificação)
 *   cyan    — que DOCUMENTO existe (NF-e vinculada)
 *   âmbar   — o que TRAVOU (saldo sem decisão)
 *   cinza   — de ONDE veio (pedido retroativo, criado por um documento)
 *
 * Teto de três visíveis por linha: um quarto sinal aceso ao mesmo tempo vira
 * ruído, e sinal que está sempre aceso não é sinal.
 */
function SinaisPedido({ pedido: p, aberto }: { pedido: PedidoView; aberto: boolean }) {
  // Pedido que nasceu de um documento (XML, DFe, lançamento manual) não foi
  // planejado por ninguém — ler a lista sem essa distinção faz parecer que a
  // loja comprou o que na verdade só recebeu.
  const retroativo = p.origem === "XML" || p.origem === "DFE" || p.origem === "ENTRADA_MANUAL";
  return (
    <>
      {p.temBonificacao && (
        <span title="Tem bonificação" aria-label="Tem bonificação" className="inline-flex shrink-0 text-violet">
          <Gift size={12} />
        </span>
      )}
      {aberto && p.temNota && (
        <span
          title="NF-e vinculada — a conferência sai pelo XML"
          aria-label="NF-e vinculada"
          className="inline-flex shrink-0 text-brand"
        >
          <Receipt size={12} />
        </span>
      )}
      {p.saldoPendente && (
        <span
          title="Chegou em parte e ninguém decidiu o que fazer com o resto"
          aria-label="Saldo sem decisão"
          className="inline-flex shrink-0 text-accent"
        >
          <PackageX size={12} />
        </span>
      )}
      {retroativo && (
        <span
          title={
            p.origem === "ENTRADA_MANUAL"
              ? "Criado por um lançamento manual no estoque"
              : "Criado pela nota do fornecedor — não houve pedido antes"
          }
          aria-label="Pedido retroativo"
          className="inline-flex shrink-0 text-faint"
        >
          <FileText size={12} />
        </span>
      )}
    </>
  );
}

export function PurchaseOrderList({
  pedidos,
  acoes,
  statusPendingId = null,
  compacta = false,
  pagina,
  totalPaginas,
  onPagina,
}: {
  pedidos: PedidoView[];
  acoes: PoAcoes;
  /** Id do pedido cujo status está sendo alterado — mostra loading na coluna Status. */
  statusPendingId?: string | null;
  /** Versão mobile — cards empilhados em vez de tabela. */
  compacta?: boolean;
  pagina: number;
  totalPaginas: number;
  onPagina: (p: number) => void;
}) {
  if (compacta) {
    return (
      <div className="flex flex-col gap-2">
        {pedidos.map((p) => (
          <PurchaseOrderCardRow
            key={p.id}
            pedido={p}
            acoes={acoes}
            statusPending={p.id === statusPendingId}
          />
        ))}
        <Paginacao pagina={pagina} total={totalPaginas} onPage={onPagina} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-wide text-faint">
              <th className="px-4 py-2.5">Pedido</th>
              <th className="px-4 py-2.5">Fornecedor</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Recebimento</th>
              <th className="px-4 py-2.5 text-right">Valor</th>
              <th className="px-4 py-2.5">Entrega prevista</th>
              <th className="w-px px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {pedidos.map((p) => (
              <PurchaseOrderRow
                key={p.id}
                pedido={p}
                acoes={acoes}
                statusPending={p.id === statusPendingId}
              />
            ))}
          </tbody>
        </table>
      </div>
      <Paginacao pagina={pagina} total={totalPaginas} onPage={onPagina} />
    </div>
  );
}

export function PurchaseOrderRow({
  pedido: p,
  acoes,
  statusPending = false,
}: {
  pedido: PedidoView;
  acoes: PoAcoes;
  statusPending?: boolean;
}) {
  const aberto = PEDIDO_A_RECEBER.includes(p.status);
  const prazo = aberto ? sinalPrazo(p.previsaoEntrega) : null;
  const atrasado = aberto && (atrasoEmDias(p.previsaoEntrega) ?? 0) > 0;

  return (
    <tr
      onClick={() => acoes.onVer(p)}
      className={cn(
        "group cursor-pointer transition-colors",
        // A informação mais urgente da tela estava num ícone de 14px na sétima
        // coluna. Tingir a linha faz o atraso ser visto antes de ser lido.
        atrasado ? "bg-danger/5 hover:bg-danger/10" : "hover:bg-surface-2/60",
      )}
    >
      <td className="relative px-4 py-2.5">
        {atrasado && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-danger" />}
        <span className="flex items-center gap-1.5">
          <span className="font-mono text-[13px] font-semibold text-ink">{p.numero}</span>
          <SinaisPedido pedido={p} aberto={aberto} />
        </span>
        <span className="block text-[11px] text-faint">
          {p.siteNome} · {p.totalItems} {p.totalItems === 1 ? "produto" : "produtos"}
        </span>
      </td>
      <td className="px-4 py-2.5">
        <span className="flex items-center gap-2">
          <SupplierAvatar nome={p.supplierNome} logoUrl={p.supplierLogoUrl} />
          <span className="min-w-0">
            <span className="block max-w-44 truncate font-medium text-ink">{p.supplierNome}</span>
            {/* "Última atualização" e "Responsável" saíram de colunas próprias:
                ocupavam largura permanente, empurravam o botão Receber para
                fora em 13", e nenhuma das duas decide alguma coisa na lista. */}
            <span className="block max-w-44 truncate text-[11px] text-faint">
              {relTempo(p.updatedAt)}
              {p.operador && ` · ${p.operador.split(" ")[0]}`}
            </span>
          </span>
        </span>
      </td>
      <td className="px-4 py-2.5">
        {statusPending ? (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold text-muted">
            <Loader2 size={12} className="animate-spin" /> Atualizando…
          </span>
        ) : (
          <PurchaseOrderStatusBadge status={p.status} />
        )}
      </td>
      <td className="px-4 py-2.5">
        <ProgressoRecebimento pedido={p} />
      </td>
      <td className="px-4 py-2.5 text-right">
        <span className="block font-medium tabular-nums text-ink">{fmtMoney(p.valorTotal)}</span>
        {/* Em pedido parcial o total já não é o que interessa: o que interessa
            é quanto ainda falta chegar. */}
        {aberto && p.valorSaldo > 0 && p.valorSaldo < p.valorTotal - 0.005 && (
          <span className="block text-[11px] tabular-nums text-accent">
            falta {fmtMoney(p.valorSaldo)}
          </span>
        )}
      </td>
      <td className="px-4 py-2.5">
        <span className="flex items-center gap-1.5 whitespace-nowrap text-muted">
          {previsaoComAno(p.previsaoEntrega)}
          {prazo && (
            <span title={prazo.title} aria-label={prazo.title} className={cn("inline-flex shrink-0", prazo.cls)}>
              <prazo.icon size={14} />
            </span>
          )}
        </span>
      </td>
      <td className="w-px whitespace-nowrap px-4 py-2.5 text-right">
        <span className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              acoes.onVer(p);
            }}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-surface-2"
          >
            <Eye size={13} className="text-muted" /> Ver pedido
          </button>
          <AcoesDoPedido pedido={p} acoes={acoes} />
        </span>
      </td>
    </tr>
  );
}

/**
 * Menu secundário da linha. Tudo aqui pertence ao ciclo do pedido — editar,
 * duplicar, cancelar, excluir. Nada de recebimento: essas ações são de
 * /recebimento, e oferecê-las nos dois lugares criaria dois caminhos para
 * mover estoque, com regras que fatalmente divergem.
 */
function AcoesDoPedido({ pedido: p, acoes }: { pedido: PedidoView; acoes: PoAcoes }) {
  const rascunho = p.status === "RASCUNHO";
  const encerrado = p.status === "RECEBIDO" || p.status === "CANCELADO";
  return (
    <span onClick={(e) => e.stopPropagation()}>
      <Menu
        trigger={
          <button
            type="button"
            aria-label={`Mais ações do pedido ${p.numero}`}
            className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <MoreHorizontal size={16} />
          </button>
        }
      >
        <MenuItem icon={<Eye size={14} />} onClick={() => acoes.onVer(p)}>
          Ver pedido
        </MenuItem>
        {/* Editar só em rascunho: pedido já enviado ao fornecedor mudou de
            mãos — alterar itens por baixo faria a tela e o fornecedor
            discordarem sobre o que foi comprado. */}
        <MenuItem icon={<Pencil size={14} />} disabled={!rascunho} onClick={() => acoes.onEditar(p)}>
          Editar pedido
        </MenuItem>
        <MenuItem icon={<Copy size={14} />} onClick={() => acoes.onDuplicar(p)}>
          Duplicar pedido
        </MenuItem>
        <MenuItem icon={<CircleX size={14} />} danger disabled={encerrado} onClick={() => acoes.onCancelar(p)}>
          Cancelar pedido
        </MenuItem>
        {rascunho && (
          <MenuItem icon={<Trash2 size={14} />} danger onClick={() => acoes.onExcluir(p)}>
            Excluir rascunho
          </MenuItem>
        )}
      </Menu>
    </span>
  );
}

/** Linha-card usada na versão mobile da lista. */
function PurchaseOrderCardRow({
  pedido: p,
  acoes,
  statusPending = false,
}: {
  pedido: PedidoView;
  acoes: PoAcoes;
  statusPending?: boolean;
}) {
  const aberto = PEDIDO_A_RECEBER.includes(p.status);
  const prazo = aberto ? sinalPrazo(p.previsaoEntrega) : null;
  const atrasado = aberto && (atrasoEmDias(p.previsaoEntrega) ?? 0) > 0;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => acoes.onVer(p)}
      onKeyDown={(e) => e.key === "Enter" && acoes.onVer(p)}
      className={cn(
        "flex cursor-pointer flex-col gap-2 rounded-lg border p-3.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)",
        atrasado
          ? "border-danger/30 bg-danger/5"
          : "border-line bg-surface hover:bg-surface-2/60",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <span className="font-mono text-[13px] font-semibold text-ink">{p.numero}</span>
          <SinaisPedido pedido={p} aberto={aberto} />
        </span>
        {statusPending ? (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold text-muted">
            <Loader2 size={12} className="animate-spin" /> Atualizando…
          </span>
        ) : (
          <PurchaseOrderStatusBadge status={p.status} />
        )}
      </div>
      <div className="flex items-center gap-2">
        <SupplierAvatar nome={p.supplierNome} logoUrl={p.supplierLogoUrl} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{p.supplierNome}</span>
      </div>
      <ProgressoRecebimento pedido={p} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span className="tabular-nums">{p.totalItems}</span>
        <span className="font-medium tabular-nums text-ink">{fmtMoney(p.valorTotal)}</span>
        {aberto && p.valorSaldo > 0 && p.valorSaldo < p.valorTotal - 0.005 && (
          <span className="tabular-nums text-accent">falta {fmtMoney(p.valorSaldo)}</span>
        )}
        {p.previsaoEntrega && (
          <span className="inline-flex items-center gap-1.5">
            Entrega {previsaoComAno(p.previsaoEntrega)}
            {prazo && (
              <span title={prazo.title} aria-label={prazo.title} className={cn("inline-flex shrink-0", prazo.cls)}>
                <prazo.icon size={14} />
              </span>
            )}
          </span>
        )}
        <span className="text-faint">{relTempo(p.updatedAt)}</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            acoes.onVer(p);
          }}
          className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface-2"
        >
          <Eye size={14} className="text-muted" /> Ver pedido
        </button>
        <AcoesDoPedido pedido={p} acoes={acoes} />
      </div>
    </div>
  );
}

function Paginacao({
  pagina,
  total,
  onPage,
}: {
  pagina: number;
  total: number;
  onPage: (p: number) => void;
}) {
  if (total <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={() => onPage(pagina - 1)}
        disabled={pagina <= 1}
        aria-label="Página anterior"
        className="grid h-8 w-8 place-items-center rounded-sm border border-line text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40"
      >
        <ChevronLeft size={15} />
      </button>
      <span className="px-2 text-xs font-medium tabular-nums text-muted">
        {pagina} <span className="text-faint">/ {total}</span>
      </span>
      <button
        type="button"
        onClick={() => onPage(pagina + 1)}
        disabled={pagina >= total}
        aria-label="Próxima página"
        className="grid h-8 w-8 place-items-center rounded-sm border border-line text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40"
      >
        <ChevronRight size={15} />
      </button>
    </div>
  );
}
