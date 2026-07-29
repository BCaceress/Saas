"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ImageOff,
  ImagePlus,
  Trash2,
  CornerDownLeft,
  Plus,
  Package,
  ShoppingCart,
  Warehouse,
  Truck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { POLICY_PADRAO, type EstoquePolicy } from "@/lib/estoque-estrategia";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field, Label } from "@/components/ui/misc";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { PageHeader } from "@/components/app/page-header";
import { SkuTag } from "@/components/sku-tag";
import { SimpleProductForm } from "./simple-product-form";
import { createProduct, updateProduct, createSubcategory } from "../actions";
import type {
  BrandOpt,
  CategoryOpt,
  SubcategoryOpt,
  StorageOpt,
  SupplierPickerOpt,
  FiscalOpt,
  ProductRow,
} from "../_types";

type Tipo = "SIMPLES" | "INSUMO";

type PackagingRow = { nome: string; ean: string; fatorConversao: string };

type FormProps = {
  mode: "new" | "edit";
  tipo: Tipo;
  product?: ProductRow | null;
  brands: BrandOpt[];
  categories: CategoryOpt[];
  subcategories: SubcategoryOpt[];
  storage: StorageOpt[];
  suppliers: SupplierPickerOpt[];
  fiscalProfiles: FiscalOpt[];
  /** Padrão do tenant (Configurações → Estoque) — pré-preenche o mínimo no cadastro. */
  defaultEstoqueMinimo?: number;
  /** Estratégia de controle de estoque da empresa — decide quais metas aparecem. */
  policy?: EstoquePolicy;
};

/**
 * Porta de entrada do cadastro de produto.
 *
 * SIMPLES tem assistente próprio (`SimpleProductForm`): pergunta a pergunta,
 * campos que só aparecem quando fazem sentido. INSUMO segue o formulário
 * abaixo — poucos campos, sem preço de venda, foco em consumo/embalagem.
 */
export function ProductForm({ tipo, ...rest }: FormProps) {
  return tipo === "SIMPLES" ? (
    <SimpleProductForm {...rest} />
  ) : (
    <InsumoForm {...rest} />
  );
}

/** Cartão de seção do formulário — cabeçalho mono + corpo em coluna. */
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

