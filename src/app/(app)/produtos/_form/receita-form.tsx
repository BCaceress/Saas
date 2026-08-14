"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Boxes,
  Check,
  Coins,
  Copy,
  CornerDownLeft,
  CookingPot,
  Eye,
  GlassWater,
  ImageOff,
  ImagePlus,
  LayoutList,
  Martini,
  Minus,
  Plus,
  Search,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Trash2,
  Utensils,
  Wand2,
  X,
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
import { SectionCard, Thumb } from "./parts";
import {
  OnlineChannels,
  initChannels,
  channelsToInput,
  type ChannelRow,
} from "./online-channels";
import { createReceita, updateReceita } from "../actions";
import type { SalesChannel } from "@/generated/prisma";
import type {
  SubcategoryOpt,
  ComponentCandidate,
  ReceitaData,
  RecipeType,
} from "../_types";

type Unidade = "UN" | "ML" | "G";

type GroupItem = {
  componentProductId: string;
  quantidade: string;
  unidade: Unidade;
  isDefault: boolean;
  acrescimoPreco: string; // masked money, "" = sem acréscimo
};

type Group = {
  key: string;
  nome: string;
  obrigatoria: boolean;
  tipoSelecao: "UNICA" | "MULTIPLA";
  maxSelecoes: string;
  busca: string;
  items: GroupItem[];
};

const parseNum = (s: string) => {
  const x = Number(String(s).replace(",", "."));
  return Number.isFinite(x) && x > 0 ? x : 0;
};

const parseQtd = parseNum;

let _keyCounter = 0;
const newKey = () => `g${++_keyCounter}`;

const TIPOS: { value: RecipeType; label: string; icon: React.ReactNode }[] = [
  { value: "DRINK", label: "Drink", icon: <Martini size={15} /> },
  { value: "PRATO", label: "Prato", icon: <Utensils size={15} /> },
  { value: "OUTRO", label: "Outro", icon: <CookingPot size={15} /> },
];

const COPY: Record<
  RecipeType,
  {
    novo: string;
    ficha: string;
    fichaVazia: string;
    buscaPlaceholder: string;
    disponivel: string;
    preparoLabel: string;
    preparoPlaceholder: string;
  }
> = {
  DRINK: {
    novo: "Novo drink",
    ficha: "Ficha técnica",
    fichaVazia: "Organize os componentes em grupos. Cada grupo pode ter uma ou mais opções.",
    buscaPlaceholder: "Buscar bebida ou insumo…",
    disponivel: "doses montáveis",
    preparoLabel: "Montagem",
    preparoPlaceholder:
      "Colocar 4 cubos de gelo\nAdicionar 20ml de vodka\nCompletar com 200ml de energético",
  },
  PRATO: {
    novo: "Novo prato",
    ficha: "Ficha técnica",
    fichaVazia: "Organize os ingredientes em grupos.",
    buscaPlaceholder: "Buscar ingrediente ou insumo…",
    disponivel: "porções",
    preparoLabel: "Modo de preparo",
    preparoPlaceholder: "Descreva o passo a passo da receita.",
  },
  OUTRO: {
    novo: "Nova receita",
    ficha: "Ficha técnica",
    fichaVazia: "Organize os componentes em grupos.",
    buscaPlaceholder: "Buscar produto ou insumo…",
    disponivel: "preparáveis",
    preparoLabel: "Modo de preparo",
    preparoPlaceholder: "Instruções de preparo, se houver.",
  },
};

function initGroups(receita?: ReceitaData | null): Group[] {
  if (receita?.groups?.length) {
    return receita.groups.map((g) => ({
      key: newKey(),
      nome: g.nome,
      obrigatoria: g.obrigatoria,
      tipoSelecao: g.tipoSelecao,
      maxSelecoes: g.maxSelecoes?.toString() ?? "",
      busca: "",
      items: g.items.map((i) => ({
        componentProductId: i.componentProductId,
        quantidade: String(i.quantidade),
        unidade: i.unidade as Unidade,
        isDefault: i.isDefault,
        acrescimoPreco: moneyToMask(i.acrescimoPreco) ?? "",
      })),
    }));
  }
  // Legado: componentes soltos → auto-grupo "Ficha base"
  if (receita?.components?.length) {
    return [
      {
        key: newKey(),
        nome: "Ficha base",
        obrigatoria: true,
        tipoSelecao: "UNICA",
        maxSelecoes: "",
        busca: "",
        items: receita.components.map((c, idx) => ({
          componentProductId: c.componentProductId,
          quantidade: String(c.quantidade),
          unidade: c.unidade as Unidade,
          isDefault: idx === 0,
          acrescimoPreco: "",
        })),
      },
    ];
  }
  return [];
}

