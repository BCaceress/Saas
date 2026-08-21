"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarClock,
  Check,
  FileText,
  History,
  Package,
  Search,
  Sparkles,
  Wallet,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/misc";
import { SugestoesPendentes } from "@/components/fornecedor/sincronizacao";
import { EstadoVazio, Metrica, MetricaGrid, fmtMoney } from "../../../cotacoes/_catalogo/ui";
import { relDia } from "../../../cotacoes/_ui";
import type { EventoSync, HistoricoFornecedor } from "@/lib/fornecedores/historico";

// ============================================================
// Aba Histórico — o relacionamento com este fornecedor, construído sozinho
// pelos XMLs que já entraram.
//
// Responde três perguntas na ordem em que aparecem na cabeça do comprador:
// "quando comprei e em que condição?", "o que ele costuma me vender?" e
// "por que meu cadastro mudou?".
// ============================================================

const ICONE_EVENTO: Record<EventoSync["tipo"], React.ElementType> = {
  AUTOMATICO: Check,
  SUGESTAO: Sparkles,
  HISTORICO: History,
};

const COR_EVENTO: Record<EventoSync["tipo"], string> = {
  AUTOMATICO: "text-ok",
  SUGESTAO: "text-accent",
  HISTORICO: "text-muted",
};

const DECISAO_LABEL: Record<string, string> = {
  ATUALIZAR: "cadastro atualizado",
  CONTATO: "virou contato",
  PRINCIPAL: "virou contato principal",
  MANTER: "recusado",
};

