"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { brl, cn } from "@/lib/utils";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import { TecladoNumerico, paraNumero } from "@/components/mobile/teclado-numerico";
import { alterarPrecoAction } from "@/app/(mobile)/m/acoes/actions";
import type { FichaProduto } from "@/app/(mobile)/m/_produto-data";

/**
 * Trocar preço é a ação mais rápida do app: um número e confirmar.
 *
 * A margem aparece ENQUANTO se digita, não depois de salvar — é o único jeito
 * de a pessoa perceber que ia vender abaixo do custo antes de a etiqueta ir
 * para a prateleira.
 *
 * Módulo próprio com export default para entrar por `dynamic()`: fechada, esta
 * sheet não renderiza nada, e o teclado numérico não precisa estar no bundle de
 * quem só quis conferir um preço.
 */
export default function PrecoSheet({
  ficha,
  valorInicial,
  onFechar,
  onConcluir,
}: {
  ficha: FichaProduto;
  valorInicial?: string;
  onFechar: () => void;
  onConcluir: (mensagem: string) => void;
}) {
  const [valor, setValor] = React.useState(valorInicial ?? "");
  const [salvando, setSalvando] = React.useState(false);

  const preco = paraNumero(valor);
  const custo = ficha.custoMedio;
  const margem = custo != null && custo > 0 && preco > 0 ? ((preco - custo) / preco) * 100 : null;
  const abaixoDoCusto = custo != null && preco > 0 && preco < custo;

  async function salvar() {
    if (preco <= 0 || salvando) return;
    setSalvando(true);
    try {
      const r = await alterarPrecoAction({ productId: ficha.id, preco });
      onConcluir(
        `${r.nome} agora custa ${brl(r.preco)}${
          r.margemPct != null ? ` · margem ${r.margemPct.toFixed(1)}%` : ""
        }.`,
      );
    } catch (e) {
      toast.error(
        "Não foi possível salvar o preço",
        e instanceof Error ? e.message : "Tente de novo em instantes.",
      );
    } finally {
      setSalvando(false);
    }
  }

  return (
    <BottomSheet
      open
      onClose={onFechar}
      titulo="Alterar preço"
      descricao={
        <span className="line-clamp-1">
          {ficha.nome} · <span className="font-mono text-xs">{ficha.sku}</span>
        </span>
      }
      rodape={
        <Button onClick={salvar} disabled={preco <= 0 || salvando} className="w-full" size="lg">
          {salvando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Salvar preço
        </Button>
      }
    >
      <div className="space-y-3 pb-2">
        <div className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-center">
          <p className="font-display text-3xl leading-none font-semibold text-ink tabular-nums">
            <span className="mr-1 text-base font-normal text-muted">R$</span>
            {valor === "" ? "0,00" : valor}
          </p>
          <p className="mt-1 text-xs text-muted">
            hoje: {ficha.precoVenda == null ? "sem preço" : brl(ficha.precoVenda)}
            {custo != null && ` · custo ${brl(custo)}`}
          </p>
        </div>

        {margem != null && custo != null && (
          <p
            className={cn(
              "rounded-lg px-3 py-2 text-center text-[13px] font-medium",
              abaixoDoCusto
                ? "bg-danger-soft text-danger"
                : margem < 10
                  ? "bg-warn-soft text-warn"
                  : "bg-ok-soft text-ok",
            )}
          >
            {abaixoDoCusto
              ? `Abaixo do custo — prejuízo de ${brl(custo - preco)} por unidade.`
              : `Margem de ${margem.toFixed(1)}% · ${brl(preco - custo)} por unidade.`}
          </p>
        )}

        <TecladoNumerico valor={valor} onChange={setValor} decimais={2} />
      </div>
    </BottomSheet>
  );
}
