"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ScanBarcode,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ImageOff,
  ImagePlus,
  Trash2,
  Plus,
  X,
  Check,
  CornerDownLeft,
  ChevronRight,
  ArrowDown,
  Box,
  Boxes,
  Package,
  PackageOpen,
  ShoppingCart,
  Warehouse,
  Wine,
  FileText,
  Globe,
  TrendingUp,
  TrendingDown,
  Truck,
  Sparkles,
  Pencil,
  RotateCcw,
  Lightbulb,
} from "lucide-react";
import {
  cn,
  brl,
  margem,
  maskMoney,
  moneyToMask,
  parseMoney,
} from "@/lib/utils";
import { onlyDigits } from "@/lib/normalize";
import { arquivoParaThumb } from "@/lib/imagem";
import { POLICY_PADRAO, type EstoquePolicy } from "@/lib/estoque-estrategia";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { Field, Label, Badge, Eyebrow } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { PageHeader } from "@/components/app/page-header";
import { SkuTag } from "@/components/sku-tag";
import {
  OnlineChannels,
  initChannels,
  channelsToInput,
  type ChannelRow,
} from "./online-channels";
import {
  createProduct,
  updateProduct,
  enrichEan,
  createCategory,
  createSubcategory,
  checkEanTaken,
  checkNomeSimilar,
  sugerirMargemSubcategoria,
  sugerirDescricaoOnline,
} from "../actions";
import { vincularItemAction } from "../../compras/_catalogo/actions";
import type { SalesChannel } from "@/generated/prisma";
import type {
  BrandOpt,
  CategoryOpt,
  SubcategoryOpt,
  StorageOpt,
  SupplierPickerOpt,
  FiscalOpt,
  ProductRow,
} from "../_types";
import type { ProductPrefill } from "./product-form";

type PackagingRow = { nome: string; ean: string; fatorConversao: string };

/** "UN" = compro solto; qualquer outro valor é o nome da embalagem de compra. */
type CompraMode = "UN" | string;

/** Tempo que o card "produto encontrado" fica na tela (o fio de baixo conta). */
const FOUND_CARD_MS = 7000;
const DRAFT_KEY = "nohub:rascunho:produto-simples";
/** Âncoras das etapas, na ordem — usadas pelo auto-scroll e pelos atalhos. */
const STEP_IDS = ["etapa-produto", "etapa-compra", "etapa-uso", "etapa-estoque"];

const COMPRA_OPCOES: { key: string; label: string; icon: React.ReactNode }[] = [
  { key: "UN", label: "Unidade", icon: <Package size={18} /> },
  { key: "Caixa", label: "Caixa", icon: <Box size={18} /> },
  { key: "Fardo", label: "Fardo", icon: <Boxes size={18} /> },
  { key: "Engradado", label: "Engradado", icon: <PackageOpen size={18} /> },
  { key: "Pacote", label: "Pacote", icon: <Package size={18} /> },
];

// ── Peças de UI ────────────────────────────────────────────

/**
 * Área que cresce em vez de aparecer seca. Os filhos continuam montados
 * enquanto fechados (o CSS zera a altura), então o estado não se perde.
 */
function Collapse({
  open,
  gap = 4,
  children,
  className,
}: {
  open: boolean;
  /** Gap (em unidades Tailwind) do contêiner pai — cancelado enquanto fechado. */
  gap?: 0 | 3 | 4;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className="grow-reveal"
      data-open={open}
      style={open || !gap ? undefined : { marginTop: `-${gap * 0.25}rem` }}
    >
      <div>
        <div className={cn("flex flex-col gap-4", className)} inert={!open}>
          {children}
        </div>
      </div>
    </div>
  );
}

/** Etapa do assistente — uma pergunta, um bloco de campos. */
function Step({
  n,
  id,
  question,
  hint,
  done,
  delay = 0,
  children,
}: {
  n: number;
  id?: string;
  question: string;
  hint?: string;
  done?: boolean;
  /** Atraso da entrada em stagger (ms). */
  delay?: number;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="fade-up scroll-mt-4 rounded-[var(--radius-lg)] border border-line bg-surface p-5 shadow-[var(--shadow-1)]"
      style={{ animationDelay: `${delay}ms` }}
    >
      <header className="flex items-start gap-3">
        <span
          key={done ? "done" : "todo"}
          className={cn(
            "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full font-mono text-[11px] font-semibold",
            done ? "pop-in bg-ok-soft text-ok" : "bg-brand-soft text-brand-strong",
          )}
          aria-hidden
        >
          {done ? <Check size={12} /> : n}
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-[15px] font-semibold leading-tight text-ink">
            {question}
          </h2>
          {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
        </div>
      </header>
      <div className="mt-4 flex flex-col gap-4 sm:pl-9">{children}</div>
    </section>
  );
}

/** Número que corre até o valor novo — a margem deixa de pular na tela. */
function useCountUp(target: number | null, ms = 320) {
  const [shown, setShown] = useState(target);
  const fromRef = useRef(target);
  useEffect(() => {
    const from = fromRef.current;
    fromRef.current = target;
    let raf = 0;
    // Sem valor anterior comparável — assume direto (no próximo frame, para
    // não escrever estado dentro do corpo do efeito).
    if (target === null || from === null || from === target) {
      raf = requestAnimationFrame(() => setShown(target));
      return () => cancelAnimationFrame(raf);
    }
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min((t - t0) / ms, 1);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(from + (target - from) * eased));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return shown;
}

/** Bloco recolhido — nada aparece até o operador pedir. */
function Collapsible({
  icon,
  title,
  summary,
  defaultOpen,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-[var(--radius-lg)] border border-line bg-surface shadow-[var(--shadow-1)]"
    >
      <summary className="flex cursor-pointer select-none list-none items-center gap-3 rounded-[var(--radius-lg)] px-5 py-4 transition-colors hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
        {icon && <span className="shrink-0 text-muted">{icon}</span>}
        <span className="font-display text-[14px] font-semibold text-ink">
          {title}
        </span>
        {summary && (
          <span className="ml-auto truncate text-xs text-muted">{summary}</span>
        )}
        <ChevronRight
          size={14}
          className={cn(
            "shrink-0 text-faint transition-transform duration-200 group-open:rotate-90",
            summary ? "ml-2" : "ml-auto",
          )}
        />
      </summary>
      <div className="flex flex-col gap-4 border-t border-line p-5">
        {children}
      </div>
    </details>
  );
}

/** Cartão de escolha — a resposta da pergunta da etapa. */
function Choice({
  selected,
  onClick,
  icon,
  label,
  sub,
}: {
  selected: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  label: string;
  sub?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "flex min-w-[96px] flex-1 flex-col items-center gap-1.5 rounded-[var(--radius)] border px-3 py-3 transition-[colors,transform] duration-150 hover:-translate-y-px",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)]",
        selected
          ? "border-brand bg-brand-soft text-brand-strong"
          : "border-line-strong bg-surface text-ink-2 hover:border-brand/40 hover:bg-surface-2",
      )}
    >
      {icon && <span className={selected ? "" : "text-faint"}>{icon}</span>}
      <span className="text-[13px] font-medium leading-none">{label}</span>
      {sub && <span className="text-[11px] leading-none text-muted">{sub}</span>}
    </button>
  );
}

function ImageThumb({
  imagemUrl,
  onPick,
  onClear,
}: {
  imagemUrl: string;
  onPick: () => void;
  onClear: () => void;
}) {
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={onPick}
        className="group relative flex h-[44px] w-[44px] items-center justify-center overflow-hidden rounded-[var(--radius)] border border-line-strong bg-surface-2 transition-colors hover:border-brand/40"
        title={imagemUrl ? "Trocar imagem" : "Adicionar imagem"}
      >
        {imagemUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imagemUrl} alt="" className="h-full w-full object-contain" />
        ) : (
          <ImagePlus size={16} className="text-faint" />
        )}
        <span className="absolute inset-0 grid place-items-center bg-ink/40 opacity-0 transition-opacity group-hover:opacity-100">
          <ImagePlus size={14} className="text-white" />
        </span>
      </button>
      {imagemUrl && (
        <button
          type="button"
          onClick={onClear}
          className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full border border-line bg-surface text-danger shadow-[var(--shadow-1)] hover:bg-danger-soft"
          title="Remover imagem"
        >
          <Trash2 size={10} />
        </button>
      )}
    </div>
  );
}

