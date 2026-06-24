"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ScanBarcode,
  Sparkles,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  ImageOff,
  ImagePlus,
  Trash2,
  CornerDownLeft,
  Plus,
  Loader2,
  X,
  Package,
  ShoppingCart,
  Wine,
  Warehouse,
  FileText,
  Globe,
  ChevronRight,
  Box,
  Droplets,
  Truck,
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
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field, Label, Badge, Eyebrow } from "@/components/ui/misc";
import { Sheet } from "@/components/ui/sheet";
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
  createSubcategory,
} from "../actions";
import type { SalesChannel } from "@/generated/prisma";
import type {
  BrandOpt,
  CategoryOpt,
  SubcategoryOpt,
  StorageOpt,
  SupplierRow,
  FiscalOpt,
  ProductRow,
} from "../_types";

type Tipo = "SIMPLES" | "INSUMO";

type PackagingRow = { nome: string; ean: string; fatorConversao: string };

const TITLE_NEW: Record<Tipo, string> = {
  SIMPLES: "Novo produto simples",
  INSUMO: "Novo insumo",
};

// Sugestões de nome para a embalagem de compra (input livre — não muda schema).
const EMBALAGEM_SUGESTOES = ["Caixa", "Fardo", "Engradado", "Pacote"];

function SectionBlock({
  icon,
  title,
  badge,
  children,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius)] border border-line bg-surface shadow-[var(--shadow-1)]",
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        {icon && <span className="shrink-0 text-brand-strong">{icon}</span>}
        <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.15em] text-ink-2">
          {title}
        </span>
        {badge && <span className="ml-1">{badge}</span>}
      </div>
      <div className="flex flex-col gap-4 p-4">{children}</div>
    </div>
  );
}

function AccordionBlock({
  icon,
  title,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group rounded-[var(--radius)] border border-line bg-surface shadow-[var(--shadow-1)]">
      <summary className="flex cursor-pointer select-none list-none items-center gap-2 rounded-[var(--radius)] px-4 py-3 transition-colors hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
        {icon && <span className="shrink-0 text-muted">{icon}</span>}
        <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.15em] text-ink-2">
          {title}
        </span>
        <Badge tone="neutral" className="ml-auto text-[9px]">
          opcional
        </Badge>
        <ChevronRight
          size={13}
          className="ml-1 shrink-0 text-faint transition-transform duration-200 group-open:rotate-90"
        />
      </summary>
      <div className="flex flex-col gap-4 border-t border-line p-4">
        {children}
      </div>
    </details>
  );
}

function FlowNode({
  icon,
  label,
  title,
  detail,
  ean,
  active,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
  detail?: string;
  ean?: string;
  active: boolean;
  tone: "brand" | "accent" | "neutral";
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-[var(--radius-sm)] p-2.5 transition-opacity",
        active ? "bg-surface-2" : "opacity-50",
      )}
    >
      <span
        className={cn(
          "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full",
          tone === "brand" && "bg-brand-soft text-brand-strong",
          tone === "accent" && "bg-accent-soft text-accent",
          tone === "neutral" && "bg-surface text-faint",
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.15em] text-muted">
          {label}
        </span>
        <p
          className={cn(
            "truncate text-[12px] font-medium",
            active ? "text-ink" : "text-faint",
          )}
        >
          {title}
        </p>
        {ean && (
          <p className="truncate font-mono text-[10px] text-faint">{ean}</p>
        )}
        {detail && (
          <p
            className={cn(
              "truncate font-mono text-[11px] font-semibold tabular-nums",
              tone === "accent" ? "text-accent" : "text-ink-2",
            )}
          >
            {detail}
          </p>
        )}
      </div>
    </div>
  );
}

function FlowConnector() {
  return (
    <div className="ml-[21px] flex h-4 w-6 items-center">
      <div className="h-full w-px bg-line-strong" />
    </div>
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
        className="group relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-[var(--radius)] border border-line bg-surface-2 transition-colors hover:border-brand/40"
        title={imagemUrl ? "Trocar imagem" : "Adicionar imagem"}
      >
        {imagemUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imagemUrl}
            alt=""
            className="h-full w-full object-contain"
          />
        ) : (
          <ImageOff size={18} className="text-faint" />
        )}
        <span className="absolute inset-0 grid place-items-center bg-ink/40 opacity-0 transition-opacity group-hover:opacity-100">
          <ImagePlus size={15} className="text-white" />
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

