"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Boxes,
  CheckCircle2,
  CornerDownLeft,
  ImageOff,
  ImagePlus,
  Layers,
  ListPlus,
  Minus,
  Plus,
  Ruler,
  Search,
  Trash2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { cn, brl, margem, maskMoney, moneyToMask, parseMoney } from "@/lib/utils";
import { arquivoParaThumb } from "@/lib/imagem";
import { derive, type DeriveComponent } from "@/lib/derive";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field, Badge, Eyebrow } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { PageHeader } from "@/components/app/page-header";
import { SkuTag } from "@/components/sku-tag";
import { SectionCard, Linha, Thumb } from "./parts";
import { TipoIcone } from "@/components/app/produto-tipo";
import {
  OnlineChannels,
  initChannels,
  channelsToInput,
  type ChannelRow,
} from "./online-channels";
import { useVoltaProdutos } from "./_volta";
import { createCombo, updateCombo } from "../actions";
import type { SalesChannel } from "@/generated/prisma";
import type {
  ComponentCandidate,
  ComboData,
} from "../_types";

type Item = { componentProductId: string; quantidade: number };

/** Item de grupo em edição — acréscimo é texto mascarado ("" = sem acréscimo). */
type GroupItem = {
  componentProductId: string;
  quantidade: number;
  isDefault: boolean;
  acrescimoPreco: string;
};

type Group = {
  key: string;
  nome: string;
  obrigatoria: boolean;
  tipoSelecao: "UNICA" | "MULTIPLA";
  /** Texto: "" = sem limite. */
  maxSelecoes: string;
  items: GroupItem[];
};

/** Tamanho do kit em edição — fator e preço como texto. */
type Variant = {
  key: string;
  nome: string;
  fatorEscala: string;
  precoVenda: string;
  isDefault: boolean;
};

let seq = 0;
const novaKey = () => `g${++seq}`;

function initGroups(combo?: ComboData | null): Group[] {
  if (!combo?.groups?.length) return [];
  return combo.groups.map((g) => ({
    key: novaKey(),
    nome: g.nome,
    obrigatoria: g.obrigatoria,
    tipoSelecao: g.tipoSelecao,
    maxSelecoes: g.maxSelecoes?.toString() ?? "",
    items: g.items.map((i) => ({
      componentProductId: i.componentProductId,
      quantidade: i.quantidade,
      isDefault: i.isDefault,
      acrescimoPreco: moneyToMask(i.acrescimoPreco) ?? "",
    })),
  }));
}