function InsumoForm({
  mode,
  product,
  brands,
  categories,
  subcategories,
  storage,
  suppliers,
  defaultEstoqueMinimo,
  policy = POLICY_PADRAO,
}: Omit<FormProps, "tipo">) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const nomeRef = useRef<HTMLInputElement>(null);
  const savedRef = useRef(false);

  const [ean, setEan] = useState(product?.ean ?? "");
  const [nome, setNome] = useState(product?.nome ?? "");
  const [sku, setSku] = useState(product?.sku ?? "");
  const [marca, setMarca] = useState(product?.marca ?? "");
  const [subcategoryId, setSubcategoryId] = useState(
    product?.subcategoryId ?? "",
  );
  const [imagemUrl, setImagemUrl] = useState(product?.imagemUrl ?? "");
  const imgFileRef = useRef<HTMLInputElement>(null);

  // Embalagens de compra (fardo, caixa…) — cada uma com EAN e fator próprios.
  const [packagings, setPackagings] = useState<PackagingRow[]>(
    product?.packagings?.map((p) => ({
      nome: p.nome ?? "",
      ean: p.ean ?? "",
      fatorConversao: p.fatorConversao?.toString() ?? "",
    })) ?? [],
  );
  function addPackaging() {
    setPackagings((prev) => [...prev, { nome: "", ean: "", fatorConversao: "" }]);
  }
  function updatePackaging(i: number, patch: Partial<PackagingRow>) {
    setPackagings((prev) =>
      prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)),
    );
  }
  function removePackaging(i: number) {
    setPackagings((prev) => prev.filter((_, idx) => idx !== i));
  }

  const [fornecedorPrincipalId, setFornecedor] = useState(
    product?.fornecedorPrincipalId ?? "",
  );

  const [unidadeBase, setUnidadeBase] = useState<"UN" | "ML" | "G">(
    product?.unidadeBase ?? "UN",
  );
  const [conteudo, setConteudo] = useState(
    product?.conteudoPorUnidade?.toString() ?? "",
  );
  const [controleEstoque, setControleEstoque] = useState(
    product ? product.estoque.controlado : false,
  );
  const [estoqueMinimo, setMin] = useState(
    product?.estoque.minimo?.toString() ??
      (defaultEstoqueMinimo ? String(defaultEstoqueMinimo) : ""),
  );
  const [estoqueIdeal, setIdeal] = useState(
    product?.estoque.ideal?.toString() ?? "",
  );
  const [estoqueInicial, setInicial] = useState("");
  const [locationId, setLocation] = useState(product?.estoque.locationId ?? "");

  // Sidepanel "nova subcategoria"
  const [subSheet, setSubSheet] = useState(false);
  const [subSaving, setSubSaving] = useState(false);
  const [subErr, setSubErr] = useState<string>();
  const [novaSubCategoryId, setNovaSubCategoryId] = useState(
    categories.length === 1 ? categories[0].id : "",
  );
  const [novaSubNome, setNovaSubNome] = useState("");

  const title = mode === "edit" ? "Editar insumo" : "Novo insumo";

  // Subcategorias agrupadas por categoria — vira <optgroup>.
  const subsByCat = useMemo(() => {
    const map = new Map<string, SubcategoryOpt[]>();
    for (const s of subcategories) {
      const arr = map.get(s.categoriaNome);
      if (arr) arr.push(s);
      else map.set(s.categoriaNome, [s]);
    }
    return Array.from(map, ([categoria, subs]) => ({ categoria, subs }));
  }, [subcategories]);

  // Prefixo estável só para o placeholder do SKU — o número final é gerado
  // (sequencial, único) no servidor quando o campo fica vazio.
  function skuPreview(subId: string): string {
    const sub = subcategories.find((s) => s.id === subId);
    if (!sub) return "Ex.: BEB-CER-4521";
    return `${sub.categorySkuPrefix}-${sub.skuPrefix}-••••`;
  }

  function n(v: string): number | null {
    const x = Number(String(v).replace(",", "."));
    return Number.isFinite(x) && v !== "" ? x : null;
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

  // Limpa a identidade para o próximo cadastro, preservando o contexto de lote.
  function resetForNext() {
    setEan("");
    setNome("");
    setSku("");
    setMarca("");
    setImagemUrl("");
    setPackagings([]);
    setInicial("");
    setConteudo("");
    setError(undefined);
  }

  function salvar(andNew = false) {
    setError(undefined);
    if (nome.trim().length < 2) {
      setError("Informe o nome do insumo.");
      nomeRef.current?.focus();
      return;
    }
    if (!subcategoryId) {
      setError("Escolha a subcategoria.");
      document.getElementById("sub")?.focus();
      return;
    }

    // Canais online não têm UI no insumo — o que já existe é preservado.
    const salesChannels = (product?.salesChannels ?? [])
      .filter((c) => c.ativo && c.precoCanal != null)
      .map((c) => ({
        canal: c.canal,
        precoCanal: c.precoCanal!,
        descricaoCanal: c.descricaoCanal,
      }));

    const input = {
      tipo: "INSUMO" as const,
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
      fracionavel: unidadeBase !== "UN",
      conteudoPorUnidade: n(conteudo),
      precoVenda: product?.precoVenda ?? null,
      custo: product?.custo ?? null,
      fiscalProfileId: product?.fiscalProfileId ?? undefined,
      restricaoIdade: product?.restricaoIdade ?? false,
      gtinTributavel: product?.gtinTributavel ?? undefined,
      unidadeTributavel: product?.unidadeTributavel ?? undefined,
      fatorConversaoTrib: product?.fatorConversaoTrib ?? undefined,
      codigoAnp: product?.codigoAnp ?? undefined,
      controlaEstoque: controleEstoque,
      estoqueMinimo: n(estoqueMinimo) ?? 0,
      estoqueIdeal: n(estoqueIdeal) ?? 0,
      estoqueInicial: n(estoqueInicial) ?? 0,
      locationId: locationId || undefined,
      fornecedorPrincipalId: fornecedorPrincipalId || undefined,
      fornecedoresIds: fornecedorPrincipalId ? [fornecedorPrincipalId] : [],
      packagings: packagings
        .filter((p) => p.nome.trim() && (n(p.fatorConversao) ?? 0) > 0)
        .map((p) => ({
          nome: p.nome.trim(),
          ean: p.ean.trim() || undefined,
          fatorConversao: n(p.fatorConversao)!,
        })),
      vendeOnline: product?.vendeOnline ?? false,
      salesChannels,
    };

    start(async () => {
      try {
        if (product) await updateProduct(product.id, input);
        else await createProduct(input);
        savedRef.current = true;
        if (andNew && !product) {
          resetForNext();
          router.refresh();
          toast.success("Insumo salvo", "Cadastre o próximo.");
          requestAnimationFrame(() => nomeRef.current?.focus());
          return;
        }
        router.push("/produtos");
        router.refresh();
      } catch (e) {
        savedRef.current = false;
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

  // Ctrl/Cmd+Enter salva de qualquer campo — atalho de entrada rápida.
  function onKeyDownForm(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      salvar();
    }
  }

  // Aviso de sair sem salvar — só no cadastro novo com algo preenchido.
  const isDirty = mode === "new" && (nome.trim() !== "" || ean !== "");
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
                </div>
                <Field
                  label="SKU"
                  htmlFor="sku"
                  hint="Vazio = gerado automaticamente ao salvar. Editável."
                  className="sm:col-span-2"
                >
                  <Input
                    id="sku"
                    value={sku}
                    onChange={(e) => setSku(e.target.value.toUpperCase())}
                    placeholder={skuPreview(subcategoryId)}
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
                  {mode !== "edit" && (
                    <Field label="Estoque inicial" htmlFor="ini">
                      <Input
                        id="ini"
                        value={estoqueInicial}
                        onChange={(e) => setInicial(e.target.value)}
                        placeholder="0"
                        inputMode="numeric"
                        className="font-mono"
                      />
                    </Field>
                  )}
                  {policy.usaGiro ? (
                    <p className="text-xs text-muted">
                      Sua empresa repõe por rotatividade — a necessidade de compra sai do
                      giro de consumo, sem mínimo ou ideal por produto.
                    </p>
                  ) : (
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
                      {policy.usaIdeal && (
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
                      )}
                    </div>
                  )}
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
        {mode === "new" && (
          <Button
            variant="secondary"
            onClick={() => salvar(true)}
            disabled={pending}
          >
            {pending ? "Salvando…" : "Salvar e cadastrar outro"}
          </Button>
        )}
        <Button onClick={() => salvar()} disabled={pending}>
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
