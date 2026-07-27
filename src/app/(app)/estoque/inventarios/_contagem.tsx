"use client";

// Tela dedicada de UMA contagem em andamento. Extraída da lista de inventários
// para dar foco total ao operador: só o inventário aberto, sem o resto da agenda.

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  ClipboardList,
  CheckCircle2,
  Search,
  ArrowUpRight,
  ArrowDownRight,
  AlertTriangle,
  Check,
  ArrowLeft,
  Package,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet } from "@/components/ui/sheet";
import { PageHeader } from "@/components/app/page-header";
import {
  salvarContagemInventarioAction,
  fecharInventarioAction,
  cancelarInventarioAction,
} from "../actions";
import {
  type Inventario,
  pl,
  fmtQtd,
  tituloEscopo,
  subtituloInventario,
} from "./_client";

function Thumb({ url }: { url: string | null }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      className="h-10 w-10 shrink-0 rounded-[var(--radius)] border border-line object-cover"
    />
  ) : (
    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius)] border border-line bg-surface text-faint">
      <Package size={18} />
    </div>
  );
}

export function ContagemView({
  inventario,
  multiSite,
}: {
  inventario: Inventario;
  multiSite: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // productId -> qtdContada
  const [contagem, setContagem] = useState<Record<string, number>>(() => {
    const inicial: Record<string, number> = {};
    for (const it of inventario.items) {
      if (it.qtdContada != null) inicial[it.productId] = it.qtdContada;
    }
    return inicial;
  });
  const [confirmados, setConfirmados] = useState<Set<string>>(
    () => new Set(inventario.items.filter((it) => it.qtdContada != null).map((it) => it.productId)),
  );
  const [buscaContagem, setBuscaContagem] = useState("");
  const [rascunhoSalvoEm, setRascunhoSalvoEm] = useState<Date | null>(null);
  const [revisaoAberta, setRevisaoAberta] = useState(false);
  const primeiroInputRef = useRef<HTMLInputElement>(null);

  const totalAberto = inventario.items.length;
  const contadosAberto = inventario.items.filter(
    (it) => contagem[it.productId] != null,
  ).length;
  const pctAberto = totalAberto > 0 ? Math.round((contadosAberto / totalAberto) * 100) : 0;

  useEffect(() => {
    primeiroInputRef.current?.focus();
  }, []);

  function confirmarCampo(productId: string) {
    setConfirmados((prev) => (prev.has(productId) ? prev : new Set(prev).add(productId)));
    const valor = contagem[productId];
    if (valor == null) return;
    salvarContagemInventarioAction({
      inventoryId: inventario.id,
      items: [{ productId, qtdContada: Math.max(0, valor) }],
    })
      .then(() => setRascunhoSalvoEm(new Date()))
      .catch(() => {});
  }

  function editarCampo(productId: string) {
    setConfirmados((prev) => {
      if (!prev.has(productId)) return prev;
      const next = new Set(prev);
      next.delete(productId);
      return next;
    });
  }

  function focarProximo(idx: number) {
    const proximo = document.querySelector<HTMLInputElement>(`[data-conta-idx="${idx + 1}"]`);
    if (proximo) proximo.focus();
    else (document.activeElement as HTMLElement | null)?.blur();
  }

  function setConta(productId: string, qtd: number) {
    setContagem((p) => ({ ...p, [productId]: qtd }));
  }

  // Itens ordenados por localização (corredor/prateleira) e filtráveis.
  const termoContagem = buscaContagem.trim().toLowerCase();
  const itensOrdenados = [...inventario.items].sort((a, b) => {
    const la = a.locationNome ?? "￿";
    const lb = b.locationNome ?? "￿";
    return la.localeCompare(lb, "pt-BR") || a.nome.localeCompare(b.nome, "pt-BR");
  });
  const itensContagem = termoContagem
    ? itensOrdenados.filter(
        (it) =>
          it.nome.toLowerCase().includes(termoContagem) ||
          it.sku.toLowerCase().includes(termoContagem) ||
          (it.ean ?? "").includes(termoContagem),
      )
    : itensOrdenados;

  const divergentesRevisao = inventario.items.filter(
    (it) => contagem[it.productId] != null && contagem[it.productId] !== it.qtdSistema,
  );
  const naoContadosRevisao = inventario.items.filter((it) => contagem[it.productId] == null);

  function fechar() {
    setError(null);
    const items = inventario.modoCego
      ? inventario.items
          .filter((it) => contagem[it.productId] != null)
          .map((it) => ({ productId: it.productId, qtdContada: contagem[it.productId] }))
      : inventario.items.map((it) => ({
          productId: it.productId,
          qtdContada: contagem[it.productId] ?? it.qtdSistema,
        }));
    startTransition(async () => {
      try {
        await fecharInventarioAction({ inventoryId: inventario.id, items });
        router.push("/estoque/inventarios");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao fechar inventário.");
      }
    });
  }

  function cancelar() {
    setError(null);
    startTransition(async () => {
      try {
        await cancelarInventarioAction(inventario.id);
        router.push("/estoque/inventarios");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao cancelar.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={`Contagem · ${tituloEscopo(inventario)}`}
        icon={ClipboardList}
        description={subtituloInventario(inventario, multiSite)}
        backHref="/estoque/inventarios"
        innerClassName="max-w-none"
        actions={
          <button
            type="button"
            onClick={cancelar}
            disabled={pending}
            className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-3.5 py-2 text-sm font-medium text-muted transition-colors hover:text-danger"
          >
            Cancelar contagem
          </button>
        }
      />

      {error && (
        <p className="rounded-[var(--radius)] bg-danger-soft px-4 py-2.5 text-sm text-danger">{error}</p>
      )}

      <div className="relative flex flex-col gap-3 overflow-hidden rounded-[var(--radius-lg)] border border-brand/30 bg-surface p-5">
        <span className="absolute inset-y-0 left-0 w-1 bg-brand" aria-hidden />

        <div className="pl-1">
          <div className="flex items-center justify-between text-[11px] text-faint">
            <span>
              {contadosAberto} de {totalAberto} {pl(totalAberto, "produto contado", "produtos contados")}
              {rascunhoSalvoEm && <span className="text-faint"> · Contagem salva automaticamente</span>}
            </span>
            <span className="font-semibold text-brand">{pctAberto}% concluído</span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pctAberto}%` }} />
          </div>
        </div>

        {inventario.items.length > 5 && (
          <div className="relative pl-1">
            <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-faint" />
            <input
              value={buscaContagem}
              onChange={(e) => setBuscaContagem(e.target.value)}
              placeholder="Buscar por nome, SKU ou código de barras..."
              className="w-full rounded-[var(--radius)] border border-line bg-surface py-2 pl-8 pr-3 text-sm text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            />
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          {itensContagem.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-faint">
              Nenhum produto encontrado para “{buscaContagem}”.
            </p>
          )}
          {itensContagem.map((it, idx) => {
            const touched = contagem[it.productId] != null;
            const contada = touched ? contagem[it.productId] : "";
            const confirmado = touched && confirmados.has(it.productId);
            const diverge = !inventario.modoCego && confirmado && contagem[it.productId] !== it.qtdSistema;
            const diffVal = diverge ? (contada as number) - it.qtdSistema : 0;
            return (
              <div key={it.productId} className="flex items-center gap-3 rounded-[var(--radius)] bg-surface-2 px-3 py-1.5">
                <Thumb url={it.imagemUrl} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink">{it.nome}</p>
                  <p className="font-mono text-[11px] text-faint">
                    {it.sku}
                    {it.ean && ` · ${it.ean}`}
                    {it.locationNome && ` · ${it.locationNome}`}
                    {!inventario.modoCego && (
                      <> · No sistema tem: <span className="font-semibold text-ink">{fmtQtd(it.qtdSistema)}</span></>
                    )}
                  </p>
                </div>
                <div className="flex w-28 shrink-0 flex-col gap-1">
                  <div className="flex items-center gap-1.5">
                    <label className="text-[10px] font-semibold text-faint">Contado</label>
                    {diverge && (
                      <span
                        className={cn(
                          "inline-flex items-center gap-0.5 text-[10px] font-semibold tabular-nums",
                          diffVal > 0 ? "text-ok" : "text-danger",
                        )}
                      >
                        {diffVal > 0 ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                        {diffVal > 0 ? "+" : ""}
                        {fmtQtd(diffVal)}
                      </span>
                    )}
                    {!inventario.modoCego && confirmado && !diverge && (
                      <Check size={11} className="text-ok" aria-label="Confere com o sistema" />
                    )}
                  </div>
                  <input
                    ref={idx === 0 ? primeiroInputRef : undefined}
                    data-conta-idx={idx}
                    type="number"
                    min={0}
                    step={0.001}
                    value={contada}
                    placeholder="0"
                    onChange={(e) => setConta(it.productId, Number(e.target.value))}
                    onFocus={() => editarCampo(it.productId)}
                    onBlur={() => { if (touched) confirmarCampo(it.productId); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (touched) confirmarCampo(it.productId);
                        focarProximo(idx);
                      }
                    }}
                    className={cn(
                      "rounded-[var(--radius)] border bg-surface px-3 py-1.5 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
                      diverge ? "border-warn text-warn" : "border-line text-ink focus-visible:border-brand",
                    )}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line pt-3">
          {inventario.modoCego && contadosAberto < totalAberto && (
            <p className="text-xs text-muted">
              Contagem cega exige contar todos os produtos —{" "}
              {totalAberto - contadosAberto === 1
                ? "falta 1 produto"
                : `faltam ${totalAberto - contadosAberto} produtos`}.
            </p>
          )}
          <button
            type="button"
            onClick={() => setRevisaoAberta(true)}
            disabled={pending || (inventario.modoCego && contadosAberto < totalAberto)}
            title={
              inventario.modoCego && contadosAberto < totalAberto
                ? "Na contagem cega todos os produtos precisam ser contados antes de finalizar"
                : undefined
            }
            className="flex cursor-pointer items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-60"
          >
            <CheckCircle2 size={14} />
            {inventario.modoCego ? "Revisar e finalizar" : "Revisar divergências e finalizar"}
          </button>
        </div>
      </div>

      {/* ── Revisão antes de finalizar ── */}
      <Sheet
        open={revisaoAberta}
        onClose={() => setRevisaoAberta(false)}
        title="Revisar e finalizar"
        description={
          inventario.modoCego
            ? "Confira os valores contados antes de finalizar — a divergência é calculada no fechamento, sem mostrar o saldo do sistema."
            : "Confira o resultado antes de aplicar os ajustes — divergências geram ajuste automático no saldo."
        }
        width="lg"
      >
        {inventario.modoCego ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-faint">
                {inventario.items.length} {pl(inventario.items.length, "produto contado", "produtos contados")}
              </p>
              <div className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
                {itensOrdenados.map((it) => (
                  <div
                    key={it.productId}
                    className="flex items-center gap-3 rounded-[var(--radius)] border border-line bg-surface-2 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{it.nome}</p>
                      <p className="font-mono text-[11px] text-faint">
                        {it.sku}
                        {it.locationNome && ` · ${it.locationNome}`}
                      </p>
                    </div>
                    <div className="w-14 shrink-0 text-center">
                      <p className="text-[10px] text-faint">Contado</p>
                      <p className="text-sm font-semibold tabular-nums text-ink">
                        {contagem[it.productId] != null ? fmtQtd(contagem[it.productId]) : "—"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <RevisaoFooter pending={pending} onVoltar={() => setRevisaoAberta(false)} onFechar={fechar} />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {naoContadosRevisao.length > 0 && (
              <div className="flex items-start gap-2.5 rounded-[var(--radius)] border border-warn/30 bg-warn-soft px-4 py-3">
                <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn" />
                <div>
                  <p className="text-sm font-medium text-ink">
                    {naoContadosRevisao.length} {pl(naoContadosRevisao.length, "produto não contado", "produtos não contados")}
                  </p>
                  <p className="text-xs text-muted">
                    {pl(naoContadosRevisao.length, "Será mantido", "Serão mantidos")} com o saldo do sistema, sem ajuste.
                  </p>
                </div>
              </div>
            )}

            {divergentesRevisao.length === 0 ? (
              <div className="flex items-center gap-2.5 rounded-[var(--radius)] border border-ok/30 bg-ok-soft px-4 py-3">
                <CheckCircle2 size={16} className="shrink-0 text-ok" />
                <p className="text-sm text-ink">Nenhuma divergência — a contagem confere com o sistema.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-faint">
                  {divergentesRevisao.length} {pl(divergentesRevisao.length, "divergência será ajustada", "divergências serão ajustadas")}
                </p>
                <div className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
                  {divergentesRevisao.map((it) => {
                    const contadaRev = contagem[it.productId];
                    const diffRev = contadaRev - it.qtdSistema;
                    return (
                      <div
                        key={it.productId}
                        className="flex items-center gap-3 rounded-[var(--radius)] border border-l-2 border-y-line border-r-line border-l-warn bg-surface-2 px-3 py-2"
                      >
                        {diffRev > 0 ? (
                          <ArrowUpRight size={14} className="shrink-0 text-ok" aria-label="Contado a mais" />
                        ) : (
                          <ArrowDownRight size={14} className="shrink-0 text-danger" aria-label="Contado a menos" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-ink">{it.nome}</p>
                          <p className="font-mono text-[11px] text-faint">{it.sku}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-4">
                          <div className="w-14 text-center">
                            <p className="text-[10px] text-faint">Sistema</p>
                            <p className="text-sm tabular-nums text-ink">{fmtQtd(it.qtdSistema)}</p>
                          </div>
                          <div className="w-14 text-center">
                            <p className="text-[10px] text-faint">Contado</p>
                            <p className={cn("text-sm font-semibold tabular-nums", diffRev > 0 ? "text-ok" : "text-danger")}>
                              {fmtQtd(contadaRev)}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <RevisaoFooter pending={pending} onVoltar={() => setRevisaoAberta(false)} onFechar={fechar} />
          </div>
        )}
      </Sheet>
    </div>
  );
}

function RevisaoFooter({
  pending,
  onVoltar,
  onFechar,
}: {
  pending: boolean;
  onVoltar: () => void;
  onFechar: () => void;
}) {
  return (
    <div className="flex justify-end gap-2 border-t border-line pt-3">
      <button
        type="button"
        onClick={onVoltar}
        disabled={pending}
        className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
      >
        <ArrowLeft size={14} /> Voltar à contagem
      </button>
      <button
        type="button"
        onClick={onFechar}
        disabled={pending}
        className="flex cursor-pointer items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-60"
      >
        {pending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
        Confirmar e finalizar
      </button>
    </div>
  );
}
