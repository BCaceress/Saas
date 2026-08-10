"use client";

import { useMemo, useState, useTransition } from "react";
import {
  FolderTree,
  Tag,
  Truck,
  Search,
  Plus,
  Check as CheckIcon,
  X,
  Info,
  Coins,
  Globe,
  Receipt,
  EyeOff,
  Tags,
} from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { brl, cn, maskMoney, parseMoney } from "@/lib/utils";
import { bulkEditProducts, desfazerBulkEdit } from "../actions";
import type { BrandOpt, CategoryNode, FiscalOpt, SupplierRow, TagOpt } from "../_types";

/** Produto na fila da edição em lote — só o que a prévia precisa mostrar. */
export type ProdutoLote = {
  id: string;
  nome: string;
  sku: string;
  /** Receita (PERSONALIZADO) fica de fora do bloco de marca. */
  tipo?: string;
};

type ModoFornecedor = "substituir" | "adicionar" | "remover";

const MODO_LABEL: Record<ModoFornecedor, string> = {
  substituir: "Substituir",
  adicionar: "Adicionar",
  remover: "Remover",
};

const MODO_HINT: Record<ModoFornecedor, string> = {
  substituir: "Troca a lista inteira pelos escolhidos. O primeiro vira o principal.",
  adicionar: "Mantém os fornecedores atuais e acrescenta os escolhidos.",
  remover: "Tira os escolhidos de quem os tiver. Os demais continuam.",
};

const nomeFornecedor = (s: SupplierRow) => s.nomeFantasia || s.razaoSocial;

/**
 * Edição em lote da listagem: categoria/subcategoria, marca e fornecedores dos
 * produtos selecionados. Cada bloco começa desligado — o que o operador não
 * ligar não é enviado e o campo fica como está no cadastro.
 */
type ModoPreco = "percentual" | "valor" | "fixo";

const PRECO_LABEL: Record<ModoPreco, string> = {
  percentual: "Percentual",
  valor: "Somar R$",
  fixo: "Preço fixo",
};

const ARRED_LABEL: Record<string, string> = {
  nenhum: "Sem arredondar",
  "90": "Terminar em ,90",
  "99": "Terminar em ,99",
  inteiro: "Valor inteiro",
};

