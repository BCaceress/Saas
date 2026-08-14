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
  Receipt,
  TextCursorInput,
  MapPin,
  BadgePercent,
} from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { brl, cn, maskMoney, parseMoney } from "@/lib/utils";
import { bulkEditProducts, bulkRenameProducts, desfazerBulkEdit } from "../actions";
import type {
  BrandOpt, CategoryFilterOpt, FiscalOpt, StorageOpt, SubcategoryFilterOpt, SupplierPickerOpt,
} from "../_types";

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

const nomeFornecedor = (s: SupplierPickerOpt) => s.nomeFantasia || s.razaoSocial;

/**
 * Edição em lote da listagem, em quatro grupos: catálogo (categoria, marca,
 * nomes), comercial (preço), estoque (fornecedores, localização) e fiscal.
 * Cada bloco começa desligado — o que o operador não ligar não é enviado e o
 * campo fica como está no cadastro.
 */
type ModoPreco = "percentual" | "valor" | "fixo";

const PRECO_LABEL: Record<ModoPreco, string> = {
  percentual: "Percentual",
  valor: "Somar R$",
  fixo: "Preço fixo",
};

/**
 * Teto de campos de nome desenhados de uma vez. Renomear é edição fina — quem
 * seleciona três mil produtos está mexendo em preço ou categoria, não digitando
 * três mil nomes; e três mil `<input>` controlados travam a digitação.
 */
const TETO_NOMES = 200;

