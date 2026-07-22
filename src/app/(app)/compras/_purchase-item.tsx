"use client";

import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, History, MessageSquarePlus, PackagePlus, Trash2, TriangleAlert, X } from "lucide-react";
import { cn, maskMoney, moneyToMask, parseMoney } from "@/lib/utils";
import { fmtMoney, fmtQtd, Stepper, Thumb } from "./_ui";

// ── Item do pedido de compra ──────────────────────────────────
// Separa os dois conceitos que o campo "Custo un." misturava:
//   · Unidade de COMPRA  — a embalagem escolhida (caixa, fardo, pack…);
//     quantidade e preço sempre se referem a ela.
//   · Unidade de ESTOQUE — a unidade base (UN); a linha de conversão mostra
//     quantas unidades entram e quanto custa cada uma, sem conta mental.
//
// Layout denso (2 linhas por item): controles alinhados em colunas fixas
// (cabeçalho em PurchaseListHeader) + strip de conversão embaixo.

export type PurchasePackaging = {
  id: string;
  nome: string; // "Caixa", "Fardo", "Pack"…
  fatorConversao: number; // quantas UN base contém
  isCompraDefault: boolean;
};

export type PurchaseItemProduct = {
  id: string;
  nome: string;
  sku: string;
  imagemUrl: string | null;
  categoria?: string | null;
  custoMedio: number | null; // por UN base — referência p/ sugestão e variação
  packagings: PurchasePackaging[];
};

export type PurchaseItemValue = {
  packagingId: string | null; // null = unidade
  qtd: number; // sempre na embalagem selecionada
  preco: string; // máscara pt-BR — preço DA EMBALAGEM selecionada
  observacao: string;
};

// Larguras fixas por coluna — compartilhadas entre cabeçalho e linhas para
// os controles ficarem alinhados como uma tabela.
export const COL = {
  embalagem: "w-32 shrink-0",
  qtd: "w-[100px] shrink-0",
  preco: "w-24 shrink-0",
  total: "w-[5.5rem] shrink-0 text-right",
  remover: "w-7 shrink-0",
} as const;

const inputCls =
  "h-7 rounded-lg border border-line bg-surface px-2 text-xs text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)";

export function packagingOf(product: PurchaseItemProduct, packagingId: string | null) {
  return packagingId ? (product.packagings.find((pk) => pk.id === packagingId) ?? null) : null;
}

/** Embalagem inicial ao adicionar o produto: a marcada como padrão de compra. */
export function defaultPackaging(product: PurchaseItemProduct): PurchasePackaging | null {
  return product.packagings.find((pk) => pk.isCompraDefault) ?? product.packagings[0] ?? null;
}

/** Preço sugerido DA EMBALAGEM (custo médio base × fator). */
export function precoSugerido(product: PurchaseItemProduct, pkg: PurchasePackaging | null): string {
  if (product.custoMedio == null) return "";
  return moneyToMask(pkg ? product.custoMedio * pkg.fatorConversao : product.custoMedio);
}

const rotuloEmbalagem = (pkg: PurchasePackaging | null) => (pkg ? pkg.nome.toLowerCase() : "unidade");
const plural = (qtd: number, nome: string) => (qtd === 1 ? nome : `${nome}s`);

// ── Cabeçalho de colunas (só ≥sm — no mobile os controles quebram linha) ──

export function PurchaseListHeader() {
  return (
    <div className="hidden items-center gap-2 px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-faint sm:flex">
      <span className="min-w-0 flex-1">Produto</span>
      <span className={COL.embalagem}>Embalagem</span>
      <span className={cn(COL.qtd, "text-center")}>Qtd</span>
      <span className={cn(COL.preco, "text-right")}>Preço emb.</span>
      <span className={COL.total}>Total</span>
      <span className={COL.remover} aria-hidden />
    </div>
  );
}

// ── Seletor de embalagem ──────────────────────────────────────

export function PurchasePackagingSelector({
  product,
  value,
  onChange,
}: {
  product: PurchaseItemProduct;
  value: string | null;
  onChange: (packagingId: string | null) => void;
}) {
  // Só uma forma de comprar (unidade) → nada a escolher; mantém a coluna.
  if (product.packagings.length === 0) {
    return <span className={cn(COL.embalagem, "text-xs text-faint")}>Unidade</span>;
  }
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      aria-label="Embalagem de compra"
      className={cn(inputCls, COL.embalagem)}
    >
      <option value="">Unidade</option>
      {product.packagings.map((pk) => (
        <option key={pk.id} value={pk.id}>
          {pk.nome} c/{fmtQtd(pk.fatorConversao)}
        </option>
      ))}
    </select>
  );
}