export function LoteSheet({
  open,
  onClose,
  produtos,
  categoryTree,
  brands,
  suppliers,
  fiscais = [],
  etiquetasExistentes = [],
  onAplicado,
}: {
  open: boolean;
  onClose: () => void;
  produtos: ProdutoLote[];
  categoryTree: CategoryNode[];
  brands: BrandOpt[];
  suppliers: SupplierRow[];
  fiscais?: FiscalOpt[];
  /** Etiquetas já usadas no tenant — viram atalho para não nascer variação. */
  etiquetasExistentes?: TagOpt[];
  onAplicado?: () => void;
}) {
  const [pending, start] = useTransition();

  // ── Categoria / subcategoria ──
  const [mexerCategoria, setMexerCategoria] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [subcategoryId, setSubcategoryId] = useState("");

  // ── Marca ──
  const [mexerMarca, setMexerMarca] = useState(false);
  /** "" = sem marca (limpa); "__nova" = criar pelo nome; senão é um brandId. */
  const [marcaEscolha, setMarcaEscolha] = useState("");
  const [marcaNova, setMarcaNova] = useState("");

  // ── Preço ──
  const [mexerPreco, setMexerPreco] = useState(false);
  const [modoPreco, setModoPreco] = useState<ModoPreco>("percentual");
  const [precoValor, setPrecoValor] = useState("");
  const [arredondar, setArredondar] = useState<"nenhum" | "90" | "99" | "inteiro">("nenhum");

  // ── Etiquetas ──
  const [mexerEtiquetas, setMexerEtiquetas] = useState(false);
  const [modoEtiqueta, setModoEtiqueta] = useState<ModoFornecedor>("adicionar");
  const [etiquetaTexto, setEtiquetaTexto] = useState("");
  const [etiquetas, setEtiquetas] = useState<string[]>([]);

  function addEtiqueta(nome: string) {
    const limpo = nome.trim();
    if (limpo.length < 2) return;
    setEtiquetas((prev) => (prev.includes(limpo) ? prev : [...prev, limpo]));
    setEtiquetaTexto("");
  }

  // ── Venda online / fiscal / situação ──
  const [mexerOnline, setMexerOnline] = useState(false);
  const [vendeOnline, setVendeOnline] = useState(true);
  const [mexerFiscal, setMexerFiscal] = useState(false);
  const [fiscalId, setFiscalId] = useState("");
  const [mexerSituacao, setMexerSituacao] = useState(false);
  const [ativo, setAtivo] = useState(false);

  // ── Fornecedores ──
  const [mexerFornecedor, setMexerFornecedor] = useState(false);
  const [modo, setModo] = useState<ModoFornecedor>("substituir");
  const [buscaForn, setBuscaForn] = useState("");
  /** Ordem importa no modo "substituir": o primeiro vira o principal. */
  const [fornSel, setFornSel] = useState<string[]>([]);

  const subs = useMemo(() => {
    const cat = categoryTree.find((c) => c.id === categoryId);
    return (cat?.subcategorias ?? []).filter((s) => s.ativo);
  }, [categoryTree, categoryId]);

  const fornecedoresAtivos = useMemo(
    () => suppliers.filter((s) => s.ativo),
    [suppliers],
  );

  const listaForn = useMemo(() => {
    const termo = buscaForn.trim().toLowerCase();
    if (!termo) return fornecedoresAtivos;
    return fornecedoresAtivos.filter((s) =>
      `${s.razaoSocial} ${s.nomeFantasia ?? ""} ${s.cnpj ?? ""}`
        .toLowerCase()
        .includes(termo),
    );
  }, [fornecedoresAtivos, buscaForn]);

  const porId = useMemo(
    () => new Map(suppliers.map((s) => [s.id, s])),
    [suppliers],
  );

  /** Receitas na fila: o servidor não aplica marca nelas — o painel avisa antes. */
  const receitas = produtos.filter((p) => p.tipo === "PERSONALIZADO").length;

  function alternarForn(id: string) {
    setFornSel((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  /** % vem como número solto; somar/fixo vêm mascarados em reais. */
  const precoNum =
    modoPreco === "percentual"
      ? Number(precoValor.replace(",", "."))
      : parseMoney(precoValor) ?? NaN;
  const precoValido = Number.isFinite(precoNum) && (modoPreco === "percentual" || precoNum >= 0);

  /** Prévia sobre R$ 10,00 — a conta na cabeça do operador, feita na tela. */
  const exemplo = (() => {
    if (!precoValido) return null;
    const base = 10;
    const bruto =
      modoPreco === "percentual"
        ? base * (1 + precoNum / 100)
        : modoPreco === "valor"
          ? base + precoNum
          : precoNum;
    const final =
      arredondar === "inteiro"
        ? Math.round(bruto)
        : arredondar === "90"
          ? Math.floor(bruto) + 0.9
          : arredondar === "99"
            ? Math.floor(bruto) + 0.99
            : Math.round(bruto * 100) / 100;
    return Math.max(0, final);
  })();

  const alteracoes: string[] = [];
  if (mexerCategoria && subcategoryId) {
    const sub = subs.find((s) => s.id === subcategoryId);
    const cat = categoryTree.find((c) => c.id === categoryId);
    alteracoes.push(`categoria → ${cat?.nome} › ${sub?.nome}`);
  }
  if (mexerMarca) {
    alteracoes.push(
      marcaEscolha === "__nova"
        ? `marca → ${marcaNova.trim() || "(informe o nome)"}`
        : marcaEscolha
          ? `marca → ${brands.find((b) => b.id === marcaEscolha)?.nome}`
          : "marca → sem marca",
    );
  }
  if (mexerPreco && precoValido) {
    alteracoes.push(
      modoPreco === "percentual"
        ? `preço → ${precoNum > 0 ? "+" : ""}${precoNum}%`
        : modoPreco === "valor"
          ? `preço → ${precoNum > 0 ? "+" : ""}${brl(precoNum)}`
          : `preço → ${brl(precoNum)} fixo`,
    );
  }
  if (mexerEtiquetas && (etiquetas.length || modoEtiqueta === "substituir")) {
    alteracoes.push(
      `etiquetas → ${MODO_LABEL[modoEtiqueta].toLowerCase()} ${etiquetas.length || "todas"}`,
    );
  }
  if (mexerOnline) alteracoes.push(vendeOnline ? "venda online → ligada" : "venda online → desligada");
  if (mexerFiscal) {
    alteracoes.push(
      fiscalId
        ? `fiscal → ${fiscais.find((f) => f.id === fiscalId)?.nome}`
        : "fiscal → sem perfil",
    );
  }
  if (mexerSituacao) alteracoes.push(ativo ? "situação → ativos" : "situação → inativos");
  if (mexerFornecedor && fornSel.length) {
    alteracoes.push(
      `fornecedores → ${MODO_LABEL[modo].toLowerCase()} ${fornSel.length}`,
    );
  } else if (mexerFornecedor && modo === "substituir") {
    alteracoes.push("fornecedores → remover todos");
  }

  function aplicar() {
    // Erro que explica o quê e como resolver, em vez de botão morto sem motivo.
    if (mexerCategoria && !subcategoryId) {
      toast.info("Escolha a subcategoria", "A categoria sozinha não define onde o produto entra.");
      return;
    }
    if (mexerMarca && marcaEscolha === "__nova" && marcaNova.trim().length < 2) {
      toast.info("Informe o nome da marca", "Ou escolha uma marca já cadastrada.");
      return;
    }
    if (mexerPreco && !precoValido) {
      toast.info("Informe o valor da reprecificação", "Ex.: 10 para subir 10%.");
      return;
    }
    if (mexerEtiquetas && modoEtiqueta !== "substituir" && !etiquetas.length) {
      toast.info("Escreva ao menos uma etiqueta", "Digite e aperte Enter para incluir na lista.");
      return;
    }
    if (mexerFornecedor && modo !== "substituir" && !fornSel.length) {
      toast.info(
        "Escolha ao menos um fornecedor",
        `Nada foi selecionado para ${MODO_LABEL[modo].toLowerCase()}.`,
      );
      return;
    }
    if (!alteracoes.length) {
      toast.info("Nada para aplicar", "Ligue ao menos um campo acima.");
      return;
    }

    start(async () => {
      try {
        const { alterados, desfazer } = await bulkEditProducts({
          ids: produtos.map((p) => p.id),
          ...(mexerCategoria && subcategoryId ? { subcategoryId } : {}),
          ...(mexerMarca
            ? marcaEscolha === "__nova"
              ? { marcaNome: marcaNova.trim() }
              : { brandId: marcaEscolha || null }
            : {}),
          ...(mexerPreco
            ? { preco: { modo: modoPreco, valor: precoNum, arredondar } }
            : {}),
          ...(mexerEtiquetas
            ? { etiquetas: { modo: modoEtiqueta, nomes: etiquetas } }
            : {}),
          ...(mexerOnline ? { vendeOnline } : {}),
          ...(mexerFiscal ? { fiscalProfileId: fiscalId || null } : {}),
          ...(mexerSituacao ? { ativo } : {}),
          ...(mexerFornecedor ? { fornecedores: { modo, ids: fornSel } } : {}),
        });
        toast.success(
          `${alterados} ${alterados === 1 ? "produto atualizado" : "produtos atualizados"}`,
          desfazer ? undefined : "Vínculo de fornecedor não volta atrás.",
          desfazer
            ? {
                rotulo: "Desfazer",
                onClick: async () => {
                  await desfazerBulkEdit(desfazer);
                  toast.info("Lote desfeito");
                  onAplicado?.();
                },
              }
            : undefined,
        );
        onAplicado?.();
        onClose();
      } catch (e) {
        toast.error(
          "Não deu para aplicar",
          e instanceof Error ? e.message : "Tente de novo.",
        );
      }
    });
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Editar em lote"
      description={`${produtos.length} produto${produtos.length === 1 ? "" : "s"} selecionado${produtos.length === 1 ? "" : "s"} · o que ficar desligado continua como está.`}
      width="2xl"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="min-w-0 flex-1 truncate text-sm text-muted">
            {alteracoes.length ? alteracoes.join(" · ") : "Nenhuma alteração escolhida"}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={aplicar} disabled={pending}>
              {pending ? "Aplicando…" : `Aplicar a ${produtos.length}`}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {/* ── Categoria / subcategoria ── */}
        <Bloco
          icon={<FolderTree size={15} />}
          titulo="Categoria e subcategoria"
          resumo="Move os produtos para outra prateleira do catálogo."
          ligado={mexerCategoria}
          onToggle={() => setMexerCategoria((v) => !v)}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Categoria">
              <Select
                value={categoryId}
                onChange={(e) => {
                  setCategoryId(e.target.value);
                  setSubcategoryId("");
                }}
              >
                <option value="">Escolha a categoria</option>
                {categoryTree.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Subcategoria"
              hint={
                categoryId && subs.length === 0
                  ? "Esta categoria não tem subcategoria ativa."
                  : undefined
              }
            >
              <Select
                value={subcategoryId}
                onChange={(e) => setSubcategoryId(e.target.value)}
                disabled={!categoryId}
              >
                <option value="">
                  {categoryId ? "Escolha a subcategoria" : "Escolha a categoria antes"}
                </option>
                {subs.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nome}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <p className="mt-2 flex items-start gap-1.5 text-xs text-muted">
            <Info size={13} className="mt-0.5 shrink-0" />
            O SKU não muda: ele já está impresso na etiqueta da prateleira.
          </p>
        </Bloco>

        {/* ── Marca ── */}
        <Bloco
          icon={<Tag size={15} />}
          titulo="Marca"
          resumo="Define a mesma marca para todos os selecionados."
          ligado={mexerMarca}
          onToggle={() => setMexerMarca((v) => !v)}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Marca">
              <Select
                value={marcaEscolha}
                onChange={(e) => setMarcaEscolha(e.target.value)}
              >
                <option value="">Sem marca (limpar)</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.nome}
                  </option>
                ))}
                <option value="__nova">＋ Nova marca…</option>
              </Select>
            </Field>
            {marcaEscolha === "__nova" && (
              <Field label="Nome da nova marca">
                <Input
                  value={marcaNova}
                  onChange={(e) => setMarcaNova(e.target.value)}
                  placeholder="Ex.: Ambev"
                  autoFocus
                />
              </Field>
            )}
          </div>
          {marcaEscolha === "__nova" && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-muted">
              <Plus size={13} className="mt-0.5 shrink-0" />
              Se já existir uma marca com esse nome, ela é reaproveitada.
            </p>
          )}
          {receitas > 0 && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-muted">
              <Info size={13} className="mt-0.5 shrink-0" />
              {receitas === 1 ? "1 receita fica" : `${receitas} receitas ficam`} de fora: preparo da
              casa não tem marca.
            </p>
          )}
        </Bloco>

        {/* ── Preço ── */}
        <Bloco
          icon={<Coins size={15} />}
          titulo="Preço de venda"
          resumo="Reprecifica em massa: percentual, acréscimo fixo ou preço único."
          ligado={mexerPreco}
          onToggle={() => setMexerPreco((v) => !v)}
        >
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(PRECO_LABEL) as ModoPreco[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => { setModoPreco(m); setPrecoValor(""); }}
                className={cn(
                  "cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  modoPreco === m
                    ? "border-brand/40 bg-brand-soft text-brand-strong"
                    : "border-line text-ink-2 hover:bg-surface-2",
                )}
              >
                {PRECO_LABEL[m]}
              </button>
            ))}
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field
              label={modoPreco === "percentual" ? "Variação (%)" : "Valor (R$)"}
              hint={modoPreco === "percentual" ? "Negativo desconta: -10 baixa 10%." : undefined}
            >
              <Input
                value={precoValor}
                onChange={(e) =>
                  setPrecoValor(
                    modoPreco === "percentual"
                      ? e.target.value.replace(/[^\d,.-]/g, "").slice(0, 6)
                      : maskMoney(e.target.value),
                  )
                }
                inputMode={modoPreco === "percentual" ? "text" : "numeric"}
                placeholder={modoPreco === "percentual" ? "10" : "0,00"}
                className="font-mono"
              />
            </Field>
            <Field label="Arredondamento">
              <Select
                value={arredondar}
                onChange={(e) => setArredondar(e.target.value as typeof arredondar)}
              >
                {Object.entries(ARRED_LABEL).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {exemplo != null && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-muted">
              <Info size={13} className="mt-0.5 shrink-0" />
              Um produto de {brl(10)} passa a custar{" "}
              <span className="font-mono font-medium text-ink">{brl(exemplo)}</span>.
              {modoPreco !== "fixo" && " Produto sem preço continua sem preço."}
            </p>
          )}
          <p className="mt-1 text-xs text-muted">Insumo fica de fora: é uso interno, não tem venda.</p>
        </Bloco>

        {/* ── Etiquetas ── */}
        <Bloco
          icon={<Tags size={15} />}
          titulo="Etiquetas"
          resumo="Marca livre do operador: promoção, curva A, verão."
          ligado={mexerEtiquetas}
          onToggle={() => setMexerEtiquetas((v) => !v)}
        >
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(MODO_LABEL) as ModoFornecedor[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setModoEtiqueta(m)}
                className={cn(
                  "cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  modoEtiqueta === m
                    ? "border-brand/40 bg-brand-soft text-brand-strong"
                    : "border-line text-ink-2 hover:bg-surface-2",
                )}
              >
                {MODO_LABEL[m]}
              </button>
            ))}
          </div>

          {etiquetas.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {etiquetas.map((nome) => (
                <span
                  key={nome}
                  className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand-strong"
                >
                  {nome}
                  <button
                    type="button"
                    onClick={() => setEtiquetas((prev) => prev.filter((x) => x !== nome))}
                    className="cursor-pointer rounded-full p-0.5 hover:bg-brand/15"
                    aria-label={`Tirar ${nome} da lista`}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="mt-3">
            <Input
              value={etiquetaTexto}
              onChange={(e) => setEtiquetaTexto(e.target.value)}
              onKeyDown={(e) => {
                // Enter e vírgula fecham a etiqueta: é como se digita lista.
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addEtiqueta(etiquetaTexto);
                }
              }}
              onBlur={() => addEtiqueta(etiquetaTexto)}
              placeholder="Digite e aperte Enter (ex.: promoção)"
            />
          </div>

          {/* Etiquetas já em uso viram atalho — evita "promoçao" e "promoção". */}
          {etiquetasExistentes.length > 0 && modoEtiqueta !== "substituir" && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted">Em uso:</span>
              {etiquetasExistentes
                .filter((t) => !etiquetas.includes(t.nome))
                .slice(0, 12)
                .map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => addEtiqueta(t.nome)}
                    className="cursor-pointer rounded-full border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink-2 transition-colors hover:border-brand/40 hover:bg-brand-soft hover:text-brand-strong"
                  >
                    {t.nome}
                  </button>
                ))}
            </div>
          )}
          {modoEtiqueta === "substituir" && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-warn">
              <Info size={13} className="mt-0.5 shrink-0" />
              Substituir apaga as etiquetas atuais dos selecionados.
            </p>
          )}
        </Bloco>

        {/* ── Venda online ── */}
        <Bloco
          icon={<Globe size={15} />}
          titulo="Venda online"
          resumo="Liga ou desliga os selecionados dos canais online."
          ligado={mexerOnline}
          onToggle={() => setMexerOnline((v) => !v)}
        >
          <div className="flex flex-wrap gap-1.5">
            {[
              { v: true, label: "Vende online" },
              { v: false, label: "Não vende online" },
            ].map((o) => (
              <button
                key={String(o.v)}
                type="button"
                onClick={() => setVendeOnline(o.v)}
                className={cn(
                  "cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  vendeOnline === o.v
                    ? "border-brand/40 bg-brand-soft text-brand-strong"
                    : "border-line text-ink-2 hover:bg-surface-2",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">
            Preço e descrição por canal continuam como estão em cada produto.
          </p>
        </Bloco>

        {/* ── Perfil fiscal ── */}
        <Bloco
          icon={<Receipt size={15} />}
          titulo="Perfil fiscal"
          resumo="Aplica o mesmo NCM/CST a todos os selecionados."
          ligado={mexerFiscal}
          onToggle={() => setMexerFiscal((v) => !v)}
        >
          <Field label="Perfil">
            <Select value={fiscalId} onChange={(e) => setFiscalId(e.target.value)}>
              <option value="">Sem perfil (limpar)</option>
              {fiscais.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome} · NCM {f.ncm}
                  {f.precisaRevisao ? " (a revisar)" : ""}
                </option>
              ))}
            </Select>
          </Field>
          {fiscais.some((f) => f.id === fiscalId && f.precisaRevisao) && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-warn">
              <Info size={13} className="mt-0.5 shrink-0" />
              Este perfil ainda não passou pelo contador — vale como rascunho, não como verdade.
            </p>
          )}
        </Bloco>

        {/* ── Situação ── */}
        <Bloco
          icon={<EyeOff size={15} />}
          titulo="Situação"
          resumo="Tira da listagem sem apagar o histórico, ou traz de volta."
          ligado={mexerSituacao}
          onToggle={() => setMexerSituacao((v) => !v)}
        >
          <div className="flex flex-wrap gap-1.5">
            {[
              { v: true, label: "Ativar" },
              { v: false, label: "Inativar" },
            ].map((o) => (
              <button
                key={String(o.v)}
                type="button"
                onClick={() => setAtivo(o.v)}
                className={cn(
                  "cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  ativo === o.v
                    ? "border-brand/40 bg-brand-soft text-brand-strong"
                    : "border-line text-ink-2 hover:bg-surface-2",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </Bloco>

        {/* ── Fornecedores ── */}
        <Bloco
          icon={<Truck size={15} />}
          titulo="Fornecedores"
          resumo="Vincula ou desvincula fornecedores em massa."
          ligado={mexerFornecedor}
          onToggle={() => setMexerFornecedor((v) => !v)}
        >
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(MODO_LABEL) as ModoFornecedor[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setModo(m)}
                className={cn(
                  "cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  modo === m
                    ? "border-brand/40 bg-brand-soft text-brand-strong"
                    : "border-line text-ink-2 hover:bg-surface-2",
                )}
              >
                {MODO_LABEL[m]}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">{MODO_HINT[modo]}</p>

          {fornSel.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {fornSel.map((id, i) => (
                <span
                  key={id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand-strong"
                >
                  {porId.get(id) ? nomeFornecedor(porId.get(id)!) : id}
                  {modo === "substituir" && i === 0 && (
                    <span className="rounded-full bg-brand/15 px-1.5 py-px text-[10px]">
                      principal
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => alternarForn(id)}
                    className="cursor-pointer rounded-full p-0.5 hover:bg-brand/15"
                    aria-label={`Tirar ${porId.get(id) ? nomeFornecedor(porId.get(id)!) : "fornecedor"} da lista`}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="relative mt-3">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
            <Input
              value={buscaForn}
              onChange={(e) => setBuscaForn(e.target.value)}
              placeholder="Buscar fornecedor por nome ou CNPJ"
              className="h-10 pl-9"
            />
          </div>

          <ul className="mt-2 max-h-64 divide-y divide-line overflow-y-auto rounded-[var(--radius)] border border-line">
            {listaForn.length === 0 && (
              <li className="px-3 py-6 text-center text-xs text-muted">
                {fornecedoresAtivos.length === 0
                  ? "Nenhum fornecedor cadastrado ainda."
                  : "Nenhum fornecedor bate com a busca."}
              </li>
            )}
            {listaForn.map((s) => {
              const marcado = fornSel.includes(s.id);
              return (
                <li key={s.id}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm transition-colors hover:bg-surface-2",
                      marcado && "bg-brand-soft/40",
                    )}
                  >
                    <Checkbox checked={marcado} onChange={() => alternarForn(s.id)} />
                    <span className="min-w-0 flex-1 truncate text-ink">{nomeFornecedor(s)}</span>
                    {s.cnpj && (
                      <span className="shrink-0 font-mono text-[11px] text-faint">{s.cnpj}</span>
                    )}
                    {marcado && <CheckIcon size={14} className="shrink-0 text-brand-strong" />}
                  </label>
                </li>
              );
            })}
          </ul>

          {modo === "substituir" && fornSel.length === 0 && (
            <p className="mt-2 text-xs text-warn">
              Sem nenhum escolhido, os produtos ficam sem fornecedor.
            </p>
          )}
        </Bloco>

        {/* ── Prévia do lote ── */}
        <details className="rounded-[var(--radius)] border border-line">
          <summary className="cursor-pointer select-none px-4 py-2.5 text-sm text-ink-2 hover:bg-surface-2">
            Ver os {produtos.length} produtos que vão mudar
          </summary>
          <ul className="max-h-56 divide-y divide-line overflow-y-auto border-t border-line text-xs">
            {produtos.map((p) => (
              <li key={p.id} className="flex items-center gap-2 px-4 py-1.5 text-ink-2">
                <span className="min-w-0 flex-1 truncate">{p.nome}</span>
                <span className="shrink-0 font-mono text-faint">{p.sku}</span>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </Sheet>
  );
}

/** Bloco de campo opcional: só o que estiver ligado entra na gravação. */
function Bloco({
  icon,
  titulo,
  resumo,
  ligado,
  onToggle,
  children,
}: {
  icon: React.ReactNode;
  titulo: string;
  resumo: string;
  ligado: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-[var(--radius)] border transition-colors",
        ligado ? "border-brand/40 bg-brand-soft/20" : "border-line",
      )}
    >
      <label className="flex cursor-pointer items-start gap-3 px-4 py-3">
        <Checkbox checked={ligado} onChange={onToggle} className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <span className="text-faint">{icon}</span>
            {titulo}
          </span>
          <span className="mt-0.5 block text-xs text-muted">{resumo}</span>
        </span>
      </label>
      {ligado && <div className="border-t border-line/70 px-4 py-3">{children}</div>}
    </section>
  );
}
