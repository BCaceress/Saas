"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import { TecladoNumerico, paraNumero } from "@/components/mobile/teclado-numerico";
import { Chip } from "@/components/mobile/acao-estoque";
import { criarPedidoDoScannerAction } from "@/app/(mobile)/m/acoes/actions";
import type { FichaProduto } from "@/app/(mobile)/m/_produto-data";

const ATALHOS_QTD = [6, 12, 24, 48];

/**
 * Pedido de um item só, direto da gôndola.
 *
 * Já vem com a sugestão da estratégia de estoque da empresa (`cobertura.sugestao`,
 * calculada em lib/estoque-estrategia): quem está de pé na frente do buraco na
 * prateleira não deveria ter de calcular quanto falta para o alvo.
 *
 * Módulo próprio com export default para entrar por `dynamic()` — ver
 * `acoes-produto.tsx`.
 */
export default function PedirSheet({
  ficha,
  siteAtivo,
  quantidadeInicial,
  onFechar,
  onConcluir,
}: {
  ficha: FichaProduto;
  siteAtivo: string | null;
  quantidadeInicial?: string;
  onFechar: () => void;
  onConcluir: (mensagem: string) => void;
}) {
  const sugestao = ficha.cobertura?.sugestao ?? 0;
  const [valor, setValor] = React.useState(
    quantidadeInicial ?? (sugestao > 0 ? String(Math.ceil(sugestao)) : ""),
  );
  const [salvando, setSalvando] = React.useState(false);

  const qtd = paraNumero(valor);

  async function salvar() {
    if (qtd <= 0 || salvando) return;
    setSalvando(true);
    try {
      const r = await criarPedidoDoScannerAction({
        siteId: siteAtivo,
        enviar: false,
        itens: [{ productId: ficha.id, quantidade: qtd, supplierId: null }],
      });
      if (r.semFornecedor.length > 0) {
        toast.error(
          "Sem fornecedor cadastrado",
          `${ficha.nome} não tem fornecedor vinculado — cadastre um antes de pedir.`,
        );
        setSalvando(false);
        return;
      }
      const pedido = r.criados[0];
      onConcluir(
        `Rascunho ${pedido?.numero ?? ""} para ${pedido?.fornecedor ?? "o fornecedor"} — revise em Compras antes de enviar.`,
      );
    } catch (e) {
      toast.error(
        "Não foi possível abrir o pedido",
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
      titulo="Pedir ao fornecedor"
      descricao={
        <span className="line-clamp-1">
          {ficha.nome} · <span className="font-mono text-xs">{ficha.sku}</span>
        </span>
      }
      rodape={
        <Button onClick={salvar} disabled={qtd <= 0 || salvando} className="w-full" size="lg">
          {salvando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Criar rascunho de pedido
        </Button>
      }
    >
      <div className="space-y-3 pb-2">
        <div className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-center">
          <p className="font-display text-3xl leading-none font-semibold text-ink tabular-nums">
            {valor === "" ? "0" : valor}
            {/* Pedido é em unidades — `unidadeBase` descreve o conteúdo da
                embalagem (ml/g), não o que se pede ao fornecedor. */}
            <span className="ml-1 text-base font-normal text-muted">un</span>
          </p>
          <p className="mt-1 text-xs text-muted">
            em estoque: {ficha.totalFechado.toLocaleString("pt-BR")}
            {ficha.cobertura?.dias != null && ` · dura ${ficha.cobertura.label}`}
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {sugestao > 0 && (
            <Chip
              ativo={qtd === Math.ceil(sugestao)}
              onClick={() => setValor(String(Math.ceil(sugestao)))}
            >
              sugerido {Math.ceil(sugestao)}
            </Chip>
          )}
          {ATALHOS_QTD.map((n) => (
            <Chip key={n} ativo={qtd === n} onClick={() => setValor(String(n))}>
              {n}
            </Chip>
          ))}
        </div>

        <TecladoNumerico valor={valor} onChange={setValor} decimais={0} />

        <p className="text-xs text-muted">
          O pedido nasce como rascunho, no fornecedor principal do produto. Enviar é um
          toque em Compras — bipe errado não vira caminhão na porta.
        </p>
      </div>
    </BottomSheet>
  );
}
