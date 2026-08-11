"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCheck, Loader2, PackageOpen, ScanLine, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge, Card } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { Scanner } from "@/components/mobile/scanner";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import {
  TecladoNumerico,
  VisorQuantidade,
  paraNumero,
} from "@/components/mobile/teclado-numerico";
import { receberPedidoCompraAction } from "@/app/(app)/estoque/actions";
import type { PedidoCompraView, PedidoCompraItemView } from "@/app/(app)/estoque/_data";

/**
 * Conferência de pedido na porta.
 *
 * Bipa o código, o item sobe, a quantidade recebida entra no teclado. As
 * quantidades são em UNIDADE DE COMPRA (a embalagem do pedido), igual ao
 * desktop — `receberPedidoCompra` é quem multiplica pelo `fatorConversao`.
 * Mostrar unidade base aqui faria o conferente digitar 120 onde o pedido diz
 * 10 caixas.
 *
 * Diferente da contagem, aqui NÃO há salvamento parcial: `receberPedidoCompra`
 * dá entrada no estoque e mexe no financeiro — é uma decisão só, no fim, com o
 * que foi conferido.
 */
export function ReceberClient({
  pedido,
  codigos,
}: {
  pedido: PedidoCompraView;
  /** productId → códigos de barras (unidade e embalagens). */
  codigos: Record<string, string[]>;
}) {
  const router = useRouter();

  // Começa com o que já foi recebido em conferências anteriores (parcial).
  const [recebido, setRecebido] = React.useState<Record<string, number>>(() =>
    Object.fromEntries(pedido.items.map((i) => [i.id, i.qtdRecebida])),
  );
  const [ordem, setOrdem] = React.useState<string[]>([]);
  const [alvo, setAlvo] = React.useState<PedidoCompraItemView | null>(null);
  // A câmera nasce desligada: conferir pela lista (com busca por texto) é o
  // caminho de quem já tem a nota na mão; vídeo ligado sem pedir come bateria.
  const [camera, setCamera] = React.useState(false);
  const [busca, setBusca] = React.useState("");
  const [nota, setNota] = React.useState("");
  const [enviando, setEnviando] = React.useState(false);
  const [confirmar, setConfirmar] = React.useState(false);
  const [confirmarTudo, setConfirmarTudo] = React.useState(false);

  const porCodigo = React.useMemo(() => {
    const m = new Map<string, PedidoCompraItemView>();
    for (const item of pedido.items) {
      for (const c of codigos[item.productId] ?? []) m.set(c, item);
      m.set(item.sku.toLowerCase(), item);
    }
    return m;
  }, [pedido.items, codigos]);

  const aoLerCodigo = React.useCallback(
    (codigo: string) => {
      const item = porCodigo.get(codigo) ?? porCodigo.get(codigo.toLowerCase());
      if (!item) {
        toast.error("Fora deste pedido", `Código ${codigo} não está na lista.`);
        return;
      }
      setAlvo(item);
    },
    [porCodigo],
  );

  function definir(itemId: string, qtd: number) {
    setRecebido((prev) => ({ ...prev, [itemId]: qtd }));
    setOrdem((prev) => [itemId, ...prev.filter((p) => p !== itemId)]);
    setAlvo(null);
  }

  /**
   * "Veio tudo": carimba cada item com a quantidade PEDIDA e dá todos por
   * conferidos. É o caso comum de quem já conferiu com a nota na porta — sem
   * isto, um pedido de 40 linhas exige 40 aberturas de teclado para digitar
   * exatamente o número que já está na tela.
   *
   * Fica atrás de confirmação porque apaga o que foi conferido item a item.
   */
  function receberTudoConformePedido() {
    setRecebido(Object.fromEntries(pedido.items.map((i) => [i.id, i.qtdPedida])));
    setOrdem(pedido.items.map((i) => i.id));
    setConfirmarTudo(false);
    toast.success("Tudo conferido conforme o pedido.", "Revise antes de dar entrada.");
  }

  async function finalizar() {
    setEnviando(true);
    try {
      await receberPedidoCompraAction({
        pedidoId: pedido.id,
        numeroNota: nota.trim() || null,
        gerarFinanceiro: false,
        items: pedido.items.map((i) => ({
          itemId: i.id,
          qtdRecebida: recebido[i.id] ?? 0,
        })),
      });
      toast.success("Entrada registrada.", "O estoque já foi atualizado.");
      router.push("/m/receber");
      router.refresh();
    } catch (e) {
      toast.error(
        "Não foi possível receber",
        e instanceof Error ? e.message : "Tente de novo.",
      );
      setEnviando(false);
      setConfirmar(false);
    }
  }

  const conferidos = ordem.length;
  const divergentes = pedido.items.filter(
    (i) => (recebido[i.id] ?? 0) !== i.qtdPedida,
  ).length;

  const lista = React.useMemo(() => {
    const pos = new Map(ordem.map((id, i) => [id, i]));
    const termo = busca.trim().toLowerCase();
    return [...pedido.items]
      .filter((i) => {
        if (!termo) return true;
        const cods = (codigos[i.productId] ?? []).join(" ");
        return `${i.nome} ${i.sku} ${cods}`.toLowerCase().includes(termo);
      })
      .sort((a, b) => {
        const pa = pos.get(a.id);
        const pb = pos.get(b.id);
        if (pa != null && pb != null) return pa - pb;
        if (pa != null) return -1;
        if (pb != null) return 1;
        return a.nome.localeCompare(b.nome, "pt-BR");
      });
  }, [pedido.items, ordem, busca, codigos]);

  return (
    <div className="space-y-3 pb-16">
      {camera && (
        <Scanner
          onCodigo={aoLerCodigo}
          continuo
          ocupado={alvo !== null}
          onFechar={() => setCamera(false)}
        />
      )}

      {/* Achar o item pelo nome/código e bipar são a mesma pergunta ("qual item
          agora?"), então dividem a linha — o leitor é o botão à direita. */}
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-faint"
            aria-hidden
          />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Achar por nome ou código"
            aria-label="Buscar item do pedido"
            className="min-h-11 w-full rounded-full border border-line-button bg-surface pr-4 pl-9 text-sm text-ink placeholder:text-faint focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
          />
        </div>

        <button
          type="button"
          onClick={() => setCamera((v) => !v)}
          aria-pressed={camera}
          aria-label={camera ? "Fechar o leitor" : "Ler código de barras"}
          className={cn(
            "tap grid h-11 w-11 shrink-0 place-items-center rounded-full border transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none",
            camera
              ? "border-brand bg-brand text-on-brand"
              : "border-line-button bg-surface text-ink",
          )}
        >
          <ScanLine className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <Button
        variant="secondary"
        onClick={() => setConfirmarTudo(true)}
        className="w-full"
      >
        <CheckCheck className="h-4 w-4" aria-hidden />
        Veio tudo conforme o pedido
      </Button>

      <ul className="space-y-1.5">
        {lista.map((i) => {
          const q = recebido[i.id] ?? 0;
          const conferido = ordem.includes(i.id);
          const diverge = q !== i.qtdPedida;
          const unidade = i.packagingNome ?? "un";
          return (
            <li key={i.id}>
              <button type="button" onClick={() => setAlvo(i)} className="w-full text-left">
                <Card
                  className={cn(
                    "flex items-center gap-3 p-3",
                    conferido && (diverge ? "border-warn/40 bg-warn-soft/30" : "border-ok/40 bg-ok-soft/30"),
                  )}
                >
                  {/* Foto no lugar do ícone de estado: na porta quem confere
                      olha a embalagem, não o nome. O estado vira selo no canto.
                      <img> cru como no resto do app — a URL é arbitrária e
                      next/image exigiria allowlist por host. */}
                  <span className="relative shrink-0">
                    {i.imagemUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={i.imagemUrl}
                        alt=""
                        className="h-12 w-12 rounded-lg border border-line bg-surface object-contain"
                      />
                    ) : (
                      <span className="grid h-12 w-12 place-items-center rounded-lg border border-line bg-surface-2 text-muted">
                        <PackageOpen className="h-5 w-5" aria-hidden />
                      </span>
                    )}
                    <span
                      className={cn(
                        "absolute -right-1 -bottom-1 grid h-5 w-5 place-items-center rounded-full ring-2 ring-surface",
                        conferido
                          ? diverge
                            ? "bg-warn text-white"
                            : "bg-ok text-white"
                          : "bg-surface-2 text-muted",
                      )}
                      aria-hidden
                    >
                      {conferido ? <Check className="h-3 w-3" /> : <ScanLine className="h-3 w-3" />}
                    </span>
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{i.nome}</span>
                    <span className="block truncate font-mono text-[11px] text-muted">
                      {i.sku}
                    </span>
                    {i.tipo !== "COMPRA" && (
                      <Badge tone="accent" className="mt-1">
                        Bonificação
                      </Badge>
                    )}
                  </span>

                  <span className="shrink-0 text-right">
                    <span className="block font-display text-lg leading-none font-semibold text-ink tabular-nums">
                      {q.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}
                    </span>
                    <span className="text-[11px] text-muted">
                      de {i.qtdPedida.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}{" "}
                      {unidade.toLowerCase()}
                    </span>
                  </span>
                </Card>
              </button>
            </li>
          );
        })}
      </ul>

      {lista.length === 0 && (
        <Card className="p-6 text-center text-sm text-ink-2">
          Nenhum item do pedido com “{busca.trim()}”.
        </Card>
      )}

      <div className="fixed inset-x-0 bottom-16 z-30 border-t border-line bg-surface px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-ink">
              {conferidos} de {pedido.items.length} conferidos
            </p>
            <p className="text-[11px] text-muted">
              {divergentes > 0
                ? `${divergentes} diferente${divergentes > 1 ? "s" : ""} do pedido`
                : "tudo bateu com o pedido"}
            </p>
          </div>
          <Button onClick={() => setConfirmar(true)} disabled={enviando}>
            Dar entrada
          </Button>
        </div>
      </div>

      {alvo && (
        <SheetItem
          item={alvo}
          atual={recebido[alvo.id] ?? 0}
          onFechar={() => setAlvo(null)}
          onConfirmar={(q) => definir(alvo.id, q)}
        />
      )}

      {confirmar && (
        <BottomSheet
          open
          onClose={() => setConfirmar(false)}
          titulo="Dar entrada no estoque"
          descricao="Isto atualiza o saldo e não pode ser desfeito por aqui."
          rodape={
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => setConfirmar(false)}
                className="flex-1"
                size="lg"
              >
                Voltar
              </Button>
              <Button onClick={finalizar} disabled={enviando} className="flex-1" size="lg">
                {enviando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                Confirmar
              </Button>
            </div>
          }
        >
          <div className="space-y-3 pb-2">
            {divergentes > 0 && (
              <p className="rounded-lg bg-warn-soft p-3 text-[13px] text-warn">
                {divergentes} {divergentes > 1 ? "itens estão" : "item está"} com quantidade
                diferente da pedida. O pedido fica como recebido parcial.
              </p>
            )}
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink">
                Número da nota (opcional)
              </span>
              <input
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                inputMode="numeric"
                placeholder="Ex.: 123456"
                className="min-h-11 w-full rounded-full border border-line-button bg-surface px-4 text-sm text-ink placeholder:text-faint focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              />
            </label>
          </div>
        </BottomSheet>
      )}

      {confirmarTudo && (
        <BottomSheet
          open
          onClose={() => setConfirmarTudo(false)}
          titulo="Veio tudo conforme o pedido?"
          descricao="Cada item fica com a quantidade que foi pedida."
          rodape={
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => setConfirmarTudo(false)}
                className="flex-1"
                size="lg"
              >
                Voltar
              </Button>
              <Button onClick={receberTudoConformePedido} className="flex-1" size="lg">
                <CheckCheck className="h-4 w-4" aria-hidden />
                Confirmar tudo
              </Button>
            </div>
          }
        >
          <div className="space-y-3 pb-2">
            <p className="text-[13px] text-ink-2">
              {pedido.items.length} {pedido.items.length > 1 ? "itens ficam" : "item fica"}{" "}
              conferido{pedido.items.length > 1 ? "s" : ""} com a quantidade pedida. Nada
              entra no estoque ainda — a entrada continua sendo no botão “Dar entrada”.
            </p>
            {conferidos > 0 && (
              <p className="rounded-lg bg-warn-soft p-3 text-[13px] text-warn">
                Isto substitui o que já foi conferido item a item.
              </p>
            )}
          </div>
        </BottomSheet>
      )}
    </div>
  );
}