// ── Quantidade (sempre na embalagem escolhida) ────────────────

export function PurchaseQuantityStepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className={COL.qtd}>
      <Stepper value={value} onChange={onChange} min={0} size="sm" />
    </div>
  );
}

// ── Preço da embalagem (nunca o custo unitário) ───────────────

export function PurchasePriceInput({
  pkg,
  value,
  onChange,
  alerta = false,
}: {
  pkg: PurchasePackaging | null;
  value: string;
  onChange: (v: string) => void;
  alerta?: boolean;
}) {
  return (
    <input
      inputMode="numeric"
      value={value}
      onChange={(e) => onChange(maskMoney(e.target.value))}
      placeholder="0,00"
      aria-label={`Preço por ${rotuloEmbalagem(pkg)}`}
      className={cn(inputCls, COL.preco, "text-right tabular-nums", alerta && "border-warn")}
    />
  );
}

// ── Strip de conversão compra → estoque ───────────────────────

export function PurchaseConversionSummary({
  pkg,
  qtd,
  preco,
  custoMedio,
}: {
  pkg: PurchasePackaging | null;
  qtd: number;
  preco: number; // da embalagem
  custoMedio: number | null;
}) {
  const fator = pkg ? pkg.fatorConversao : 1;
  const unidades = qtd * fator;
  const custoUn = fator > 0 ? preco / fator : 0;
  const difPct = custoMedio && custoMedio > 0 && custoUn > 0 ? ((custoUn - custoMedio) / custoMedio) * 100 : null;

  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
      <PackagePlus size={12} className="shrink-0 text-brand" />
      {unidades > 0 ? (
        <>
          <span>
            Entrada: <strong className="font-semibold text-ink">{fmtQtd(unidades)} UN</strong>
            {pkg && <span className="text-faint"> ({fmtQtd(qtd)} {plural(qtd, rotuloEmbalagem(pkg))} × {fmtQtd(fator)})</span>}
          </span>
          {pkg && preco > 0 && (
            <span className="tabular-nums">· {fmtMoney(custoUn)}/UN</span>
          )}
          {difPct != null && Math.abs(difPct) >= 0.5 && (
            <span className={cn("flex items-center gap-0.5 font-medium tabular-nums", difPct > 0 ? "text-danger" : "text-ok")}>
              {difPct > 0 ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
              {difPct > 0 ? "+" : ""}
              {difPct.toFixed(0)}% vs custo atual
            </span>
          )}
        </>
      ) : (
        <span>Informe a quantidade para calcular a entrada no estoque.</span>
      )}
    </p>
  );
}

// ── Observação do item ────────────────────────────────────────

export function PurchaseItemNotes({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [aberto, setAberto] = useState(value.trim().length > 0);
  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-faint transition-colors hover:text-ink"
      >
        <MessageSquarePlus size={12} /> Observação
      </button>
    );
  }
  return (
    <div className="flex w-full items-center gap-1.5">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Observação do item — ex.: preferir validade longa…"
        maxLength={500}
        className={cn(inputCls, "min-w-0 flex-1")}
      />
      <button
        type="button"
        onClick={() => {
          onChange("");
          setAberto(false);
        }}
        aria-label="Remover observação"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-faint hover:bg-surface-2 hover:text-ink"
      >
        <X size={12} />
      </button>
    </div>
  );
}

// ── Linha completa do item ────────────────────────────────────

