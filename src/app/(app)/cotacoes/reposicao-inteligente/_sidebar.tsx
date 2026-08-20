"use client";

import { Archive, Loader2, Send } from "lucide-react";
import { fmtMoney, fmtQtd, SupplierAvatar } from "../_ui";

// ── Resumo fixo da compra — o operador nunca perde a visão geral ──
// Desktop: sidebar sticky à direita. Mobile: barra fixa no rodapé.

export type ResumoReposicao = {
  produtos: number;
  unidades: number;
  total: number;
  fornecedores: { supplierId: string; nome: string; logoUrl: string | null; produtos: number; unidades: number; total: number }[];
};

export function FloatingPurchaseSummary({
  resumo,
  onCriarTodos,
  onSalvar,
  salvando,
  criando,
  bloqueado,
}: {
  resumo: ResumoReposicao;
  onCriarTodos: () => void;
  onSalvar: () => void;
  salvando: boolean;
  criando: boolean;
  /** true quando não há site ativo — os botões ficam desabilitados. */
  bloqueado: boolean;
}) {
  const nPedidos = resumo.fornecedores.length;
  const vazio = resumo.produtos === 0;
  const off = vazio || bloqueado || salvando || criando;

  const botaoCriar = (
    <button
      type="button"
      disabled={off}
      onClick={onCriarTodos}
      className="flex items-center justify-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-50"
    >
      {criando ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
      {nPedidos <= 1 ? "Criar pedido" : `Criar todos os pedidos (${nPedidos})`}
    </button>
  );

  return (
    <>
      {/* Desktop: sidebar sticky */}
      <aside className="hidden lg:flex lg:flex-col lg:gap-4 lg:self-start lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-(--shadow-1)">
        <p className="text-xs font-semibold uppercase tracking-wide text-faint">Resumo da reposição</p>

        <dl className="flex flex-col gap-1.5 text-sm">
          <LinhaResumo rotulo="Produtos selecionados" valor={String(resumo.produtos)} />
          <LinhaResumo rotulo="Unidades" valor={fmtQtd(resumo.unidades)} />
          <LinhaResumo rotulo="Fornecedores" valor={String(nPedidos)} />
          <LinhaResumo rotulo="Pedidos a criar" valor={String(nPedidos)} />
        </dl>

        <div className="border-t border-line pt-3">
          <p className="text-xs text-muted">Valor estimado</p>
          <p className="font-display text-2xl font-bold tabular-nums text-ink">{fmtMoney(resumo.total)}</p>
        </div>

        {resumo.fornecedores.length > 0 && (
          <ul className="flex flex-col gap-2 border-t border-line pt-3">
            {resumo.fornecedores.map((f) => (
              <li key={f.supplierId} className="flex items-center gap-2.5">
                <SupplierAvatar nome={f.nome} logoUrl={f.logoUrl} size={26} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{f.nome}</p>
                  <p className="text-xs text-muted">
                    {f.produtos} {f.produtos === 1 ? "produto" : "produtos"}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-semibold tabular-nums text-ink">{fmtMoney(f.total)}</p>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-2 border-t border-line pt-4">
          {botaoCriar}
          <button
            type="button"
            disabled={off}
            onClick={onSalvar}
            className="flex items-center justify-center gap-2 rounded-full border border-line px-5 py-2.5 text-sm font-medium text-muted transition-colors hover:border-line-strong hover:text-ink disabled:opacity-45"
          >
            {salvando ? <Loader2 size={15} className="animate-spin" /> : <Archive size={15} />}
            Salvar revisão
          </button>
          <p className="text-center text-[11px] leading-snug text-faint">
            {vazio ? "Selecione ao menos um produto para criar um pedido." : "Cada fornecedor gera um pedido independente."}
          </p>
        </div>
      </aside>

      {/* Mobile: barra fixa no rodapé */}
      <div className="sticky bottom-0 z-40 -mx-1 border-t border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80 lg:hidden">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            {vazio ? (
              <p className="text-sm font-semibold text-ink">Nenhum produto selecionado</p>
            ) : (
              <>
                <p className="truncate text-sm font-semibold text-ink">
                  {resumo.produtos} {resumo.produtos === 1 ? "produto" : "produtos"} · {fmtMoney(resumo.total)}
                </p>
                <p className="text-xs text-muted">
                  {nPedidos} {nPedidos === 1 ? "pedido será criado" : "pedidos serão criados"}
                </p>
              </>
            )}
          </div>
          {botaoCriar}
        </div>
      </div>
    </>
  );
}

function LinhaResumo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{rotulo}</dt>
      <dd className="font-semibold tabular-nums text-ink">{valor}</dd>
    </div>
  );
}