function SheetItem({
  item,
  atual,
  onFechar,
  onConfirmar,
}: {
  item: PedidoCompraItemView;
  atual: number;
  onFechar: () => void;
  onConfirmar: (q: number) => void;
}) {
  const [valor, setValor] = React.useState(atual ? String(atual).replace(".", ",") : "");
  const unidade = item.packagingNome ?? "unidade";

  return (
    <BottomSheet
      open
      onClose={onFechar}
      titulo={item.nome}
      descricao={
        <>
          Pedido: {item.qtdPedida.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}{" "}
          {unidade.toLowerCase()}
          {item.fatorConversao > 1 && (
            <> · 1 {unidade.toLowerCase()} = {item.fatorConversao} un</>
          )}
        </>
      }
      rodape={
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => onConfirmar(item.qtdPedida)}
            className="flex-1"
            size="lg"
          >
            Veio tudo
          </Button>
          <Button
            onClick={() => onConfirmar(paraNumero(valor))}
            disabled={valor === ""}
            className="flex-1"
            size="lg"
          >
            <Check className="h-4 w-4" aria-hidden />
            Confirmar
          </Button>
        </div>
      }
    >
      <div className="space-y-3 pb-2">
        <VisorQuantidade valor={valor} unidade={unidade.toLowerCase()} />
        <TecladoNumerico valor={valor} onChange={setValor} decimais={3} />
        <button
          type="button"
          onClick={() => onConfirmar(0)}
          className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-1.5 rounded-full text-[13px] font-medium text-danger hover:bg-danger-soft"
        >
          <X className="h-4 w-4" aria-hidden />
          Não veio nada deste item
        </button>
      </div>
    </BottomSheet>
  );
}
