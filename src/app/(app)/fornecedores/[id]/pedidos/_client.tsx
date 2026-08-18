"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ClipboardList, Search, Eye } from "lucide-react";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EstadoVazio, fmtMoney } from "../../../compras/_catalogo/ui";
import { PEDIDO_STATUS, StatusBadge, relDia, previsaoLabel } from "../../../compras/_ui";
import type { PedidoFornecedor } from "../_data";

// Aba Pedidos — só o que foi pedido A ESTE fornecedor. A visão de todos os
// pedidos, com kanban e ações de fluxo, continua em Compras › Pedidos.

const FILTROS = [
  { valor: "", label: "Todos os status" },
  { valor: "aberto", label: "Em aberto" },
  { valor: "RECEBIDO", label: "Recebidos" },
  { valor: "CANCELADO", label: "Cancelados" },
];

const ABERTOS = ["RASCUNHO", "ENVIADO", "AGUARDANDO", "EM_TRANSITO", "CONFERENCIA", "RECEBIDO_PARCIAL"];

export function PedidosFornecedor({
  pedidos,
  nome,
}: {
  pedidos: PedidoFornecedor[];
  nome: string;
}) {
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState("");

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return pedidos.filter((p) => {
      if (t && !p.numero.toLowerCase().includes(t) && !p.siteNome.toLowerCase().includes(t)) {
        return false;
      }
      if (status === "aberto") return ABERTOS.includes(p.status);
      if (status) return p.status === status;
      return true;
    });
  }, [pedidos, busca, status]);

  const total = lista.reduce((s, p) => s + (p.status === "CANCELADO" ? 0 : p.valorTotal), 0);

  if (pedidos.length === 0) {
    return (
      <EstadoVazio
        icon={<ClipboardList size={20} />}
        titulo={`Nenhum pedido para ${nome}`}
        descricao="Quando um pedido for gerado para este fornecedor — pela cesta, pela reposição inteligente ou à mão — ele aparece aqui."
        acao={
          <Link href="/compras/reposicao-inteligente">
            <Button size="sm" variant="secondary">
              Ver o que comprar
            </Button>
          </Link>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1 sm:max-w-72">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por número ou loja"
            className="pl-9"
            aria-label="Buscar pedido"
          />
        </div>
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="w-auto min-w-40"
          aria-label="Filtrar por status"
        >
          {FILTROS.map((f) => (
            <option key={f.valor} value={f.valor}>
              {f.label}
            </option>
          ))}
        </Select>
        <p className="ml-auto text-[12px] text-muted">
          {lista.length} pedido{lista.length === 1 ? "" : "s"} ·{" "}
          <span className="font-mono font-semibold text-ink">{fmtMoney(total)}</span>
        </p>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-line bg-surface">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint">
              <th className="px-4 py-2.5 font-medium">Número</th>
              <th className="px-3 py-2.5 font-medium">Data</th>
              <th className="px-3 py-2.5 font-medium">Loja</th>
              <th className="px-3 py-2.5 text-right font-medium">Itens</th>
              <th className="px-3 py-2.5 text-right font-medium">Valor</th>
              <th className="px-3 py-2.5 font-medium">Entrega prevista</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {lista.map((p) => {
              const st = PEDIDO_STATUS[p.status] ?? PEDIDO_STATUS.RASCUNHO;
              const Icone = st.icon;
              return (
                <tr key={p.id} className="border-b border-line last:border-0 hover:bg-surface-2/60">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg", st.soft, st.text)}>
                        <Icone size={13} />
                      </span>
                      <span className="font-mono text-[13px] font-semibold text-ink">{p.numero}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-[12px] text-muted">{relDia(p.createdAt)}</td>
                  <td className="max-w-40 px-3 py-2.5 text-[12px] text-muted">
                    <span className="block truncate">{p.siteNome}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-[12px] text-ink-2">{p.itens}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-[13px] font-semibold text-ink tnum">
                    {fmtMoney(p.valorTotal)}
                  </td>
                  <td className="px-3 py-2.5 text-[12px] text-muted">
                    {p.recebidoEm ? `Recebido ${relDia(p.recebidoEm)}` : previsaoLabel(p.previsaoEntrega)}
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <Link href={`/compras/pedidos?q=${encodeURIComponent(p.numero)}`}>
                      <Button size="sm" variant="ghost" title="Abrir em Compras › Pedidos">
                        <Eye size={14} />
                        Visualizar
                      </Button>
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