export function ReceitaForm({
  mode,
  receita,
  tipoInicial = "DRINK",
  subcategories,
  candidates,
}: {
  mode: "new" | "edit";
  receita?: ReceitaData | null;
  tipoInicial?: RecipeType;
  subcategories: SubcategoryOpt[];
  candidates: ComponentCandidate[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pdvOpen, setPdvOpen] = useState(false);
  const [triedSave, setTriedSave] = useState(false);
  const [margemAlvo, setMargemAlvo] = useState("60");
  // URL da imagem só aparece quando o operador pede (evita ruído no caminho comum).
  const [showImgUrl, setShowImgUrl] = useState(
    !!receita?.imagemUrl && !receita.imagemUrl.startsWith("data:"),
  );
  // Impede o aviso de "sair sem salvar" logo após um save bem-sucedido.
  const savedRef = useRef(false);
  const nomeRef = useRef<HTMLInputElement>(null);
  const imgFileRef = useRef<HTMLInputElement>(null);

  const [tipoReceita, setTipoReceita] = useState<RecipeType>(
    receita?.tipoReceita ?? tipoInicial,
  );
  const [nome, setNome] = useState(receita?.nome ?? "");
  const [copoMl, setCopoMl] = useState<string>(() => {
    const tipo = receita?.tipoReceita ?? tipoInicial;
    if (tipo !== "DRINK") return "";
    if (receita?.copoMl) return receita.copoMl.toString();
    // Legado: deriva do volume da variação padrão, quando houver
    if (receita?.variants?.length) {
      const defaultVar = receita.variants.find((v) => v.isDefault) ?? receita.variants[0];
      return defaultVar?.volumeMl?.toString() ?? "";
    }
    return "";
  });
  const [subcategoryId, setSubcategoryId] = useState(receita?.subcategoryId ?? "");
  const [precoVenda, setPrecoVenda] = useState(moneyToMask(receita?.precoVenda));
  const [imagemUrl, setImagemUrl] = useState(receita?.imagemUrl ?? "");
  const [modoPreparo, setModoPreparo] = useState(receita?.modoPreparo ?? "");
  const [vendeOnline, setVendeOnline] = useState(receita?.vendeOnline ?? false);
  const [pesoGramas, setPeso] = useState(receita?.pesoGramas?.toString() ?? "");
  const [descricaoOnline, setDescOnline] = useState(receita?.descricaoOnline ?? "");
  const [channels, setChannels] = useState<ChannelRow[]>(
    initChannels(receita?.salesChannels),
  );
  const setChannel = (canal: SalesChannel, patch: Partial<ChannelRow>) =>
    setChannels((prev) => prev.map((r) => (r.canal === canal ? { ...r, ...patch } : r)));

  const [groups, setGroups] = useState<Group[]>(() => initGroups(receita));

  const copy = COPY[tipoReceita];

  const byId = useMemo(() => {
    const m = new Map<string, ComponentCandidate>();
    for (const c of candidates) m.set(c.id, c);
    return m;
  }, [candidates]);

  const title = mode === "edit" ? "Editar receita" : copy.novo;

  const subsByCat = useMemo(() => {
    const map = new Map<string, SubcategoryOpt[]>();
    for (const s of subcategories) {
      const arr = map.get(s.categoriaNome);
      if (arr) arr.push(s);
      else map.set(s.categoriaNome, [s]);
    }
    return Array.from(map, ([categoria, subs]) => ({ categoria, subs }));
  }, [subcategories]);

  const selectedSub = useMemo(
    () => subcategories.find((s) => s.id === subcategoryId),
    [subcategories, subcategoryId],
  );

  // Custo derivado usando o item padrão de cada grupo
  const comps = useMemo<DeriveComponent[]>(
    () =>
      groups.flatMap((g) => {
        const def = g.items.find((i) => i.isDefault) ?? g.items[0];
        if (!def) return [];
        const c = byId.get(def.componentProductId);
        if (!c) return [];
        return [
          {
            quantidade: parseQtd(def.quantidade),
            unidade: def.unidade,
            custo: c.custo,
            precoVenda: c.precoVenda,
            conteudoPorUnidade: c.conteudoPorUnidade,
            estoqueFechado: c.estoqueFechado,
            estoqueAberto: c.estoqueAberto,
          },
        ];
      }),
    [groups, byId],
  );
  const derived = useMemo(() => derive(comps), [comps]);

  const precoNum = parseMoney(precoVenda);
  const margemPct = margem(precoNum, derived.custoTotal);
  const margemPositiva = margemPct !== null && margemPct >= 0;
  const lucro =
    precoNum != null && derived.custoTotal != null ? precoNum - derived.custoTotal : null;

  const idadeAuto = groups.some((g) =>
    g.items.some((i) => byId.get(i.componentProductId)?.restricaoIdade),
  );

  const totalItems = groups.reduce((acc, g) => acc + g.items.length, 0);

  // Margem com 3 níveis semânticos: verde ≥15% · âmbar 0-15% · vermelho negativo.
  const margemColor: "ok" | "warn" | "danger" | null =
    margemPct === null
      ? null
      : margemPct < 0
        ? "danger"
        : margemPct < 15
          ? "warn"
          : "ok";

  // Preço sugerido a partir da margem-alvo: preço = custo / (1 − margem/100).
  const alvoNum = Number(String(margemAlvo).replace(",", "."));
  const precoSugerido =
    derived.custoTotal != null && Number.isFinite(alvoNum) && alvoNum > 0 && alvoNum < 100
      ? derived.custoTotal / (1 - alvoNum / 100)
      : null;

  // Rótulo da disponibilidade derivada (doses/porções montáveis com o estoque atual).
  const disponivelLabel = copy.disponivel;

  // ── Gestão de grupos ─────────────────────────────────────

  function addGroup() {
    setGroups((prev) => [
      ...prev,
      {
        key: newKey(),
        nome: "",
        obrigatoria: true,
        tipoSelecao: "UNICA",
        maxSelecoes: "",
        busca: "",
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

  function duplicateGroup(key: string) {
    setGroups((prev) => {
      const idx = prev.findIndex((g) => g.key === key);
      if (idx < 0) return prev;
      const g = prev[idx];
      const copia: Group = {
        ...g,
        key: newKey(),
        nome: g.nome ? `${g.nome} (cópia)` : "",
        busca: "",
        items: g.items.map((i) => ({ ...i })),
      };
      const next = [...prev];
      next.splice(idx + 1, 0, copia);
      return next;
    });
  }

  function updateGroup(key: string, patch: Partial<Omit<Group, "key" | "items">>) {
    setGroups((prev) =>
      prev.map((g) => {
        if (g.key !== key) return g;
        const updated = { ...g, ...patch };
        // Se mudar para UNICA e houver múltiplos padrões, mantém só o primeiro
        if (patch.tipoSelecao === "UNICA") {
          const firstIdx = updated.items.findIndex((i) => i.isDefault);
          if (firstIdx >= 0) {
            updated.items = updated.items.map((item, idx) => ({
              ...item,
              isDefault: idx === firstIdx,
            }));
          }
        }
        return updated;
      }),
    );
  }

  function addItemToGroup(groupKey: string, candidate: ComponentCandidate) {
    const unidade: Unidade = candidate.fracionavel ? (candidate.unidadeBase as Unidade) : "UN";
    // Dose sugerida no cadastro do produto manda; sem ela, cai no conteúdo da
    // embalagem (comportamento antigo).
    const qtdBase = candidate.fracionavel
      ? (candidate.dosePadrao ?? candidate.conteudoPorUnidade ?? 50)
      : 1;
    const copoNum = parseNum(copoMl);
    const qtdFinal =
      tipoReceita === "DRINK" && unidade === "ML" && copoNum > 0
        ? Math.min(qtdBase, copoNum)
        : qtdBase;
    setGroups((prev) =>
      prev.map((g) => {
        if (g.key !== groupKey) return g;
        if (g.items.some((i) => i.componentProductId === candidate.id)) return g;
        const isFirst = g.items.length === 0;
        return {
          ...g,
          busca: "",
          items: [
            ...g.items,
            {
              componentProductId: candidate.id,
              quantidade: String(qtdFinal),
              unidade,
              isDefault: isFirst,
              acrescimoPreco: "",
            },
          ],
        };
      }),
    );
  }

  function removeItemFromGroup(groupKey: string, componentProductId: string) {
    setGroups((prev) =>
      prev.map((g) => {
        if (g.key !== groupKey) return g;
        const next = g.items.filter((i) => i.componentProductId !== componentProductId);
        // Garante um padrão se sobrarem itens
        if (next.length > 0 && !next.some((i) => i.isDefault)) {
          next[0] = { ...next[0], isDefault: true };
        }
        return { ...g, items: next };
      }),
    );
  }

  function updateGroupItem(
    groupKey: string,
    componentProductId: string,
    patch: Partial<GroupItem>,
  ) {
    setGroups((prev) =>
      prev.map((g) =>
        g.key !== groupKey
          ? g
          : {
              ...g,
              items: g.items.map((i) =>
                i.componentProductId === componentProductId ? { ...i, ...patch } : i,
              ),
            },
      ),
    );
  }

  function setGroupItemDefault(groupKey: string, componentProductId: string) {
    setGroups((prev) =>
      prev.map((g) =>
        g.key !== groupKey
          ? g
          : {
              ...g,
              items: g.items.map((i) => ({
                ...i,
                isDefault:
                  g.tipoSelecao === "UNICA"
                    ? i.componentProductId === componentProductId
                    : i.componentProductId === componentProductId
                      ? !i.isDefault
                      : i.isDefault,
              })),
            },
      ),
    );
  }

  function getResultados(g: Group): ComponentCandidate[] {
    const term = g.busca.trim().toLowerCase();
    if (!term) return [];
    const naGrupo = new Set(g.items.map((i) => i.componentProductId));
    return candidates
      .filter((c) => !naGrupo.has(c.id))
      .filter((c) => `${c.nome} ${c.sku} ${c.marca ?? ""}`.toLowerCase().includes(term))
      .slice(0, 8);
  }

  // ── Imagem ────────────────────────────────────────────────

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

  // ── Salvar ────────────────────────────────────────────────

  function salvar() {
    setTriedSave(true);
    const fail = (msg: string) => {
      toast.error("Não foi possível salvar", msg);
    };
    if (nome.trim().length < 2) {
      nomeRef.current?.focus();
      return fail("Informe o nome da receita.");
    }
    if (!subcategoryId) return fail("Escolha a subcategoria.");
    if (tipoReceita === "DRINK" && !parseNum(copoMl))
      return fail("Escolha o tamanho do copo antes de salvar.");
    if (groups.length === 0)
      return fail("Adicione ao menos um grupo à ficha técnica.");
    for (const g of groups) {
      if (!g.nome.trim()) return fail("Todo grupo precisa de um nome.");
      if (g.items.length === 0) return fail(`O grupo "${g.nome || "sem nome"}" está vazio.`);
    }
    const copoNum = parseNum(copoMl);
    if (tipoReceita === "DRINK" && copoNum > 0) {
      for (const g of groups) {
        for (const item of g.items) {
          if (item.unidade === "ML" && parseQtd(item.quantidade) > copoNum) {
            const nome = byId.get(item.componentProductId)?.nome ?? "item";
            return fail(`"${nome}" tem ${item.quantidade}ml mas o copo é de ${copoMl}ml.`);
          }
        }
      }
    }

    let salesChannels: ReturnType<typeof channelsToInput> = [];
    if (tipoReceita !== "DRINK" && vendeOnline) {
      try {
        salesChannels = channelsToInput(channels);
      } catch (e) {
        return fail(e instanceof Error ? e.message : "Canal online sem preço.");
      }
    }

    const input = {
      nome,
      subcategoryId,
      imagemUrl: imagemUrl || undefined,
      precoVenda: precoNum,
      restricaoIdade: idadeAuto,
      tipoReceita,
      copoMl: tipoReceita === "DRINK" ? parseNum(copoMl) || null : null,
      modoPreparo: modoPreparo || undefined,
      vendeOnline: tipoReceita !== "DRINK" && vendeOnline,
      pesoGramas: pesoGramas ? Number(pesoGramas) : undefined,
      descricaoOnline: descricaoOnline || undefined,
      components: [],
      groups: groups.map((g, idx) => ({
        nome: g.nome.trim(),
        obrigatoria: g.obrigatoria,
        tipoSelecao: g.tipoSelecao,
        maxSelecoes: g.maxSelecoes ? Number(g.maxSelecoes) : null,
        ordem: idx,
        items: g.items
          .map((i) => ({
            componentProductId: i.componentProductId,
            quantidade: parseQtd(i.quantidade),
            unidade: i.unidade,
            isDefault: i.isDefault,
            acrescimoPreco: parseMoney(i.acrescimoPreco) ?? null,
          }))
          .filter((i) => i.quantidade > 0),
      })),
      variants: [],
      salesChannels,
    };

    start(async () => {
      try {
        if (receita) await updateReceita(receita.id, input);
        else await createReceita(input);
        savedRef.current = true;
        router.push("/produtos");
        router.refresh();
      } catch (e) {
        savedRef.current = false;
        toast.error(
          "Não foi possível salvar",
          e instanceof Error ? e.message : "Falha ao salvar.",
        );
      }
    });
  }

  function onKeyDownForm(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      salvar();
    }
  }

  // Aviso de sair sem salvar — só no cadastro novo com algo preenchido.
  const isDirty =
    mode === "new" &&
    (nome.trim() !== "" ||
      precoVenda !== "" ||
      imagemUrl !== "" ||
      modoPreparo.trim() !== "" ||
      groups.length > 0);
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      if (savedRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // ── Render ────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4" onKeyDown={onKeyDownForm}>
      <PageHeader
        backHref="/produtos"
        breadcrumbs={[{ label: "Produtos", href: "/produtos" }, { label: title }]}
        title={title}
        badge={mode === "edit" && receita?.sku ? <SkuTag sku={receita.sku} /> : undefined}
        innerClassName="max-w-none sm:px-8"
      />

      <div className="px-4 sm:px-8">
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
          {/* ── Coluna esquerda (sticky) ── */}
          <div className="flex flex-col gap-4 lg:sticky lg:top-3 lg:col-span-4">

            {/* Tipo de receita */}
            <div className="flex flex-wrap items-center gap-2 rounded-(--radius) border border-line bg-surface-2 p-2">
              <span className="px-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.15em] text-muted">
                Tipo de receita
              </span>
              <div className="flex gap-1">
                {TIPOS.map((t) => {
                  const ativo = tipoReceita === t.value;
                  return (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setTipoReceita(t.value)}
                      aria-pressed={ativo}
                      className={cn(
                        "flex cursor-pointer items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
                        ativo
                          ? "bg-brand text-on-brand shadow-(--shadow-1)"
                          : "text-ink-2 hover:bg-surface",
                      )}
                    >
                      {t.icon}
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Essenciais — nome + subcategoria + SKU + preço */}
            <SectionCard
              title="Essenciais"
              badge={
                idadeAuto ? (
                  <span className="ml-auto flex items-center gap-1 rounded-full border border-warn/30 bg-warn-soft px-2 py-0.5 text-[10px] font-semibold text-warn">
                    <ShieldCheck size={11} className="shrink-0" />
                    Venda restrita +18
                  </span>
                ) : undefined
              }
            >
              <Field label="Nome da receita" htmlFor="nome">
                <Input
                  id="nome"
                  ref={nomeRef}
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder={
                    tipoReceita === "DRINK"
                      ? "Ex.: Caipirinha de limão"
                      : tipoReceita === "PRATO"
                        ? "Ex.: Porção de batata frita"
                        : "Ex.: Receita da casa"
                  }
                  className="text-[15px] font-medium"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Subcategoria" htmlFor="sub">
                  <Select
                    id="sub"
                    value={subcategoryId}
                    onChange={(e) => setSubcategoryId(e.target.value)}
                  >
                    <option value="">Selecione…</option>
                    {subsByCat.map(({ categoria, subs }) => (
                      <optgroup key={categoria} label={categoria}>
                        {subs.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.nome}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </Select>
                  <div className="mt-1.5 flex items-center gap-2">
                    {mode === "edit" && receita?.sku ? (
                      <SkuTag sku={receita.sku} />
                    ) : selectedSub ? (
                      <span className="font-mono text-[11px] text-faint">
                        SKU: {selectedSub.categorySkuPrefix}-{selectedSub.skuPrefix}-????
                      </span>
                    ) : null}
                  </div>
                </Field>
                <Field label="Preço base" htmlFor="preco">
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
                      className="pl-9 font-mono text-base font-semibold"
                    />
                  </div>
                </Field>
              </div>

              {/* Custo & margem derivados da ficha técnica */}
              <div className="flex flex-col gap-3 border-t border-line pt-3">
                {derived.totalComponentes === 0 ? (
                  <p className="flex items-center gap-1.5 text-xs text-muted">
                    <Coins size={13} className="shrink-0 text-faint" />
                    Adicione itens à ficha para ver custo e margem.
                  </p>
                ) : (
                  <>
                    <div className="grid grid-cols-3 divide-x divide-line overflow-hidden rounded-(--radius-sm) border border-line bg-surface-2">
                      <div className="px-3 py-2">
                        <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.15em] text-muted">
                          Custo ficha
                        </p>
                        <p
                          className={cn(
                            "font-mono text-sm font-semibold tabular-nums",
                            derived.custoIncompleto ? "text-warn" : "text-ink",
                          )}
                        >
                          {derived.custoTotal != null ? brl(derived.custoTotal) : "—"}
                        </p>
                      </div>
                      <div className="px-3 py-2">
                        <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.15em] text-muted">
                          Margem
                        </p>
                        <p
                          className={cn(
                            "flex items-center gap-1 font-mono text-sm font-semibold tabular-nums",
                            margemColor === "ok" && "text-ok",
                            margemColor === "warn" && "text-warn",
                            margemColor === "danger" && "text-danger",
                            !margemColor && "text-faint",
                          )}
                        >
                          {margemPct != null ? (
                            <>
                              {margemColor === "danger" ? (
                                <TrendingDown size={13} className="shrink-0" />
                              ) : (
                                <TrendingUp size={13} className="shrink-0" />
                              )}
                              {margemPct}%
                            </>
                          ) : (
                            "—"
                          )}
                        </p>
                      </div>
                      <div className="px-3 py-2">
                        <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.15em] text-muted">
                          Lucro
                        </p>
                        <p className="font-mono text-sm font-semibold tabular-nums text-ink">
                          {lucro != null ? brl(lucro) : "—"}
                        </p>
                      </div>
                    </div>

                    {derived.custoIncompleto && (
                      <p className="text-xs text-warn">
                        Algum componente não tem custo cadastrado — a margem fica
                        incompleta.
                      </p>
                    )}

                    {/* Margem-alvo → sugere preço a partir do custo */}
                    <div className="flex items-end gap-2">
                      <Field label="Margem-alvo (%)" htmlFor="malvo" className="w-24">
                        <Input
                          id="malvo"
                          value={margemAlvo}
                          onChange={(e) =>
                            setMargemAlvo(e.target.value.replace(/\D/g, "").slice(0, 2))
                          }
                          inputMode="numeric"
                          placeholder="60"
                          className="font-mono"
                        />
                      </Field>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={precoSugerido == null}
                        onClick={() =>
                          precoSugerido != null &&
                          setPrecoVenda(moneyToMask(Math.round(precoSugerido * 100) / 100))
                        }
                        className="mb-0.5"
                      >
                        <Wand2 size={14} />
                        {precoSugerido != null
                          ? `Sugerir ${brl(precoSugerido)}`
                          : "Sugerir preço"}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </SectionCard>

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
                <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-(--radius) border border-line bg-surface-2">
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
                  <div className="flex flex-wrap items-center gap-2">
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
                    <span className="text-xs text-muted">JPG, PNG ou WebP, até 2 MB.</span>
                  </div>
                  {showImgUrl ? (
                    <Input
                      value={imagemUrl.startsWith("data:") ? "" : imagemUrl}
                      onChange={(e) => setImagemUrl(e.target.value)}
                      placeholder={
                        imagemUrl.startsWith("data:")
                          ? "Imagem enviada do computador"
                          : "https://…"
                      }
                      inputMode="url"
                      className="font-mono text-[12px] placeholder:font-sans"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowImgUrl(true)}
                      className="flex items-center gap-1 self-start text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
                    >
                      <ImagePlus size={12} /> Colar URL de imagem
                    </button>
                  )}
                </div>
              </div>
            </SectionCard>

            {/* Montagem/Preparo */}
            <SectionCard title={copy.preparoLabel}>
              <Textarea
                value={modoPreparo}
                onChange={(e) => setModoPreparo(e.target.value)}
                placeholder={copy.preparoPlaceholder}
                className={tipoReceita === "PRATO" ? "min-h-35" : "min-h-22.5"}
              />
            </SectionCard>
          </div>

          {/* ── Coluna direita ── */}
          <div className="flex flex-col gap-4 lg:col-span-8">

            {/* Tamanho do copo — apenas DRINK, obrigatório antes dos grupos */}
            {tipoReceita === "DRINK" && (
              <SectionCard
                title="Tamanho do copo"
                badge={
                  parseNum(copoMl) > 0 ? (
                    <Badge tone="brand">{copoMl} ml</Badge>
                  ) : undefined
                }
              >
                <p className="text-xs text-muted">
                  Define o volume do copo. Os ingredientes em ml não podem ultrapassar este valor.
                </p>
                <div className="flex flex-wrap gap-2">
                  {[200, 300, 400, 500, 600, 800, 1000].map((ml) => (
                    <button
                      key={ml}
                      type="button"
                      onClick={() => setCopoMl(String(ml))}
                      className={cn(
                        "flex cursor-pointer items-center gap-1 rounded-full border px-3.5 py-1.5 font-mono text-sm font-medium transition-colors",
                        copoMl === String(ml)
                          ? "border-brand bg-brand text-on-brand"
                          : "border-line bg-surface-2 text-ink-2 hover:border-brand/40 hover:bg-brand-soft",
                      )}
                    >
                      <GlassWater size={13} />
                      {ml} ml
                    </button>
                  ))}
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={[200, 300, 400, 500, 600, 800, 1000].includes(Number(copoMl)) ? "" : copoMl}
                      onChange={(e) => setCopoMl(e.target.value.replace(/\D/g, ""))}
                      inputMode="numeric"
                      placeholder="Outro (ml)"
                      className="h-8 w-28 font-mono text-[13px]"
                    />
                  </div>
                </div>
              </SectionCard>
            )}

            {/* Ficha técnica com grupos */}
            <SectionCard
              title={copy.ficha}
              badge={
                totalItems > 0 ? (
                  <span className="ml-auto flex flex-wrap items-center gap-1.5">
                    <Badge tone="brand">
                      {groups.length} {groups.length === 1 ? "grupo" : "grupos"} · {totalItems}{" "}
                      {totalItems === 1 ? "item" : "itens"}
                    </Badge>
                    {derived.disponibilidade > 0 && (
                      <Badge tone="neutral">
                        <Boxes size={11} className="shrink-0" />≈ {derived.disponibilidade}{" "}
                        {disponivelLabel}
                      </Badge>
                    )}
                  </span>
                ) : undefined
              }
            >
              {tipoReceita === "DRINK" && !parseNum(copoMl) && groups.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-(--radius) border border-dashed border-line-strong px-6 py-10 text-center">
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-brand-soft text-brand-strong">
                    <GlassWater size={20} />
                  </span>
                  <p className="max-w-sm text-sm text-muted">
                    Escolha o tamanho do copo antes de criar os grupos.
                  </p>
                </div>
              ) : groups.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-(--radius) border border-dashed border-line-strong px-6 py-10 text-center">
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-brand-soft text-brand-strong">
                    <LayoutList size={20} />
                  </span>
                  <p className="max-w-sm text-sm text-muted">{copy.fichaVazia}</p>
                  <Button type="button" variant="secondary" size="sm" onClick={addGroup}>
                    <Plus size={15} /> Adicionar grupo
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {groups.map((g, gi) => {
                    const resultados = getResultados(g);
                    const nomeInvalido = triedSave && !g.nome.trim();
                    const vazioInvalido = triedSave && g.items.length === 0;
                    const grupoInvalido = nomeInvalido || vazioInvalido;
                    return (
                      <div
                        key={g.key}
                        className={cn(
                          "overflow-visible rounded-sm border bg-surface-2",
                          grupoInvalido ? "border-danger/50" : "border-line",
                        )}
                      >
                        {/* Cabeçalho do grupo */}
                        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
                          <Input
                            value={g.nome}
                            onChange={(e) => updateGroup(g.key, { nome: e.target.value })}
                            placeholder="Nome do grupo (ex.: Destilado)"
                            className={cn(
                              "h-8 min-w-0 flex-1 text-[13px] font-semibold",
                              nomeInvalido && "border-danger ring-1 ring-danger/40",
                            )}
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
                          >
                            <option value="UNICA">Única</option>
                            <option value="MULTIPLA">Múltipla</option>
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
                              className="grid h-7 w-7 place-items-center rounded-sm text-faint transition-colors hover:bg-surface hover:text-ink-2 disabled:opacity-30 disabled:hover:bg-transparent"
                            >
                              <ArrowUp size={14} />
                            </button>
                            <button
                              type="button"
                              aria-label="Mover grupo para baixo"
                              onClick={() => moveGroup(g.key, 1)}
                              disabled={gi === groups.length - 1}
                              className="grid h-7 w-7 place-items-center rounded-sm text-faint transition-colors hover:bg-surface hover:text-ink-2 disabled:opacity-30 disabled:hover:bg-transparent"
                            >
                              <ArrowDown size={14} />
                            </button>
                            <button
                              type="button"
                              aria-label="Duplicar grupo"
                              onClick={() => duplicateGroup(g.key)}
                              className="grid h-7 w-7 place-items-center rounded-sm text-faint transition-colors hover:bg-surface hover:text-ink-2"
                            >
                              <Copy size={13} />
                            </button>
                            <button
                              type="button"
                              aria-label="Remover grupo"
                              onClick={() => removeGroup(g.key)}
                              className="grid h-7 w-7 place-items-center rounded-sm text-faint transition-colors hover:bg-danger-soft hover:text-danger"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>

                        {/* Busca dentro do grupo */}
                        <div className="relative px-3 pt-2.5">
                          <div className="relative">
                            <Search
                              size={14}
                              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"
                            />
                            <Input
                              value={g.busca}
                              onChange={(e) => updateGroup(g.key, { busca: e.target.value })}
                              placeholder={copy.buscaPlaceholder}
                              className="pl-8 text-[13px]"
                            />
                          </div>
                          {g.busca.trim() && (
                            <div className="absolute z-40 mt-1 max-h-60 w-[calc(100%-1.5rem)] overflow-y-auto rounded-(--radius) border border-line bg-surface p-1 shadow-(--shadow-2)">
                              {resultados.length === 0 ? (
                                <p className="px-3 py-4 text-center text-sm text-muted">
                                  Nenhum produto bate com a busca.
                                </p>
                              ) : (
                                resultados.map((c) => (
                                  <button
                                    key={c.id}
                                    type="button"
                                    onClick={() => addItemToGroup(g.key, c)}
                                    className="flex w-full items-center gap-3 rounded-sm px-2.5 py-2 text-left transition-colors hover:bg-brand-soft"
                                  >
                                    <Thumb url={c.imagemUrl} tipo={c.tipo} size={9} />
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-[13px] font-medium text-ink">
                                        {c.nome}
                                      </p>
                                      <div className="mt-0.5 flex items-center gap-2">
                                        <SkuTag sku={c.sku} />
                                        {c.fracionavel && (
                                          <span className="text-[11px] text-faint">
                                            dose em {c.unidadeBase.toLowerCase()}
                                            {c.dosePadrao
                                              ? ` · padrão ${c.dosePadrao}`
                                              : ""}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    {c.custo != null && (
                                      <span className="shrink-0 font-mono text-[11px] font-semibold tabular-nums text-muted">
                                        {brl(c.custo)}
                                        <span className="text-faint">
                                          /{c.fracionavel ? c.unidadeBase.toLowerCase() : "un"}
                                        </span>
                                      </span>
                                    )}
                                    <Plus size={14} className="shrink-0 text-brand-strong" />
                                  </button>
                                ))
                              )}
                            </div>
                          )}
                        </div>

                        {/* Itens do grupo */}
                        {g.items.length === 0 ? (
                          <p
                            className={cn(
                              "px-3 py-3 text-center text-xs",
                              vazioInvalido ? "text-danger" : "text-faint",
                            )}
                          >
                            {vazioInvalido
                              ? "Este grupo está vazio — busque e adicione ao menos uma opção."
                              : "Busque acima e adicione opções a este grupo."}
                          </p>
                        ) : (
                          <div className="overflow-x-auto p-3 pt-2">
                            <table className="w-full min-w-125 text-left">
                              <thead className="border-b border-line text-[10px] font-semibold uppercase tracking-wider text-faint">
                                <tr>
                                  <th className="px-2 py-2">Produto</th>
                                  <th className="px-2 py-2">Qtd</th>
                                  <th className="px-2 py-2 text-center">
                                    {g.tipoSelecao === "UNICA" ? "Padrão" : "Padrão"}
                                  </th>
                                  <th className="px-2 py-2" title="Valor acrescido ao preço quando selecionado (R$)">
                                    Acresce (R$)
                                  </th>
                                  <th className="w-8 px-2 py-2" />
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-line">
                                {g.items.map((item) => {
                                  const c = byId.get(item.componentProductId);
                                  if (!c) return null;
                                  return (
                                    <tr
                                      key={item.componentProductId}
                                      className="bg-surface transition-colors hover:bg-surface-2"
                                    >
                                      <td className="px-2 py-2">
                                        <div className="flex items-center gap-2">
                                          <Thumb url={c.imagemUrl} tipo={c.tipo} size={9} />
                                          <div className="min-w-0">
                                            <p className="truncate text-[12px] font-medium text-ink">
                                              {c.nome}
                                            </p>
                                            <SkuTag sku={c.sku} />
                                          </div>
                                        </div>
                                      </td>
                                      <td className="px-2 py-2">
                                        <div className="flex items-center gap-1">
                                          <Input
                                            value={item.quantidade}
                                            onChange={(e) => {
                                              let val = e.target.value.replace(/[^\d.,]/g, "");
                                              if (
                                                item.unidade === "ML" &&
                                                tipoReceita === "DRINK"
                                              ) {
                                                const copoNum = parseNum(copoMl);
                                                if (copoNum > 0 && parseNum(val) > copoNum) {
                                                  val = String(copoNum);
                                                }
                                              }
                                              updateGroupItem(g.key, item.componentProductId, {
                                                quantidade: val,
                                              });
                                            }}
                                            inputMode="decimal"
                                            className="h-7 w-14 px-1.5 text-center font-mono text-[12px]"
                                          />
                                          <Select
                                            value={item.unidade}
                                            onChange={(e) =>
                                              updateGroupItem(g.key, item.componentProductId, {
                                                unidade: e.target.value as Unidade,
                                              })
                                            }
                                            containerClassName="w-auto"
                                            className="h-7 pl-2 pr-7 text-[12px]"
                                          >
                                            <option value="UN">un</option>
                                            <option value="ML">ml</option>
                                            <option value="G">g</option>
                                          </Select>
                                        </div>
                                      </td>
                                      <td className="px-2 py-2 text-center">
                                        {g.tipoSelecao === "UNICA" ? (
                                          <input
                                            type="radio"
                                            name={`default-${g.key}`}
                                            checked={item.isDefault}
                                            onChange={() =>
                                              setGroupItemDefault(g.key, item.componentProductId)
                                            }
                                            className="cursor-pointer accent-brand"
                                          />
                                        ) : (
                                          <input
                                            type="checkbox"
                                            checked={item.isDefault}
                                            onChange={() =>
                                              setGroupItemDefault(g.key, item.componentProductId)
                                            }
                                            className="cursor-pointer accent-brand"
                                          />
                                        )}
                                      </td>
                                      <td className="px-2 py-2">
                                        <div className="relative">
                                          <span className="pointer-events-none absolute inset-y-0 left-1.5 flex items-center text-[10px] text-muted">
                                            R$
                                          </span>
                                          <Input
                                            value={item.acrescimoPreco}
                                            onChange={(e) =>
                                              updateGroupItem(g.key, item.componentProductId, {
                                                acrescimoPreco: maskMoney(e.target.value),
                                              })
                                            }
                                            inputMode="numeric"
                                            placeholder="0,00"
                                            title="Valor acrescido ao preço quando selecionado"
                                            className="h-7 w-20 pl-5 pr-1 text-center font-mono text-[12px]"
                                          />
                                        </div>
                                      </td>
                                      <td className="px-2 py-2">
                                        <button
                                          type="button"
                                          aria-label="Remover item"
                                          onClick={() =>
                                            removeItemFromGroup(g.key, item.componentProductId)
                                          }
                                          className="grid h-6 w-6 place-items-center rounded-sm text-faint transition-colors hover:bg-danger-soft hover:text-danger"
                                        >
                                          <Trash2 size={13} />
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={addGroup}
                    className="self-start"
                  >
                    <Plus size={14} /> Adicionar grupo
                  </Button>
                </div>
              )}
            </SectionCard>

            {/* Venda online — oculto para drinks */}
            {tipoReceita !== "DRINK" && <SectionCard title="Venda online">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-2">
                <input
                  type="checkbox"
                  checked={vendeOnline}
                  onChange={(e) => setVendeOnline(e.target.checked)}
                  className="cursor-pointer accent-brand"
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
                        className="min-h-20"
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
            </SectionCard>}
          </div>
        </div>

      </div>

      {/* Footer de ações */}
      <div className="sticky bottom-4 z-10 mx-4 mb-4 flex items-center justify-end gap-3 rounded-lg border border-line bg-surface/90 px-4 py-3 shadow-(--shadow-2) backdrop-blur sm:mx-8 sm:px-6">
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
        <Button
          variant="secondary"
          onClick={() => setPdvOpen(true)}
          disabled={pending}
          type="button"
        >
          <Eye size={15} /> Visualizar no PDV
        </Button>
        <Button variant="ghost" onClick={() => router.push("/produtos")} disabled={pending}>
          Cancelar
        </Button>
        <Button onClick={salvar} disabled={pending}>
          {pending ? "Salvando…" : "Salvar receita"}
        </Button>
      </div>

      {/* Modal PDV preview — montado só aberto: montar já é o "reset ao abrir". */}
      {pdvOpen && (
        <PdvPreviewModal
          onClose={() => setPdvOpen(false)}
          nome={nome}
          tipoReceita={tipoReceita}
          precoNum={precoNum}
          imagemUrl={imagemUrl}
          groups={groups}
          byId={byId}
        />
      )}
    </div>
  );
}

// ── PDV preview modal ────────────────────────────────────────

function PdvPreviewModal({
  onClose,
  nome,
  tipoReceita,
  precoNum,
  imagemUrl,
  groups,
  byId,
}: {
  onClose: () => void;
  nome: string;
  tipoReceita: RecipeType;
  precoNum: number | null;
  imagemUrl: string;
  groups: Group[];
  byId: Map<string, ComponentCandidate>;
}) {
  /**
   * Seleção inicial: o que o grupo marca como padrão, ou o primeiro item.
   *
   * Calculada no `useState` e não num efeito de reset — o modal só existe
   * enquanto está aberto, então montar já é o reset. Efeito que chamava
   * `setSelections` no corpo causava render em cascata a cada abertura.
   */
  const [selections, setSelections] = useState<Record<string, string[]>>(() => {
    const s: Record<string, string[]> = {};
    for (const g of groups) {
      const defs = g.items.filter((i) => i.isDefault).map((i) => i.componentProductId);
      s[g.key] = defs.length ? defs : g.items.slice(0, 1).map((i) => i.componentProductId);
    }
    return s;
  });
  const [qty, setQty] = useState(1);

  // ESC fecha
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const acrescimoTotal = useMemo(() => {
    let total = 0;
    for (const g of groups) {
      for (const id of selections[g.key] ?? []) {
        const item = g.items.find((i) => i.componentProductId === id);
        if (item) total += parseMoney(item.acrescimoPreco) ?? 0;
      }
    }
    return total;
  }, [selections, groups]);

  const precoBase = precoNum ?? 0;
  const total = (precoBase + acrescimoTotal) * qty;

  function toggle(g: Group, id: string) {
    setSelections((prev) => {
      const cur = prev[g.key] ?? [];
      if (g.tipoSelecao === "UNICA") return { ...prev, [g.key]: [id] };
      const max = g.maxSelecoes ? Number(g.maxSelecoes) : Infinity;
      if (cur.includes(id)) return { ...prev, [g.key]: cur.filter((x) => x !== id) };
      if (cur.length >= max) return prev;
      return { ...prev, [g.key]: [...cur, id] };
    });
  }

  const TipoIcon =
    tipoReceita === "DRINK" ? Martini : tipoReceita === "PRATO" ? Utensils : CookingPot;
  const tipoLabel =
    tipoReceita === "DRINK" ? "Drink" : tipoReceita === "PRATO" ? "Prato" : "Outro";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Prévia PDV — ${nome || "produto"}`}
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-[3px]" />

      {/* Painel */}
      <div
        className="relative z-10 flex w-full max-h-[92dvh] flex-col overflow-hidden rounded-t-(--radius-xl) border border-line bg-surface shadow-(--shadow-2) sm:max-w-[480px] sm:rounded-(--radius-xl)"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Hero: imagem ou header só-texto ── */}
        {imagemUrl ? (
          <div className="relative h-44 shrink-0 overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imagemUrl} alt="" className="h-full w-full object-cover" />
            {/* Gradiente para legibilidade do título sobre a imagem */}
            <div className="absolute inset-0 bg-gradient-to-t from-ink/70 via-ink/20 to-transparent" />
            {/* Título sobre a imagem */}
            <div className="absolute inset-x-0 bottom-0 flex items-end gap-2.5 px-4 pb-4">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/15 text-white backdrop-blur-sm">
                <TipoIcon size={16} />
              </span>
              <div className="min-w-0">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.15em] text-white/60">
                  {tipoLabel}
                </p>
                <h2 className="truncate text-lg font-bold leading-tight text-white">
                  {nome || "Sem nome"}
                </h2>
              </div>
            </div>
            {/* Fechar */}
            <button
              type="button"
              aria-label="Fechar prévia"
              onClick={onClose}
              className="absolute right-3 top-3 grid h-8 w-8 cursor-pointer place-items-center rounded-full bg-ink/30 text-white/80 backdrop-blur-sm transition-colors hover:bg-ink/50"
            >
              <X size={15} />
            </button>
          </div>
        ) : (
          /* Header sem imagem */
          <div className="flex items-center gap-3 border-b border-line bg-surface-2 px-4 py-3.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-soft text-brand">
              <TipoIcon size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.15em] text-muted">
                {tipoLabel}
              </p>
              <h2 className="truncate text-[15px] font-semibold text-ink">
                {nome || "Sem nome"}
              </h2>
            </div>
            <button
              type="button"
              aria-label="Fechar prévia"
              onClick={onClose}
              className="grid h-8 w-8 cursor-pointer place-items-center rounded-full text-faint transition-colors hover:bg-surface hover:text-ink-2"
            >
              <X size={15} />
            </button>
          </div>
        )}

        {/* Preço base — linha discreta abaixo do hero */}
        {precoBase > 0 && (
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="text-xs text-muted">A partir de</span>
            <span className="font-mono text-sm font-semibold text-accent">
              {brl(precoBase)}
            </span>
          </div>
        )}

{/* ── Grupos — scrollável ── */}
        <div className="flex-1 overflow-y-auto">
          {groups.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-surface-2 text-faint">
                <LayoutList size={18} />
              </span>
              <p className="text-sm text-muted">
                Adicione grupos à ficha técnica para ver a prévia.
              </p>
            </div>
          ) : (
            groups.map((g) => {
              const sel = selections[g.key] ?? [];
              const selCount = sel.length;
              const isInvalid = g.obrigatoria && selCount === 0;
              return (
                <div key={g.key} className="border-b border-line last:border-0">
                  {/* Cabeçalho do grupo */}
                  <div
                    className={cn(
                      "flex items-center justify-between px-4 py-2",
                      isInvalid ? "bg-danger-soft" : "bg-canvas",
                    )}
                  >
                    <span
                      className={cn(
                        "font-mono text-[10.5px] font-semibold uppercase tracking-[0.15em]",
                        isInvalid ? "text-danger" : "text-muted",
                      )}
                    >
                      {g.nome || "Grupo"}
                    </span>
                    <span
                      className={cn(
                        "text-[10px] font-medium",
                        isInvalid ? "text-danger" : selCount > 0 ? "text-ok" : "text-faint",
                      )}
                    >
                      {g.obrigatoria
                        ? isInvalid ? "⚠ Obrigatório" : "✓ Obrigatório"
                        : "Opcional"}
                    </span>
                  </div>

                  {/* Itens do grupo */}
                  <div className="divide-y divide-line">
                    {[...g.items]
                      .sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0))
                      .map((item) => {
                      const c = byId.get(item.componentProductId);
                      if (!c) return null;
                      const selected = sel.includes(item.componentProductId);
                      const acrescimo = parseMoney(item.acrescimoPreco) ?? 0;

                      return (
                        <button
                          key={item.componentProductId}
                          type="button"
                          onClick={() => toggle(g, item.componentProductId)}
                          className={cn(
                            "flex w-full cursor-pointer items-center gap-3 py-3 pr-4 text-left transition-colors",
                            selected
                              ? "border-l-[3px] border-brand bg-brand-soft pl-[13px]"
                              : "border-l-[3px] border-transparent pl-[13px] hover:bg-surface-2",
                          )}
                        >
                          {/* Indicador seleção */}
                          <span
                            className={cn(
                              "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all",
                              selected
                                ? "border-brand bg-brand"
                                : "border-line-strong bg-surface",
                            )}
                          >
                            {selected && (
                              <Check size={10} strokeWidth={3} className="text-white" />
                            )}
                          </span>

                          {/* Thumbnail */}
                          {c.imagemUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={c.imagemUrl}
                              alt=""
                              className="h-10 w-10 shrink-0 rounded-(--radius-sm) border border-line object-cover"
                            />
                          ) : (
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-(--radius-sm) border border-line bg-surface-2 text-faint">
                              <ImageOff size={13} />
                            </span>
                          )}

                          {/* Nome */}
                          <span
                            className={cn(
                              "flex-1 truncate text-[13px]",
                              selected ? "font-semibold text-ink" : "font-normal text-ink-2",
                            )}
                          >
                            {c.nome}
                          </span>

                          {/* Preço ou badge */}
                          {acrescimo > 0 ? (
                            <span
                              className={cn(
                                "shrink-0 font-mono text-[12px] font-semibold",
                                selected ? "text-accent" : "text-muted",
                              )}
                            >
                              +{brl(acrescimo)}
                            </span>
                          ) : selected ? (
                            <span className="shrink-0 rounded-full bg-ok-soft px-2 py-0.5 font-mono text-[10px] font-semibold text-ok">
                              incluso
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* ── Footer: qty + total + CTA ── */}
        <div className="shrink-0 border-t border-line bg-surface px-4 pb-6 pt-3">
          <div className="flex items-center justify-between">
            {/* Stepper */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Diminuir quantidade"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-line-strong bg-surface text-ink-2 transition-colors hover:bg-surface-2 disabled:opacity-40"
                disabled={qty <= 1}
              >
                <Minus size={14} />
              </button>
              <span className="w-7 text-center font-mono text-sm font-bold text-ink">
                {qty}
              </span>
              <button
                type="button"
                aria-label="Aumentar quantidade"
                onClick={() => setQty((q) => q + 1)}
                className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-line-strong bg-surface text-ink-2 transition-colors hover:bg-surface-2"
              >
                <Plus size={14} />
              </button>
            </div>

            {/* Total */}
            <div className="text-right">
              <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.15em] text-muted">
                Total
              </p>
              <p className="font-mono text-xl font-bold tabular-nums text-ink">
                {brl(total)}
              </p>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
