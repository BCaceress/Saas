"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Boxes,
  CheckCircle2,
  CornerDownLeft,
  ImageOff,
  ImagePlus,
  Minus,
  Plus,
  Search,
  Trash2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { cn, brl, margem, maskMoney, moneyToMask, parseMoney } from "@/lib/utils";
import { derive, type DeriveComponent } from "@/lib/derive";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field, Badge, Eyebrow } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { PageHeader } from "@/components/app/page-header";
import { SkuTag } from "@/components/sku-tag";
import { SectionCard, Linha, Thumb } from "./parts";
import {
  OnlineChannels,
  initChannels,
  channelsToInput,
  type ChannelRow,
} from "./online-channels";
import { createCombo, updateCombo } from "../actions";
import type { SalesChannel } from "@/generated/prisma";
import type {
  ComponentCandidate,
  ComboData,
} from "../_types";

type Item = { componentProductId: string; quantidade: number };

export function ComboForm({
  mode,
  combo,
  candidates,
}: {
  mode: "new" | "edit";
  combo?: ComboData | null;
  candidates: ComponentCandidate[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const nomeRef = useRef<HTMLInputElement>(null);
  const imgFileRef = useRef<HTMLInputElement>(null);

  const [nome, setNome] = useState(combo?.nome ?? "");
  const [precoVenda, setPrecoVenda] = useState(moneyToMask(combo?.precoVenda));
  const [imagemUrl, setImagemUrl] = useState(combo?.imagemUrl ?? "");
  const [vendeOnline, setVendeOnline] = useState(combo?.vendeOnline ?? false);
  const [pesoGramas, setPeso] = useState(combo?.pesoGramas?.toString() ?? "");
  const [descricaoOnline, setDescOnline] = useState(combo?.descricaoOnline ?? "");
  const [channels, setChannels] = useState<ChannelRow[]>(
    initChannels(combo?.salesChannels),
  );
  const setChannel = (canal: SalesChannel, patch: Partial<ChannelRow>) =>
    setChannels((prev) => prev.map((r) => (r.canal === canal ? { ...r, ...patch } : r)));

  const [items, setItems] = useState<Item[]>(combo?.components ?? []);
  const [busca, setBusca] = useState("");

  const byId = useMemo(() => {
    const m = new Map<string, ComponentCandidate>();
    for (const c of candidates) m.set(c.id, c);
    return m;
  }, [candidates]);

  const title = mode === "edit" ? "Editar combo" : "Novo kit / combo";

  // Candidatos que ainda não estão no combo, filtrados pela busca.
  const resultados = useMemo(() => {
    const term = busca.trim().toLowerCase();
    const noCombo = new Set(items.map((i) => i.componentProductId));
    return candidates
      .filter((c) => !noCombo.has(c.id))
      .filter(
        (c) =>
          !term ||
          `${c.nome} ${c.sku} ${c.marca ?? ""}`.toLowerCase().includes(term),
      )
      .slice(0, 8);
  }, [candidates, items, busca]);

  // Derivação ao vivo (custo somado, soma dos avulsos, disponibilidade).
  const derived = useMemo(() => {
    const comps: DeriveComponent[] = items.flatMap((i) => {
      const c = byId.get(i.componentProductId);
      if (!c) return [];
      return [
        {
          quantidade: i.quantidade,
          unidade: "UN" as const,
          custo: c.custo,
          precoVenda: c.precoVenda,
          conteudoPorUnidade: c.conteudoPorUnidade,
          estoqueFechado: c.estoqueFechado,
          estoqueAberto: c.estoqueAberto,
        },
      ];
    });
    return derive(comps);
  }, [items, byId]);

  const precoNum = parseMoney(precoVenda);
  const margemPct = margem(precoNum, derived.custoTotal);
  const margemPositiva = margemPct !== null && margemPct >= 0;
  const lucro =
    precoNum != null && derived.custoTotal != null ? precoNum - derived.custoTotal : null;
  // Desconto do kit frente à soma dos avulsos (referência ao operador).
  const descontoPct =
    precoNum != null && derived.somaAvulsos && derived.somaAvulsos > 0
      ? Math.round((1 - precoNum / derived.somaAvulsos) * 100)
      : null;

  function addItem(id: string) {
    setItems((prev) =>
      prev.some((i) => i.componentProductId === id)
        ? prev
        : [...prev, { componentProductId: id, quantidade: 1 }],
    );
    setBusca("");
  }
  function setQtd(id: string, q: number) {
    setItems((prev) =>
      prev.map((i) =>
        i.componentProductId === id ? { ...i, quantidade: Math.max(1, q) } : i,
      ),
    );
  }
  function removeItem(id: string) {
    setItems((prev) => prev.filter((i) => i.componentProductId !== id));
  }

  function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Arquivo inválido", "Escolha uma imagem (JPG, PNG ou WebP).");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Imagem muito grande", "Escolha uma imagem de até 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImagemUrl(String(reader.result));
    reader.onerror = () =>
      toast.error("Erro ao ler imagem", "Não foi possível abrir o arquivo.");
    reader.readAsDataURL(file);
  }

  function salvar() {
    setError(undefined);
    if (nome.trim().length < 2) {
      setError("Informe o nome do combo.");
      nomeRef.current?.focus();
      return;
    }
    if (items.length === 0) return setError("Adicione ao menos um item ao combo.");

    let salesChannels;
    try {
      salesChannels = vendeOnline ? channelsToInput(channels) : [];
    } catch (e) {
      return setError(e instanceof Error ? e.message : "Canal online sem preço.");
    }

    const input = {
      nome,
      imagemUrl: imagemUrl || undefined,
      precoVenda: precoNum,
      restricaoIdade: false,
      vendeOnline,
      pesoGramas: pesoGramas ? Number(pesoGramas) : undefined,
      descricaoOnline: descricaoOnline || undefined,
      components: items,
      salesChannels,
    };

    start(async () => {
      try {
        if (combo) await updateCombo(combo.id, input);
        else await createCombo(input);
        router.push("/produtos");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Falha ao salvar.");
      }
    });
  }

  function onKeyDownForm(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      salvar();
    }
  }

  return (
    <div className="flex flex-col gap-4" onKeyDown={onKeyDownForm}>
      <PageHeader
        backHref="/produtos"
        breadcrumbs={[{ label: "Produtos", href: "/produtos" }, { label: title }]}
        title={title}
        badge={mode === "edit" && combo?.sku ? <SkuTag sku={combo.sku} /> : undefined}
        innerClassName="max-w-none sm:px-8"
      />

      <div className="px-4 sm:px-8">
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
          {/* Coluna principal: nome + itens */}
          <div className="flex flex-col gap-4 lg:col-span-8">
            <SectionCard title="Essenciais">
              <Field label="Nome do combo" htmlFor="nome">
                <Input
                  id="nome"
                  ref={nomeRef}
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Ex.: Kit festa — 5 cervejas + energéticos"
                  className="text-[15px] font-medium"
                />
              </Field>
            </SectionCard>

            {/* Itens do combo */}
            <SectionCard
              title="Itens do combo"
              badge={
                items.length > 0 ? (
                  <Badge tone="brand">
                    {items.length} {items.length === 1 ? "item" : "itens"}
                  </Badge>
                ) : undefined
              }
            >
              {/* Busca + adicionar */}
              <div className="relative">
                <Search
                  size={15}
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint"
                />
                <Input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar produto por nome, SKU ou marca…"
                  className="pl-9"
                />
                {busca.trim() && (
                  <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-[var(--radius)] border border-line bg-surface p-1 shadow-[var(--shadow-2)]">
                    {resultados.length === 0 ? (
                      <p className="px-3 py-4 text-center text-sm text-muted">
                        Nenhum produto disponível bate com a busca.
                      </p>
                    ) : (
                      resultados.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => addItem(c.id)}
                          className="flex w-full items-center gap-3 rounded-[var(--radius-sm)] px-2.5 py-2 text-left transition-colors hover:bg-brand-soft"
                        >
                          <Thumb url={c.imagemUrl} tipo={c.tipo} size={9} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-medium text-ink">
                              {c.nome}
                            </p>
                            <div className="mt-0.5 flex items-center gap-2">
                              <SkuTag sku={c.sku} />
                              <span className="font-mono text-[11px] text-muted tnum">
                                {brl(c.precoVenda)}
                              </span>
                            </div>
                          </div>
                          <Plus size={15} className="shrink-0 text-brand-strong" />
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Lista de itens adicionados */}
              {items.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-[var(--radius)] border border-dashed border-line-strong px-6 py-10 text-center">
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-brand-soft text-brand-strong">
                    <Boxes size={20} />
                  </span>
                  <p className="text-sm text-muted">
                    Adicione o primeiro item do kit pela busca acima.
                  </p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-[var(--radius)] border border-line">
                  <table className="w-full text-left">
                    <thead className="border-b border-line bg-surface-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
                      <tr>
                        <th className="px-3 py-2.5">Produto</th>
                        <th className="px-3 py-2.5 text-center">Qtd.</th>
                        <th className="hidden px-3 py-2.5 text-right sm:table-cell">
                          Subtotal
                        </th>
                        <th className="w-10 px-3 py-2.5" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {items.map((i) => {
                        const c = byId.get(i.componentProductId);
                        if (!c) return null;
                        const subtotal =
                          c.custo != null ? c.custo * i.quantidade : null;
                        const semEstoque = c.estoqueFechado < i.quantidade;
                        return (
                          <tr key={i.componentProductId} className="bg-surface">
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-2.5">
                                <Thumb url={c.imagemUrl} tipo={c.tipo} size={9} />
                                <div className="min-w-0">
                                  <p className="truncate text-[13px] font-medium text-ink">
                                    {c.nome}
                                  </p>
                                  <div className="mt-0.5 flex items-center gap-2">
                                    <SkuTag sku={c.sku} />
                                    {c.custo == null && (
                                      <Badge tone="warn">
                                        <AlertCircle size={10} /> sem custo
                                      </Badge>
                                    )}
                                    {semEstoque && (
                                      <Badge tone="danger">sem estoque</Badge>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="mx-auto flex w-fit items-center gap-1 rounded-full border border-line bg-surface-2 p-0.5">
                                <button
                                  type="button"
                                  aria-label="Diminuir"
                                  onClick={() =>
                                    setQtd(i.componentProductId, i.quantidade - 1)
                                  }
                                  className="grid h-6 w-6 place-items-center rounded-full text-muted transition-colors hover:bg-surface hover:text-ink"
                                >
                                  <Minus size={13} />
                                </button>
                                <input
                                  value={i.quantidade}
                                  onChange={(e) => {
                                    const v = Number(e.target.value.replace(/\D/g, ""));
                                    setQtd(i.componentProductId, v || 1);
                                  }}
                                  inputMode="numeric"
                                  className="w-9 bg-transparent text-center font-mono text-[13px] font-medium text-ink outline-none tnum"
                                />
                                <button
                                  type="button"
                                  aria-label="Aumentar"
                                  onClick={() =>
                                    setQtd(i.componentProductId, i.quantidade + 1)
                                  }
                                  className="grid h-6 w-6 place-items-center rounded-full text-muted transition-colors hover:bg-surface hover:text-ink"
                                >
                                  <Plus size={13} />
                                </button>
                              </div>
                            </td>
                            <td className="hidden px-3 py-2.5 text-right font-mono text-[13px] text-ink-2 tnum sm:table-cell">
                              {subtotal != null ? brl(subtotal) : "—"}
                            </td>
                            <td className="px-3 py-2.5">
                              <button
                                type="button"
                                aria-label="Remover item"
                                onClick={() => removeItem(i.componentProductId)}
                                className="grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] text-faint transition-colors hover:bg-danger-soft hover:text-danger"
                              >
                                <Trash2 size={15} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>

            {/* Venda online */}
            <SectionCard title="Venda online">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-2">
                <input
                  type="checkbox"
                  checked={vendeOnline}
                  onChange={(e) => setVendeOnline(e.target.checked)}
                  className="cursor-pointer accent-[var(--brand)]"
                />
                Vende em canais online (iFood, Mercado Livre…)
              </label>
              {vendeOnline && (
                <>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Peso (g)" htmlFor="peso">
                      <Input
                        id="peso"
                        value={pesoGramas}
                        onChange={(e) => setPeso(e.target.value.replace(/\D/g, ""))}
                        placeholder="0"
                        inputMode="numeric"
                        className="font-mono"
                      />
                    </Field>
                    <Field label="Descrição para o anúncio" htmlFor="desc">
                      <Textarea
                        id="desc"
                        value={descricaoOnline}
                        onChange={(e) => setDescOnline(e.target.value)}
                        placeholder="Texto que aparece no canal de venda"
                        className="min-h-[80px]"
                      />
                    </Field>
                  </div>
                  <div className="flex flex-col gap-2 border-t border-line pt-3">
                    <Eyebrow>Canais de venda</Eyebrow>
                    <OnlineChannels
                      rows={channels}
                      onChange={setChannel}
                      descricaoPadrao={descricaoOnline}
                    />
                  </div>
                </>
              )}
            </SectionCard>
          </div>

          {/* Coluna lateral: resumo + imagem (sticky) */}
          <div className="flex flex-col gap-4 lg:sticky lg:top-3 lg:col-span-4">
            {/* Painel resumo — elemento-assinatura do combo */}
            <div className="flex flex-col gap-4 rounded-[var(--radius)] border border-accent/30 bg-accent-soft p-4">
              <div className="flex items-center justify-between">
                <Eyebrow className="text-accent">Preço e margem do kit</Eyebrow>
                {margemPct !== null && (
                  <span
                    className={cn(
                      "flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-xs font-bold",
                      margemPositiva ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger",
                    )}
                  >
                    {margemPositiva ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                    {margemPct}%
                  </span>
                )}
              </div>

              <Field label="Preço do kit" htmlFor="preco">
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex select-none items-center text-sm text-muted">
                    R$
                  </span>
                  <Input
                    id="preco"
                    value={precoVenda}
                    onChange={(e) => setPrecoVenda(maskMoney(e.target.value))}
                    placeholder="0,00"
                    inputMode="numeric"
                    className="bg-surface pl-9 font-mono text-base font-semibold"
                  />
                </div>
              </Field>

              <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] bg-surface/60 px-3 py-3 text-[13px]">
                <Linha
                  label="Soma dos avulsos"
                  value={derived.somaAvulsos != null ? brl(derived.somaAvulsos) : "—"}
                />
                {descontoPct != null && descontoPct > 0 && (
                  <Linha
                    label="Desconto do kit"
                    value={`${descontoPct}%`}
                    tone="ok"
                  />
                )}
                <Linha
                  label="Custo somado"
                  value={derived.custoTotal != null ? brl(derived.custoTotal) : "—"}
                />
                <div className="my-0.5 h-px bg-line" />
                <Linha
                  label="Margem bruta"
                  value={lucro != null ? brl(lucro) : "—"}
                  tone={lucro != null ? (margemPositiva ? "ok" : "danger") : undefined}
                  strong
                />
              </div>

              {derived.custoIncompleto && items.length > 0 && (
                <p className="flex items-start gap-1.5 text-xs text-warn">
                  <AlertCircle size={13} className="mt-0.5 shrink-0" />
                  Algum item não tem custo cadastrado — a margem fica incompleta.
                </p>
              )}

              {/* Disponibilidade derivada */}
              <div className="flex items-center justify-between rounded-[var(--radius-sm)] border border-line bg-surface px-3 py-2.5">
                <span className="text-xs text-muted">Kits montáveis com o estoque</span>
                <span
                  className={cn(
                    "flex items-center gap-1.5 font-mono text-sm font-bold tnum",
                    derived.disponibilidade > 0 ? "text-ink" : "text-danger",
                  )}
                >
                  {derived.disponibilidade > 0 ? (
                    <CheckCircle2 size={14} className="text-ok" />
                  ) : (
                    <AlertCircle size={14} className="text-danger" />
                  )}
                  {derived.disponibilidade}
                </span>
              </div>
            </div>

            {/* Imagem */}
            <SectionCard title="Imagem">
              <input
                ref={imgFileRef}
                type="file"
                accept="image/*"
                onChange={onPickImage}
                className="hidden"
              />
              <div className="flex items-start gap-4">
                <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-[var(--radius)] border border-line bg-surface-2">
                  {imagemUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={imagemUrl} alt="" className="h-full w-full object-contain" />
                  ) : (
                    <span className="grid h-full w-full place-items-center text-faint">
                      <ImageOff size={20} />
                    </span>
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => imgFileRef.current?.click()}
                    >
                      <ImagePlus size={15} />
                      {imagemUrl ? "Trocar" : "Enviar"}
                    </Button>
                    {imagemUrl && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setImagemUrl("")}
                        className="text-danger hover:text-danger"
                      >
                        <Trash2 size={15} /> Remover
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted">JPG, PNG ou WebP, até 2 MB.</p>
                </div>
              </div>
            </SectionCard>
          </div>
        </div>

        {error && (
          <p className="mt-4 flex items-center gap-2 rounded-[var(--radius-sm)] bg-danger-soft px-3 py-2.5 text-sm text-danger">
            <AlertCircle size={15} className="shrink-0" />
            {error}
          </p>
        )}
      </div>

      {/* Footer de ações */}
      <div className="sticky bottom-4 z-10 mx-4 mb-4 flex items-center justify-end gap-3 rounded-[var(--radius-lg)] border border-line bg-surface/90 px-4 py-3 shadow-[var(--shadow-2)] backdrop-blur sm:mx-8 sm:px-6">
        <span className="mr-auto hidden items-center gap-1.5 text-xs text-faint sm:flex">
          <kbd className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px]">
            Ctrl
          </kbd>
          +
          <kbd className="rounded border border-line bg-surface-2 px-1 py-0.5 font-mono text-[10px]">
            <CornerDownLeft size={11} />
          </kbd>
          para salvar
        </span>
        <Button variant="ghost" onClick={() => router.push("/produtos")} disabled={pending}>
          Cancelar
        </Button>
        <Button onClick={salvar} disabled={pending}>
          {pending ? "Salvando…" : "Salvar combo"}
        </Button>
      </div>
    </div>
  );
}