/** Linha do painel lateral. */
function PanelRow({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "ok" | "warn" | "danger" | "muted";
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-muted">{label}</span>
      <span
        className={cn(
          "truncate text-[13px] font-medium tabular-nums",
          mono && "font-mono",
          tone === "ok" && "text-ok",
          tone === "warn" && "text-warn",
          tone === "danger" && "text-danger",
          tone === "muted" && "text-faint",
          !tone && "text-ink",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** Nó do fluxo do produto no painel lateral. */
function FlowNode({
  icon,
  label,
  title,
  detail,
  hint,
  active,
  tone = "brand",
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
  detail?: string;
  hint?: string;
  active: boolean;
  tone?: "brand" | "accent";
}) {
  return (
    <div
      className={cn(
        "flow-in flex items-start gap-2.5 rounded-[var(--radius-sm)] p-2 transition-opacity",
        active ? "bg-surface-2" : "opacity-50",
      )}
    >
      <span
        className={cn(
          "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full",
          !active && "bg-surface text-faint",
          active && tone === "brand" && "bg-brand-soft text-brand-strong",
          active && tone === "accent" && "bg-accent-soft text-accent",
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.15em] text-muted">
          {label}
        </span>
        <p
          className={cn(
            "truncate text-[12.5px] font-medium",
            active ? "text-ink" : "text-faint",
          )}
        >
          {title}
        </p>
        {detail && (
          <p
            className={cn(
              "truncate font-mono text-[11px] tabular-nums",
              tone === "accent" ? "text-accent" : "text-ink-2",
            )}
          >
            {detail}
          </p>
        )}
        {hint && (
          <p className="truncate font-mono text-[11px] font-medium text-ok">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}

function FlowArrow() {
  return (
    <div className="ml-[15px] flex h-3 w-6 items-center text-faint">
      <ArrowDown size={12} />
    </div>
  );
}

/** Linha de utilização — checkbox grande com título e explicação. */
function UsoToggle({
  checked,
  onChange,
  icon,
  label,
  desc,
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  icon: React.ReactNode;
  label: string;
  desc: string;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex flex-1 cursor-pointer items-start gap-3 p-3.5 transition-colors",
        checked ? "bg-brand-soft/50" : "hover:bg-surface-2",
        className,
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 cursor-pointer accent-[var(--brand)]"
      />
      <span
        className={cn(
          "mt-px shrink-0",
          checked ? "text-brand-strong" : "text-faint",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-medium text-ink">{label}</span>
        <span className="block text-xs text-muted">{desc}</span>
      </span>
    </label>
  );
}

function margemVerdict(pct: number | null): {
  label: string;
  tone: "ok" | "warn" | "danger";
} | null {
  if (pct === null) return null;
  if (pct < 0) return { label: "Margem negativa", tone: "danger" };
  if (pct < 15) return { label: "Margem baixa", tone: "warn" };
  if (pct < 35) return { label: "Margem boa", tone: "ok" };
  return { label: "Margem excelente", tone: "ok" };
}

// ── Formulário ─────────────────────────────────────────────

export function SimpleProductForm({
  mode,
  product,
  brands,
  categories,
  subcategories,
  storage,
  suppliers,
  fiscalProfiles,
  defaultEstoqueMinimo,
  policy = POLICY_PADRAO,
  prefill,
}: {
  mode: "new" | "edit";
  product?: ProductRow | null;
  brands: BrandOpt[];
  categories: CategoryOpt[];
  subcategories: SubcategoryOpt[];
  storage: StorageOpt[];
  suppliers: SupplierPickerOpt[];
  fiscalProfiles: FiscalOpt[];
  defaultEstoqueMinimo?: number;
  /** Estratégia de controle da empresa — decide quais metas aparecem. */
  policy?: EstoquePolicy;
  /** Veio da revisão do catálogo de um fornecedor (encarte/tabela importada
   * sem vínculo). Só faz sentido com `mode: "new"`. */
  prefill?: ProductPrefill;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState<string>();
  const nomeRef = useRef<HTMLInputElement>(null);
  const savedRef = useRef(false);
  // Item do fornecedor pendente de vínculo — a primeira gravação herda,
  // "salvar e cadastrar próximo" depois disso já é produto sem origem.
  const [itemParaVincular, setItemParaVincular] = useState(prefill?.itemId ?? null);

  // Identidade
  const [ean, setEan] = useState(product?.ean ?? prefill?.ean ?? "");
  const [nome, setNome] = useState(product?.nome ?? prefill?.nome ?? "");
  const [sku, setSku] = useState(product?.sku ?? "");
  const [marca, setMarca] = useState(product?.marca ?? prefill?.marca ?? "");
  const [subcategoryId, setSubcategoryId] = useState(
    product?.subcategoryId ?? prefill?.subcategoryIdSugerido ?? "",
  );
  const [imagemUrl, setImagemUrl] = useState(product?.imagemUrl ?? "");
  const imgFileRef = useRef<HTMLInputElement>(null);
  const [showImgUrl, setShowImgUrl] = useState(false);
  // SKU some atrás de um link — 95% do cadastro nunca mexe (gera sozinho ao salvar).
  const [showSku, setShowSku] = useState(mode === "edit" || !!product?.sku);
  const [eanTaken, setEanTaken] = useState<{
    id?: string;
    nome: string;
    sku: string;
  } | null>(null);
  const [eanShake, setEanShake] = useState(false);
  const [nomeSimilar, setNomeSimilar] = useState<{
    id: string;
    nome: string;
    sku: string;
  } | null>(null);
  const [nomeSimilarDismiss, setNomeSimilarDismiss] = useState(false);
  /** Campos que o operador já visitou — habilita o aviso inline no blur. */
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const touch = (k: string) => setTouched((t) => ({ ...t, [k]: true }));

  // Só depois de identificar o produto o resto da tela aparece — prefill do
  // encarte já identifica, então pula direto pro resto.
  const [revealed, setRevealed] = useState(mode === "edit" || !!prefill);
  const [naoEncontrado, setNaoEncontrado] = useState(false);
  const [foundCard, setFoundCard] = useState<{
    nome: string;
    marca: string;
    categoria: string;
    imagem: string;
    ean: string;
    viaIa: boolean;
  } | null>(null);

  // Preço
  const [precoVenda, setPrecoVenda] = useState(moneyToMask(product?.precoVenda));
  const [custo, setCusto] = useState(moneyToMask(product?.custo ?? prefill?.custo));

  // Compra
  const [compraMode, setCompraMode] = useState<CompraMode | null>(
    product?.packagings?.[0]?.nome ?? (mode === "edit" ? "UN" : null),
  );
  const [pkEan, setPkEan] = useState(product?.packagings?.[0]?.ean ?? "");
  const [pkFator, setPkFator] = useState(
    product?.packagings?.[0]?.fatorConversao?.toString() ?? "",
  );
  const [extraPk, setExtraPk] = useState<PackagingRow[]>(
    (product?.packagings ?? []).slice(1).map((p) => ({
      nome: p.nome ?? "",
      ean: p.ean ?? "",
      fatorConversao: p.fatorConversao?.toString() ?? "",
    })),
  );
  const [fornecedoresList, setFornecedoresList] = useState<string[]>(
    product?.fornecedores?.length
      ? [...product.fornecedores]
          .sort((a, b) => Number(b.isPrincipal) - Number(a.isPrincipal))
          .map((f) => f.id)
      : product?.fornecedorPrincipalId
        ? [product.fornecedorPrincipalId]
        : [],
  );
  const [showFornecedor, setShowFornecedor] = useState(
    !!product?.fornecedorPrincipalId,
  );
  const addFornecedor = (id: string) =>
    setFornecedoresList((prev) => (prev.includes(id) ? prev : [...prev, id]));
  const removeFornecedor = (id: string) =>
    setFornecedoresList((prev) => prev.filter((fid) => fid !== id));

  // Utilização — as duas convivem: vende a unidade no caixa E rende dose.
  const [vendaUnidade, setVendaUnidade] = useState(product?.vendaUnidade ?? true);
  const [usaEmDrinks, setUsaEmDrinks] = useState(product?.fracionavel ?? false);
  const [unidadeBase, setUnidadeBase] = useState<"UN" | "ML" | "G">(
    product?.unidadeBase ?? "UN",
  );
  const [conteudo, setConteudo] = useState(
    product?.conteudoPorUnidade?.toString() ?? "",
  );
  const [dosePadrao, setDosePadrao] = useState(
    product?.dosePadrao?.toString() ?? "",
  );

  // Estoque
  const [estoqueMinimo, setMin] = useState(
    product != null
      ? String(Math.trunc(product.estoque.minimo))
      : defaultEstoqueMinimo
        ? String(Math.trunc(defaultEstoqueMinimo))
        : "",
  );
  const [estoqueIdeal, setIdeal] = useState(
    product != null ? String(Math.trunc(product.estoque.ideal)) : "",
  );
  const [locationId, setLocation] = useState(product?.estoque.locationId ?? "");
  const [querInicial, setQuerInicial] = useState<boolean | null>(null);
  const [estoqueInicial, setInicial] = useState("");

  // Fiscal
  const [fiscalProfileId, setFiscal] = useState(product?.fiscalProfileId ?? "");
  const [restricaoIdade, setIdade] = useState(product?.restricaoIdade ?? false);
  const [gtinTrib, setGtinTrib] = useState(product?.gtinTributavel ?? "");
  const [uTrib, setUTrib] = useState(product?.unidadeTributavel ?? "");
  const [fatorTrib, setFatorTrib] = useState(
    product?.fatorConversaoTrib != null ? String(product.fatorConversaoTrib) : "",
  );
  const [codigoAnp, setCodigoAnp] = useState(product?.codigoAnp ?? "");

  // Online
  const [vendeOnline, setVendeOnline] = useState(product?.vendeOnline ?? false);
  const [pesoGramas, setPeso] = useState(product?.pesoGramas?.toString() ?? "");
  const [alturaCm, setAltura] = useState(product?.alturaCm?.toString() ?? "");
  const [larguraCm, setLargura] = useState(product?.larguraCm?.toString() ?? "");
  const [comprimentoCm, setComprimento] = useState(
    product?.comprimentoCm?.toString() ?? "",
  );
  const [descricaoOnline, setDescOnline] = useState(
    product?.descricaoOnline ?? "",
  );
  const [gerandoDesc, setGerandoDesc] = useState(false);
  const [descErro, setDescErro] = useState<string>();
  const [channels, setChannels] = useState<ChannelRow[]>(
    initChannels(product?.salesChannels),
  );
  const setChannel = (canal: SalesChannel, patch: Partial<ChannelRow>) =>
    setChannels((prev) =>
      prev.map((r) => (r.canal === canal ? { ...r, ...patch } : r)),
    );

  // Categorias/subcategorias criadas aqui — entram na lista antes do refresh.
  const [extraCats, setExtraCats] = useState<CategoryOpt[]>([]);
  const [extraSubs, setExtraSubs] = useState<SubcategoryOpt[]>([]);
  const [criandoSub, setCriandoSub] = useState(false);

  const allCats = useMemo(
    () =>
      [...categories, ...extraCats].filter(
        (c, i, arr) => arr.findIndex((x) => x.id === c.id) === i,
      ),
    [categories, extraCats],
  );
  const allSubs = useMemo(
    () =>
      [...subcategories, ...extraSubs].filter(
        (s, i, arr) => arr.findIndex((x) => x.id === s.id) === i,
      ),
    [subcategories, extraSubs],
  );

  const subOptions: ComboOption[] = useMemo(
    () =>
      [...allSubs]
        .sort((a, b) =>
          a.categoriaNome === b.categoriaNome
            ? a.nome.localeCompare(b.nome, "pt-BR")
            : a.categoriaNome.localeCompare(b.categoriaNome, "pt-BR"),
        )
        .map((s) => ({ value: s.id, label: s.nome, group: s.categoriaNome })),
    [allSubs],
  );
  const brandOptions: ComboOption[] = useMemo(
    () => brands.map((b) => ({ value: b.nome, label: b.nome })),
    [brands],
  );
  const compraOpcoes = useMemo(() => {
    const custom =
      compraMode &&
      compraMode !== "UN" &&
      !COMPRA_OPCOES.some((o) => o.key === compraMode)
        ? [{ key: compraMode, label: compraMode, icon: <Box size={18} /> }]
        : [];
    return [...COMPRA_OPCOES, ...custom];
  }, [compraMode]);

  // ── Derivados ───────────────────────────────────────────
  const margemPct = margem(parseMoney(precoVenda), parseMoney(custo));
  const verdict = margemVerdict(margemPct);
  const precoNum = parseMoney(precoVenda) ?? 0;
  const custoNum = parseMoney(custo) ?? 0;
  const medida = unidadeBase === "G" ? "g" : "ml";
  const conteudoNum = n(conteudo);
  const doseNum = n(dosePadrao);
  const fatorNum = n(pkFator);
  const porcaoLabel = unidadeBase === "G" ? "porções" : "doses";
  // Rendimento em tempo real: quantas doses saem de uma unidade fechada.
  const doses =
    usaEmDrinks && (conteudoNum ?? 0) > 0 && (doseNum ?? 0) > 0
      ? Math.floor(conteudoNum! / doseNum!)
      : null;
  const subAtual = allSubs.find((s) => s.id === subcategoryId);
  const selectedFiscal = fiscalProfiles.find((f) => f.id === fiscalProfileId);
  const compraLabel =
    compraMode && compraMode !== "UN" ? compraMode : "Unidade";

  const etapas = [
    {
      label: "produto",
      done: nome.trim().length >= 2 && !!subcategoryId,
      focus: "nome",
    },
    { label: "compra", done: compraMode !== null, focus: "compra" },
    {
      label: "utilização",
      done: vendaUnidade || usaEmDrinks,
      focus: "uso",
    },
    { label: "preço", done: (mode === "edit" || custoNum > 0) && precoNum > 0, focus: "custo" },
  ];
  const doneCnt = etapas.filter((e) => e.done).length;
  const isReady = doneCnt === etapas.length;
  const firstMissing = etapas.find((e) => !e.done);
  const margemAnimada = useCountUp(margemPct);

  // Campo obrigatório visitado e ainda vazio — aviso na hora, sem esperar o Salvar.
  const faltando = {
    nome: touched.nome && nome.trim().length < 2,
    sub: touched.sub && !subcategoryId,
    custo: mode === "new" && touched.custo && custoNum <= 0,
    preco: touched.preco && precoNum <= 0,
  };

  function n(v: string): number | null {
    const x = Number(String(v).replace(",", "."));
    return Number.isFinite(x) && v !== "" ? x : null;
  }

  /** Estoque se conta em unidade inteira — descarta vírgula e decimais. */
  function soInteiro(v: string): string {
    return v.replace(/\D/g, "");
  }

  function skuPreview(subId: string): string {
    const sub = allSubs.find((s) => s.id === subId);
    if (!sub) return "Gerado ao salvar";
    return `${sub.categorySkuPrefix}-${sub.skuPrefix}-••••`;
  }

  // O card de "produto encontrado" some sozinho — cumpriu o papel dele.
  useEffect(() => {
    if (!foundCard) return;
    const t = setTimeout(() => setFoundCard(null), FOUND_CARD_MS);
    return () => clearTimeout(t);
  }, [foundCard]);

  useEffect(() => {
    if (!eanShake) return;
    const t = setTimeout(() => setEanShake(false), 400);
    return () => clearTimeout(t);
  }, [eanShake]);

  // ── Teclado: Enter caminha pelo formulário ──────────────
  function focusById(id: string) {
    const el = document.getElementById(id) as HTMLElement | null;
    el?.focus();
  }
  /** Enter em campo simples pula pro próximo — cadastro sem tirar a mão do teclado. */
  function enterTo(nextId: string) {
    return (e: React.KeyboardEvent) => {
      if (e.key !== "Enter" || e.shiftKey) return;
      e.preventDefault();
      focusById(nextId);
    };
  }

  // ── Auto-scroll: etapa concluída chama a próxima ────────
  const prevDone = useRef<boolean[]>(etapas.map((e) => e.done));
  useEffect(() => {
    const atual = etapas.map((e) => e.done);
    const virou = atual.findIndex((d, i) => d && !prevDone.current[i]);
    prevDone.current = atual;
    if (virou < 0 || virou >= STEP_IDS.length - 1) return;
    // Nunca rolar enquanto o operador digita — só depois de clique/escolha.
    const ativo = document.activeElement?.tagName;
    if (ativo === "INPUT" || ativo === "TEXTAREA" || ativo === "SELECT") return;
    document
      .getElementById(STEP_IDS[virou + 1])
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etapas.map((e) => e.done).join()]);

  // ── Rascunho local: fechou a aba sem querer, não perde o que digitou ──
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    if (mode !== "new") return;
    // localStorage não existe no SSR — a leitura só pode acontecer aqui, e vai
    // num microtask para não escrever estado dentro do corpo do efeito.
    let vivo = true;
    Promise.resolve().then(() => {
      if (!vivo) return;
      try {
        const raw = localStorage.getItem(DRAFT_KEY);
        if (raw) setDraft(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        /* rascunho corrompido é rascunho descartado */
      }
    });
    return () => {
      vivo = false;
    };
  }, [mode]);

  const snapshot = {
    ean,
    nome,
    sku,
    marca,
    subcategoryId,
    imagemUrl,
    precoVenda,
    custo,
    compraMode,
    pkEan,
    pkFator,
    vendaUnidade,
    usaEmDrinks,
    unidadeBase,
    conteudo,
    dosePadrao,
    estoqueMinimo,
    estoqueIdeal,
    locationId,
    querInicial,
    estoqueInicial,
    restricaoIdade,
  };
  const snapshotKey = JSON.stringify(snapshot);
  useEffect(() => {
    if (mode !== "new") return;
    const parsed = JSON.parse(snapshotKey) as typeof snapshot;
    const vazio = !parsed.nome && !parsed.ean && !parsed.custo && !parsed.precoVenda;
    const t = setTimeout(() => {
      try {
        if (vazio) localStorage.removeItem(DRAFT_KEY);
        else localStorage.setItem(DRAFT_KEY, snapshotKey);
      } catch {
        /* storage cheio/bloqueado — rascunho é bônus, não bloqueia nada */
      }
    }, 600);
    return () => clearTimeout(t);
  }, [snapshotKey, mode]);

  function limparRascunho() {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* idem */
    }
    setDraft(null);
  }

  function retomarRascunho() {
    if (!draft) return;
    const d = draft as Partial<typeof snapshot>;
    setEan(d.ean ?? "");
    setNome(d.nome ?? "");
    setSku(d.sku ?? "");
    setShowSku(!!d.sku);
    setMarca(d.marca ?? "");
    setSubcategoryId(d.subcategoryId ?? "");
    setImagemUrl(d.imagemUrl ?? "");
    setPrecoVenda(d.precoVenda ?? "");
    setCusto(d.custo ?? "");
    setCompraMode(d.compraMode ?? null);
    setPkEan(d.pkEan ?? "");
    setPkFator(d.pkFator ?? "");
    setVendaUnidade(d.vendaUnidade ?? true);
    setUsaEmDrinks(d.usaEmDrinks ?? false);
    setUnidadeBase(d.unidadeBase ?? "UN");
    setConteudo(d.conteudo ?? "");
    setDosePadrao(d.dosePadrao ?? "");
    setMin(soInteiro(d.estoqueMinimo ?? ""));
    setIdeal(soInteiro(d.estoqueIdeal ?? ""));
    setLocation(d.locationId ?? "");
    setQuerInicial(d.querInicial ?? null);
    setInicial(soInteiro(d.estoqueInicial ?? ""));
    setIdade(d.restricaoIdade ?? false);
    setRevealed(true);
    setDraft(null);
    toast.success("Cadastro retomado", "Continue de onde parou.");
  }

  // ── Duplicata semântica: nome+marca parecido, não só EAN idêntico ──
  useEffect(() => {
    let vivo = true;
    const nomeOk = nome.trim().length >= 3;
    const t = setTimeout(
      () => {
        if (!vivo) return;
        if (!nomeOk) return setNomeSimilar(null);
        setNomeSimilarDismiss(false);
        checkNomeSimilar({
          nome,
          marcaNome: marca || undefined,
          subcategoryId: subcategoryId || undefined,
          excludeId: product?.id,
        })
          .then((r) => vivo && setNomeSimilar(r))
          .catch(() => vivo && setNomeSimilar(null));
      },
      nomeOk ? 500 : 0,
    );
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [nome, marca, subcategoryId, product?.id]);

  // ── Preço sugerido: margem mediana praticada na subcategoria ──
  const [sugestao, setSugestao] = useState<{
    margemPct: number;
    base: number;
  } | null>(null);
  useEffect(() => {
    let vivo = true;
    if (!subcategoryId) {
      Promise.resolve().then(() => vivo && setSugestao(null));
      return () => {
        vivo = false;
      };
    }
    sugerirMargemSubcategoria(subcategoryId)
      .then((r) => vivo && setSugestao(r))
      .catch(() => vivo && setSugestao(null));
    return () => {
      vivo = false;
    };
  }, [subcategoryId]);

  // Preço que zera a diferença para a margem mediana da subcategoria.
  const precoSugerido =
    sugestao && custoNum > 0 && sugestao.margemPct < 100
      ? custoNum / (1 - sugestao.margemPct / 100)
      : null;

  // ── Ações ───────────────────────────────────────────────
  async function buscarEan(codigoRaw?: string) {
    const codigo = codigoRaw ?? ean;
    if (onlyDigits(codigo).length < 8) {
      setEanShake(true);
      toast.error(
        "Código de barras inválido",
        "Escaneie de novo ou digite ao menos 8 dígitos.",
      );
      return;
    }
    setError(undefined);
    setNaoEncontrado(false);
    setEnriching(true);
    try {
      const s = await enrichEan(codigo);
      if (!s.encontrado) {
        switch (s.motivo) {
          case "invalido":
            toast.error("Código de barras inválido", s.erro);
            break;
          case "ja_cadastrado":
            toast.error("Código já cadastrado", s.erro);
            break;
          case "rate_limit":
            toast.error(
              "Limite de consultas atingido",
              "Tente mais tarde ou preencha à mão.",
            );
            break;
          case "sem_token":
            toast.error(
              "Busca indisponível",
              "Serviço de código de barras sem token. Preencha à mão.",
            );
            break;
          default:
            break;
        }
        setNaoEncontrado(s.motivo === "nao_encontrado" || !s.motivo);
        setRevealed(true);
        requestAnimationFrame(() => nomeRef.current?.focus());
      } else {
        if (s.nome) setNome(s.nome);
        if (s.marcaNome) setMarca(s.marcaNome);
        if (s.subcategoryId) setSubcategoryId(s.subcategoryId);
        if (s.imagemUrl) setImagemUrl(s.imagemUrl);
        if (s.pesoGramas) setPeso(String(s.pesoGramas));
        if (s.restricaoIdade) setIdade(true);
        const cat = s.subcategoryId
          ? allSubs.find((x) => x.id === s.subcategoryId)
          : undefined;
        setFoundCard({
          nome: s.nome ?? "",
          marca: s.marcaNome ?? "",
          categoria: cat ? `${cat.categoriaNome} · ${cat.nome}` : "",
          imagem: s.imagemUrl ?? "",
          ean: codigo,
          viaIa: s.fonte === "cosmos+llm",
        });
        setRevealed(true);
        toast.success("Produto encontrado", "Confira e siga o cadastro.");
      }
    } catch {
      setError("Não foi possível buscar agora.");
      toast.error(
        "Erro ao pesquisar",
        "Não foi possível buscar agora. Tente novamente.",
      );
    } finally {
      setEnriching(false);
    }
  }

  /**
   * Pistola de código de barras despeja os dígitos em rajada (~10 ms entre
   * teclas) e nem toda envia Enter no fim. Detecta a rajada e busca sozinho —
   * digitação humana (>60 ms por tecla) não dispara nada.
   */
  const scan = useRef({ inicio: 0, ultima: 0, timer: 0 });
  function onEanChange(v: string) {
    setEan(v);
    if (eanTaken) setEanTaken(null);

    const agora = performance.now();
    const st = scan.current;
    if (!st.ultima || agora - st.ultima > 300) st.inicio = agora;
    st.ultima = agora;
    if (st.timer) window.clearTimeout(st.timer);

    const digitos = onlyDigits(v);
    const emRajada = agora - st.inicio < 600 && digitos.length >= 8;
    if (!emRajada || enriching) return;
    st.timer = window.setTimeout(() => buscarEan(v), 150);
  }

  async function onEanBlur() {
    if (onlyDigits(ean).length < 8) return setEanTaken(null);
    try {
      const r = await checkEanTaken(ean);
      setEanTaken(
        r.taken ? { id: r.id, nome: r.nome!, sku: r.sku! } : null,
      );
    } catch {
      /* silencioso — não bloqueia o cadastro */
    }
  }

  async function gerarDescricaoOnline() {
    setDescErro(undefined);
    setGerandoDesc(true);
    try {
      const texto = await sugerirDescricaoOnline({
        nome,
        marcaNome: marca || undefined,
        categoriaNome: subAtual?.nome,
      });
      setDescOnline(texto);
    } catch (e) {
      setDescErro(
        e instanceof Error ? e.message : "Não foi possível gerar agora.",
      );
    } finally {
      setGerandoDesc(false);
    }
  }

  async function criarSubcategoria(nomeSub: string, categoryId: string) {
    setCriandoSub(true);
    try {
      let catId = categoryId;
      let catNome = allCats.find((c) => c.id === catId)?.nome ?? "";
      if (catId === "__new") {
        const cat = await createCategory(nomeSub);
        catId = cat.id;
        catNome = cat.nome;
        setExtraCats((prev) => [...prev, { id: cat.id, nome: cat.nome }]);
      }
      const id = await createSubcategory({ categoryId: catId, nome: nomeSub });
      setExtraSubs((prev) => [
        ...prev,
        {
          id,
          nome: nomeSub,
          categoriaNome: catNome,
          skuPrefix: "",
          categorySkuPrefix: "",
          defaultStorageType: null,
          defaultFiscalProfileId: null,
        },
      ]);
      setSubcategoryId(id);
      router.refresh();
    } catch (e) {
      toast.error(
        "Não deu para criar",
        e instanceof Error ? e.message : "Tente de novo.",
      );
    } finally {
      setCriandoSub(false);
    }
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

  /** Lê "330ml", "1L", "500g", "1kg" do nome — poupa uma digitação. */
  function inferConteudo(
    nomeProduto: string,
  ): { valor: string; unidade: "ML" | "G" } | null {
    const m = nomeProduto.match(/(\d+(?:[.,]\d+)?)\s*(ml|l|g|kg)\b/i);
    if (!m) return null;
    const raw = parseFloat(m[1].replace(",", "."));
    const unit = m[2].toLowerCase();
    if (unit === "ml") return { valor: String(raw), unidade: "ML" };
    if (unit === "l") return { valor: String(raw * 1000), unidade: "ML" };
    if (unit === "g") return { valor: String(raw), unidade: "G" };
    if (unit === "kg") return { valor: String(raw * 1000), unidade: "G" };
    return null;
  }

  function focusField(id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    (el as HTMLElement).focus?.({ preventScroll: true });
  }

  function resetForNext() {
    setEan("");
    setNome("");
    setSku("");
    setMarca("");
    setPrecoVenda("");
    setCusto("");
    setImagemUrl("");
    setShowImgUrl(false);
    setShowSku(false);
    setNomeSimilar(null);
    setNomeSimilarDismiss(false);
    setCompraMode(null);
    setPkEan("");
    setPkFator("");
    setExtraPk([]);
    setVendaUnidade(true);
    setUsaEmDrinks(false);
    setUnidadeBase("UN");
    setConteudo("");
    setDosePadrao("");
    setQuerInicial(null);
    setInicial("");
    setEanTaken(null);
    setFoundCard(null);
    setNaoEncontrado(false);
    setRevealed(false);
    setError(undefined);
  }

  function salvar(andNew = false) {
    setError(undefined);
    if (nome.trim().length < 2) {
      setError("Informe o nome do produto.");
      focusField("nome");
      return;
    }
    if (!subcategoryId) {
      setError("Escolha a categoria do produto.");
      focusField("sub");
      return;
    }
    if (!vendaUnidade && !usaEmDrinks) {
      toast.error(
        "Utilização não definida",
        "Marque venda por unidade, uso em drinks e receitas, ou os dois.",
      );
      setError("Escolha ao menos uma utilização do produto.");
      focusField("uso");
      return;
    }
    if (mode === "new" && !parseMoney(custo)) {
      toast.error("Custo obrigatório", "Informe o preço de custo antes de salvar.");
      setError("Informe o preço de custo.");
      focusField("custo");
      return;
    }
    if (!parseMoney(precoVenda)) {
      toast.error(
        "Preço obrigatório",
        "Informe o preço de venda antes de salvar.",
      );
      setError("Informe o preço de venda.");
      focusField("preco");
      return;
    }

    let salesChannels;
    try {
      salesChannels = vendeOnline ? channelsToInput(channels) : [];
    } catch (e) {
      return setError(
        e instanceof Error ? e.message : "Canal online sem preço.",
      );
    }

    const packagings = [
      ...(compraMode && compraMode !== "UN" && (fatorNum ?? 0) > 0
        ? [
            {
              nome: compraMode,
              ean: pkEan.trim() || undefined,
              fatorConversao: fatorNum!,
            },
          ]
        : []),
      ...extraPk
        .filter((p) => p.nome.trim() && (n(p.fatorConversao) ?? 0) > 0)
        .map((p) => ({
          nome: p.nome.trim(),
          ean: p.ean.trim() || undefined,
          fatorConversao: n(p.fatorConversao)!,
        })),
    ];

    const input = {
      tipo: "SIMPLES" as const,
      sku: sku.trim() || undefined,
      ean: ean || undefined,
      nome,
      subcategoryId,
      marcaNome: marca || undefined,
      brandId:
        product?.brandId && product.marca === marca ? product.brandId : undefined,
      imagemUrl: imagemUrl || undefined,
      unidadeBase: usaEmDrinks ? unidadeBase : ("UN" as const),
      vendaUnidade,
      fracionavel: usaEmDrinks,
      conteudoPorUnidade: usaEmDrinks ? conteudoNum : null,
      dosePadrao: usaEmDrinks ? doseNum : null,
      precoVenda: parseMoney(precoVenda),
      custo: parseMoney(custo),
      fiscalProfileId: fiscalProfileId || undefined,
      restricaoIdade,
      gtinTributavel: gtinTrib.trim() || undefined,
      unidadeTributavel: uTrib.trim().toUpperCase() || undefined,
      fatorConversaoTrib: n(fatorTrib) ?? undefined,
      codigoAnp: codigoAnp.trim() || undefined,
      controlaEstoque: true,
      // Trunca também aqui: prefill (CSV/EAN) pode trazer decimal.
      estoqueMinimo: Math.trunc(n(estoqueMinimo) ?? 0),
      estoqueIdeal: Math.trunc(n(estoqueIdeal) ?? 0),
      estoqueInicial: querInicial ? Math.trunc(n(estoqueInicial) ?? 0) : 0,
      locationId: locationId || undefined,
      fornecedorPrincipalId: fornecedoresList[0] || undefined,
      fornecedoresIds: fornecedoresList,
      packagings,
      vendeOnline,
      pesoGramas: n(pesoGramas) ?? undefined,
      alturaCm: vendeOnline ? (n(alturaCm) ?? undefined) : undefined,
      larguraCm: vendeOnline ? (n(larguraCm) ?? undefined) : undefined,
      comprimentoCm: vendeOnline ? (n(comprimentoCm) ?? undefined) : undefined,
      descricaoOnline: descricaoOnline || undefined,
      salesChannels,
    };

    start(async () => {
      try {
        let created: { id: string; sku: string } | undefined;
        if (product) {
          await updateProduct(product.id, input);
        } else {
          created = await createProduct(input);
        }
        savedRef.current = true;
        limparRascunho();

        // Só a primeira gravação herda o vínculo com o item do fornecedor —
        // "salvar e cadastrar próximo" depois disso é produto sem origem.
        const itemId = itemParaVincular;
        if (itemId) setItemParaVincular(null);
        if (itemId && created) {
          try {
            await vincularItemAction(itemId, created.id);
          } catch {
            toast.error(
              "Produto criado, mas não vinculei ao item do fornecedor",
              "Vincule à mão na aba Catálogo do fornecedor.",
            );
          }
        }

        if (andNew && !product) {
          resetForNext();
          router.refresh();
          toast.success("Produto salvo", "Cadastre o próximo.");
          requestAnimationFrame(() => document.getElementById("ean")?.focus());
          return;
        }
        router.push(itemId && prefill ? `/fornecedores/${prefill.supplierId}/catalogo` : "/produtos");
        router.refresh();
      } catch (e) {
        savedRef.current = false;
        setError(e instanceof Error ? e.message : "Falha ao salvar.");
      }
    });
  }

  function onKeyDownForm(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      salvar();
      return;
    }
    // Alt+1..4 pula direto para a etapa.
    if (e.altKey && /^[1-4]$/.test(e.key)) {
      e.preventDefault();
      const alvo = document.getElementById(STEP_IDS[Number(e.key) - 1]);
      alvo?.scrollIntoView({ behavior: "smooth", block: "start" });
      focusById(etapas[Number(e.key) - 1].focus);
      return;
    }
    // Esc em dois tempos: primeiro solta o campo, depois sai da tela. Evita
    // perder o cadastro por um Esc reflexo no meio da digitação.
    if (e.key === "Escape") {
      const el = document.activeElement as HTMLElement | null;
      const digitando =
        el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
      if (digitando) {
        el.blur();
        return;
      }
      e.preventDefault();
      router.push("/produtos");
    }
  }

  const isDirty =
    mode === "new" &&
    (nome.trim() !== "" || ean !== "" || precoVenda !== "" || custo !== "");
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

  const title = mode === "edit" ? "Editar produto" : "Novo produto simples";

  return (
    <div className="flex flex-col gap-4" onKeyDown={onKeyDownForm}>
      <PageHeader
        backHref="/produtos"
        breadcrumbs={[{ label: "Produtos", href: "/produtos" }, { label: title }]}
        title={title}
        badge={
          mode === "edit" && product?.sku ? (
            <SkuTag sku={product.sku} />
          ) : undefined
        }
        innerClassName="max-w-none sm:px-8"
      />

      <input
        ref={imgFileRef}
        type="file"
        accept="image/*"
        onChange={onPickImage}
        className="hidden"
      />

      <div className="px-4 pb-28 sm:px-8">
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_324px]">
          {/* ── Coluna do assistente ── */}
          <div className="flex flex-col gap-4">
            {/* Cadastro veio da revisão do catálogo de um fornecedor — dados
                abaixo já saíram do encarte/tabela importada, só confirme. */}
            {itemParaVincular && prefill && (
              <div className="fade-up flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-brand/30 bg-brand-soft px-4 py-3">
                <Truck size={15} className="shrink-0 text-brand-strong" />
                <p className="min-w-0 flex-1 text-sm text-ink-2">
                  Cadastrando a partir do encarte de{" "}
                  <span className="font-medium text-ink">{prefill.supplierNome}</span> — confira os
                  dados antes de salvar.
                </p>
                <Link
                  href={`/fornecedores/${prefill.supplierId}/catalogo`}
                  className="shrink-0 text-[13px] font-medium text-brand-strong hover:underline"
                >
                  Cancelar e voltar
                </Link>
              </div>
            )}

            {/* Rascunho de um cadastro que ficou pelo caminho */}
            {draft && mode === "new" && (
              <div className="fade-up flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-info/30 bg-info-soft px-4 py-3">
                <RotateCcw size={15} className="shrink-0 text-info" />
                <p className="min-w-0 flex-1 text-sm text-ink-2">
                  Você tem um cadastro não finalizado
                  {typeof draft.nome === "string" && draft.nome ? (
                    <>
                      {": "}
                      <span className="font-medium text-ink">{draft.nome}</span>
                    </>
                  ) : (
                    "."
                  )}
                </p>
                <div className="flex shrink-0 items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={retomarRascunho}>
                    Retomar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={limparRascunho}>
                    Descartar
                  </Button>
                </div>
              </div>
            )}

            {/* 1 · Identificação */}
            {mode === "new" && (
              <section className="fade-up rounded-[var(--radius-lg)] border border-brand/25 bg-brand-soft p-5 shadow-[var(--shadow-1)] sm:p-6">
                <div className="flex items-center gap-2">
                  <ScanBarcode size={15} className="text-brand-strong" />
                  <Eyebrow className="text-brand-strong">Identificação</Eyebrow>
                </div>
                <h2 className="mt-2 font-display text-xl font-semibold leading-tight text-ink sm:text-2xl">
                  Comece pelo código de barras
                </h2>
                <p className="mt-1 max-w-lg text-sm text-ink-2">
                  Escaneie ou digite o EAN para buscar automaticamente as
                  informações do produto.
                </p>

                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <div className="relative flex-1">
                    <ScanBarcode
                      size={20}
                      aria-hidden
                      className={cn(
                        "pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 transition-colors",
                        enriching ? "text-brand-strong" : "text-muted",
                      )}
                    />
                    <Input
                      id="ean"
                      autoFocus
                      value={ean}
                      onChange={(e) => onEanChange(e.target.value)}
                      onBlur={onEanBlur}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        if (onlyDigits(ean).length >= 8) buscarEan();
                        else setEanShake(true);
                      }}
                      disabled={enriching}
                      aria-busy={enriching}
                      placeholder="Escaneie ou digite o EAN…"
                      inputMode="numeric"
                      className={cn(
                        "h-14 pl-12 font-mono text-lg tracking-wide placeholder:font-sans placeholder:text-base placeholder:font-normal placeholder:tracking-normal",
                        eanShake && "shake-x border-danger",
                      )}
                    />
                    {enriching && (
                      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[var(--radius)]">
                        <div className="scan-line absolute inset-y-1 w-1/3 bg-gradient-to-r from-transparent via-brand/25 to-transparent" />
                      </div>
                    )}
                  </div>
                  <Button
                    type="button"
                    onClick={() => buscarEan()}
                    disabled={enriching || ean.length < 8}
                    className="h-14 shrink-0 gap-2 px-6 text-base"
                  >
                    {enriching ? (
                      <Loader2 size={17} className="animate-spin" />
                    ) : (
                      <ScanBarcode size={17} />
                    )}
                    {enriching ? "Buscando…" : "Buscar dados"}
                  </Button>
                </div>

                {eanTaken && (
                  <div className="fade-up mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-sm)] border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-warn">
                    <AlertCircle size={13} className="shrink-0" />
                    <span className="min-w-0 flex-1">
                      Já existe um produto com esse código:{" "}
                      <span className="font-medium">{eanTaken.nome}</span> (
                      {eanTaken.sku}).
                    </span>
                    {eanTaken.id && (
                      <Link
                        href={`/produtos/${eanTaken.id}/editar`}
                        className="flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] border border-warn/40 px-2 py-1 font-medium transition-colors hover:bg-warn/10"
                      >
                        <Pencil size={11} /> Editar o existente
                      </Link>
                    )}
                  </div>
                )}

                {foundCard && (
                  <div className="fade-up relative mt-3 flex items-start gap-3 overflow-hidden rounded-[var(--radius)] border border-ok/30 bg-surface p-3">
                    {foundCard.imagem ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={foundCard.imagem}
                        alt=""
                        className="h-14 w-14 shrink-0 rounded-[var(--radius-sm)] border border-line bg-white object-contain"
                      />
                    ) : (
                      <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-line text-faint">
                        <ImageOff size={18} />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-ok">
                        <CheckCircle2 size={13} /> Produto encontrado
                      </p>
                      <p className="truncate text-sm font-medium text-ink">
                        {foundCard.nome}
                      </p>
                      <p className="truncate text-xs text-muted">
                        {[foundCard.marca, foundCard.categoria]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      <p className="truncate font-mono text-[11px] text-faint">
                        {foundCard.ean}
                      </p>
                      <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted">
                        {foundCard.viaIa && (
                          <Sparkles size={11} className="text-brand-strong" />
                        )}
                        Essas informações foram preenchidas automaticamente.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setFoundCard(null)}
                      className="shrink-0 text-faint hover:text-ink"
                      aria-label="Fechar"
                    >
                      <X size={14} />
                    </button>
                    {/* Fio de tempo — mostra que o card vai sumir sozinho */}
                    <span
                      aria-hidden
                      className="countdown-bar absolute bottom-0 left-0 h-0.5 w-full bg-ok/40"
                      style={{ animationDuration: `${FOUND_CARD_MS}ms` }}
                    />
                  </div>
                )}

                {naoEncontrado && !foundCard && (
                  <p className="mt-3 text-sm text-ink-2">
                    Produto não encontrado. Continue preenchendo manualmente.
                  </p>
                )}

                {!revealed && (
                  <button
                    type="button"
                    onClick={() => {
                      setRevealed(true);
                      requestAnimationFrame(() => nomeRef.current?.focus());
                    }}
                    className="mt-3 text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
                  >
                    Não tem código de barras? Preencher manualmente
                  </button>
                )}
              </section>
            )}

            {revealed && (
              <>
                {/* 2 · Informações principais */}
                <Step
                  n={1}
                  id={STEP_IDS[0]}
                  question="Informações principais"
                  hint="O básico para o produto existir no sistema."
                  done={etapas[0].done}
                >
                  <div className="flex items-end gap-3">
                    <ImageThumb
                      imagemUrl={imagemUrl}
                      onPick={() => imgFileRef.current?.click()}
                      onClear={() => setImagemUrl("")}
                    />
                    <Field
                      label="Nome do produto"
                      htmlFor="nome"
                      required
                      className="min-w-0 flex-1"
                    >
                      <Input
                        id="nome"
                        ref={nomeRef}
                        value={nome}
                        onChange={(e) => setNome(e.target.value)}
                        onBlur={() => touch("nome")}
                        onKeyDown={enterTo("marca")}
                        placeholder="Ex.: Heineken Long Neck 330ml"
                        className={cn(
                          "text-[15px] font-medium placeholder:text-sm placeholder:font-normal",
                          faltando.nome && "border-warn",
                        )}
                      />
                    </Field>
                  </div>

                  {nomeSimilar && !nomeSimilarDismiss && (
                    <div className="fade-up flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-sm)] border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-warn">
                      <AlertCircle size={13} className="shrink-0" />
                      <span className="min-w-0 flex-1">
                        Já existe um produto parecido:{" "}
                        <span className="font-medium">{nomeSimilar.nome}</span>{" "}
                        ({nomeSimilar.sku}).
                      </span>
                      <Link
                        href={`/produtos/${nomeSimilar.id}/editar`}
                        className="flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] border border-warn/40 px-2 py-1 font-medium transition-colors hover:bg-warn/10"
                      >
                        <Pencil size={11} /> Ver produto
                      </Link>
                      <button
                        type="button"
                        onClick={() => setNomeSimilarDismiss(true)}
                        className="shrink-0 text-faint hover:text-ink"
                        aria-label="É um produto diferente, continuar"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  )}

                  {showImgUrl ? (
                    <Field label="URL da imagem" htmlFor="img-url">
                      <Input
                        id="img-url"
                        value={imagemUrl.startsWith("data:") ? "" : imagemUrl}
                        onChange={(e) => setImagemUrl(e.target.value)}
                        placeholder="https://…"
                        inputMode="url"
                        className="font-mono text-xs placeholder:font-sans placeholder:text-sm"
                      />
                    </Field>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowImgUrl(true)}
                      className="flex items-center gap-1 self-start text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
                    >
                      <ImagePlus size={12} /> Colar URL de imagem
                    </button>
                  )}

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <Field label="Marca" htmlFor="marca">
                      <Combobox
                        id="marca"
                        value={marca}
                        onChange={setMarca}
                        options={brandOptions}
                        placeholder="Ex.: Heineken"
                        freeText
                        onCommit={() => focusById("sub")}
                        onCreate={(q) => setMarca(q)}
                        createLabel={(q) => `Criar “${q}”`}
                      />
                    </Field>

                    <Field
                      label="Categoria"
                      htmlFor="sub"
                      required
                      error={faltando.sub ? "Escolha a categoria." : undefined}
                    >
                      <div onBlur={() => touch("sub")}>
                      <Combobox
                        id="sub"
                        value={subcategoryId}
                        onChange={setSubcategoryId}
                        options={subOptions}
                        placeholder="Busque ou crie…"
                        emptyText="Nenhuma categoria com esse nome."
                        onCommit={() => focusById("custo")}
                        renderCreate={(q, close) => (
                          <CriarSubcategoria
                            nome={q}
                            categories={allCats}
                            saving={criandoSub}
                            onCreate={async (catId) => {
                              await criarSubcategoria(q, catId);
                              close();
                            }}
                          />
                        )}
                      />
                      </div>
                    </Field>

                    <Field
                      label="SKU"
                      htmlFor="sku"
                      hint={showSku ? "Vazio = gerado ao salvar." : undefined}
                    >
                      {showSku ? (
                        <Input
                          id="sku"
                          autoFocus
                          value={sku}
                          onChange={(e) => setSku(e.target.value.toUpperCase())}
                          placeholder={skuPreview(subcategoryId)}
                          className="font-mono placeholder:font-sans placeholder:font-normal placeholder:tracking-normal"
                        />
                      ) : (
                        <button
                          type="button"
                          id="sku"
                          onClick={() => setShowSku(true)}
                          className="flex h-11 w-full items-center gap-1.5 rounded-[var(--radius)] border border-dashed border-line-strong px-4 text-sm text-muted transition-colors hover:border-brand/40 hover:text-ink"
                        >
                          <Pencil size={12} /> Personalizar SKU
                        </button>
                      )}
                    </Field>
                  </div>

                  {mode === "edit" && (
                    <Field label="Código de barras (EAN)" htmlFor="ean-edit">
                      <Input
                        id="ean-edit"
                        value={ean}
                        onChange={(e) => setEan(e.target.value)}
                        onBlur={onEanBlur}
                        placeholder="7891000315507"
                        inputMode="numeric"
                        className="font-mono placeholder:font-sans"
                      />
                    </Field>
                  )}
                </Step>

                {/* 3 · Compra */}
                <Step
                  n={2}
                  id={STEP_IDS[1]}
                  delay={60}
                  question="Como você compra este produto?"
                  hint="Se comprar em embalagem fechada, o sistema converte para unidades na entrada."
                  done={etapas[1].done}
                >
                  <div id="compra" className="flex flex-wrap gap-2">
                    {compraOpcoes.map((o) => (
                      <Choice
                        key={o.key}
                        selected={compraMode === o.key}
                        onClick={() => {
                          setCompraMode(o.key);
                          if (o.key !== "UN")
                            requestAnimationFrame(() => focusById("pk-fator"));
                        }}
                        icon={o.icon}
                        label={o.label}
                      />
                    ))}
                  </div>

                  <Collapse open={!!compraMode && compraMode !== "UN"}>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <Field
                        label={`Quantidade de unidades por ${(compraMode ?? "").toLowerCase()}`}
                        htmlFor="pk-fator"
                        required
                      >
                        <Input
                          id="pk-fator"
                          value={pkFator}
                          onChange={(e) => setPkFator(e.target.value)}
                          onKeyDown={enterTo("pk-ean")}
                          placeholder="12"
                          inputMode="numeric"
                          className="font-mono"
                        />
                      </Field>
                      <Field
                        label="Código de barras da embalagem"
                        htmlFor="pk-ean"
                        hint="Opcional — o EAN impresso na caixa/fardo."
                      >
                        <Input
                          id="pk-ean"
                          value={pkEan}
                          onChange={(e) => setPkEan(e.target.value)}
                          placeholder="789…"
                          inputMode="numeric"
                          className="font-mono placeholder:font-sans"
                        />
                      </Field>
                    </div>
                  </Collapse>

                  {extraPk.map((p, i) => (
                    <div
                      key={i}
                      className="grid grid-cols-[2fr_1fr_2fr_auto] items-end gap-3"
                    >
                      <Field label="Outra embalagem" htmlFor={`epk-nome-${i}`}>
                        <Input
                          id={`epk-nome-${i}`}
                          value={p.nome}
                          onChange={(e) =>
                            setExtraPk((prev) =>
                              prev.map((x, idx) =>
                                idx === i ? { ...x, nome: e.target.value } : x,
                              ),
                            )
                          }
                          placeholder="Ex.: Fardo"
                        />
                      </Field>
                      <Field label="Unidades" htmlFor={`epk-fator-${i}`}>
                        <Input
                          id={`epk-fator-${i}`}
                          value={p.fatorConversao}
                          onChange={(e) =>
                            setExtraPk((prev) =>
                              prev.map((x, idx) =>
                                idx === i
                                  ? { ...x, fatorConversao: e.target.value }
                                  : x,
                              ),
                            )
                          }
                          placeholder="6"
                          inputMode="numeric"
                          className="font-mono"
                        />
                      </Field>
                      <Field label="EAN" htmlFor={`epk-ean-${i}`}>
                        <Input
                          id={`epk-ean-${i}`}
                          value={p.ean}
                          onChange={(e) =>
                            setExtraPk((prev) =>
                              prev.map((x, idx) =>
                                idx === i ? { ...x, ean: e.target.value } : x,
                              ),
                            )
                          }
                          placeholder="789…"
                          inputMode="numeric"
                          className="font-mono placeholder:font-sans"
                        />
                      </Field>
                      <button
                        type="button"
                        onClick={() =>
                          setExtraPk((prev) => prev.filter((_, idx) => idx !== i))
                        }
                        className="mb-1.5 grid h-9 w-9 place-items-center rounded-[var(--radius-sm)] border border-line text-faint transition-colors hover:border-danger/40 hover:bg-danger-soft hover:text-danger"
                        aria-label="Remover embalagem"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}

                  <div className="flex flex-wrap items-center gap-4">
                    {compraMode && compraMode !== "UN" && (fatorNum ?? 0) > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          setExtraPk((prev) => [
                            ...prev,
                            { nome: "", ean: "", fatorConversao: "" },
                          ])
                        }
                        className="flex items-center gap-1 text-xs font-medium text-brand-strong hover:text-brand"
                      >
                        <Plus size={13} /> Outra embalagem
                      </button>
                    )}
                    {!showFornecedor && suppliers.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowFornecedor(true)}
                        className="flex items-center gap-1 text-xs font-medium text-muted hover:text-ink"
                      >
                        <Truck size={13} /> Definir fornecedor
                      </button>
                    )}
                  </div>

                  {showFornecedor && (
                    <div className="flex flex-col gap-2">
                      <Label>Fornecedores</Label>
                      {fornecedoresList.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {fornecedoresList.map((id, i) => {
                            const sup = suppliers.find((s) => s.id === id);
                            return (
                              <div
                                key={id}
                                className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-ink-2"
                              >
                                {i === 0 && (
                                  <span className="rounded-full bg-brand-soft px-1.5 py-0.5 font-mono text-[9px] font-semibold text-brand-strong">
                                    principal
                                  </span>
                                )}
                                {sup?.nomeFantasia || sup?.razaoSocial}
                                <button
                                  type="button"
                                  onClick={() => removeFornecedor(id)}
                                  className="text-faint hover:text-danger"
                                  aria-label="Remover fornecedor"
                                >
                                  <X size={11} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {suppliers.filter((s) => !fornecedoresList.includes(s.id))
                        .length > 0 ? (
                        <Select
                          value=""
                          onChange={(e) => {
                            if (e.target.value) addFornecedor(e.target.value);
                          }}
                        >
                          <option value="">Adicionar fornecedor…</option>
                          {suppliers
                            .filter((s) => !fornecedoresList.includes(s.id))
                            .map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.nomeFantasia || s.razaoSocial}
                              </option>
                            ))}
                        </Select>
                      ) : suppliers.length === 0 ? (
                        <p className="text-xs text-muted">
                          Nenhum fornecedor cadastrado ainda.
                        </p>
                      ) : null}
                    </div>
                  )}
                </Step>

                {/* 4 · Utilização */}
                <Step
                  n={3}
                  id={STEP_IDS[2]}
                  delay={120}
                  question="Utilização do produto"
                  hint="Informe como este produto poderá ser utilizado dentro do sistema."
                  done={etapas[2].done}
                >
                  <div
                    id="uso"
                    className="flex flex-col divide-y divide-line overflow-hidden rounded-[var(--radius)] border border-line-strong sm:flex-row sm:divide-x sm:divide-y-0"
                  >
                    <UsoToggle
                      checked={vendaUnidade}
                      onChange={setVendaUnidade}
                      icon={<Package size={16} />}
                      label="Venda por unidade (PDV)"
                      desc="O produto pode ser vendido normalmente no caixa."
                    />
                    <UsoToggle
                      checked={usaEmDrinks}
                      onChange={(v) => {
                        setUsaEmDrinks(v);
                        if (!v) return;
                        const inferred = inferConteudo(nome);
                        if (inferred && !conteudo) {
                          setConteudo(inferred.valor);
                          setUnidadeBase(inferred.unidade);
                        } else if (unidadeBase === "UN") {
                          setUnidadeBase("ML");
                        }
                        requestAnimationFrame(() => focusById("cont"));
                      }}
                      icon={<Wine size={16} />}
                      label="Utilizado em Drinks e Receitas"
                      desc="O produto poderá ser consumido parcialmente em receitas e drinks."
                    />
                  </div>

                  <Collapse open={usaEmDrinks}>
                    <div className="flex flex-col gap-4">
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <Field label="Unidade utilizada">
                          <div className="flex gap-1.5">
                            {(["ML", "G"] as const).map((u) => (
                              <button
                                key={u}
                                type="button"
                                onClick={() => setUnidadeBase(u)}
                                aria-pressed={unidadeBase === u}
                                className={cn(
                                  "flex-1 rounded-[var(--radius)] border px-2 py-2.5 text-sm font-medium transition-colors",
                                  unidadeBase === u
                                    ? "border-brand bg-brand text-on-brand"
                                    : "border-line-strong bg-surface text-ink-2 hover:border-brand/40 hover:bg-surface-2",
                                )}
                              >
                                {u === "ML" ? "Mililitros (ml)" : "Gramas (g)"}
                              </button>
                            ))}
                          </div>
                        </Field>
                        <Field
                          label="Conteúdo da embalagem"
                          htmlFor="cont"
                          hint={`Quantidade existente em uma unidade fechada, em ${medida}.`}
                        >
                          <Input
                            id="cont"
                            value={conteudo}
                            onChange={(e) => setConteudo(e.target.value)}
                            onKeyDown={enterTo("dose")}
                            placeholder={unidadeBase === "G" ? "5000" : "1000"}
                            inputMode="decimal"
                            className="font-mono"
                          />
                        </Field>
                        <Field
                          label="Dose padrão (opcional)"
                          htmlFor="dose"
                          hint="Sugestão ao criar novos drinks. Pode mudar em cada receita."
                        >
                          <Input
                            id="dose"
                            value={dosePadrao}
                            onChange={(e) => setDosePadrao(e.target.value)}
                            placeholder={unidadeBase === "G" ? "180" : "50"}
                            inputMode="decimal"
                            className="font-mono"
                          />
                        </Field>
                      </div>

                      {(conteudoNum ?? 0) <= 0 ? (
                        <p className="flex items-start gap-2 text-xs text-muted">
                          <AlertCircle size={13} className="mt-0.5 shrink-0" />
                          Informe o conteúdo da embalagem para permitir o
                          controle automático do consumo nos drinks.
                        </p>
                      ) : (
                        doses !== null && (
                          <p
                            key={doses}
                            className="flow-in flex items-center gap-1.5 font-mono text-xs font-medium text-ok"
                          >
                            <Check size={13} /> ≈ {doses} {porcaoLabel} por
                            unidade
                          </p>
                        )
                      )}
                    </div>
                  </Collapse>
                </Step>

                {/* 5 · Estoque */}
                <Step
                  n={4}
                  id={STEP_IDS[3]}
                  delay={180}
                  question="Estoque"
                  done={mode === "edit" || querInicial !== null}
                >
                  <div className="flex flex-col gap-3">
                    <Eyebrow>Reposição</Eyebrow>
                    {policy.usaGiro && (
                      <p className="flex items-start gap-2 text-xs text-muted">
                        <Sparkles size={13} className="mt-0.5 shrink-0 text-brand" />
                        Sua empresa repõe por rotatividade: a quantidade a comprar sai do
                        giro de venda deste produto, sem meta fixa.
                      </p>
                    )}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      {policy.usaMinimo && (
                        <Field label="Estoque mínimo" htmlFor="min">
                          <Input
                            id="min"
                            value={estoqueMinimo}
                            onChange={(e) => setMin(soInteiro(e.target.value))}
                            placeholder="0"
                            inputMode="numeric"
                            className="font-mono"
                          />
                        </Field>
                      )}
                      {policy.usaIdeal && (
                        <Field label="Estoque ideal" htmlFor="ideal">
                          <Input
                            id="ideal"
                            value={estoqueIdeal}
                            onChange={(e) => setIdeal(soInteiro(e.target.value))}
                            placeholder="0"
                            inputMode="numeric"
                            className="font-mono"
                          />
                        </Field>
                      )}
                      {storage.length > 0 && (
                        <Field label="Local" htmlFor="loc">
                          <Select
                            id="loc"
                            value={locationId}
                            onChange={(e) => setLocation(e.target.value)}
                          >
                            <option value="">Sem local</option>
                            {storage.map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.nome}
                                {l.siteNome ? ` — ${l.siteNome}` : ""}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      )}
                    </div>
                  </div>

                  {mode === "new" && (
                    <div className="flex flex-col gap-3 border-t border-line pt-4">
                      <Eyebrow>Primeiro estoque</Eyebrow>
                      <div className="flex flex-wrap items-center gap-3">
                        <p className="text-sm text-ink-2">
                          Deseja informar o estoque inicial?
                        </p>
                        <div className="flex gap-1.5">
                          {[
                            { v: true, label: "Sim" },
                            { v: false, label: "Depois" },
                          ].map((o) => (
                            <button
                              key={o.label}
                              type="button"
                              onClick={() => {
                                setQuerInicial(o.v);
                                if (!o.v) setInicial("");
                                else requestAnimationFrame(() => focusById("ini"));
                              }}
                              aria-pressed={querInicial === o.v}
                              className={cn(
                                "rounded-[var(--radius-pill)] border px-4 py-1.5 text-sm font-medium transition-colors",
                                querInicial === o.v
                                  ? "border-brand bg-brand-soft text-brand-strong"
                                  : "border-line-strong bg-surface text-ink-2 hover:border-brand/40",
                              )}
                            >
                              {o.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <Collapse open={querInicial === true} gap={3}>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                          <Field label="Quantidade" htmlFor="ini">
                            <Input
                              id="ini"
                              value={estoqueInicial}
                              onChange={(e) => setInicial(soInteiro(e.target.value))}
                              placeholder="0"
                              inputMode="numeric"
                              className="font-mono"
                            />
                          </Field>
                          {storage.length > 0 && (
                            <Field
                              label="Local"
                              hint="O mesmo definido acima em Reposição."
                            >
                              <button
                                type="button"
                                onClick={() => focusById("loc")}
                                className="flex h-11 w-full items-center justify-between gap-2 rounded-[var(--radius)] border border-line-strong bg-surface-2 px-4 text-left text-sm text-ink-2 transition-colors hover:border-brand/40"
                              >
                                <span className="truncate">
                                  {storage.find((l) => l.id === locationId)?.nome ??
                                    "Sem local"}
                                </span>
                                <span className="shrink-0 text-xs text-brand-strong">
                                  trocar
                                </span>
                              </button>
                            </Field>
                          )}
                          <Field
                            label="Valor de custo"
                            htmlFor="custo-ini"
                            hint="Mesmo custo unitário do produto."
                          >
                            <div className="relative">
                              <span className="pointer-events-none absolute inset-y-0 left-3 flex select-none items-center text-sm text-muted">
                                R$
                              </span>
                              <Input
                                id="custo-ini"
                                value={custo}
                                onChange={(e) =>
                                  setCusto(maskMoney(e.target.value))
                                }
                                placeholder="0,00"
                                inputMode="numeric"
                                className="pl-9 font-mono"
                              />
                            </div>
                          </Field>
                        </div>
                      </Collapse>
                    </div>
                  )}
                </Step>

                {/* 6 · Fiscal */}
                <Collapsible
                  icon={<FileText size={15} />}
                  title="Fiscal"
                  summary={
                    selectedFiscal
                      ? selectedFiscal.nome
                      : "Usar configuração da categoria"
                  }
                >
                  <Field
                    label="Perfil fiscal"
                    htmlFor="fiscal"
                    hint="Valide com seu contador antes de emitir nota."
                  >
                    <Select
                      id="fiscal"
                      value={fiscalProfileId}
                      onChange={(e) => setFiscal(e.target.value)}
                    >
                      <option value="">Usar configuração da categoria</option>
                      {fiscalProfiles.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.nome} (NCM {f.ncm})
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {selectedFiscal && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="neutral" className="font-mono">
                        NCM {selectedFiscal.ncm}
                      </Badge>
                      {selectedFiscal.precisaRevisao && (
                        <Badge tone="warn">
                          <AlertCircle size={11} /> Precisa de revisão
                        </Badge>
                      )}
                    </div>
                  )}

                  <label className="flex cursor-pointer items-center gap-2 border-t border-line pt-4 text-sm text-ink-2">
                    <input
                      type="checkbox"
                      checked={restricaoIdade}
                      onChange={(e) => setIdade(e.target.checked)}
                      className="cursor-pointer accent-[var(--brand)]"
                    />
                    Venda restrita a maiores de 18 anos
                  </label>

                  <details className="group border-t border-line pt-4">
                    <summary className="flex cursor-pointer select-none list-none items-center gap-2 text-sm text-muted transition-colors hover:text-ink-2 [&::-webkit-details-marker]:hidden">
                      <ChevronRight
                        size={13}
                        className="shrink-0 transition-transform duration-200 group-open:rotate-90"
                      />
                      Unidade tributável e combustíveis
                    </summary>
                    <div className="mt-3 grid gap-4 sm:grid-cols-2">
                      <Field
                        label="Unidade tributável"
                        htmlFor="utrib"
                        hint="Só quando a nota sai em unidade diferente da venda."
                      >
                        <Input
                          id="utrib"
                          value={uTrib}
                          onChange={(e) =>
                            setUTrib(e.target.value.toUpperCase().slice(0, 6))
                          }
                          placeholder="KG"
                          className="font-mono"
                        />
                      </Field>
                      <Field
                        label="Fator de conversão"
                        htmlFor="ftrib"
                        hint="Quantidade tributável por unidade vendida."
                      >
                        <Input
                          id="ftrib"
                          value={fatorTrib}
                          onChange={(e) => setFatorTrib(e.target.value)}
                          placeholder="1"
                          inputMode="decimal"
                          className="font-mono"
                        />
                      </Field>
                      <Field
                        label="GTIN tributável"
                        htmlFor="gtrib"
                        hint="Vazio = usa o código de barras do produto."
                      >
                        <Input
                          id="gtrib"
                          value={gtinTrib}
                          onChange={(e) =>
                            setGtinTrib(e.target.value.replace(/\D/g, ""))
                          }
                          placeholder="7891234567890"
                          inputMode="numeric"
                          className="font-mono"
                        />
                      </Field>
                      <Field
                        label="Código ANP"
                        htmlFor="anp"
                        hint="Só para combustíveis."
                      >
                        <Input
                          id="anp"
                          value={codigoAnp}
                          onChange={(e) =>
                            setCodigoAnp(
                              e.target.value.replace(/\D/g, "").slice(0, 9),
                            )
                          }
                          placeholder="320102001"
                          inputMode="numeric"
                          className="font-mono"
                        />
                      </Field>
                    </div>
                  </details>
                </Collapsible>

                {/* 7 · Venda online */}
                <div className="rounded-[var(--radius-lg)] border border-line bg-surface p-5 shadow-[var(--shadow-1)]">
                  <label className="flex cursor-pointer items-center gap-3 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={vendeOnline}
                      onChange={(e) => setVendeOnline(e.target.checked)}
                      className="cursor-pointer accent-[var(--brand)]"
                    />
                    <Globe size={15} className="text-muted" />
                    <span className="font-medium">Vender em canais online</span>
                  </label>

                  <Collapse
                    open={vendeOnline}
                    gap={0}
                    className="mt-4 border-t border-line pt-4"
                  >
                    <div className="flex flex-col gap-4">
                      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                        <Field label="Peso (g)" htmlFor="peso">
                          <Input
                            id="peso"
                            value={pesoGramas}
                            onChange={(e) => setPeso(e.target.value)}
                            placeholder="0"
                            inputMode="numeric"
                            className="font-mono"
                          />
                        </Field>
                        <Field label="Altura (cm)" htmlFor="altura">
                          <Input
                            id="altura"
                            value={alturaCm}
                            onChange={(e) => setAltura(e.target.value)}
                            placeholder="0"
                            inputMode="decimal"
                            className="font-mono"
                          />
                        </Field>
                        <Field label="Largura (cm)" htmlFor="largura">
                          <Input
                            id="largura"
                            value={larguraCm}
                            onChange={(e) => setLargura(e.target.value)}
                            placeholder="0"
                            inputMode="decimal"
                            className="font-mono"
                          />
                        </Field>
                        <Field label="Comprimento (cm)" htmlFor="comprimento">
                          <Input
                            id="comprimento"
                            value={comprimentoCm}
                            onChange={(e) => setComprimento(e.target.value)}
                            placeholder="0"
                            inputMode="decimal"
                            className="font-mono"
                          />
                        </Field>
                      </div>
                      <Field
                        label="Descrição para o anúncio"
                        htmlFor="desc"
                        hint={
                          descErro
                            ? undefined
                            : "Texto que aparece no canal de venda."
                        }
                        error={descErro}
                      >
                        <div className="flex flex-col gap-2">
                          <Textarea
                            id="desc"
                            value={descricaoOnline}
                            onChange={(e) => setDescOnline(e.target.value)}
                            placeholder="Texto que aparece no canal de venda"
                            className="min-h-[80px]"
                          />
                          <button
                            type="button"
                            onClick={gerarDescricaoOnline}
                            disabled={gerandoDesc || nome.trim().length < 2}
                            className="flex items-center gap-1.5 self-start rounded-[var(--radius-sm)] border border-line bg-surface px-2.5 py-1 text-xs font-medium text-brand-strong transition-colors hover:border-brand/40 hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {gerandoDesc ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <Sparkles size={12} />
                            )}
                            {gerandoDesc ? "Gerando…" : "Sugerir com IA"}
                          </button>
                        </div>
                      </Field>
                      <div className="flex flex-col gap-2">
                        <Eyebrow>Canais de venda</Eyebrow>
                        <OnlineChannels
                          rows={channels}
                          onChange={setChannel}
                          descricaoPadrao={descricaoOnline}
                        />
                      </div>
                    </div>
                  </Collapse>
                </div>
              </>
            )}

            {error && (
              <p className="fade-up flex items-center gap-2 rounded-[var(--radius)] bg-danger-soft px-3 py-2.5 text-sm text-danger">
                <AlertCircle size={15} className="shrink-0" />
                {error}
              </p>
            )}
          </div>

          {/* ── Painel inteligente ── */}
          <aside className="lg:sticky lg:top-4">
            <div className="divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface shadow-[var(--shadow-1)]">
              {/* Produto */}
              <div className="flex items-center gap-3 p-4">
                {imagemUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imagemUrl}
                    alt=""
                    className="h-11 w-11 shrink-0 rounded-[var(--radius-sm)] border border-line bg-white object-contain"
                  />
                ) : (
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-line bg-surface-2 text-faint">
                    <Package size={17} />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <Eyebrow className="text-[9.5px]">Produto</Eyebrow>
                  <p
                    className={cn(
                      "truncate text-sm font-medium",
                      nome.trim() ? "text-ink" : "text-faint",
                    )}
                  >
                    {nome.trim() || "Sem nome ainda"}
                  </p>
                  <p className="truncate text-[11px] text-muted">
                    {[marca, subAtual?.nome].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                {restricaoIdade && (
                  <Badge tone="warn" className="shrink-0 text-[10px]">
                    +18
                  </Badge>
                )}
              </div>

              {/* Fluxo do produto — compra → estoque → destinos */}
              <div className="p-4">
                <Eyebrow className="text-[9.5px]">Fluxo do produto</Eyebrow>
                <div className="mt-2">
                  <FlowNode
                    icon={<ShoppingCart size={13} />}
                    label="Compra"
                    title={
                      compraMode === null ? "Não definida" : compraLabel
                    }
                    detail={
                      compraMode && compraMode !== "UN" && (fatorNum ?? 0) > 0
                        ? `${fatorNum} unidades`
                        : undefined
                    }
                    active={compraMode !== null}
                  />
                  <FlowArrow />
                  <FlowNode
                    icon={<Warehouse size={13} />}
                    label="Estoque"
                    title="Unidades no estoque"
                    detail={
                      usaEmDrinks && (conteudoNum ?? 0) > 0
                        ? `1 un = ${conteudoNum} ${medida}`
                        : undefined
                    }
                    active
                  />
                  {vendaUnidade && (
                    <>
                      <FlowArrow />
                      <FlowNode
                        icon={<Package size={13} />}
                        label="Destino"
                        title="Venda por unidade"
                        detail={precoNum > 0 ? brl(precoNum) : undefined}
                        active
                      />
                    </>
                  )}
                  {usaEmDrinks && (
                    <>
                      <FlowArrow />
                      <FlowNode
                        icon={<Wine size={13} />}
                        label="Destino"
                        title="Drinks e receitas"
                        detail={
                          (doseNum ?? 0) > 0
                            ? `Dose padrão ${doseNum} ${medida}`
                            : undefined
                        }
                        hint={doses !== null ? `≈ ${doses} ${porcaoLabel}` : undefined}
                        active
                        tone="accent"
                      />
                    </>
                  )}
                  {!vendaUnidade && !usaEmDrinks && (
                    <>
                      <FlowArrow />
                      <FlowNode
                        icon={<Package size={13} />}
                        label="Destino"
                        title="Nenhuma utilização marcada"
                        active={false}
                      />
                    </>
                  )}
                </div>
              </div>

              {/* Preço */}
              <div className="flex flex-col gap-3 bg-accent-soft/40 p-4">
                <div className="flex items-center justify-between">
                  <Eyebrow className="text-accent">Preço</Eyebrow>
                  {verdict && (
                    <span
                      className={cn(
                        "flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-xs font-bold transition-colors duration-300",
                        verdict.tone === "ok" && "bg-ok-soft text-ok",
                        verdict.tone === "warn" && "bg-warn-soft text-warn",
                        verdict.tone === "danger" && "bg-danger-soft text-danger",
                      )}
                    >
                      {verdict.tone === "danger" ? (
                        <TrendingDown size={11} />
                      ) : (
                        <TrendingUp size={11} />
                      )}
                      {margemAnimada}%
                    </span>
                  )}
                </div>

                <Field label="Preço de custo" htmlFor="custo" required={mode === "new"}>
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-3 flex select-none items-center text-sm text-muted">
                      R$
                    </span>
                    <Input
                      id="custo"
                      value={custo}
                      onChange={(e) => setCusto(maskMoney(e.target.value))}
                      onBlur={() => touch("custo")}
                      onKeyDown={enterTo("preco")}
                      placeholder="0,00"
                      inputMode="numeric"
                      className={cn("pl-9 font-mono", faltando.custo && "border-warn")}
                    />
                  </div>
                </Field>

                <Field label="Preço de venda" htmlFor="preco" required>
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-3 flex select-none items-center text-sm text-muted">
                      R$
                    </span>
                    <Input
                      id="preco"
                      value={precoVenda}
                      onChange={(e) => setPrecoVenda(maskMoney(e.target.value))}
                      onBlur={() => touch("preco")}
                      onKeyDown={enterTo("salvar-produto")}
                      placeholder="0,00"
                      inputMode="numeric"
                      className={cn(
                        "pl-9 font-mono text-base font-semibold",
                        faltando.preco && "border-warn",
                      )}
                    />
                  </div>
                </Field>

                {verdict ? (
                  <PanelRow
                    label={verdict.label}
                    value={`${margemAnimada}%`}
                    mono
                    tone={verdict.tone}
                  />
                ) : (
                  <PanelRow
                    label="Margem"
                    value="—"
                    mono
                    tone="muted"
                  />
                )}
                {precoNum > 0 && custoNum > 0 && (
                  <PanelRow
                    label="Lucro por unidade"
                    value={brl(precoNum - custoNum)}
                    mono
                  />
                )}

                {/* Referência real do tenant, não markup mágico */}
                {precoSugerido && sugestao && (
                  <button
                    type="button"
                    onClick={() => setPrecoVenda(moneyToMask(precoSugerido))}
                    className="fade-up flex items-start gap-2 rounded-[var(--radius-sm)] border border-line bg-surface px-2.5 py-2 text-left transition-colors hover:border-accent/40 hover:bg-accent-soft"
                  >
                    <Lightbulb size={13} className="mt-0.5 shrink-0 text-accent" />
                    <span className="min-w-0 text-[11.5px] leading-snug text-ink-2">
                      Margem média em{" "}
                      <span className="font-medium">{subAtual?.nome}</span>:{" "}
                      <span className="font-mono font-semibold">
                        {sugestao.margemPct}%
                      </span>{" "}
                      → usar{" "}
                      <span className="font-mono font-semibold text-accent">
                        {brl(precoSugerido)}
                      </span>
                      <span className="block text-[10.5px] text-faint">
                        base: {sugestao.base} produtos da subcategoria
                      </span>
                    </span>
                  </button>
                )}
              </div>

              {/* Progresso */}
              <div className="p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-muted">
                    {isReady ? (
                      <span className="font-medium text-ok">
                        Pronto para salvar
                      </span>
                    ) : (
                      <>
                        {doneCnt} de {etapas.length} etapas concluídas
                        {firstMissing && (
                          <>
                            {" · "}
                            <button
                              type="button"
                              onClick={() => focusField(firstMissing.focus)}
                              className="font-medium text-brand-strong underline-offset-2 hover:underline"
                            >
                              falta {firstMissing.label}
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-faint">
                    {doneCnt}/{etapas.length}
                  </span>
                </div>
                <div
                  className={cn(
                    "h-1.5 w-full overflow-hidden rounded-full bg-line-strong",
                    isReady && "ready-glow",
                  )}
                >
                  <div
                    className={cn(
                      "h-full rounded-full transition-[width] duration-500",
                      isReady ? "bg-ok" : "bg-brand",
                    )}
                    style={{ width: `${(doneCnt / etapas.length) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* ── Barra de ações ── */}
      <div className="sticky bottom-4 z-10 mx-4 mb-4 flex items-center justify-end gap-3 rounded-[var(--radius-lg)] border border-line bg-surface/90 px-4 py-3 shadow-[var(--shadow-2)] backdrop-blur sm:mx-8 sm:px-6">
        <span className="mr-auto hidden items-center gap-3 text-xs text-ink-2 sm:flex">
          <span className="flex items-center gap-1.5">
            <kbd className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px]">
              Ctrl
            </kbd>
            +
            <kbd className="rounded border border-line bg-surface-2 px-1 py-0.5 font-mono text-[10px]">
              <CornerDownLeft size={11} />
            </kbd>
            salvar
          </span>
          <span className="hidden items-center gap-1.5 text-faint lg:flex">
            <kbd className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px]">
              Alt
            </kbd>
            +
            <kbd className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px]">
              1–4
            </kbd>
            etapas
          </span>
        </span>
        <Button
          variant="ghost"
          onClick={() => router.push("/produtos")}
          disabled={pending}
        >
          Cancelar
        </Button>
        {mode === "new" && (
          <Button
            variant="secondary"
            onClick={() => salvar(true)}
            disabled={pending}
          >
            {pending ? "Salvando…" : "Salvar e cadastrar outro"}
          </Button>
        )}
        <Button
          id="salvar-produto"
          onClick={() => salvar()}
          disabled={pending}
          className={cn(isReady && "ready-glow")}
        >
          {pending ? "Salvando…" : "Salvar produto"}
        </Button>
      </div>
    </div>
  );
}

/** Linha de criar subcategoria dentro do próprio dropdown — sem modal. */
function CriarSubcategoria({
  nome,
  categories,
  saving,
  onCreate,
}: {
  nome: string;
  categories: CategoryOpt[];
  saving: boolean;
  onCreate: (categoryId: string) => void | Promise<void>;
}) {
  const [catId, setCatId] = useState(categories[0]?.id ?? "__new");
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] bg-surface-2 p-2.5">
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-brand-strong">
        <Plus size={13} /> Criar “{nome}”
      </p>
      <div className="flex items-center gap-2">
        <Select
          value={catId}
          onChange={(e) => setCatId(e.target.value)}
          onMouseDown={(e) => e.stopPropagation()}
          className="h-9 text-xs"
          containerClassName="min-w-0 flex-1"
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              em {c.nome}
            </option>
          ))}
          <option value="__new">como nova categoria</option>
        </Select>
        <Button
          type="button"
          size="sm"
          disabled={saving}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onCreate(catId)}
          className="h-9 shrink-0"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : "Criar"}
        </Button>
      </div>
    </div>
  );
}