export function ProductForm({
  mode,
  tipo,
  product,
  brands,
  categories,
  subcategories,
  storage,
  suppliers,
  fiscalProfiles,
}: {
  mode: "new" | "edit";
  tipo: Tipo;
  product?: ProductRow | null;
  brands: BrandOpt[];
  categories: CategoryOpt[];
  subcategories: SubcategoryOpt[];
  storage: StorageOpt[];
  suppliers: SupplierRow[];
  fiscalProfiles: FiscalOpt[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [enriching, setEnriching] = useState(false);
  const [enriched, setEnriched] = useState(false);
  const [error, setError] = useState<string>();
  const [hint, setHint] = useState<string>();
  const nomeRef = useRef<HTMLInputElement>(null);

  const [ean, setEan] = useState(product?.ean ?? "");
  const [nome, setNome] = useState(product?.nome ?? "");
  const [sku, setSku] = useState(product?.sku ?? "");
  const skuEdited = useRef(false);
  const [marca, setMarca] = useState(product?.marca ?? "");
  const [subcategoryId, setSubcategoryId] = useState(
    product?.subcategoryId ?? "",
  );
  const [precoVenda, setPrecoVenda] = useState(
    moneyToMask(product?.precoVenda),
  );
  const [custo, setCusto] = useState(moneyToMask(product?.custo));
  const [imagemUrl, setImagemUrl] = useState(product?.imagemUrl ?? "");
  const imgFileRef = useRef<HTMLInputElement>(null);
  // Embalagem de compra única.
  const [pkNome, setPkNome] = useState(product?.packagings?.[0]?.nome ?? "");
  const [pkEan, setPkEan] = useState(product?.packagings?.[0]?.ean ?? "");
  const [pkFator, setPkFator] = useState(
    product?.packagings?.[0]?.fatorConversao?.toString() ?? "",
  );

  //  lista dinâmica de embalagens para o modo INSUMO
  const [packagings, setPackagings] = useState<PackagingRow[]>(
    tipo === "INSUMO"
      ? (product?.packagings?.map((p) => ({
          nome: p.nome ?? "",
          ean: p.ean ?? "",
          fatorConversao: p.fatorConversao?.toString() ?? "",
        })) ?? [])
      : [],
  );

  // Fornecedores — primeiro é o principal (schema suporta um; UI permite marcar vários).
  const [fornecedoresList, setFornecedoresList] = useState<string[]>(
    product?.fornecedorPrincipalId ? [product.fornecedorPrincipalId] : [],
  );
  const addFornecedor = (id: string) =>
    setFornecedoresList((prev) => (prev.includes(id) ? prev : [...prev, id]));
  const removeFornecedor = (id: string) =>
    setFornecedoresList((prev) => prev.filter((fid) => fid !== id));

  // ← ADICIONAR — fornecedor simplificado (select único) para INSUMO
  const fornecedorPrincipalId = fornecedoresList[0] ?? "";
  function setFornecedor(id: string) {
    setFornecedoresList(id ? [id] : []);
  }

  // ← ADICIONAR — CRUD de embalagens para INSUMO
  function addPackaging() {
    setPackagings((prev) => [
      ...prev,
      { nome: "", ean: "", fatorConversao: "" },
    ]);
  }
  function updatePackaging(i: number, patch: Partial<PackagingRow>) {
    setPackagings((prev) =>
      prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)),
    );
  }
  function removePackaging(i: number) {
    setPackagings((prev) => prev.filter((_, idx) => idx !== i));
  }

  const [unidadeBase, setUnidadeBase] = useState<"UN" | "ML" | "G">(
    product?.unidadeBase ?? "UN",
  );
  const [fracionavel, setFracionavel] = useState(product?.fracionavel ?? false);
  const [conteudo, setConteudo] = useState(
    product?.conteudoPorUnidade?.toString() ?? "",
  );
  const [estoqueMinimo, setMin] = useState(
    product?.estoque.minimo?.toString() ?? "",
  );
  const [estoqueIdeal, setIdeal] = useState(
    product?.estoque.ideal?.toString() ?? "",
  );
  const [estoqueInicial, setInicial] = useState("");
  const [locationId, setLocation] = useState(product?.estoque.locationId ?? "");

  const [controleEstoque, setControleEstoque] = useState(
    tipo === "INSUMO"
      ? !!product && (product.estoque.minimo > 0 || product.estoque.ideal > 0)
      : false,
  );

  const [fiscalProfileId, setFiscal] = useState(product?.fiscalProfileId ?? "");
  const [restricaoIdade, setIdade] = useState(product?.restricaoIdade ?? false);

  const [vendeOnline, setVendeOnline] = useState(product?.vendeOnline ?? false);
  const [pesoGramas, setPeso] = useState("");
  const [descricaoOnline, setDescOnline] = useState("");
  const [channels, setChannels] = useState<ChannelRow[]>(
    initChannels(product?.salesChannels),
  );
  const setChannel = (canal: SalesChannel, patch: Partial<ChannelRow>) =>
    setChannels((prev) =>
      prev.map((r) => (r.canal === canal ? { ...r, ...patch } : r)),
    );

  // Sidepanel "nova subcategoria"
  const [subSheet, setSubSheet] = useState(false);
  const [subSaving, setSubSaving] = useState(false);
  const [subErr, setSubErr] = useState<string>();
  const [novaSubCategoryId, setNovaSubCategoryId] = useState(
    categories.length === 1 ? categories[0].id : "",
  );
  const [novaSubNome, setNovaSubNome] = useState("");

  function previewSku(subId: string): string {
    const sub = subcategories.find((s) => s.id === subId);
    if (!sub) return "";
    const n = Math.floor(1000 + Math.random() * 9000);
    return `${sub.categorySkuPrefix}-${sub.skuPrefix}-${n}`;
  }

  const isSimples = tipo === "SIMPLES";
  const margemPct = margem(parseMoney(precoVenda), parseMoney(custo));
  const precoNum = parseMoney(precoVenda) ?? 0;
  const custoNum = parseMoney(custo) ?? 0;
  const lucro = precoNum > 0 && custoNum > 0 ? precoNum - custoNum : null;

  // Margem com 3 níveis semânticos: verde ≥15% · âmbar 0-15% · vermelho negativo.
  const margemColor: "ok" | "warn" | "danger" | null =
    margemPct === null
      ? null
      : margemPct < 0
        ? "danger"
        : margemPct < 15
          ? "warn"
          : "ok";

  const medida = unidadeBase === "G" ? "grama" : "ml";
  const conteudoNum = (() => {
    const x = Number(String(conteudo).replace(",", "."));
    return Number.isFinite(x) && conteudo !== "" ? x : null;
  })();
  const custoPorMedida =
    fracionavel && custoNum > 0 && conteudoNum && conteudoNum > 0
      ? custoNum / conteudoNum
      : null;

  // Progresso: 4 campos-chave para "pronto para salvar".
  const progressSteps = [
    { label: "nome", done: nome.trim().length >= 2 },
    { label: "subcategoria", done: !!subcategoryId },
    { label: "custo", done: custoNum > 0 },
    { label: "preço de venda", done: precoNum > 0 },
  ];
  const doneCnt = progressSteps.filter((s) => s.done).length;
  const isReady = doneCnt === progressSteps.length;
  const firstMissing = progressSteps.find((s) => !s.done);

  const selectedFiscal = fiscalProfiles.find((f) => f.id === fiscalProfileId);
  const title = mode === "edit" ? "Editar produto" : TITLE_NEW[tipo];

  // Subcategorias agrupadas por categoria — vira <optgroup> (cabeçalho não selecionável).
  const subsByCat = useMemo(() => {
    const map = new Map<string, SubcategoryOpt[]>();
    for (const s of subcategories) {
      const arr = map.get(s.categoriaNome);
      if (arr) arr.push(s);
      else map.set(s.categoriaNome, [s]);
    }
    return Array.from(map, ([categoria, subs]) => ({ categoria, subs }));
  }, [subcategories]);

  function n(v: string): number | null {
    const x = Number(String(v).replace(",", "."));
    return Number.isFinite(x) && v !== "" ? x : null;
  }

  async function buscarEan() {
    // Valida antes de chamar o servidor — código de barras curto demais.
    if (onlyDigits(ean).length < 8) {
      toast.error(
        "Código de barras inválido",
        "Escaneie de novo ou digite ao menos 8 dígitos.",
      );
      return;
    }
    setError(undefined);
    setHint(undefined);
    setEnriching(true);
    try {
      const s = await enrichEan(ean);
      if (!s.encontrado) {
        const fallback = s.erro ?? "Nada encontrado. Preencha à mão.";
        switch (s.motivo) {
          case "invalido":
            toast.error("Código de barras inválido", s.erro);
            break;
          case "ja_cadastrado":
            toast.error("Código já cadastrado", s.erro);
            break;
          case "nao_encontrado":
            toast.info(
              "Produto não encontrado",
              "Nenhum produto com esse código. Preencha à mão.",
            );
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
            toast.error("Erro ao pesquisar", fallback);
        }
        setHint(fallback);
        nomeRef.current?.focus();
      } else {
        if (s.nome) setNome(s.nome);
        if (s.marcaNome) setMarca(s.marcaNome);
        if (s.subcategoryId) setSubcategoryId(s.subcategoryId);
        if (s.imagemUrl) setImagemUrl(s.imagemUrl);
        if (s.pesoGramas) setPeso(String(s.pesoGramas));
        if (s.restricaoIdade) setIdade(true);
        setEnriched(true);
        const viaIa = s.fonte === "cosmos+llm";
        setHint(
          viaIa
            ? `Sugerido por IA${s.fiscalDica ? ` · ${s.fiscalDica}` : ""}. Revise antes de salvar.`
            : "Dados do código de barras. Revise e complete.",
        );
        toast.success(
          "Produto encontrado",
          viaIa
            ? "Dados sugeridos por IA. Revise antes de salvar."
            : "Revise e complete os dados.",
        );
        nomeRef.current?.focus();
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

  function pkHintText(qtd: string): string | undefined {
    const f = n(pkFator);
    const q = n(qtd);
    const label = pkNome.trim();
    if (!f || f <= 1 || !label || !q || q <= 0) return undefined;
    const inteiro = Math.floor(q / f);
    if (inteiro === 0) return undefined;
    const resto = Math.round(q % f);
    return resto === 0
      ? `= ${inteiro} ${label}`
      : `= ${inteiro} ${label} + ${resto} un`;
  }

  function salvar() {
    setError(undefined);
    if (nome.trim().length < 2) {
      setError("Informe o nome do produto.");
      nomeRef.current?.focus();
      return;
    }
    if (!subcategoryId) return setError("Escolha a subcategoria.");
    if (!parseMoney(precoVenda)) {
      toast.error(
        "Preço obrigatório",
        "Informe o preço de venda antes de salvar.",
      );
      return setError("Informe o preço de venda.");
    }

    let salesChannels;
    try {
      salesChannels = vendeOnline ? channelsToInput(channels) : [];
    } catch (e) {
      return setError(
        e instanceof Error ? e.message : "Canal online sem preço.",
      );
    }

    const input = {
      tipo,
      sku: sku.trim() || undefined,
      ean: ean || undefined,
      nome,
      subcategoryId,
      marcaNome: marca || undefined,
      brandId:
        product?.brandId && product.marca === marca
          ? product.brandId
          : undefined,
      imagemUrl: imagemUrl || undefined,
      unidadeBase,
      fracionavel: isSimples ? fracionavel : unidadeBase !== "UN",
      conteudoPorUnidade: n(conteudo),
      precoVenda: parseMoney(precoVenda),
      custo: parseMoney(custo),
      fiscalProfileId: fiscalProfileId || undefined,
      restricaoIdade,
      estoqueMinimo: n(estoqueMinimo) ?? 0,
      estoqueIdeal: n(estoqueIdeal) ?? 0,
      estoqueInicial: n(estoqueInicial) ?? 0,
      locationId: locationId || undefined,
      fornecedorPrincipalId: fornecedoresList[0] || undefined,
      packagings: isSimples
        ? pkNome.trim() && (n(pkFator) ?? 0) > 0
          ? [
              {
                nome: pkNome.trim(),
                ean: pkEan.trim() || undefined,
                fatorConversao: n(pkFator)!,
              },
            ]
          : []
        : packagings
            .filter((p) => p.nome.trim() && (n(p.fatorConversao) ?? 0) > 0)
            .map((p) => ({
              nome: p.nome.trim(),
              ean: p.ean.trim() || undefined,
              fatorConversao: n(p.fatorConversao)!,
            })),
      vendeOnline,
      pesoGramas: n(pesoGramas) ?? undefined,
      descricaoOnline: descricaoOnline || undefined,
      salesChannels,
    };

    start(async () => {
      try {
        if (product) await updateProduct(product.id, input);
        else await createProduct(input);
        router.push("/produtos");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Falha ao salvar.");
      }
    });
  }

  async function salvarSubcategoria() {
    setSubErr(undefined);
    if (!novaSubCategoryId) return setSubErr("Escolha a categoria.");
    if (novaSubNome.trim().length < 2)
      return setSubErr("Informe o nome da subcategoria.");
    setSubSaving(true);
    try {
      const id = await createSubcategory({
        categoryId: novaSubCategoryId,
        nome: novaSubNome,
      });
      setSubcategoryId(id);
      setSubSheet(false);
      setNovaSubNome("");
      router.refresh();
    } catch (e) {
      setSubErr(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSubSaving(false);
    }
  }

  // Imagem por arquivo local — lida como data URL (protótipo, sem storage ainda).
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

  // Extrai quantidade e unidade do nome do produto (ex.: "330ml", "1L", "500g", "1kg").
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

  // Ctrl/Cmd+Enter salva de qualquer campo — atalho de entrada rápida.
  function onKeyDownForm(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      salvar();
    }
  }

  return (
    <div className="flex flex-col gap-4" onKeyDown={onKeyDownForm}>
      {/* ── Cabeçalho ── */}
      <PageHeader
        backHref="/produtos"
        breadcrumbs={[
          { label: "Produtos", href: "/produtos" },
          { label: title },
        ]}
        title={title}
        badge={
          mode === "edit" && product?.sku ? (
            <SkuTag sku={product.sku} />
          ) : undefined
        }
        innerClassName="max-w-none sm:px-8"
      />

      <div className="px-4 pb-28 sm:px-8">
        {/* ── Scanner: ponto de partida (novo + simples) — faixa full-width ── */}
        {isSimples && mode === "new" && (
          <div className="mb-4 overflow-hidden rounded-[var(--radius-lg)] border border-ok/20 bg-ok-soft shadow-[var(--shadow-1)]">
            <div className="flex flex-col gap-3 p-3 lg:p-4">
              <div className="flex items-center gap-2">
                <ScanBarcode size={14} className="text-ok" />
                <Eyebrow className="text-ok">
                  Comece pelo código de barras
                </Eyebrow>
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="relative flex-1">
                    <ScanBarcode
                      size={18}
                      aria-hidden
                      className={cn(
                        "pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 transition-colors",
                        enriching ? "text-ok" : "text-muted",
                      )}
                    />
                    <Input
                      id="ean"
                      autoFocus
                      value={ean}
                      onChange={(e) => setEan(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && ean.length >= 8) {
                          e.preventDefault();
                          buscarEan();
                        }
                      }}
                      disabled={enriching}
                      aria-busy={enriching}
                      placeholder="Escaneie ou digite o EAN…"
                      inputMode="numeric"
                      className="h-12 bg-surface pl-11 font-mono text-base tracking-wide placeholder:font-sans placeholder:text-sm placeholder:font-normal placeholder:tracking-normal"
                    />
                    {enriching && (
                      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[var(--radius)]">
                        <div className="scan-line absolute inset-y-1 w-1/3 bg-gradient-to-r from-transparent via-ok/30 to-transparent" />
                      </div>
                    )}
                  </div>
                  <Button
                    type="button"
                    onClick={buscarEan}
                    disabled={enriching || ean.length < 8}
                    className="h-12 shrink-0 gap-2 px-5"
                  >
                    {enriching ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <ScanBarcode size={16} />
                    )}
                    {enriching ? "Buscando…" : "Buscar dados"}
                  </Button>
                </div>

                {enriched && nome ? (
                  <div className="flex items-center gap-3 rounded-[var(--radius)] border border-line bg-surface p-3">
                    {imagemUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={imagemUrl}
                        alt=""
                        className="h-12 w-12 shrink-0 rounded-[var(--radius-sm)] border border-line bg-white object-contain"
                      />
                    ) : (
                      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-line text-faint">
                        <ImageOff size={18} />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-[11px] font-medium text-ok">
                        <CheckCircle2 size={13} /> Produto reconhecido
                      </p>
                      <p className="truncate text-sm font-medium text-ink">
                        {nome}
                      </p>
                      {marca && (
                        <p className="truncate text-xs text-muted">{marca}</p>
                      )}
                    </div>
                  </div>
                ) : hint ? (
                  <p className="flex items-start gap-2 text-xs text-ok">
                    <Sparkles size={13} className="mt-0.5 shrink-0" />
                    {hint}
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={() => nomeRef.current?.focus()}
                    className="self-start text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
                  >
                    Não tem código? Preencher manualmente
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Grid de conteúdo ── */}
        {isSimples ? (
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            {/* ── Coluna esquerda ── */}
            <div className="flex flex-col gap-4">
              {/* Essenciais */}
              <SectionBlock icon={<Package size={13} />} title="Essenciais">
                <input
                  ref={imgFileRef}
                  type="file"
                  accept="image/*"
                  onChange={onPickImage}
                  className="hidden"
                />
                {/* Nome + miniatura de imagem lado a lado */}
                <div className="flex items-end gap-3">
                  <ImageThumb
                    imagemUrl={imagemUrl}
                    onPick={() => imgFileRef.current?.click()}
                    onClear={() => setImagemUrl("")}
                  />
                  <Field
                    label="Nome do produto"
                    htmlFor="nome"
                    className="min-w-0 flex-1"
                  >
                    <Input
                      id="nome"
                      ref={nomeRef}
                      value={nome}
                      onChange={(e) => setNome(e.target.value)}
                      placeholder="Ex.: Heineken Long Neck 330ml"
                      className="text-[15px] font-medium placeholder:text-sm placeholder:font-normal"
                    />
                  </Field>
                </div>

                {/* URL da imagem — somente quando não há upload local */}
                <Field label="URL da imagem" htmlFor="img-url">
                  <Input
                    id="img-url"
                    value={imagemUrl.startsWith("data:") ? "" : imagemUrl}
                    onChange={(e) => setImagemUrl(e.target.value)}
                    placeholder={
                      imagemUrl.startsWith("data:")
                        ? "Imagem enviada do computador"
                        : "https://… (opcional)"
                    }
                    inputMode="url"
                    className="font-mono text-xs placeholder:font-sans placeholder:text-sm"
                  />
                </Field>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Field
                    label="Marca"
                    htmlFor="marca"
                    hint="Cria automaticamente se nova."
                  >
                    <Input
                      id="marca"
                      value={marca}
                      onChange={(e) => setMarca(e.target.value)}
                      list="brand-list"
                      placeholder="Ex.: Heineken"
                    />
                    <datalist id="brand-list">
                      {brands.map((b) => (
                        <option key={b.id} value={b.nome} />
                      ))}
                    </datalist>
                  </Field>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="sub">Subcategoria</Label>
                      <button
                        type="button"
                        onClick={() => {
                          setSubErr(undefined);
                          setSubSheet(true);
                        }}
                        className="flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-xs font-medium text-brand-strong transition-colors hover:bg-brand-soft"
                      >
                        <Plus size={13} /> Nova
                      </button>
                    </div>
                    <Select
                      id="sub"
                      value={subcategoryId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setSubcategoryId(id);
                        if (mode === "new" && !skuEdited.current) {
                          setSku(previewSku(id));
                        }
                      }}
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
                  </div>
                  <Field
                    label="SKU"
                    htmlFor="sku"
                    hint="Gerado automaticamente. Editável."
                  >
                    <Input
                      id="sku"
                      value={sku}
                      onChange={(e) => {
                        skuEdited.current = true;
                        setSku(e.target.value.toUpperCase());
                      }}
                      placeholder="Ex.: BEB-CER-4521"
                      className="font-mono placeholder:font-sans placeholder:font-normal placeholder:tracking-normal"
                    />
                  </Field>
                </div>
              </SectionBlock>

              {/* Como compro */}
              <SectionBlock
                icon={<ShoppingCart size={13} />}
                title="Como compro"
              >
                <p className="text-xs text-muted">
                  A embalagem que você compra (caixa, fardo…) tem código de
                  barras próprio. Na entrada, o estoque converte para unidades
                  sozinho.
                </p>

                {/* Inputs em linha: Nome · Unidades · EAN */}
                <div className="grid grid-cols-[2fr_1fr_2fr] gap-3">
                  <Field label="Nome da embalagem" htmlFor="pk-nome">
                    <Input
                      id="pk-nome"
                      value={pkNome}
                      onChange={(e) => setPkNome(e.target.value)}
                      placeholder="Ex.: Caixa"
                    />
                  </Field>
                  <Field label="Unidades" htmlFor="pk-fator">
                    <Input
                      id="pk-fator"
                      value={pkFator}
                      onChange={(e) => setPkFator(e.target.value)}
                      placeholder="6"
                      inputMode="numeric"
                      className="font-mono"
                    />
                  </Field>
                  <Field label="Código de barras (EAN)" htmlFor="pk-ean">
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

                {/* Sugestões de nome quando campo vazio */}
                {!pkNome.trim() && (
                  <div className="flex flex-wrap gap-1.5">
                    {EMBALAGEM_SUGESTOES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setPkNome(s)}
                        className="rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs text-ink-2 transition-colors hover:border-brand/40 hover:bg-brand-soft"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}

                {/* Fornecedores */}
                <div className="flex flex-col gap-2 border-t border-line pt-3">
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
              </SectionBlock>

              {/* Como vendo e fraciono */}
              <SectionBlock
                icon={<Wine size={13} />}
                title="Produto fracionável (drinks e receitas)"
              >
                {/* Fracionamento — dose para receita/drink */}
                <div className="flex flex-col gap-3 rounded-[var(--radius-sm)] border border-line bg-surface-2 p-3">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-2">
                    <input
                      type="checkbox"
                      checked={fracionavel}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setFracionavel(checked);
                        if (checked) {
                          const inferred = inferConteudo(nome);
                          if (inferred) {
                            setConteudo(inferred.valor);
                            setUnidadeBase(inferred.unidade);
                          } else if (pesoGramas) {
                            setConteudo(pesoGramas);
                            setUnidadeBase("G");
                          } else {
                            setUnidadeBase("ML");
                          }
                        } else {
                          setUnidadeBase("UN");
                          setConteudo("");
                        }
                      }}
                      className="cursor-pointer accent-[var(--brand)]"
                    />
                    Fracionável — vende em dose ou em pratos
                  </label>

                  {fracionavel && (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Field label="Unidade da dose">
                        <div className="flex gap-1.5">
                          {(["ML", "G"] as const).map((u) => (
                            <button
                              key={u}
                              type="button"
                              onClick={() => setUnidadeBase(u)}
                              aria-pressed={unidadeBase === u}
                              className={cn(
                                "flex-1 rounded-[var(--radius-sm)] border px-3 py-2 text-sm font-medium transition-colors",
                                unidadeBase === u
                                  ? "border-brand bg-brand text-on-brand"
                                  : "border-line bg-surface text-ink-2 hover:border-brand/40 hover:bg-brand-soft",
                              )}
                            >
                              {u === "ML" ? "Mililitro (ml)" : "Grama (g)"}
                            </button>
                          ))}
                        </div>
                      </Field>
                      <Field
                        label="Conteúdo por unidade"
                        htmlFor="cont"
                        hint={`Total em ${medida} de 1 unidade fechada.`}
                      >
                        <Input
                          id="cont"
                          value={conteudo}
                          onChange={(e) => setConteudo(e.target.value)}
                          placeholder="Ex.: 2000"
                          inputMode="decimal"
                          className="font-mono"
                        />
                      </Field>
                    </div>
                  )}
                </div>
              </SectionBlock>

              {/* Estoque */}
              <SectionBlock icon={<Warehouse size={13} />} title="Estoque">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Field
                    label="Estoque mínimo"
                    htmlFor="min"
                    hint={pkHintText(estoqueMinimo)}
                  >
                    <Input
                      id="min"
                      value={estoqueMinimo}
                      onChange={(e) => setMin(e.target.value)}
                      placeholder="0"
                      inputMode="numeric"
                      className="font-mono"
                    />
                  </Field>
                  <Field
                    label="Estoque ideal"
                    htmlFor="ideal"
                    hint={pkHintText(estoqueIdeal)}
                  >
                    <Input
                      id="ideal"
                      value={estoqueIdeal}
                      onChange={(e) => setIdeal(e.target.value)}
                      placeholder="0"
                      inputMode="numeric"
                      className="font-mono"
                    />
                  </Field>
                  {storage.length > 0 && (
                    <Field label="Local de armazenagem" htmlFor="loc">
                      <Select
                        id="loc"
                        value={locationId}
                        onChange={(e) => setLocation(e.target.value)}
                      >
                        <option value="">Sem local</option>
                        {storage.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.nome}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                  <Field
                    label="Estoque inicial"
                    htmlFor="ini"
                    hint={
                      mode === "edit"
                        ? "Ajuste via movimentação."
                        : pkHintText(estoqueInicial)
                    }
                  >
                    <Input
                      id="ini"
                      value={estoqueInicial}
                      onChange={(e) => setInicial(e.target.value)}
                      placeholder="0"
                      inputMode="numeric"
                      disabled={mode === "edit"}
                      className="font-mono"
                    />
                  </Field>
                </div>
              </SectionBlock>

              {/* Fiscal — recolhível, opcional */}
              <AccordionBlock icon={<FileText size={13} />} title="Fiscal">
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
                    <option value="">Usar o sugerido pela subcategoria</option>
                    {fiscalProfiles.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.nome} (NCM {f.ncm})
                      </option>
                    ))}
                  </Select>
                </Field>
                {selectedFiscal?.precisaRevisao && (
                  <Badge tone="warn" className="self-start">
                    <AlertCircle size={11} /> Perfil fiscal precisa de revisão
                  </Badge>
                )}
                <label className="flex cursor-pointer items-center gap-2 border-t border-line pt-3 text-sm text-ink-2">
                  <input
                    type="checkbox"
                    checked={restricaoIdade}
                    onChange={(e) => setIdade(e.target.checked)}
                    className="cursor-pointer accent-[var(--brand)]"
                  />
                  Venda restrita a maiores de 18 anos
                </label>
              </AccordionBlock>

              {/* Venda online — recolhível, opcional */}
              <AccordionBlock icon={<Globe size={13} />} title="Venda online">
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
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-1">
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
              </AccordionBlock>
            </div>

            {/* ── Coluna direita — painel sticky ── */}
            <aside className="flex flex-col gap-4 lg:sticky lg:top-4">
              {/* Preço e margem */}
              <div className="rounded-[var(--radius)] border border-accent/30 bg-accent-soft p-4">
                <div className="mb-3 flex items-center justify-between">
                  <Eyebrow className="text-accent">Preço e margem</Eyebrow>
                  {margemPct !== null && (
                    <span
                      className={cn(
                        "flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-xs font-bold",
                        margemColor === "ok" && "bg-ok-soft text-ok",
                        margemColor === "warn" && "bg-warn-soft text-warn",
                        margemColor === "danger" &&
                          "bg-danger-soft text-danger",
                      )}
                    >
                      {margemColor === "danger" ? (
                        <TrendingDown size={11} />
                      ) : (
                        <TrendingUp size={11} />
                      )}
                      {margemPct}%
                    </span>
                  )}
                </div>

                <div className="flex flex-col gap-3">
                  <Field label="Custo unitário" htmlFor="custo">
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 left-3 flex select-none items-center text-sm text-muted">
                        R$
                      </span>
                      <Input
                        id="custo"
                        value={custo}
                        onChange={(e) => setCusto(maskMoney(e.target.value))}
                        placeholder="0,00"
                        inputMode="numeric"
                        className="bg-surface pl-9 font-mono"
                      />
                    </div>
                  </Field>
                  <Field label="Preço de venda" htmlFor="preco">
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 left-3 flex select-none items-center text-sm text-muted">
                        R$
                      </span>
                      <Input
                        id="preco"
                        value={precoVenda}
                        onChange={(e) =>
                          setPrecoVenda(maskMoney(e.target.value))
                        }
                        placeholder="0,00"
                        inputMode="numeric"
                        className="bg-surface pl-9 font-mono text-base font-semibold"
                      />
                    </div>
                  </Field>
                </div>

                {lucro !== null && (
                  <div className="mt-3 flex flex-col gap-2 rounded-[var(--radius-sm)] bg-surface/60 px-3 py-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted">Margem bruta</span>
                      <span
                        className={cn(
                          "font-mono text-sm font-semibold tabular-nums",
                          margemColor === "ok" && "text-ok",
                          margemColor === "warn" && "text-warn",
                          margemColor === "danger" && "text-danger",
                        )}
                      >
                        {brl(lucro)} / unidade
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-line-strong">
                      <div
                        className={cn(
                          "h-full rounded-full transition-[width] duration-300",
                          margemColor === "ok" && "bg-ok",
                          margemColor === "warn" && "bg-warn",
                          margemColor === "danger" && "bg-danger",
                        )}
                        style={{
                          width: `${Math.min(100, Math.max(0, margemPct ?? 0))}%`,
                        }}
                      />
                    </div>
                    {margemColor === "warn" && (
                      <p className="text-[11px] text-warn">
                        Margem abaixo de 15% — revise o preço.
                      </p>
                    )}
                    {margemColor === "danger" && (
                      <p className="text-[11px] text-danger">
                        Preço abaixo do custo — prejuízo por unidade.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Resumo do fluxo */}
              <div className="rounded-[var(--radius)] border border-line bg-surface p-4 shadow-[var(--shadow-1)]">
                <Eyebrow className="mb-3 block">Fluxo do produto</Eyebrow>
                <FlowNode
                  icon={<Box size={13} />}
                  label="Compro"
                  title={pkNome.trim() || "Embalagem não definida"}
                  detail={n(pkFator) ? `${pkFator} unidades` : undefined}
                  ean={pkEan || undefined}
                  active={!!pkNome.trim()}
                  tone="brand"
                />
                <FlowConnector />
                <FlowNode
                  icon={<Wine size={13} />}
                  label="Vendo"
                  title="Unidade"
                  ean={ean || undefined}
                  detail={precoNum > 0 ? brl(precoNum) : undefined}
                  active
                  tone="brand"
                />
                <FlowConnector />
                <FlowNode
                  icon={<Droplets size={13} />}
                  label="Fraciono"
                  title={fracionavel ? `Dose · ${medida}` : "Não fracionável"}
                  detail={
                    custoPorMedida
                      ? `custo ${custoPorMedida.toLocaleString("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                          minimumFractionDigits: 4,
                          maximumFractionDigits: 4,
                        })}/${medida}`
                      : undefined
                  }
                  active={fracionavel}
                  tone={fracionavel ? "accent" : "neutral"}
                />
              </div>

              {/* Progresso */}
              <div className="rounded-[var(--radius)] border border-line bg-surface p-3 shadow-[var(--shadow-1)]">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-muted">
                    {isReady ? (
                      <span className="font-medium text-ok">
                        Pronto para salvar
                      </span>
                    ) : (
                      <>
                        {doneCnt} de {progressSteps.length} campos-chave
                        {firstMissing && <> · falta o {firstMissing.label}</>}
                      </>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-faint">
                    {doneCnt}/{progressSteps.length}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-line-strong">
                  <div
                    className={cn(
                      "h-full rounded-full transition-[width] duration-500",
                      isReady ? "bg-ok" : "bg-brand",
                    )}
                    style={{
                      width: `${(doneCnt / progressSteps.length) * 100}%`,
                    }}
                  />
                </div>
              </div>
            </aside>
          </div>
        ) : (
          /* ── INSUMO — layout full-width ── */
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <SectionBlock
              icon={<Package size={13} />}
              title="Essenciais"
              className="lg:col-span-12"
            >
              <input
                ref={imgFileRef}
                type="file"
                accept="image/*"
                onChange={onPickImage}
                className="hidden"
              />
              <div className="flex items-end gap-3">
                <ImageThumb
                  imagemUrl={imagemUrl}
                  onPick={() => imgFileRef.current?.click()}
                  onClear={() => setImagemUrl("")}
                />
                <Field
                  label="Nome do produto"
                  htmlFor="nome"
                  className="min-w-0 flex-1"
                >
                  <Input
                    id="nome"
                    ref={nomeRef}
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    placeholder="Ex.: Água Mineral 500ml"
                    className="text-[15px] font-medium placeholder:text-sm placeholder:font-normal"
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Código de barras (EAN)" htmlFor="ean">
                  <Input
                    id="ean"
                    value={ean}
                    onChange={(e) => setEan(e.target.value)}
                    placeholder="Ex.: 7891000315507"
                    inputMode="numeric"
                    className="font-mono placeholder:font-sans"
                  />
                </Field>
                <Field
                  label="Marca"
                  htmlFor="marca"
                  hint="Cria automaticamente se nova."
                >
                  <Input
                    id="marca"
                    value={marca}
                    onChange={(e) => setMarca(e.target.value)}
                    list="brand-list"
                    placeholder="Ex.: Crystal"
                  />
                  <datalist id="brand-list">
                    {brands.map((b) => (
                      <option key={b.id} value={b.nome} />
                    ))}
                  </datalist>
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="sub">Subcategoria</Label>
                    <button
                      type="button"
                      onClick={() => {
                        setSubErr(undefined);
                        setSubSheet(true);
                      }}
                      className="flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-xs font-medium text-brand-strong transition-colors hover:bg-brand-soft"
                    >
                      <Plus size={13} /> Nova
                    </button>
                  </div>
                  <Select
                    id="sub"
                    value={subcategoryId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setSubcategoryId(id);
                      if (mode === "new" && !skuEdited.current) {
                        setSku(previewSku(id));
                      }
                    }}
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
                </div>
                <Field
                  label="SKU"
                  htmlFor="sku"
                  hint="Gerado automaticamente. Editável."
                  className="sm:col-span-2"
                >
                  <Input
                    id="sku"
                    value={sku}
                    onChange={(e) => {
                      skuEdited.current = true;
                      setSku(e.target.value.toUpperCase());
                    }}
                    placeholder="Ex.: BEB-INS-4521"
                    className="font-mono placeholder:font-sans placeholder:font-normal placeholder:tracking-normal"
                  />
                </Field>
              </div>
            </SectionBlock>

            <SectionBlock
              icon={<Warehouse size={13} />}
              title="Estoque e unidades"
              className="lg:col-span-4"
            >
              <Field label="Controle de consumo" htmlFor="consumo">
                <Select
                  id="consumo"
                  value={unidadeBase}
                  onChange={(e) =>
                    setUnidadeBase(e.target.value as "UN" | "ML" | "G")
                  }
                >
                  <option value="UN">Unidade</option>
                  <option value="G">Grama (g)</option>
                  <option value="ML">Mililitro (ml)</option>
                </Select>
              </Field>

              {(unidadeBase === "G" || unidadeBase === "ML") && (
                <Field
                  label="Conteúdo por embalagem"
                  htmlFor="cont"
                  hint={`Em ${unidadeBase === "G" ? "g" : "ml"} por unidade fechada.`}
                >
                  <Input
                    id="cont"
                    value={conteudo}
                    onChange={(e) => setConteudo(e.target.value)}
                    placeholder="Ex.: 1000"
                    inputMode="decimal"
                    className="font-mono"
                  />
                </Field>
              )}

              <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-2">
                <input
                  type="checkbox"
                  checked={controleEstoque}
                  onChange={(e) => setControleEstoque(e.target.checked)}
                  className="cursor-pointer accent-[var(--brand)]"
                />
                Controlar estoque deste insumo
              </label>

              {controleEstoque && (
                <>
                  <Field label="Estoque inicial" htmlFor="ini">
                    <Input
                      id="ini"
                      value={estoqueInicial}
                      onChange={(e) => setInicial(e.target.value)}
                      placeholder="0"
                      inputMode="numeric"
                      disabled={mode === "edit"}
                      className="font-mono"
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Mínimo" htmlFor="min">
                      <Input
                        id="min"
                        value={estoqueMinimo}
                        onChange={(e) => setMin(e.target.value)}
                        placeholder="0"
                        inputMode="numeric"
                        className="font-mono"
                      />
                    </Field>
                    <Field label="Ideal" htmlFor="ideal">
                      <Input
                        id="ideal"
                        value={estoqueIdeal}
                        onChange={(e) => setIdeal(e.target.value)}
                        placeholder="0"
                        inputMode="numeric"
                        className="font-mono"
                      />
                    </Field>
                  </div>
                </>
              )}
            </SectionBlock>

            <SectionBlock
              icon={<ShoppingCart size={13} />}
              title="Embalagens de compra"
              className="lg:col-span-12"
            >
              <p className="text-xs text-muted">
                Cadastre como você compra o produto. Ex.: um fardo com 6
                unidades tem código de barras próprio — registre aqui e a
                entrada de estoque converte para unidades automaticamente.
              </p>

              {packagings.length > 0 && (
                <div className="flex flex-col gap-3">
                  {packagings.map((pk, i) => (
                    <div
                      key={i}
                      className="grid gap-3 sm:grid-cols-[1.5fr_1.5fr_1fr_auto] sm:items-end"
                    >
                      <Field label="Embalagem" htmlFor={`pk-nome-${i}`}>
                        <Input
                          id={`pk-nome-${i}`}
                          value={pk.nome}
                          onChange={(e) =>
                            updatePackaging(i, { nome: e.target.value })
                          }
                          placeholder="Ex.: Fardo"
                        />
                      </Field>
                      <Field
                        label="Código de barras (EAN)"
                        htmlFor={`pk-ean-${i}`}
                      >
                        <Input
                          id={`pk-ean-${i}`}
                          value={pk.ean}
                          onChange={(e) =>
                            updatePackaging(i, { ean: e.target.value })
                          }
                          placeholder="Ex.: 7891000315521"
                          inputMode="numeric"
                          className="font-mono placeholder:font-sans"
                        />
                      </Field>
                      <Field
                        label="Unidades"
                        htmlFor={`pk-fator-${i}`}
                        hint="Quantas unidades a embalagem contém."
                      >
                        <Input
                          id={`pk-fator-${i}`}
                          value={pk.fatorConversao}
                          onChange={(e) =>
                            updatePackaging(i, {
                              fatorConversao: e.target.value,
                            })
                          }
                          placeholder="Ex.: 6"
                          inputMode="numeric"
                          className="font-mono"
                        />
                      </Field>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removePackaging(i)}
                        className="mb-1 text-danger hover:text-danger"
                      >
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={addPackaging}
                className="gap-1 self-start"
              >
                <Plus size={15} /> Adicionar embalagem
              </Button>
            </SectionBlock>

            <SectionBlock
              icon={<Truck size={13} />}
              title="Fornecedor"
              className="lg:col-span-4"
            >
              {suppliers.length > 0 ? (
                <Field label="Fornecedor principal" htmlFor="forn-insumo">
                  <Select
                    id="forn-insumo"
                    value={fornecedorPrincipalId}
                    onChange={(e) => setFornecedor(e.target.value)}
                  >
                    <option value="">Nenhum</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nomeFantasia || s.razaoSocial}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <p className="text-xs text-muted">
                  Nenhum fornecedor cadastrado ainda.
                </p>
              )}

              {storage.length > 0 && (
                <Field label="Local de armazenagem" htmlFor="loc">
                  <Select
                    id="loc"
                    value={locationId}
                    onChange={(e) => setLocation(e.target.value)}
                  >
                    <option value="">Sem local definido</option>
                    {storage.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.nome}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </SectionBlock>
          </div>
        )}

        {/* Erro */}
        {error && (
          <p className="mt-4 flex items-center gap-2 rounded-[var(--radius-sm)] bg-danger-soft px-3 py-2.5 text-sm text-danger">
            <AlertCircle size={15} className="shrink-0" />
            {error}
          </p>
        )}
      </div>

      {/* ── Footer de ações — barra flutuante arredondada ── */}
      <div className="sticky bottom-4 z-10 mx-4 mb-4 flex items-center justify-end gap-3 rounded-[var(--radius-lg)] border border-line bg-surface/90 px-4 py-3 shadow-[var(--shadow-2)] backdrop-blur sm:mx-8 sm:px-6">
        <span className="mr-auto hidden items-center gap-1.5 text-xs text-ink-2 sm:flex">
          <kbd className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px]">
            Ctrl
          </kbd>
          +
          <kbd className="rounded border border-line bg-surface-2 px-1 py-0.5 font-mono text-[10px]">
            <CornerDownLeft size={11} />
          </kbd>
          <span>para salvar</span>
        </span>
        <Button
          variant="ghost"
          onClick={() => router.push("/produtos")}
          disabled={pending}
        >
          Cancelar
        </Button>
        <Button onClick={salvar} disabled={pending}>
          {pending ? "Salvando…" : "Salvar produto"}
        </Button>
      </div>

      {/* ── Sidepanel: nova subcategoria ── */}
      <Sheet
        open={subSheet}
        onClose={() => setSubSheet(false)}
        title="Nova subcategoria"
        description="Crie e já selecione no produto. Defina a categoria e o nome."
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setSubSheet(false)}
              disabled={subSaving}
            >
              Cancelar
            </Button>
            <Button
              onClick={salvarSubcategoria}
              disabled={subSaving}
              className="gap-1"
            >
              <Plus size={16} />{" "}
              {subSaving ? "Salvando…" : "Criar subcategoria"}
            </Button>
          </div>
        }
      >
        {categories.length === 0 ? (
          <p className="rounded-[var(--radius-sm)] border border-dashed border-line-strong px-3 py-6 text-center text-sm text-muted">
            Nenhuma categoria cadastrada ainda. Crie uma categoria primeiro na
            tela de Produtos.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <Field label="Categoria" htmlFor="nova-sub-cat">
              <Select
                id="nova-sub-cat"
                value={novaSubCategoryId}
                onChange={(e) => setNovaSubCategoryId(e.target.value)}
              >
                <option value="">Selecione…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Nome da subcategoria"
              htmlFor="nova-sub-nome"
              hint="Não pode repetir na mesma categoria."
            >
              <Input
                id="nova-sub-nome"
                autoFocus
                value={novaSubNome}
                onChange={(e) => setNovaSubNome(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && salvarSubcategoria()}
                placeholder="Ex.: Cervejas"
              />
            </Field>
            {subErr && <p className="text-sm text-danger">{subErr}</p>}
          </div>
        )}
      </Sheet>
    </div>
  );
}