function dataHora(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString("pt-BR")} ${d.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

export function HistoricoFornecedorClient({
  historico,
  podeEditar,
}: {
  historico: HistoricoFornecedor;
  podeEditar: boolean;
}) {
  const router = useRouter();
  const [busca, setBusca] = useState("");

  const produtos = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return historico.produtos;
    return historico.produtos.filter(
      (p) =>
        p.descricao.toLowerCase().includes(t) ||
        p.codigoFornecedor.toLowerCase().includes(t) ||
        (p.gtin ?? "").includes(t) ||
        (p.produto?.nome ?? "").toLowerCase().includes(t),
    );
  }, [historico.produtos, busca]);

  const semNada = historico.comprasNotas === 0 && historico.produtos.length === 0;

  if (semNada) {
    return (
      <EstadoVazio
        icon={<FileText size={20} />}
        titulo="Nenhuma nota deste fornecedor ainda"
        descricao="Assim que o primeiro XML de NF-e dele for importado, o cadastro se completa sozinho e o que ele vende passa a aparecer aqui."
        acao={
          <Link
            href="/fiscal/notas-recebidas"
            className="text-[13px] font-medium text-brand hover:underline"
          >
            Importar uma nota
          </Link>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {podeEditar && (
        <SugestoesPendentes sugestoes={historico.sugestoes} onResolvido={() => router.refresh()} />
      )}

      <MetricaGrid className="lg:grid-cols-4">
        <Metrica
          label="Última compra"
          valor={
            historico.ultimaCompraValor == null ? "—" : fmtMoney(historico.ultimaCompraValor)
          }
          sub={
            historico.ultimaCompraEm
              ? `NF-e ${historico.ultimaCompraNota ?? "—"} · ${relDia(historico.ultimaCompraEm)}`
              : "sem nota importada"
          }
          icon={<Wallet size={12} />}
          tom="brand"
        />
        <Metrica
          label="Notas importadas"
          valor={historico.comprasNotas.toLocaleString("pt-BR")}
          sub={`${historico.produtosTotal.toLocaleString("pt-BR")} itens diferentes`}
          icon={<FileText size={12} />}
        />
        <Metrica
          label="Prazo praticado"
          valor={historico.prazoMedioDias == null ? "—" : `${historico.prazoMedioDias} dias`}
          sub={
            historico.prazoMedioDias == null
              ? "notas sem duplicata (à vista)"
              : "média das duplicatas das notas"
          }
          icon={<CalendarClock size={12} />}
          tom="accent"
        />
        <Metrica
          label="Prazo negociado"
          valor={
            historico.prazoPagamentoDias == null ? "—" : `${historico.prazoPagamentoDias} dias`
          }
          sub="informado no cadastro"
          icon={<CalendarClock size={12} />}
        />
      </MetricaGrid>

      {/* ── O que este fornecedor já entregou ── */}
      <section className="rounded-[var(--radius-lg)] border border-line bg-surface">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-1.5 font-medium text-ink">
              <Package size={15} className="text-brand" />
              Já forneceu
            </h2>
            <p className="text-xs text-muted">
              Itens que apareceram nas notas dele — a base para escolher fornecedor na cotação.
            </p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
            />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar item, código ou EAN"
              className="pl-8"
            />
          </div>
        </header>

        {produtos.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted">
            Nenhum item encontrado para “{busca}”.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Item na nota</th>
                  <th className="px-4 py-2.5 font-medium">No meu catálogo</th>
                  <th className="px-4 py-2.5 text-right font-medium">Último preço</th>
                  <th className="px-4 py-2.5 text-right font-medium">Vezes</th>
                  <th className="px-4 py-2.5 font-medium">Última</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {produtos.map((p) => (
                  <tr key={p.id} className="transition-colors hover:bg-surface-2">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-ink">{p.descricao}</p>
                      <p className="font-mono text-[11px] text-faint">
                        {p.codigoFornecedor}
                        {p.gtin ? ` · ${p.gtin}` : ""} · {p.unidade}
                      </p>
                    </td>
                    <td className="px-4 py-2.5">
                      {p.produto ? (
                        <Link
                          href={`/produtos/${p.produto.id}`}
                          className="text-ink-2 hover:text-brand hover:underline"
                        >
                          {p.produto.nome}
                          <span className="ml-1 font-mono text-[11px] text-faint">
                            {p.produto.sku}
                          </span>
                        </Link>
                      ) : (
                        <Badge>não relacionado</Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono">
                      {p.ultimoPreco == null ? "—" : fmtMoney(p.ultimoPreco)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-muted">{p.vezes}</td>
                    <td className="px-4 py-2.5 text-muted">
                      {relDia(p.ultimaCompraEm)}
                      {p.ultimaNota && (
                        <span className="ml-1 font-mono text-[11px] text-faint">
                          NF {p.ultimaNota}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {historico.produtosTotal > historico.produtos.length && (
          <p className="border-t border-line px-4 py-2 text-[12px] text-faint">
            Mostrando os {historico.produtos.length} itens mais recentes de{" "}
            {historico.produtosTotal}.
          </p>
        )}
      </section>

      {/* ── Trilha: por que o cadastro mudou ── */}
      {historico.eventos.length > 0 && (
        <section className="rounded-[var(--radius-lg)] border border-line bg-surface">
          <header className="border-b border-line px-4 py-3">
            <h2 className="flex items-center gap-1.5 font-medium text-ink">
              <History size={15} className="text-muted" />
              Sincronizações
            </h2>
            <p className="text-xs text-muted">
              Tudo o que o XML mudou neste cadastro, com data e nota de origem.
            </p>
          </header>

          <ul className="divide-y divide-line">
            {historico.eventos.map((e) => {
              const Icone = ICONE_EVENTO[e.tipo];
              return (
                <li key={e.id} className="flex items-start gap-3 px-4 py-2.5">
                  <Icone size={14} className={`mt-0.5 shrink-0 ${COR_EVENTO[e.tipo]}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] text-ink">{e.rotulo}</p>
                    {(e.antes || e.depois) && e.tipo !== "HISTORICO" && (
                      <p className="flex flex-wrap items-center gap-x-2 text-[12px]">
                        {e.antes && <span className="text-faint line-through">{e.antes}</span>}
                        {e.antes && <span className="text-faint">→</span>}
                        <span className="text-ink-2">{e.depois}</span>
                      </p>
                    )}
                    <p className="text-[11px] text-faint">
                      {dataHora(e.createdAt)}
                      {e.notaNumero ? ` · NF-e ${e.notaNumero}` : ""}
                      {e.decisao ? ` · ${DECISAO_LABEL[e.decisao] ?? e.decisao}` : ""}
                    </p>
                  </div>
                  {e.status === "PENDENTE" && <Badge tone="accent">aguardando</Badge>}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
