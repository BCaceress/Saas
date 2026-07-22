"use client";

import { useState } from "react";
import { Building2, Check, ChevronDown, RotateCcw, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Menu, MenuItem } from "@/components/ui/menu";
import { fmtMoney, fmtQtd, relDia, StatusDot, Stepper as QuantityStepper, Thumb } from "../_ui";
import { fornecedorEfetivo, type Efetivo, type Linha, type Sel } from "./_shared";

// ── Card de produto — hierarquia: produto → quantidade → justificativa ──
// Informações em blocos (nunca uma linha longa). A quantidade sugerida é
// o elemento de maior destaque; a explicação vive num accordion
// "Entender sugestão" em linguagem simples.

export { QuantityStepper };

const fmt1 = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

export function ProductSuggestionCard({
  linha: l,
  sel,
  setItem,
  onHistorico,
}: {
  linha: Linha;
  sel: Sel | undefined;
  setItem: (productId: string, patch: Partial<Sel>) => void;
  onHistorico: (l: Linha) => void;
}) {
  const semFornecedor = l.supplierId === null;
  const s = sel ?? { on: false, qtd: Math.max(l.qtdSugerida, 1), supplierId: l.supplierId };
  const eff = fornecedorEfetivo(l, s.supplierId);
  const qtd = s.qtd;
  const subtotal = qtd * (eff.custo ?? 0);
  const alterado = qtd !== l.qtdSugerida;
  const unidade = l.packagingNome ?? "unidades";
  const idealShow = l.estoqueIdeal > 0 ? l.estoqueIdeal : l.alvoReposicao;
  const desligado = !s.on || semFornecedor;

  return (
    <li className={cn("transition-opacity", desligado && "opacity-55")}>
      <div className="flex gap-3 px-4 py-4 sm:px-5">
        <label className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center pt-0.5">
          <input
            type="checkbox"
            checked={s.on && !semFornecedor}
            disabled={semFornecedor}
            onChange={(e) => setItem(l.productId, { on: e.target.checked })}
            className="h-4.5 w-4.5 accent-brand"
            aria-label={`Incluir ${l.nome} no pedido`}
          />
        </label>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {/* Identidade × decisão */}
          <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
            <div className="flex min-w-0 flex-1 basis-56 items-start gap-3">
              <Thumb url={l.imagemUrl} nome={l.nome} size={44} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <button
                    type="button"
                    onClick={() => onHistorico(l)}
                    className="max-w-full truncate text-left text-[15px] font-semibold text-ink underline-offset-2 hover:underline"
                  >
                    {l.nome}
                  </button>
                  <StatusDot status={l.status} comLabel />
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                  <span className="rounded border border-line bg-surface-2 px-1.5 py-px font-mono text-[11px] text-ink-2">{l.sku}</span>
                  {l.categoria && <span>{l.categoria}</span>}
                </div>
                <p className="mt-1 truncate text-xs text-muted">
                  {semFornecedor ? (
                    <span className="text-warn">
                      Sem fornecedor — vincule em{" "}
                      <a href="/produtos" className="font-semibold underline underline-offset-2">
                        Produtos
                      </a>
                    </span>
                  ) : (
                    <>
                      <Building2 size={11} className="mr-1 inline align-[-1px] text-faint" />
                      {l.fornecedores.length > 1 ? (
                        <Menu
                          align="start"
                          trigger={
                            <button type="button" className="inline-flex items-center gap-0.5 font-medium text-ink-2 hover:text-brand hover:underline">
                              {eff.nome}
                              <ChevronDown size={11} />
                            </button>
                          }
                        >
                          <FornecedorPicker linha={l} atual={s.supplierId} onSelect={(id) => setItem(l.productId, { supplierId: id })} />
                        </Menu>
                      ) : (
                        eff.nome
                      )}
                      {eff.leadTime != null && (
                        <span>
                          {" "}
                          · entrega ~{eff.leadTime} {eff.leadTime === 1 ? "dia" : "dias"}
                        </span>
                      )}
                    </>
                  )}
                </p>
              </div>
            </div>

            {/* Decisão: stepper em destaque + valor estimado */}
            <div className="flex shrink-0 items-start gap-5">
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-2">
                  <QuantityStepper value={qtd} onChange={(v) => setItem(l.productId, { qtd: v })} disabled={semFornecedor || !s.on} min={0} />
                  <span className="w-max text-xs text-muted">{unidade}</span>
                </div>
                {alterado ? (
                  <button
                    type="button"
                    onClick={() => setItem(l.productId, { qtd: l.qtdSugerida })}
                    className="flex items-center gap-1 text-[11px] font-medium text-brand hover:underline"
                  >
                    <RotateCcw size={11} /> Sugerido: {fmtQtd(l.qtdSugerida)}
                  </button>
                ) : (
                  <span className="flex items-center gap-1 text-[11px] text-faint">
                    <Sparkles size={11} className="text-brand" /> Quantidade sugerida
                  </span>
                )}
                {l.packagingNome && l.fatorConversao !== 1 && (
                  <span className="text-[11px] tabular-nums text-faint">{fmtQtd(qtd * l.fatorConversao)} unidades no total</span>
                )}
              </div>
              <div className="min-w-20 text-right">
                <p className="text-base font-semibold tabular-nums text-ink">{eff.custo != null ? fmtMoney(subtotal) : "—"}</p>
                {eff.custo != null && (
                  <p className="text-[11px] tabular-nums text-muted">
                    {fmtMoney(eff.custo)}/{l.packagingNome?.toLowerCase() ?? "un"}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Situação do estoque em blocos */}
          <dl className="grid w-fit max-w-full grid-flow-col auto-cols-max divide-x divide-line overflow-x-auto rounded-xl border border-line bg-surface-2/40">
            <Bloco
              rotulo="Disponível"
              valor={fmtQtd(l.estoque)}
              tom={l.status === "ruptura" || l.status === "critico" ? "danger" : undefined}
            />
            <Bloco rotulo="Mínimo" valor={l.estoqueMinimo > 0 ? fmtQtd(l.estoqueMinimo) : "—"} />
            <Bloco rotulo="Ideal" valor={fmtQtd(idealShow)} />
            <Bloco
              rotulo="Cobertura"
              valor={l.coberturaDias == null ? "sem giro" : l.coberturaDias <= 0 ? "acabou" : `~${fmtQtd(l.coberturaDias)} d`}
            />
            {l.pendente > 0 && <Bloco rotulo="A caminho" valor={fmtQtd(l.pendente)} tom="brand" />}
          </dl>

          <SuggestionExplanation l={l} eff={eff} />
        </div>
      </div>
    </li>
  );
}

function Bloco({ rotulo, valor, tom }: { rotulo: string; valor: string; tom?: "danger" | "brand" }) {
  return (
    <div className="flex flex-col px-3 py-1.5">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-faint">{rotulo}</dt>
      <dd className={cn("text-sm font-semibold tabular-nums", tom === "danger" ? "text-danger" : tom === "brand" ? "text-brand" : "text-ink")}>
        {valor}
      </dd>
    </div>
  );
}

// ── Accordion "Entender sugestão" — a IA explica a recomendação ──

function prevRuptura(l: Linha): string {
  if (l.estoque <= 0) return "já em ruptura";
  if (l.coberturaDias == null) return "sem giro recente";
  if (l.coberturaDias <= 0) return "hoje";
  const data = new Date(Date.now() + l.coberturaDias * 864e5);
  return `em ~${fmtQtd(l.coberturaDias)} ${l.coberturaDias === 1 ? "dia" : "dias"} (${data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })})`;
}

function motivo(l: Linha, eff: Efetivo): string {
  const frases: string[] = [];
  if (l.mediaDia > 0) {
    frases.push(`O consumo médio deste produto é de ${fmt1(l.mediaDia)} ${l.mediaDia > 1 ? "unidades" : "unidade"} por dia.`);
  }
  if (l.estoque <= 0) {
    frases.push("O estoque acabou.");
  } else {
    frases.push(
      `${l.estoque === 1 ? "Resta apenas 1 unidade" : `Restam ${fmtQtd(l.estoque)} unidades`} em estoque${
        l.coberturaDias != null && l.coberturaDias > 0
          ? ` — o suficiente para ~${fmtQtd(l.coberturaDias)} ${l.coberturaDias === 1 ? "dia" : "dias"} no ritmo atual`
          : ""
      }.`,
    );
  }
  if (eff.leadTime != null) {
    frases.push(`O fornecedor tem prazo médio de entrega de ${eff.leadTime} ${eff.leadTime === 1 ? "dia" : "dias"}.`);
  }
  if (l.pendente > 0) {
    frases.push(`${fmtQtd(l.pendente)} ${l.pendente === 1 ? "unidade já está" : "unidades já estão"} a caminho e foram descontadas do cálculo.`);
  }
  const objetivo = l.status === "ruptura" || l.status === "critico" ? "Para evitar ruptura" : "Para voltar ao nível ideal";
  frases.push(`${objetivo}, recomendamos comprar ${fmtQtd(l.qtdSugerida)} ${l.packagingNome?.toLowerCase() ?? "unidades"}.`);
  return frases.join(" ");
}

export function SuggestionExplanation({ l, eff }: { l: Linha; eff: Efetivo }) {
  const [open, setOpen] = useState(false);
  const idealShow = l.estoqueIdeal > 0 ? l.estoqueIdeal : l.alvoReposicao;

  const dados: [string, string][] = [
    ["Consumo médio diário", l.mediaDia > 0 ? `${fmt1(l.mediaDia)} un/dia` : "sem vendas em 30 dias"],
    ["Última venda", l.ultimaVendaEm ? relDia(l.ultimaVendaEm) : "sem registro em 30 dias"],
    ["Última compra", relDia(l.ultimaCompraEm)],
    ["Estoque atual", `${fmtQtd(l.estoque)} un`],
    ["Estoque mínimo", l.estoqueMinimo > 0 ? `${fmtQtd(l.estoqueMinimo)} un` : "—"],
    ["Estoque ideal", `${fmtQtd(idealShow)} un`],
    ["Prazo do fornecedor", eff.leadTime != null ? `~${eff.leadTime} ${eff.leadTime === 1 ? "dia" : "dias"}` : "—"],
    ["Previsão de ruptura", prevRuptura(l)],
  ];
  if (l.pendente > 0) dados.push(["Já a caminho", `${fmtQtd(l.pendente)} un`]);

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 self-start rounded-lg py-0.5 text-xs font-semibold text-muted transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
      >
        <Sparkles size={12} className="text-brand" />
        Entender sugestão
        <ChevronDown size={13} className={cn("transition-transform motion-reduce:transition-none", open && "rotate-180")} />
      </button>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="mt-2 flex flex-col gap-3 rounded-xl bg-surface-2/60 p-4">
            <dl className="grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
              {dados.map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted">{k}</dt>
                  <dd className="text-right font-medium tabular-nums text-ink">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="border-l-2 border-brand pl-3 text-sm leading-relaxed text-ink-2">{motivo(l, eff)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Popover: escolher fornecedor ──────────────────────────────

function FornecedorPicker({
  linha: l,
  atual,
  onSelect,
}: {
  linha: Linha;
  atual: string | null;
  onSelect: (supplierId: string) => void;
}) {
  const custos = l.fornecedores.map((f) => f.custoUnitCompra).filter((v): v is number => v != null);
  const menorPreco = custos.length > 1 ? Math.min(...custos) : null;
  const leads = l.fornecedores.map((f) => f.leadTimeDias).filter((v): v is number => v != null);
  const menorLead = leads.length > 1 ? Math.min(...leads) : null;

  return (
    <div className="w-72">
      <p className="px-2.5 py-2 text-xs font-semibold uppercase tracking-wide text-faint">Escolher fornecedor</p>
      {l.fornecedores.map((f) => (
        <MenuItem
          key={f.supplierId}
          icon={f.supplierId === atual ? <Check size={14} className="text-brand" /> : <span className="inline-block w-3.5" />}
          onClick={() => onSelect(f.supplierId)}
          trailing={
            <span className="flex flex-col items-end gap-0.5">
              {f.custoUnitCompra === menorPreco && <span className="rounded-full bg-ok-soft px-1.5 py-0.5 text-[10px] font-semibold text-ok">Menor preço</span>}
              {f.leadTimeDias === menorLead && <span className="rounded-full bg-brand-soft px-1.5 py-0.5 text-[10px] font-semibold text-brand">Entrega mais rápida</span>}
            </span>
          }
        >
          <span className="block font-medium text-ink">{f.nome}</span>
          <span className="block text-xs text-muted">
            {f.custoUnitCompra != null ? `${fmtMoney(f.custoUnitCompra)}${l.packagingNome ? `/${l.packagingNome.toLowerCase()}` : ""}` : "sem custo"}
            {f.leadTimeDias != null && ` · entrega ~${f.leadTimeDias}d`}
          </span>
        </MenuItem>
      ))}
    </div>
  );
}