export function PurchaseItemCard({
  product,
  value,
  onChange,
  onRemove,
  estoqueDisponivel,
  ultimoPreco,
  avisoPendente,
}: {
  product: PurchaseItemProduct;
  value: PurchaseItemValue;
  onChange: (patch: Partial<PurchaseItemValue>) => void;
  onRemove: () => void;
  /** UN base disponíveis no site de destino — decisão de qtd sem sair do form. */
  estoqueDisponivel?: number | null;
  /** Último preço pago (por UN base) — vira sugestão clicável na embalagem atual. */
  ultimoPreco?: { custoUnBase: number; em: string } | null;
  /** Item já a caminho em outro pedido aberto do mesmo fornecedor. */
  avisoPendente?: string | null;
}) {
  const pkg = packagingOf(product, value.packagingId);
  const preco = parseMoney(value.preco) ?? 0;
  const fator = pkg ? pkg.fatorConversao : 1;
  const ultimoPrecoEmb = ultimoPreco ? ultimoPreco.custoUnBase * fator : null;

  return (
    <li
      className="rounded-xl border border-line bg-surface-2/40 px-3 py-2"
      onKeyDown={(e) => {
        // Del remove o item — só fora de campos de texto (lá, Del edita).
        const tag = (e.target as HTMLElement).tagName;
        if (e.key === "Delete" && tag !== "INPUT" && tag !== "SELECT" && tag !== "TEXTAREA") onRemove();
      }}
    >
      {/* Linha 1 — produto + controles em colunas (quebram no mobile) */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 basis-full items-center gap-2.5 sm:basis-0">
          <Thumb url={product.imagemUrl} nome={product.nome} size={30} />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium leading-tight text-ink">{product.nome}</p>
            <p className="truncate font-mono text-[10px] text-faint">
              {product.sku}
              {product.categoria ? <span className="font-sans"> · {product.categoria}</span> : null}
              {estoqueDisponivel != null && (
                <span className={cn("font-sans", estoqueDisponivel <= 0 ? "font-semibold text-danger" : "")}>
                  {" "}· disp. {fmtQtd(estoqueDisponivel)} UN
                </span>
              )}
            </p>
          </div>
        </div>

        <PurchasePackagingSelector
          product={product}
          value={value.packagingId}
          onChange={(packagingId) => {
            // Trocou a embalagem → preço re-sugerido para a nova embalagem.
            const novo = packagingOf(product, packagingId);
            onChange({ packagingId, preco: precoSugerido(product, novo) });
          }}
        />
        <PurchaseQuantityStepper value={value.qtd} onChange={(qtd) => onChange({ qtd })} />
        <PurchasePriceInput
          pkg={pkg}
          value={value.preco}
          onChange={(preco) => onChange({ preco })}
          alerta={value.qtd > 0 && preco === 0}
        />
        <span className={cn(COL.total, "text-[13px] font-semibold tabular-nums text-ink")}>{fmtMoney(value.qtd * preco)}</span>
        <button
          type="button"
          onClick={onRemove}
          className={cn(COL.remover, "grid h-7 place-items-center rounded-lg border border-line text-faint hover:bg-danger-soft hover:text-danger")}
          aria-label={`Remover ${product.nome}`}
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Linha 2 — conversão compra → estoque + referências + observação */}
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line/60 pt-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
          <PurchaseConversionSummary pkg={pkg} qtd={value.qtd} preco={preco} custoMedio={product.custoMedio} />
          {ultimoPrecoEmb != null && Math.abs(ultimoPrecoEmb - preco) >= 0.005 && (
            <button
              type="button"
              onClick={() => onChange({ preco: moneyToMask(ultimoPrecoEmb) })}
              title="Aplicar o último preço pago"
              className="flex shrink-0 items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted transition-colors hover:bg-brand-soft hover:text-brand"
            >
              <History size={11} /> últ.: {fmtMoney(ultimoPrecoEmb)}/{rotuloEmbalagem(pkg)} · {dataCurta(ultimoPreco!.em)}
            </button>
          )}
          {avisoPendente && (
            <span className="flex min-w-0 items-center gap-1 text-[11px] font-medium text-warn">
              <TriangleAlert size={11} className="shrink-0" />
              <span className="truncate">{avisoPendente}</span>
            </span>
          )}
        </div>
        <PurchaseItemNotes value={value.observacao} onChange={(observacao) => onChange({ observacao })} />
      </div>
    </li>
  );
}

const dataCurta = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

// ── Total do pedido (rodapé) ──────────────────────────────────

export function PurchaseTotal({ itens, unidades, total }: { itens: number; unidades: number; total: number }) {
  return (
    <div className="text-sm text-muted">
      <span className="tabular-nums">
        {itens} {itens === 1 ? "produto" : "produtos"} · {fmtQtd(unidades)} UN no estoque ·
      </span>{" "}
      <span className="font-display text-lg font-semibold tabular-nums text-ink">{fmtMoney(total)}</span>
    </div>
  );
}
