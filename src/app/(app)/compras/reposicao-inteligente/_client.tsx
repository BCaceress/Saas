"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, PackageCheck, PartyPopper, TriangleAlert } from "lucide-react";
import { toast } from "@/components/ui/toast";
import type { GrupoReposicao } from "../_data";
import { criarPedidosReposicaoAction } from "../actions";
import { SolicitarSheet, type GrupoEnvio } from "../_solicitar";
import { fmtQtd, previsaoLabel, Thumb } from "../_ui";
import {
  achatar,
  agruparPorFornecedor,
  fornecedorEfetivo,
  ordenarLinhas,
  type Linha,
  type Sel,
} from "./_shared";
import { ReplenishmentSummary } from "./_summary";
import { ReplenishmentFilters } from "./_filters";
import { PriorityGroup } from "./_priority-group";
import { SupplierGroup } from "./_supplier-group";
import { FloatingPurchaseSummary, type ResumoReposicao } from "./_sidebar";
import { HistoricoDrawer } from "./_historico";

// ── Reposição inteligente — assistente de compras ─────────────
// O sistema já analisou estoque, consumo e fornecedores; aqui o operador
// só revisa, ajusta e aprova. Hierarquia: resumo → prioridade →
// fornecedor → produto → quantidade → justificativa.

const hojeMais = (dias: number) => new Date(Date.now() + dias * 864e5).toISOString().slice(0, 10);

