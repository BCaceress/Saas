"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ShoppingCart,
  Trash2,
  Minus,
  Plus,
  ArrowLeftRight,
  Loader2,
  TriangleAlert,
  FileText,
  Link2Off,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Badge, Field } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { CarrinhoPorFornecedor } from "../../cotacoes/_catalogo/types";
import { EstadoVazio, SupplierAvatar, fmtMoney, fmtPreco, fmtQtd } from "../../cotacoes/_catalogo/ui";
import {
  atualizarItemCarrinhoAction,
  gerarPedidosAction,
  limparCarrinhoAction,
  removerItemCarrinhoAction,
  trocarPorMelhorPrecoAction,
} from "../../cotacoes/_catalogo/actions";

/**
 * Carrinho — um bloco por fornecedor, porque é assim que ele vira pedido:
 * fechar gera um PurchaseOrder para cada fornecedor, com os mesmos itens e
 * preços que estão aqui.
 */
export function CarrinhoCompras({
  grupos,
  sites,
  siteInicial,
  podePedir,
}: {
  grupos: CarrinhoPorFornecedor[];
  sites: Array<{ id: string; nome: string }>;
  siteInicial: string;
  podePedir: boolean;
}) {
  const router = useRouter();
  const [siteId, setSiteId] = useState(siteInicial);
  const [previsao, setPrevisao] = useState("");
  const [enviar, setEnviar] = useState(false);
  const [pending, startTransition] = useTransition();

  const total = useMemo(() => grupos.reduce((s, g) => s + g.total, 0), [grupos]);
  const itens = useMemo(() => grupos.reduce((s, g) => s + g.itens.length, 0), [grupos]);
  const semVinculo = useMemo(
    () => grupos.reduce((s, g) => s + g.itens.filter((i) => !i.productId).length, 0),
    [grupos],
  );
  const economiaPossivel = useMemo(
    () =>
      grupos.reduce(
        (s, g) =>
          s +
          g.itens.reduce(
            (acc, i) =>
              i.melhorPreco != null && i.melhorPreco < i.precoUnitario
                ? acc + (i.precoUnitario - i.melhorPreco) * i.quantidade
                : acc,
            0,
          ),
        0,
      ),
    [grupos],
  );

  function fechar() {
    startTransition(async () => {
      try {
        const r = await gerarPedidosAction({ siteId, enviar, previsaoEntrega: previsao || null });
        toast.success(
          r.criados.length === 1 ? "Pedido criado" : `${r.criados.length} pedidos criados`,
          r.semVinculo > 0
            ? `${r.semVinculo} item(ns) sem produto ficaram no carrinho para revisão.`
            : r.criados.map((c) => c.supplierNome).join(", "),
        );
        router.push("/pedidos");
      } catch (e) {
        toast.error("Não deu para fechar", e instanceof Error ? e.message : undefined);
      }
    });
  }

  function limpar() {
    startTransition(async () => {
      await limparCarrinhoAction();
      toast.success("Carrinho limpo");
      router.refresh();
    });
  }

  if (grupos.length === 0) {
    return (
      <EstadoVazio
        icon={<ShoppingCart size={20} />}
        titulo="Carrinho vazio"
        descricao="Escolha as ofertas no comparador ou direto no catálogo do fornecedor. Aqui elas viram um pedido por fornecedor."
        acao={
          <Link href="/cotacoes/comparador">
            <Button size="sm">Abrir comparador</Button>
          </Link>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-28">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted">
          {itens} item{itens > 1 ? "ns" : ""} em {grupos.length} fornecedor
          {grupos.length > 1 ? "es" : ""} — cada um vira um pedido separado.
        </p>
        <button
          type="button"
          onClick={limpar}
          disabled={pending}
          className="text-[12px] text-muted transition-colors hover:text-danger disabled:opacity-50"
        >
          Limpar carrinho
        </button>
      </div>

      {economiaPossivel > 0.01 && (
        <p className="flex items-center gap-2 rounded-[var(--radius)] border border-accent/40 bg-accent-soft/40 px-3.5 py-2.5 text-[13px] text-ink-2">
          <ArrowLeftRight size={15} className="shrink-0 text-accent" />
          Há {fmtMoney(economiaPossivel)} de diferença se cada item for comprado no fornecedor mais
          barato. Use o botão de troca nas linhas marcadas.
        </p>
      )}

      {grupos.map((grupo) => (
        <GrupoFornecedor key={grupo.supplierId} grupo={grupo} podePedir={podePedir} />
      ))}

      {semVinculo > 0 && (
        <p className="flex items-start gap-2 rounded-[var(--radius)] border border-warn/40 bg-warn-soft/40 px-3.5 py-2.5 text-[12px] text-ink-2">
          <Link2Off size={14} className="mt-0.5 shrink-0 text-warn" />
          {semVinculo} item(ns) não estão vinculados a um produto seu e não entram no pedido. Vincule
          pelo catálogo do fornecedor para incluí-los.
        </p>
      )}

      {/* Fechamento — footer fixo, como nos outros formulários do app */}
      {podePedir && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur md:left-64 print:hidden">
          <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Loja de destino" className="w-44">
                <Select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nome}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Previsão de entrega" className="w-40">
                <Input type="date" value={previsao} onChange={(e) => setPrevisao(e.target.value)} />
              </Field>
              <label className="flex h-10 cursor-pointer items-center gap-2 text-[13px] text-ink-2">
                <input
                  type="checkbox"
                  checked={enviar}
                  onChange={(e) => setEnviar(e.target.checked)}
                  className="h-4 w-4 accent-[var(--brand)]"
                />
                Já marcar como enviado
              </label>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-[11px] uppercase tracking-wide text-faint">Total</p>
                <p className="font-display text-[18px] font-semibold text-ink">{fmtMoney(total)}</p>
              </div>
              <Button onClick={fechar} disabled={pending || !siteId}>
                {pending ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
                Gerar {grupos.length} pedido{grupos.length > 1 ? "s" : ""}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GrupoFornecedor({
  grupo,
  podePedir,
}: {
  grupo: CarrinhoPorFornecedor;
  podePedir: boolean;
}) {
  const abaixoDoMinimo = grupo.pedidoMinimo != null && grupo.total < grupo.pedidoMinimo;

  return (
    <section className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <SupplierAvatar nome={grupo.supplierNome} size={34} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-[15px] font-semibold text-ink">
            {grupo.supplierNome}
          </h3>
          <p className="text-[11px] text-muted">
            {grupo.itens.length} item{grupo.itens.length > 1 ? "ns" : ""}
            {grupo.pedidoMinimo != null && ` · mínimo ${fmtMoney(grupo.pedidoMinimo)}`}
          </p>
        </div>
        {abaixoDoMinimo && (
          <Badge tone="warn">
            <TriangleAlert size={11} />
            Abaixo do mínimo
          </Badge>
        )}
        <p className="font-display text-[16px] font-semibold text-ink">{fmtMoney(grupo.total)}</p>
      </header>

      <ul className="divide-y divide-line">
        {grupo.itens.map((item) => (
          <LinhaCarrinho key={item.id} item={item} podePedir={podePedir} />
        ))}
      </ul>
    </section>
  );
}

function LinhaCarrinho({
  item,
  podePedir,
}: {
  item: CarrinhoPorFornecedor["itens"][number];
  podePedir: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [quantidade, setQuantidade] = useState(item.quantidade);

  const temMelhor =
    item.melhorPreco != null &&
    item.melhorFornecedorId !== item.supplierId &&
    item.melhorPreco < item.precoUnitario;

  function salvarQuantidade(nova: number) {
    setQuantidade(nova);
    startTransition(async () => {
      try {
        await atualizarItemCarrinhoAction(item.id, nova);
        router.refresh();
      } catch (e) {
        toast.error("Não deu para atualizar", e instanceof Error ? e.message : undefined);
      }
    });
  }

  function remover() {
    startTransition(async () => {
      await removerItemCarrinhoAction(item.id);
      router.refresh();
    });
  }

  function trocar() {
    startTransition(async () => {
      try {
        await trocarPorMelhorPrecoAction(item.id);
        toast.success("Trocado", `Agora em ${item.melhorFornecedorNome}.`);
        router.refresh();
      } catch (e) {
        toast.error("Não deu para trocar", e instanceof Error ? e.message : undefined);
      }
    });
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-2.5">
      <div className="min-w-40 flex-1">
        <p className="truncate text-[13px] font-medium text-ink">{item.descricao}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
          {item.unidade && <span>{item.unidade}</span>}
          {!item.productId && <Badge tone="warn">sem vínculo</Badge>}
          {temMelhor && (
            <span className="text-accent">
              {item.melhorFornecedorNome} faz por {fmtPreco(item.melhorPreco as number)}
            </span>
          )}
        </p>
      </div>

      {podePedir ? (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => salvarQuantidade(Math.max(1, quantidade - 1))}
            disabled={pending}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-line text-muted transition-colors hover:bg-surface-2"
            aria-label="Diminuir quantidade"
          >
            <Minus size={12} />
          </button>
          <span className="w-10 text-center font-mono text-[13px] font-semibold text-ink">
            {fmtQtd(quantidade)}
          </span>
          <button
            type="button"
            onClick={() => salvarQuantidade(quantidade + 1)}
            disabled={pending}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-line text-muted transition-colors hover:bg-surface-2"
            aria-label="Aumentar quantidade"
          >
            <Plus size={12} />
          </button>
        </div>
      ) : (
        <span className="font-mono text-[13px] text-ink">{fmtQtd(quantidade)}</span>
      )}

      <div className="w-24 shrink-0 text-right">
        <p className="font-mono text-[13px] font-semibold text-ink">
          {fmtMoney(item.precoUnitario * quantidade)}
        </p>
        <p className="font-mono text-[11px] text-faint">{fmtPreco(item.precoUnitario)} un.</p>
      </div>

      {podePedir && (
        <div className="flex shrink-0 items-center gap-0.5">
          {temMelhor && (
            <Button
              size="icon"
              variant="ghost"
              onClick={trocar}
              disabled={pending}
              title={`Trocar para ${item.melhorFornecedorNome}`}
              className={cn("text-accent")}
            >
              <ArrowLeftRight size={15} />
            </Button>
          )}
          <Button size="icon" variant="ghost" onClick={remover} disabled={pending} title="Remover">
            <Trash2 size={15} />
          </Button>
        </div>
      )}
    </li>
  );
}