function initVariants(combo?: ComboData | null): Variant[] {
  if (!combo?.variants?.length) return [];
  return combo.variants.map((v) => ({
    key: novaKey(),
    nome: v.nome,
    fatorEscala: String(v.fatorEscala),
    precoVenda: moneyToMask(v.precoVenda) ?? "",
    isDefault: v.isDefault,
  }));
}

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
  const volta = useVoltaProdutos();
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
  const [groups, setGroups] = useState<Group[]>(() => initGroups(combo));
  const [variants, setVariants] = useState<Variant[]>(() => initVariants(combo));
  const [busca, setBusca] = useState("");
  /** Busca por grupo (cada grupo tem sua caixa de "adicionar opção"). */
  const [buscaGrupo, setBuscaGrupo] = useState<Record<string, string>>({});

  const byId = useMemo(() => {
    const m = new Map<string, ComponentCandidate>();
    for (const c of candidates) m.set(c.id, c);
    return m;
  }, [candidates]);

  const title = mode === "edit" ? "Editar combo" : "Novo kit / combo";

  // Candidatos que ainda não estão nos itens fixos, filtrados pela busca.
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

  function resultadosGrupo(g: Group): ComponentCandidate[] {
    const term = (buscaGrupo[g.key] ?? "").trim().toLowerCase();
    if (!term) return [];
    const noGrupo = new Set(g.items.map((i) => i.componentProductId));
    return candidates
      .filter((c) => !noGrupo.has(c.id))
      .filter((c) => `${c.nome} ${c.sku} ${c.marca ?? ""}`.toLowerCase().includes(term))
      .slice(0, 8);
  }

  /** Itens que o kit entrega na configuração padrão: fixos + opção padrão de
   *  cada grupo obrigatório. É o que o painel de custo/margem mede. */
  const itensPadrao = useMemo(() => {
    const base: Item[] = items.map((i) => ({ ...i }));
    for (const g of groups) {
      if (!g.obrigatoria || g.items.length === 0) continue;
      const padrao = g.items.find((i) => i.isDefault) ?? g.items[0];
      base.push({
        componentProductId: padrao.componentProductId,
        quantidade: padrao.quantidade,
      });
    }
    return base;
  }, [items, groups]);

  // Derivação ao vivo (custo somado, soma dos avulsos, disponibilidade).
  const derived = useMemo(() => {
    const comps: DeriveComponent[] = itensPadrao.flatMap((i) => {
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
  }, [itensPadrao, byId]);

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

  const totalOpcoes = groups.reduce((s, g) => s + g.items.length, 0);

  // ── Itens fixos ────────────────────────────────────────────
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

  // ── Grupos de escolha ──────────────────────────────────────
  function addGroup() {
    setGroups((prev) => [
      ...prev,
      {
        key: novaKey(),
        nome: "",
        obrigatoria: true,
        tipoSelecao: "UNICA",
        maxSelecoes: "",
        items: [],
      },
    ]);
  }
  function removeGroup(key: string) {
    setGroups((prev) => prev.filter((g) => g.key !== key));
  }
  function moveGroup(key: string, dir: -1 | 1) {
    setGroups((prev) => {
      const idx = prev.findIndex((g) => g.key === key);
      const alvo = idx + dir;
      if (idx < 0 || alvo < 0 || alvo >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[alvo]] = [next[alvo], next[idx]];
      return next;
    });
  }
  function updateGroup(key: string, patch: Partial<Omit<Group, "key" | "items">>) {
    setGroups((prev) =>
      prev.map((g) => {
        if (g.key !== key) return g;
        const next = { ...g, ...patch };
        // Virou escolha única: só uma opção pode ficar como padrão.
        if (patch.tipoSelecao === "UNICA") {
          const primeiro = next.items.findIndex((i) => i.isDefault);
          next.items = next.items.map((i, idx) => ({
            ...i,
            isDefault: idx === (primeiro >= 0 ? primeiro : 0),
          }));
        }
        return next;
      }),
    );
  }
  function addItemToGroup(key: string, c: ComponentCandidate) {
    setGroups((prev) =>
      prev.map((g) => {
        if (g.key !== key) return g;
        if (g.items.some((i) => i.componentProductId === c.id)) return g;
        const primeiro = g.items.length === 0;
        return {
          ...g,
          items: [
            ...g.items,
            {
              componentProductId: c.id,
              quantidade: 1,
              isDefault: primeiro,
              acrescimoPreco: "",
            },
          ],
        };
      }),
    );
    setBuscaGrupo((prev) => ({ ...prev, [key]: "" }));
  }
  function removeItemFromGroup(key: string, componentProductId: string) {
    setGroups((prev) =>
      prev.map((g) => {
        if (g.key !== key) return g;
        const next = g.items.filter((i) => i.componentProductId !== componentProductId);
        // Tirou a opção padrão: a primeira que sobrou assume.
        if (next.length > 0 && !next.some((i) => i.isDefault)) {
          next[0] = { ...next[0], isDefault: true };
        }
        return { ...g, items: next };
      }),
    );
  }
  function updateGroupItem(
    key: string,
    componentProductId: string,
    patch: Partial<Omit<GroupItem, "componentProductId">>,
  ) {
    setGroups((prev) =>
      prev.map((g) =>
        g.key === key
          ? {
              ...g,
              items: g.items.map((i) =>
                i.componentProductId === componentProductId ? { ...i, ...patch } : i,
              ),
            }
          : g,
      ),
    );
  }
  function setGroupItemDefault(key: string, componentProductId: string) {
    setGroups((prev) =>
      prev.map((g) => {
        if (g.key !== key) return g;
        return {
          ...g,
          items: g.items.map((i) => {
            if (g.tipoSelecao === "UNICA") {
              return { ...i, isDefault: i.componentProductId === componentProductId };
            }
            return i.componentProductId === componentProductId
              ? { ...i, isDefault: !i.isDefault }
              : i;
          }),
        };
      }),
    );
  }

  // ── Tamanhos do kit ────────────────────────────────────────
  function addVariant() {
    setVariants((prev) => [
      ...prev,
      {
        key: novaKey(),
        nome: "",
        fatorEscala: "1",
        precoVenda: "",
        isDefault: prev.length === 0,
      },
    ]);
  }
  function updateVariant(key: string, patch: Partial<Omit<Variant, "key" | "isDefault">>) {
    setVariants((prev) => prev.map((v) => (v.key === key ? { ...v, ...patch } : v)));
  }
  function removeVariant(key: string) {
    setVariants((prev) => {
      const next = prev.filter((v) => v.key !== key);
      if (next.length > 0 && !next.some((v) => v.isDefault)) {
        next[0] = { ...next[0], isDefault: true };
      }
      return next;
    });
  }

  async function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
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
    try {
      setImagemUrl(await arquivoParaThumb(file));
    } catch (err) {
      toast.error("Erro ao ler imagem", err instanceof Error ? err.message : "Tente outro arquivo.");
    }
  }

  function salvar() {
    setError(undefined);
    if (nome.trim().length < 2) {
      setError("Informe o nome do combo.");
      nomeRef.current?.focus();
      return;
    }
    if (items.length === 0 && groups.length === 0) {
      return setError("Adicione um item fixo ou um grupo de escolha ao kit.");
    }
    for (const g of groups) {
      if (g.nome.trim().length === 0) {
        return setError("Todo grupo de escolha precisa de nome (ex.: Vodka).");
      }
      if (g.items.length === 0) {
        return setError(`O grupo «${g.nome.trim()}» está sem opções.`);
      }
    }
    for (const v of variants) {
      if (v.nome.trim().length === 0) {
        return setError("Todo tamanho do kit precisa de nome (ex.: Kit 6).");
      }
      if (!(Number(v.fatorEscala) > 0)) {
        return setError(`O tamanho «${v.nome.trim()}» precisa de fator maior que zero.`);
      }
    }

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
      groups: groups.map((g, ordem) => ({
        nome: g.nome,
        obrigatoria: g.obrigatoria,
        tipoSelecao: g.tipoSelecao,
        maxSelecoes:
          g.tipoSelecao === "MULTIPLA" && g.maxSelecoes ? Number(g.maxSelecoes) : null,
        ordem,
        items: g.items.map((i) => ({
          componentProductId: i.componentProductId,
          quantidade: i.quantidade,
          isDefault: i.isDefault,
          acrescimoPreco: parseMoney(i.acrescimoPreco) ?? null,
        })),
      })),
      variants: variants.map((v) => ({
        nome: v.nome,
        fatorEscala: Number(v.fatorEscala),
        precoVenda: parseMoney(v.precoVenda) ?? null,
        isDefault: v.isDefault,
      })),
      salesChannels,
    };

    start(async () => {
      try {
        if (combo) await updateCombo(combo.id, input);
        else await createCombo(input);
        router.push(volta);
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
        backHref={volta}
        breadcrumbs={[{ label: "Produtos", href: volta }, { label: title }]}
        title={title}
        badge={mode === "edit" && combo?.sku ? <SkuTag sku={combo.sku} /> : undefined}
        innerClassName="max-w-none sm:px-8"
      />

      <div className="px-4 sm:px-8">
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
          {/* Coluna principal */}
          <div className="flex flex-col gap-4 lg:col-span-8">
            <SectionCard title="Essenciais">
              <Field label="Nome do combo" htmlFor="nome">
                <Input
                  id="nome"
                  ref={nomeRef}
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Ex.: Kit festa — vodka + energético"
                  className="text-[15px] font-medium"
                />
              </Field>
            </SectionCard>

            {/* Tamanho do kit — vem antes das escolhas porque escala as
                quantidades da ficha inteira. */}
            <SectionCard
              title="Tamanho do kit"
              badge={
                variants.length > 0 ? (
                  <Badge tone="brand">
                    {variants.length} {variants.length === 1 ? "tamanho" : "tamanhos"}
                  </Badge>
                ) : undefined
              }
            >
              <p className="text-xs text-muted">
                Opcional. O fator multiplica as quantidades do kit — Kit 8 com fator 2
                entrega o dobro de cada item do Kit 4. Preço vazio = preço base × fator.
              </p>

              {variants.length === 0 ? (
                <button
                  type="button"
                  onClick={addVariant}
                  className="flex cursor-pointer items-center justify-center gap-2 rounded-[var(--radius)] border border-dashed border-line-strong px-4 py-6 text-sm text-muted transition-colors hover:border-brand/40 hover:bg-brand-soft hover:text-brand-strong"
                >
                  <Ruler size={15} />
                  Kit de tamanho único — criar tamanhos
                </button>
              ) : (
                <>
                  <div className="overflow-hidden rounded-[var(--radius)] border border-line">
                    <table className="w-full text-left">
                      <thead className="border-b border-line bg-surface-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
                        <tr>
                          <th className="px-3 py-2.5">Nome</th>
                          <th className="w-24 px-3 py-2.5 text-center">Fator</th>
                          <th className="w-32 px-3 py-2.5 text-right">Preço</th>
                          <th className="w-16 px-3 py-2.5 text-center">Padrão</th>
                          <th className="w-10 px-3 py-2.5" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {variants.map((v) => (
                          <tr key={v.key} className="bg-surface">
                            <td className="px-3 py-2">
                              <Input
                                value={v.nome}
                                onChange={(e) => updateVariant(v.key, { nome: e.target.value })}
                                placeholder="Ex.: Kit 6"
                                className="h-8 text-[13px]"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                value={v.fatorEscala}
                                onChange={(e) =>
                                  updateVariant(v.key, {
                                    fatorEscala: e.target.value.replace(/[^\d.,]/g, "").replace(",", "."),
                                  })
                                }
                                inputMode="decimal"
                                className="h-8 text-center font-mono text-[13px]"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                value={v.precoVenda}
                                onChange={(e) =>
                                  updateVariant(v.key, { precoVenda: maskMoney(e.target.value) })
                                }
                                inputMode="numeric"
                                placeholder="derivado"
                                className="h-8 text-right font-mono text-[13px]"
                              />
                            </td>
                            <td className="px-3 py-2 text-center">
                              <input
                                type="radio"
                                name="variant-default"
                                aria-label={`Tamanho padrão: ${v.nome || "sem nome"}`}
                                checked={v.isDefault}
                                onChange={() =>
                                  setVariants((prev) =>
                                    prev.map((x) => ({ ...x, isDefault: x.key === v.key })),
                                  )
                                }
                                className="cursor-pointer accent-brand"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                aria-label="Remover tamanho"
                                onClick={() => removeVariant(v.key)}
                                className="grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] text-faint transition-colors hover:bg-danger-soft hover:text-danger"
                              >
                                <Trash2 size={15} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Button type="button" variant="secondary" size="sm" onClick={addVariant}>
                    <Plus size={15} /> Adicionar tamanho
                  </Button>
                </>
              )}
            </SectionCard>

            {/* Grupos de escolha */}
            <SectionCard
              title="Grupos de escolha"
              badge={
                groups.length > 0 ? (
                  <Badge tone="brand">
                    {groups.length} {groups.length === 1 ? "grupo" : "grupos"} · {totalOpcoes}{" "}
                    {totalOpcoes === 1 ? "opção" : "opções"}
                  </Badge>
                ) : undefined
              }
            >
              <p className="text-xs text-muted">
                O que o cliente escolhe na hora da venda. Um grupo é uma pergunta
                («Vodka»), as opções são as respostas possíveis. Grupo opcional com
                acréscimo = sugestão de adicional.
              </p>

              {groups.length === 0 ? (
                <button
                  type="button"
                  onClick={addGroup}
                  className="flex cursor-pointer flex-col items-center gap-2 rounded-[var(--radius)] border border-dashed border-line-strong px-6 py-10 text-center transition-colors hover:border-brand/40 hover:bg-brand-soft"
                >
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-brand-soft text-brand-strong">
                    <Layers size={20} />
                  </span>
                  <span className="text-sm text-muted">
                    Criar o primeiro grupo — ex.: «Vodka», com as vodkas que podem entrar
                  </span>
                </button>
              ) : (
                <div className="flex flex-col gap-3">
                  {groups.map((g, gi) => (
                    <div
                      key={g.key}
                      className="overflow-visible rounded-[var(--radius)] border border-line bg-surface-2"
                    >
                      {/* Cabeçalho do grupo */}
                      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
                        <Input
                          value={g.nome}
                          onChange={(e) => updateGroup(g.key, { nome: e.target.value })}
                          placeholder="Nome do grupo (ex.: Vodka)"
                          className="h-8 min-w-0 flex-1 text-[13px] font-semibold"
                        />
                        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-ink-2">
                          <input
                            type="checkbox"
                            checked={g.obrigatoria}
                            onChange={(e) =>
                              updateGroup(g.key, { obrigatoria: e.target.checked })
                            }
                            className="cursor-pointer accent-brand"
                          />
                          Obrigatória
                        </label>
                        <Select
                          value={g.tipoSelecao}
                          onChange={(e) =>
                            updateGroup(g.key, {
                              tipoSelecao: e.target.value as "UNICA" | "MULTIPLA",
                            })
                          }
                          containerClassName="w-auto shrink-0"
                          className="h-8 text-[12px]"
                          aria-label="Quantas opções o cliente escolhe"
                        >
                          <option value="UNICA">Escolhe 1</option>
                          <option value="MULTIPLA">Escolhe várias</option>
                        </Select>
                        {g.tipoSelecao === "MULTIPLA" && (
                          <div className="flex shrink-0 items-center gap-1">
                            <span className="text-xs text-muted">Máx</span>
                            <Input
                              value={g.maxSelecoes}
                              onChange={(e) =>
                                updateGroup(g.key, {
                                  maxSelecoes: e.target.value.replace(/\D/g, ""),
                                })
                              }
                              inputMode="numeric"
                              placeholder="—"
                              aria-label="Máximo de opções"
                              className="h-8 w-12 text-center font-mono text-[12px]"
                            />
                          </div>
                        )}
                        <div className="flex shrink-0 items-center">
                          <button
                            type="button"
                            aria-label="Mover grupo para cima"
                            onClick={() => moveGroup(g.key, -1)}
                            disabled={gi === 0}
                            className="grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] text-faint transition-colors hover:bg-surface hover:text-ink-2 disabled:opacity-30"
                          >
                            <ArrowUp size={14} />
                          </button>
                          <button
                            type="button"
                            aria-label="Mover grupo para baixo"
                            onClick={() => moveGroup(g.key, 1)}
                            disabled={gi === groups.length - 1}
                            className="grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] text-faint transition-colors hover:bg-surface hover:text-ink-2 disabled:opacity-30"
                          >
                            <ArrowDown size={14} />
                          </button>
                          <button
                            type="button"
                            aria-label="Remover grupo"
                            onClick={() => removeGroup(g.key)}
                            className="grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] text-faint transition-colors hover:bg-danger-soft hover:text-danger"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      {/* Busca de opções do grupo */}
                      <div className="relative px-3 pt-3">
                        <Search
                          size={14}
                          className="pointer-events-none absolute left-6 top-1/2 -translate-y-1/2 text-faint"
                        />
                        <Input
                          value={buscaGrupo[g.key] ?? ""}
                          onChange={(e) =>
                            setBuscaGrupo((prev) => ({ ...prev, [g.key]: e.target.value }))
                          }
                          placeholder="Buscar produto para virar opção deste grupo…"
                          className="h-8 pl-8 text-[13px]"
                        />
                        {(buscaGrupo[g.key] ?? "").trim() && (
                          <div className="absolute left-3 right-3 z-20 mt-1 max-h-64 overflow-y-auto rounded-[var(--radius)] border border-line bg-surface p-1 shadow-[var(--shadow-2)]">
                            {resultadosGrupo(g).length === 0 ? (
                              <p className="px-3 py-3 text-center text-sm text-muted">
                                Nenhum produto disponível bate com a busca.
                              </p>
                            ) : (
                              resultadosGrupo(g).map((c) => (
                                <button
                                  key={c.id}
                                  type="button"
                                  onClick={() => addItemToGroup(g.key, c)}
                                  className="flex w-full cursor-pointer items-center gap-3 rounded-[var(--radius-sm)] px-2.5 py-2 text-left transition-colors hover:bg-brand-soft"
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

                      {/* Opções do grupo */}
                      {g.items.length === 0 ? (
                        <p className="px-3 py-4 text-center text-xs text-muted">
                          Sem opções ainda — busque acima as vodkas (ou o que for) que podem
                          entrar.
                        </p>
                      ) : (
                        <div className="p-3">
                          <div className="overflow-hidden rounded-[var(--radius-sm)] border border-line bg-surface">
                            <table className="w-full text-left">
                              <thead className="border-b border-line bg-surface-2 text-[10.5px] font-semibold uppercase tracking-wider text-faint">
                                <tr>
                                  <th className="px-2.5 py-2">Opção</th>
                                  <th className="w-20 px-2 py-2 text-center">Qtd.</th>
                                  <th className="w-16 px-2 py-2 text-center">Padrão</th>
                                  <th
                                    className="w-28 px-2 py-2 text-right"
                                    title="Valor somado ao preço quando o cliente escolhe esta opção"
                                  >
                                    Acréscimo
                                  </th>
                                  <th className="w-9 px-2 py-2" />
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-line">
                                {g.items.map((item) => {
                                  const c = byId.get(item.componentProductId);
                                  if (!c) return null;
                                  const semEstoque = c.estoqueFechado < item.quantidade;
                                  return (
                                    <tr key={item.componentProductId}>
                                      <td className="px-2.5 py-2">
                                        <div className="flex items-center gap-2.5">
                                          <Thumb url={c.imagemUrl} tipo={c.tipo} size={9} />
                                          <div className="min-w-0">
                                            <p className="truncate text-[13px] font-medium text-ink">
                                              {c.nome}
                                            </p>
                                            <div className="mt-0.5 flex flex-wrap items-center gap-2">
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
                                      <td className="px-2 py-2">
                                        <Input
                                          value={String(item.quantidade)}
                                          onChange={(e) => {
                                            const v = Number(e.target.value.replace(/\D/g, ""));
                                            updateGroupItem(g.key, item.componentProductId, {
                                              quantidade: Math.max(1, v || 1),
                                            });
                                          }}
                                          inputMode="numeric"
                                          aria-label={`Quantidade de ${c.nome}`}
                                          className="h-8 text-center font-mono text-[13px]"
                                        />
                                      </td>
                                      <td className="px-2 py-2 text-center">
                                        <input
                                          type={g.tipoSelecao === "UNICA" ? "radio" : "checkbox"}
                                          name={`default-${g.key}`}
                                          aria-label={`Opção padrão: ${c.nome}`}
                                          checked={item.isDefault}
                                          onChange={() =>
                                            setGroupItemDefault(g.key, item.componentProductId)
                                          }
                                          className="cursor-pointer accent-brand"
                                        />
                                      </td>
                                      <td className="px-2 py-2">
                                        <Input
                                          value={item.acrescimoPreco}
                                          onChange={(e) =>
                                            updateGroupItem(g.key, item.componentProductId, {
                                              acrescimoPreco: maskMoney(e.target.value),
                                            })
                                          }
                                          inputMode="numeric"
                                          placeholder="0,00"
                                          aria-label={`Acréscimo de ${c.nome}`}
                                          className="h-8 text-right font-mono text-[13px]"
                                        />
                                      </td>
                                      <td className="px-2 py-2">
                                        <button
                                          type="button"
                                          aria-label="Remover opção"
                                          onClick={() =>
                                            removeItemFromGroup(g.key, item.componentProductId)
                                          }
                                          className="grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] text-faint transition-colors hover:bg-danger-soft hover:text-danger"
                                        >
                                          <Trash2 size={14} />
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}

                  <Button type="button" variant="secondary" size="sm" onClick={addGroup}>
                    <ListPlus size={15} /> Adicionar grupo
                  </Button>
                </div>
              )}
            </SectionCard>

            {/* Itens fixos */}
            <SectionCard
              title="Itens fixos do kit"
              badge={
                items.length > 0 ? (
                  <Badge tone="brand">
                    {items.length} {items.length === 1 ? "item" : "itens"}
                  </Badge>
                ) : undefined
              }
            >
              <p className="text-xs text-muted">
                O que vai no kit sem o cliente escolher — gelo, copos, o refrigerante da casa.
              </p>

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
                          className="flex w-full cursor-pointer items-center gap-3 rounded-[var(--radius-sm)] px-2.5 py-2 text-left transition-colors hover:bg-brand-soft"
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
                <div className="flex flex-col items-center gap-2 rounded-[var(--radius)] border border-dashed border-line-strong px-6 py-8 text-center">
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-brand-soft text-brand-strong">
                    <TipoIcone tipo="COMBO" size={20} />
                  </span>
                  <p className="text-sm text-muted">
                    Nenhum item fixo — tudo no kit é escolha do cliente.
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
                                  aria-label={`Quantidade de ${c.nome}`}
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

              {groups.length > 0 && (
                <p className="flex items-start gap-1.5 text-xs text-muted">
                  <Boxes size={13} className="mt-0.5 shrink-0" />
                  Medido na configuração padrão (itens fixos + opção padrão de cada grupo
                  obrigatório). Acréscimo de opção entra em cima deste preço na venda.
                </p>
              )}

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

              {derived.custoIncompleto && itensPadrao.length > 0 && (
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
        <Button variant="ghost" onClick={() => router.push(volta)} disabled={pending}>
          Cancelar
        </Button>
        <Button onClick={salvar} disabled={pending}>
          {pending ? "Salvando…" : "Salvar combo"}
        </Button>
      </div>
    </div>
  );
}