export function ReposicaoInteligenteClient({
  grupos,
  siteId,
  empresa,
}: {
  grupos: GrupoReposicao[];
  siteId: string | null;
  empresa: string;
}) {
  const router = useRouter();

  const linhas = useMemo<Linha[]>(() => achatar(grupos), [grupos]);

  const [sel, setSel] = useState<Record<string, Sel>>(() => {
    const s: Record<string, Sel> = {};
    for (const l of linhas) s[l.productId] = { on: l.qtdSugerida > 0 && l.supplierId !== null, qtd: Math.max(l.qtdSugerida, 1), supplierId: l.supplierId };
    return s;
  });
  const [busca, setBusca] = useState("");
  const [fornecedorFiltro, setFornecedorFiltro] = useState<string | null>(null);
  const [historico, setHistorico] = useState<Linha | null>(null);
  // O sheet de envio pode nascer de um fornecedor só ou de "criar todos".
  const [solicitar, setSolicitar] = useState<{ escopo: "todos" | string; grupos: GrupoEnvio[] } | null>(null);
  const [concluido, setConcluido] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const setItem = (productId: string, patch: Partial<Sel>) =>
    setSel((s) => ({ ...s, [productId]: { ...s[productId], ...patch } }));

  const setMuitos = (productIds: string[], on: boolean) =>
    setSel((s) => {
      const novo = { ...s };
      for (const id of productIds) novo[id] = { ...novo[id], on };
      return novo;
    });

  // Separa quem já está coberto por pedido a caminho (não é mais sugestão) do resto.
  const jaRepostos = useMemo(() => linhas.filter((l) => l.qtdSugerida === 0 && l.pendente > 0), [linhas]);
  const ativas = useMemo(() => linhas.filter((l) => !(l.qtdSugerida === 0 && l.pendente > 0)), [linhas]);

  // Filtros só escondem cards — a seleção (e o resumo) não muda.
  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return ativas.filter((l) => {
      if (q && !`${l.nome} ${l.sku} ${l.marca ?? ""}`.toLowerCase().includes(q)) return false;
      if (fornecedorFiltro) {
        const eff = fornecedorEfetivo(l, sel[l.productId]?.supplierId ?? l.supplierId);
        if (eff.supplierId !== fornecedorFiltro) return false;
      }
      return true;
    });
  }, [ativas, busca, fornecedorFiltro, sel]);

  const agora = useMemo(() => ordenarLinhas(filtradas.filter((l) => l.status === "ruptura" || l.status === "critico")), [filtradas]);
  const breve = useMemo(() => ordenarLinhas(filtradas.filter((l) => l.status === "abaixo" || l.status === "monitorar")), [filtradas]);
  const gruposAgora = useMemo(() => agruparPorFornecedor(agora, sel), [agora, sel]);
  const gruposBreve = useMemo(() => agruparPorFornecedor(breve, sel), [breve, sel]);

  const opcoesFornecedor = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of ativas) for (const f of [{ id: l.supplierId, nome: l.supplierNome }, ...l.fornecedores.map((f) => ({ id: f.supplierId as string | null, nome: f.nome }))]) {
      if (f.id) map.set(f.id, f.nome);
    }
    return [...map.entries()].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [ativas]);

  // ── Resumo vivo: o que a revisão atual vira ──
  const resumo = useMemo<ResumoReposicao>(() => {
    const porFornecedor = new Map<string, ResumoReposicao["fornecedores"][number]>();
    let produtos = 0;
    let unidades = 0;
    let total = 0;
    for (const l of ativas) {
      const s = sel[l.productId];
      if (!s?.on || s.qtd <= 0 || !s.supplierId) continue;
      const eff = fornecedorEfetivo(l, s.supplierId);
      const un = s.qtd * l.fatorConversao;
      const sub = s.qtd * (eff.custo ?? 0);
      produtos += 1;
      unidades += un;
      total += sub;
      const f = porFornecedor.get(s.supplierId) ?? { supplierId: s.supplierId, nome: eff.nome, logoUrl: eff.logoUrl, produtos: 0, unidades: 0, total: 0 };
      f.produtos += 1;
      f.unidades += un;
      f.total += sub;
      porFornecedor.set(s.supplierId, f);
    }
    return { produtos, unidades, total, fornecedores: [...porFornecedor.values()].sort((a, b) => b.total - a.total) };
  }, [ativas, sel]);

  const totaisPorFornecedor = useMemo(
    () => new Map(resumo.fornecedores.map((f) => [f.supplierId, { produtos: f.produtos, unidades: f.unidades, total: f.total }])),
    [resumo],
  );

  // Congela a revisão em grupos de envio — o sheet pergunta só COMO solicitar.
  function montarEnvio(soFornecedor?: string): GrupoEnvio[] {
    const porFornecedor = new Map<string, GrupoEnvio>();
    for (const l of ativas) {
      const s = sel[l.productId];
      if (!s?.on || s.qtd <= 0 || !s.supplierId) continue;
      if (soFornecedor && s.supplierId !== soFornecedor) continue;
      const eff = fornecedorEfetivo(l, s.supplierId);
      const g = porFornecedor.get(s.supplierId) ?? {
        supplierId: s.supplierId,
        supplierNome: eff.nome,
        telefone: eff.telefone,
        email: eff.email,
        leadTimeDias: eff.leadTime,
        itens: [],
      };
      g.itens.push({
        productId: l.productId,
        packagingId: l.packagingId,
        nome: l.nome,
        qtd: s.qtd,
        packagingNome: l.packagingNome,
        fatorConversao: l.fatorConversao,
        custoUnitCompra: eff.custo,
      });
      porFornecedor.set(s.supplierId, g);
    }
    return [...porFornecedor.values()];
  }

  const criarPedidoFornecedor = (supplierId: string) => {
    const envio = montarEnvio(supplierId);
    if (envio.length > 0) setSolicitar({ escopo: supplierId, grupos: envio });
  };

  const criarTodos = () => {
    const envio = montarEnvio();
    if (envio.length > 0) setSolicitar({ escopo: "todos", grupos: envio });
  };

  // Salvar revisão: cria os pedidos como rascunho, sem enviar nada.
  async function salvarRevisao() {
    if (!siteId || salvando) return;
    const envio = montarEnvio();
    if (envio.length === 0) return;
    setSalvando(true);
    try {
      const criados = await criarPedidosReposicaoAction({
        siteId,
        enviar: false,
        pedidos: envio.map((g) => ({
          supplierId: g.supplierId,
          previsaoEntrega: g.leadTimeDias != null ? hojeMais(g.leadTimeDias) : null,
          observacao: null,
          items: g.itens.map((it) => ({
            productId: it.productId,
            packagingId: it.packagingId,
            qtdPedida: it.qtd,
            custoUnitario: it.custoUnitCompra ?? 0,
          })),
        })),
      });
      toast.success(
        criados.length === 1 ? "Revisão salva como rascunho" : `Revisão salva — ${criados.length} rascunhos`,
        "Retome quando quiser na aba Pedidos. Nada foi enviado aos fornecedores.",
      );
      router.push("/compras");
      router.refresh();
    } catch (e) {
      toast.error("Não foi possível salvar", e instanceof Error ? e.message : "Tente de novo.");
      setSalvando(false);
    }
  }

  // Fechar o sheet: "criar todos" volta pra central; pedido de um
  // fornecedor só limpa a seleção dele e a tela segue com o restante.
  const fecharSolicitar = () => {
    const atual = solicitar;
    setSolicitar(null);
    if (!concluido || !atual) return;
    setConcluido(false);
    if (atual.escopo === "todos") {
      router.push("/compras");
      router.refresh();
    } else {
      setMuitos(atual.grupos.flatMap((g) => g.itens.map((i) => i.productId)), false);
      router.refresh();
    }
  };

  if (linhas.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line bg-surface py-16 text-center">
        <PartyPopper size={32} className="text-ok" />
        <p className="text-sm font-semibold text-ink">Estoque em dia — nada para repor.</p>
        <p className="max-w-sm text-xs text-muted">
          Quando um produto ficar abaixo do mínimo, do ideal, ou o ritmo de venda indicar que o estoque vai acabar, a sugestão aparece aqui.
        </p>
      </div>
    );
  }

  const idsMarcaveis = (rows: Linha[]) => rows.filter((l) => l.supplierId !== null).map((l) => l.productId);
  const contarMarcados = (rows: Linha[]) => rows.filter((l) => l.supplierId !== null && sel[l.productId]?.on).length;
  const nadaFiltrado = agora.length === 0 && breve.length === 0 && (busca !== "" || fornecedorFiltro !== null);

  return (
    <div className="flex flex-col gap-5">
      <ReplenishmentSummary
        sugeridos={ativas.length}
        urgentes={ativas.filter((l) => l.status === "ruptura" || l.status === "critico").length}
        selecionados={resumo.produtos}
        fornecedores={resumo.fornecedores.length}
        pedidos={resumo.fornecedores.length}
        valor={resumo.total}
      />

      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
        <div className="flex min-w-0 flex-col gap-5">
          <ReplenishmentFilters
            busca={busca}
            onBusca={setBusca}
            fornecedorId={fornecedorFiltro}
            onFornecedor={setFornecedorFiltro}
            fornecedores={opcoesFornecedor}
          />

          {nadaFiltrado && (
            <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
              Nenhuma sugestão corresponde aos filtros. Limpe a busca ou escolha outro fornecedor.
            </p>
          )}

          {agora.length > 0 && (
            <PriorityGroup
              titulo="Risco de ruptura"
              descricao="Compre hoje para não perder venda."
              tom="danger"
              icon={TriangleAlert}
              count={agora.length}
              selecionados={contarMarcados(agora)}
              selecionaveis={idsMarcaveis(agora).length}
              onToggleTodos={(on) => setMuitos(idsMarcaveis(agora), on)}
            >
              {gruposAgora.map((g) => (
                <SupplierGroup
                  key={g.supplierId ?? "__sem__"}
                  grupo={g}
                  sel={sel}
                  setItem={setItem}
                  onHistorico={setHistorico}
                  totaisFornecedor={g.supplierId ? (totaisPorFornecedor.get(g.supplierId) ?? { produtos: 0, unidades: 0, total: 0 }) : null}
                  onCriarPedido={siteId ? criarPedidoFornecedor : null}
                  criando={salvando}
                />
              ))}
            </PriorityGroup>
          )}

          {breve.length > 0 && (
            <PriorityGroup
              titulo="Comprar em breve"
              descricao="Abaixo do ideal, ainda sem risco imediato."
              tom="warn"
              icon={CircleAlert}
              count={breve.length}
              selecionados={contarMarcados(breve)}
              selecionaveis={idsMarcaveis(breve).length}
              onToggleTodos={(on) => setMuitos(idsMarcaveis(breve), on)}
            >
              {gruposBreve.map((g) => (
                <SupplierGroup
                  key={g.supplierId ?? "__sem__"}
                  grupo={g}
                  sel={sel}
                  setItem={setItem}
                  onHistorico={setHistorico}
                  totaisFornecedor={g.supplierId ? (totaisPorFornecedor.get(g.supplierId) ?? { produtos: 0, unidades: 0, total: 0 }) : null}
                  onCriarPedido={siteId ? criarPedidoFornecedor : null}
                  criando={salvando}
                />
              ))}
            </PriorityGroup>
          )}

          {jaRepostos.length > 0 && (
            <PriorityGroup
              titulo="Já em reposição"
              descricao="Pedido em andamento cobre a necessidade."
              tom="ok"
              icon={PackageCheck}
              count={jaRepostos.length}
              defaultOpen={false}
            >
              <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
                {jaRepostos.map((l) => {
                  const pedido = l.pedidosPendentes[0] ?? null;
                  return (
                    <li key={l.productId} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                      <div className="flex min-w-0 items-center gap-3">
                        <Thumb url={l.imagemUrl} nome={l.nome} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ink">{l.nome}</p>
                          <p className="text-xs text-muted">
                            {fmtQtd(l.estoque)} disponíveis · {fmtQtd(l.pendente)} a caminho
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3 pl-13 sm:pl-0">
                        {pedido && (
                          <span className="text-xs text-faint">
                            {pedido.numero}
                            {pedido.previsaoEntrega && ` · previsto para ${previsaoLabel(pedido.previsaoEntrega).toLowerCase()}`}
                          </span>
                        )}
                        <a
                          href={`/compras?q=${encodeURIComponent(pedido?.numero ?? l.supplierNome)}`}
                          className="shrink-0 text-xs font-semibold text-brand hover:underline"
                        >
                          Ver pedido →
                        </a>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </PriorityGroup>
          )}
        </div>

        <FloatingPurchaseSummary
          resumo={resumo}
          onCriarTodos={criarTodos}
          onSalvar={salvarRevisao}
          salvando={salvando}
          criando={solicitar !== null}
          bloqueado={!siteId}
        />
      </div>

      {/* Finalização: como deseja solicitar esta compra? */}
      {solicitar && siteId && (
        <SolicitarSheet
          grupos={solicitar.grupos}
          empresa={empresa}
          siteId={siteId}
          onClose={fecharSolicitar}
          onConcluido={() => setConcluido(true)}
        />
      )}

      {/* Drawer: histórico de compras do produto */}
      <HistoricoDrawer item={historico} onClose={() => setHistorico(null)} />
    </div>
  );
}