/** Idem para a prévia "quais produtos vão mudar" — é conferência, não catálogo. */
const TETO_PREVIA = 300;

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
  categorias,
  subcategorias,
  brands,
  suppliers = [],
  fiscais = [],
  locais = [],
  carregandoOpcoes = false,
  onAplicado,
}: {
  open: boolean;
  onClose: () => void;
  produtos: ProdutoLote[];
  /** Categorias e subcategorias já estão no cliente (contexto do layout). */
  categorias: CategoryFilterOpt[];
  subcategorias: SubcategoryFilterOpt[];
  brands: BrandOpt[];
  suppliers?: SupplierPickerOpt[];
  fiscais?: FiscalOpt[];
  /** Locais de armazenagem ativos — cada um pertence a um site. */
  locais?: StorageOpt[];
  /** As três listas acima ainda estão vindo do servidor. */
  carregandoOpcoes?: boolean;
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

  // ── Nomes (um campo por produto) ──
  const [mexerNomes, setMexerNomes] = useState(false);
  /** Começa vazio: só quem for editado entra no mapa (5.000 selecionados não viram 5.000 strings). */
  const [nomes, setNomes] = useState<Record<string, string>>({});
  /** Campos de verdade na tela — acima disso o navegador engasga, não o servidor. */
  const nomesVisiveis = useMemo(
    () => (mexerNomes ? produtos.slice(0, TETO_NOMES) : []),
    [mexerNomes, produtos],
  );
  const nomeOriginal = useMemo(
    () => new Map(produtos.map((p) => [p.id, p.nome])),
    [produtos],
  );
  /** Só o que o operador mexeu de fato vai para o servidor. */
  const nomesAlterados = useMemo(
    () =>
      Object.entries(nomes)
        .map(([id, nome]) => ({ id, nome: nome.trim() }))
        .filter((n) => n.nome && n.nome !== nomeOriginal.get(n.id)),
    [nomes, nomeOriginal],
  );
  const nomeCurto = Object.values(nomes).some((n) => n.trim().length < 2);

  // ── Fiscal ──
  const [mexerFiscal, setMexerFiscal] = useState(false);
  const [fiscalId, setFiscalId] = useState("");

  // ── Localização (local de armazenagem) ──
  const [mexerLocal, setMexerLocal] = useState(false);
  /** "" = sem local (limpa em todos os sites); senão é um storageLocationId. */
  const [localId, setLocalId] = useState("");

  /** Prévia do lote: a lista só é montada depois que o operador abre. */
  const [previaAberta, setPreviaAberta] = useState(false);

  // ── Fornecedores ──
  const [mexerFornecedor, setMexerFornecedor] = useState(false);
  const [modo, setModo] = useState<ModoFornecedor>("substituir");
  const [buscaForn, setBuscaForn] = useState("");
  /** Ordem importa no modo "substituir": o primeiro vira o principal. */
  const [fornSel, setFornSel] = useState<string[]>([]);

  const subs = useMemo(
    () => subcategorias.filter((s) => s.categoryId === categoryId),
    [subcategorias, categoryId],
  );

  const listaForn = useMemo(() => {
    const termo = buscaForn.trim().toLowerCase();
    if (!termo) return suppliers;
    return suppliers.filter((s) =>
      `${s.razaoSocial} ${s.nomeFantasia ?? ""} ${s.cnpj ?? ""}`
        .toLowerCase()
        .includes(termo),
    );
  }, [suppliers, buscaForn]);

  const porId = useMemo(
    () => new Map(suppliers.map((s) => [s.id, s])),
    [suppliers],
  );

  /** Locais por loja: o mesmo nome ("Depósito") se repete entre sites. */
  const locaisPorSite = useMemo(() => {
    const mapa = new Map<string, { siteNome: string; itens: StorageOpt[] }>();
    for (const l of locais) {
      const chave = l.siteId ?? "sem-loja";
      const g = mapa.get(chave) ?? { siteNome: l.siteNome ?? "Loja", itens: [] };
      g.itens.push(l);
      mapa.set(chave, g);
    }
    return [...mapa.values()];
  }, [locais]);

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
    const cat = categorias.find((c) => c.id === categoryId);
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
  if (mexerNomes && nomesAlterados.length) {
    alteracoes.push(
      `nomes → ${nomesAlterados.length} alterado${nomesAlterados.length === 1 ? "" : "s"}`,
    );
  }
  if (mexerFiscal) {
    alteracoes.push(
      fiscalId
        ? `fiscal → ${fiscais.find((f) => f.id === fiscalId)?.nome}`
        : "fiscal → sem perfil",
    );
  }
  if (mexerFornecedor && fornSel.length) {
    alteracoes.push(
      `fornecedores → ${MODO_LABEL[modo].toLowerCase()} ${fornSel.length}`,
    );
  } else if (mexerFornecedor && modo === "substituir") {
    alteracoes.push("fornecedores → remover todos");
  }
  if (mexerLocal) {
    alteracoes.push(
      localId
        ? `local → ${locais.find((l) => l.id === localId)?.nome}`
        : "local → sem local",
    );
  }

  /** Tem campo que vale para o lote inteiro? Nome sozinho não passa por lá. */
  const temCampoLote =
    (mexerCategoria && !!subcategoryId) ||
    mexerMarca ||
    (mexerPreco && precoValido) ||
    mexerFiscal ||
    mexerFornecedor ||
    mexerLocal;

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
    if (mexerNomes && nomeCurto) {
      toast.info("Nome muito curto", "Cada produto precisa de ao menos 2 letras.");
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
        // Nome é campo por produto: vai por fora do lote, que aplica o MESMO
        // valor a todos. Renomeia antes para o `desfazer` do lote continuar
        // valendo para o que ele mesmo mudou.
        if (mexerNomes && nomesAlterados.length) {
          await bulkRenameProducts(nomesAlterados);
        }

        if (!temCampoLote) {
          const n = nomesAlterados.length;
          toast.success(`${n} ${n === 1 ? "produto renomeado" : "produtos renomeados"}`);
          onAplicado?.();
          onClose();
          return;
        }

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
          ...(mexerFiscal ? { fiscalProfileId: fiscalId || null } : {}),
          ...(mexerLocal ? { locationId: localId || null } : {}),
          ...(mexerFornecedor ? { fornecedores: { modo, ids: fornSel } } : {}),
        });
        toast.success(
          `${alterados} ${alterados === 1 ? "produto atualizado" : "produtos atualizados"}`,
          desfazer
            ? mexerNomes && nomesAlterados.length
              ? "O nome não volta com o desfazer."
              : undefined
            : mexerFornecedor
              ? "Vínculo de fornecedor não volta atrás."
              : "Local do estoque não volta atrás.",
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
      <div className="flex flex-col gap-6">
        {/* ── Catálogo: o que o produto É ── */}
        <Grupo titulo="Catálogo">
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
                {categorias.map((c) => (
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

        {/* ── Nomes ──
            Único bloco por produto: os demais aplicam o mesmo valor a todos. */}
        <Bloco
          icon={<TextCursorInput size={15} />}
          titulo="Nomes dos produtos"
          resumo="Corrige o nome de cada selecionado sem abrir um por um."
          ligado={mexerNomes}
          onToggle={() => setMexerNomes((v) => !v)}
        >
          <div className="flex max-h-80 flex-col gap-3 overflow-y-auto pr-0.5">
            {nomesVisiveis.map((p) => (
              <Field key={p.id} label={p.sku}>
                <Input
                  value={nomes[p.id] ?? p.nome}
                  onChange={(e) =>
                    setNomes((cur) => ({ ...cur, [p.id]: e.target.value }))
                  }
                  placeholder="Nome do produto"
                />
              </Field>
            ))}
          </div>
          <p className="mt-2 flex items-start gap-1.5 text-xs text-muted">
            <Info size={13} className="mt-0.5 shrink-0" />
            {produtos.length > TETO_NOMES
              ? `Mostrando os ${TETO_NOMES} primeiros de ${produtos.length}. Renomear é um a um — para o resto, filtre e volte aqui.`
              : nomesAlterados.length
                ? `${nomesAlterados.length} nome${nomesAlterados.length === 1 ? "" : "s"} alterado${nomesAlterados.length === 1 ? "" : "s"}. O nome não volta com o desfazer.`
                : "Quem não for editado fica com o nome atual."}
          </p>
        </Bloco>
        </Grupo>

        {/* ── Comercial: o que o cliente paga ── */}
        <Grupo titulo="Comercial">
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

        {/* ── Promoção ──
            Ainda não existe promoção com prazo no cadastro: o lugar dela fica
            reservado aqui para o operador não procurar em outra tela. */}
        <BlocoFuturo
          icon={<BadgePercent size={15} />}
          titulo="Promoção"
          resumo="Preço com data de início e fim, sem perder o preço cheio. Em breve."
        />
        </Grupo>

        {/* ── Estoque: onde a mercadoria está e de quem vem ── */}
        <Grupo titulo="Estoque">
        {/* ── Fornecedores ── */}
        <Bloco
          icon={<Truck size={15} />}
          titulo="Fornecedores"
          resumo="Vincula ou desvincula fornecedores em massa."
          ligado={mexerFornecedor}
          carregando={carregandoOpcoes}
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
                {suppliers.length === 0
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

        {/* ── Localização ──
            O local mora no estoque (produto × loja), não no cadastro: por isso
            alcança só a loja dona do local escolhido. */}
        <Bloco
          icon={<MapPin size={15} />}
          titulo="Localização"
          resumo="Diz onde a mercadoria fica: geladeira, depósito, prateleira."
          ligado={mexerLocal}
          carregando={carregandoOpcoes}
          onToggle={() => setMexerLocal((v) => !v)}
        >
          {locaisPorSite.length === 0 ? (
            <p className="text-xs text-muted">
              Nenhum local de armazenagem cadastrado. Crie um em Configurações › Lojas.
            </p>
          ) : (
            <>
              <Field label="Local">
                <Select value={localId} onChange={(e) => setLocalId(e.target.value)}>
                  <option value="">Sem local (limpar)</option>
                  {locaisPorSite.map((g, i) => (
                    <optgroup key={i} label={g.siteNome}>
                      {g.itens.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.nome}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              </Field>
              <p className="mt-2 flex items-start gap-1.5 text-xs text-muted">
                <Info size={13} className="mt-0.5 shrink-0" />
                {localId
                  ? "Vale para o estoque da loja dona do local. Produto sem estoque nessa loja fica como está."
                  : "Sem local limpa a localização em todas as lojas."}
              </p>
            </>
          )}
        </Bloco>
        </Grupo>

        {/* ── Fiscal: o que a nota precisa saber ── */}
        <Grupo titulo="Fiscal">
        {/* ── Perfil fiscal ── */}
        <Bloco
          icon={<Receipt size={15} />}
          titulo="Perfil fiscal"
          resumo="Aplica o mesmo NCM/CST a todos os selecionados."
          ligado={mexerFiscal}
          carregando={carregandoOpcoes}
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
        </Grupo>

        {/* ── Prévia do lote ──
            A lista só existe depois de aberta: com a seleção inteira do filtro,
            desenhar milhares de linhas fechadas atrasava a abertura do painel
            para mostrar o que ninguém pediu. */}
        <details
          className="rounded-[var(--radius)] border border-line"
          onToggle={(e) => setPreviaAberta(e.currentTarget.open)}
        >
          <summary className="cursor-pointer select-none px-4 py-2.5 text-sm text-ink-2 hover:bg-surface-2">
            Ver os {produtos.length} produtos que vão mudar
          </summary>
          {previaAberta && (
            <ul className="max-h-56 divide-y divide-line overflow-y-auto border-t border-line text-xs">
              {produtos.slice(0, TETO_PREVIA).map((p) => (
                <li key={p.id} className="flex items-center gap-2 px-4 py-1.5 text-ink-2">
                  <span className="min-w-0 flex-1 truncate">{p.nome}</span>
                  <span className="shrink-0 font-mono text-faint">{p.sku}</span>
                </li>
              ))}
              {produtos.length > TETO_PREVIA && (
                <li className="px-4 py-1.5 text-muted">
                  … e mais {produtos.length - TETO_PREVIA}.
                </li>
              )}
            </ul>
          )}
        </details>
      </div>
    </Sheet>
  );
}

/**
 * Grupo de blocos. Sete caixas iguais empilhadas viram uma parede; o título
 * diz de qual parte do produto o trecho fala (catálogo, comercial, estoque,
 * fiscal) e dá onde descansar o olho ao rolar.
 */
function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
        {titulo}
        <span className="h-px flex-1 bg-line" />
      </h3>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

/** Lugar reservado de um campo que ainda não existe — desligado, sem checkbox. */
function BlocoFuturo({
  icon,
  titulo,
  resumo,
}: {
  icon: React.ReactNode;
  titulo: string;
  resumo: string;
}) {
  return (
    <section className="rounded-[var(--radius)] border border-dashed border-line">
      <div className="flex items-start gap-3 px-4 py-3 opacity-60">
        <Checkbox checked={false} onChange={() => {}} disabled className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-ink-2">
            <span className="text-faint">{icon}</span>
            {titulo}
            <span className="rounded-full border border-line px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted">
              em breve
            </span>
          </span>
          <span className="mt-0.5 block text-xs text-muted">{resumo}</span>
        </span>
      </div>
    </section>
  );
}

/** Bloco de campo opcional: só o que estiver ligado entra na gravação. */
function Bloco({
  icon,
  titulo,
  resumo,
  ligado,
  carregando,
  onToggle,
  children,
}: {
  icon: React.ReactNode;
  titulo: string;
  resumo: string;
  ligado: boolean;
  /** A lista deste bloco ainda está vindo — o painel abre antes dela. */
  carregando?: boolean;
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
      {ligado && (
        <div className="border-t border-line/70 px-4 py-3">
          {carregando ? (
            <p className="text-xs text-muted" aria-live="polite">
              Carregando opções…
            </p>
          ) : (
            children
          )}
        </div>
      )}
    </section>
  );
}
