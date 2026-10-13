"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ScanBarcode,
  Loader2,
  AlertCircle,
  ImagePlus,
  ChevronRight,
  Trash2,
  Plus,
  CornerDownLeft,
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
import { gtinValido } from "@/lib/codigo-lido";
import { arquivoParaThumb } from "@/lib/imagem";
import { POLICY_PADRAO, type EstoquePolicy } from "@/lib/estoque-estrategia";
import { CAMPOS_PADRAO, type CamposCadastro } from "@/lib/cadastro-campos";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { Field, Label, Eyebrow } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageHeader } from "@/components/app/page-header";
import { SkuTag } from "@/components/sku-tag";
import {
  StorageIcon,
  STORAGE_LABEL,
  STORAGE_COLOR,
} from "@/components/app/armazenagem";
import { useVoltaProdutos } from "./_volta";
import {
  createProduct,
  updateProduct,
  buscarImagemPorEan,
  createCategory,
  createSubcategory,
  checkEanTaken,
  sugerirMargemSubcategoria,
  createStorageLocation,
  sitesParaLocal,
} from "../actions";
import { vincularItemAction } from "../../cotacoes/_catalogo/actions";
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

const DRAFT_KEY = "nohub:rascunho:produto-simples";
/**
 * Teto do nome. É limite de TELA, não do banco: a etiqueta imprime a 11pt e a
 * linha do caixa é estreita, e nome que estoura ali vira produto que ninguém
 * identifica na prateleira. O schema do servidor segue sem máximo de propósito
 * — importação de planilha e catálogo antigo trazem nomes maiores, e barrar
 * isso quebraria migração.
 */
const NOME_MAX = 50;

/**
 * Linha da lista de códigos do produto. Um estado só para tudo o que responde
 * por ele, mostrado em DOIS grupos — o operador precisa bater o olho e saber
 * o que passa no caixa e o que só entra pela nota:
 *
 * - unidade (`pk` ausente) → o que vende, e que também pode ser comprado
 *   solto: refrigerante lata; açúcar da marca X, da Y e da Z, que são o mesmo
 *   item no caixa. Vale sempre 1. Grava em `ProductBarcode`.
 * - embalagem (`pk`) → fardo ou caixa, só na compra: fardo com 6. Grava em
 *   `ProductPackaging`, onde o fator multiplica a entrada de estoque.
 *
 * O GRUPO decide o tipo, não a quantidade digitada: linha que mudasse de
 * tabela no meio da digitação pularia de lugar na tela, e embalagem gravada
 * não pode virar unidade — o id dela é referência solta em cotação, pedido e
 * recebimento.
 *
 * `rotulo` é o que o operador escreve para se achar ("União", "Fardo") — vira
 * o rótulo do código ou o nome da embalagem.
 */
type Linha = { codigo: string; rotulo: string; fator: string; pk?: boolean };
const linhaVazia = (codigo = ""): Linha => ({ codigo, rotulo: "", fator: "1" });
const embalagemVazia = (): Linha => ({ codigo: "", rotulo: "", fator: "", pk: true });
/** A linha 0 é sempre unidade — é o código do campo do topo. Nunca embalagem. */
function ehEmbalagem(l: Linha, i: number): boolean {
  return i > 0 && !!l.pk;
}
/**
 * Garante uma unidade no topo: se a linha 0 saiu, a primeira unidade
 * sobe; sem nenhuma, nasce uma em branco. Lista vazia esconderia o campo de
 * código inteiro.
 */
function comUnidadeNoTopo(linhas: Linha[]): Linha[] {
  const i = linhas.findIndex((l) => !l.pk);
  if (i === 0) return linhas;
  if (i < 0) return [linhaVazia(), ...linhas];
  const copia = [...linhas];
  const [unidade] = copia.splice(i, 1);
  return [unidade, ...copia];
}
/**
 * A linha 0 mantém o id `ean` de sempre: `resetForNext`, o atalho de teclado e
 * o "salvar e cadastrar próximo" apontam para ele desde antes da lista existir.
 */
const idDoCodigo = (i: number) => (i === 0 ? "ean" : `cod-${i}`);
/** Âncora da gaveta — o formulário precisa abri-la para apontar erro lá dentro. */
const MAIS_ID = "mais-configuracoes";
/** Gaveta com todos os códigos do produto — o campo do topo aponta pra cá. */
const CODIGOS_ID = "codigos-do-produto";

// ── Peças de UI ────────────────────────────────────────────

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
        className="group relative flex h-[92px] w-[92px] items-center justify-center overflow-hidden rounded-[var(--radius-lg)] border border-line-strong bg-surface-2 transition-colors hover:border-brand/40"
        title={imagemUrl ? "Trocar imagem" : "Adicionar imagem"}
      >
        {imagemUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imagemUrl} alt="" className="h-full w-full object-contain" />
        ) : (
          <ImagePlus size={22} className="text-faint" />
        )}
        <span className="absolute inset-0 grid place-items-center bg-ink/40 opacity-0 transition-opacity group-hover:opacity-100">
          <ImagePlus size={20} className="text-white" />
        </span>
      </button>
      {imagemUrl && (
        <button
          type="button"
          onClick={onClear}
          className="absolute -top-2 -right-2 grid h-6 w-6 place-items-center rounded-full border border-line bg-surface text-danger shadow-[var(--shadow-1)] hover:bg-danger-soft"
          title="Remover imagem"
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
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

/** Linha do editor de variações comerciais (o `id` só existe ao editar). */

export function SimpleProductForm({
  mode,
  product,
  brands,
  categories,
  subcategories,
  storage,
  defaultEstoqueMinimo,
  policy = POLICY_PADRAO,
  campos = CAMPOS_PADRAO,
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
  /** Campos que a operação usa (Configurações → Campos do cadastro). */
  campos?: CamposCadastro;
  /** Veio da revisão do catálogo de um fornecedor (encarte/tabela importada
   * sem vínculo). Só faz sentido com `mode: "new"`. */
  prefill?: ProductPrefill;
}) {
  const router = useRouter();
  const volta = useVoltaProdutos();
  const [pending, start] = useTransition();
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState<string>();
  const nomeRef = useRef<HTMLInputElement>(null);
  const savedRef = useRef(false);
  // Item do fornecedor pendente de vínculo — a primeira gravação herda,
  // "salvar e cadastrar próximo" depois disso já é produto sem origem.
  const [itemParaVincular, setItemParaVincular] = useState(prefill?.itemId ?? null);

  // Identidade
  //
  // Códigos de barras são uma LISTA, não um campo: o mesmo "açúcar 1 kg" chega
  // com o código da União numa semana e da Caravelas na outra, e são um produto
  // só na prateleira. O fardo do refrigerante mora na mesma lista, com a
  // quantidade 6. NÃO há código favorito: a etiqueta pergunta qual imprimir e
  // a NFC-e declara o que foi bipado na venda. A linha 0 é só a do campo do topo.
  //
  // `ean` continua existindo como atalho para a linha 0 — assim o leitor de
  // rajada, o enriquecimento, o rascunho e a checagem de duplicado seguem
  // mexendo num string, como sempre fizeram.
  const [linhas, setLinhas] = useState<Linha[]>(() => {
    const unidades: Linha[] = (product?.codigos ?? []).map((c) => ({
      codigo: c.codigo,
      rotulo: c.rotulo ?? "",
      fator: "1",
    }));
    const embalagens: Linha[] = (product?.packagings ?? []).map((pk) => ({
      codigo: pk.ean ?? "",
      rotulo: pk.nome ?? "",
      fator: pk.fatorConversao != null ? String(pk.fatorConversao) : "",
      pk: true,
    }));
    return [
      ...(unidades.length
        ? unidades
        : [linhaVazia(product?.ean ?? prefill?.ean ?? "")]),
      ...embalagens,
    ];
  });
  const ean = linhas[0]?.codigo ?? "";
  function setEan(v: string) {
    setLinhas((prev) =>
      prev.length ? [{ ...prev[0], codigo: v }, ...prev.slice(1)] : [linhaVazia(v)],
    );
  }
  // Índices de cada grupo na lista única — a tela separa, o estado não.
  const idxUnidades = linhas.flatMap((l, i) => (ehEmbalagem(l, i) ? [] : [i]));
  const idxEmbalagens = linhas.flatMap((l, i) => (ehEmbalagem(l, i) ? [i] : []));
  /** Linhas que dizem alguma coisa — é o número que aparece na gaveta fechada. */
  const linhasPreenchidas = linhas.filter(
    (l, i) => onlyDigits(l.codigo) || (ehEmbalagem(l, i) && l.rotulo.trim()),
  ).length;
  // Nasce aberta quando já há mais de um código: quem edita o açúcar de três
  // marcas precisa ver as três sem caçar.
  const [codigosAbertos, setCodigosAbertos] = useState(linhas.length > 1);
  const [codShake, setCodShake] = useState<number | null>(null);
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
  // Dono de cada código, CHAVEADO PELO CÓDIGO e não pelo índice da linha:
  // remover a linha 1 não pode fazer o aviso da linha 2 escorregar de lugar.
  const [tomados, setTomados] = useState<
    Record<string, { id?: string; nome: string; sku: string }>
  >({});
  const eanTaken = tomados[onlyDigits(ean)] ?? null;
  const [eanShake, setEanShake] = useState(false);
  /** Campos que o operador já visitou — habilita o aviso inline no blur. */
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const touch = (k: string) => setTouched((t) => ({ ...t, [k]: true }));

  // ── Lista de códigos do produto ─────────────────────────
  function adicionarCodigo(embalagem = false) {
    setLinhas((prev) => [...prev, embalagem ? embalagemVazia() : linhaVazia()]);
    setCodigosAbertos(true);
    // O foco vai para a linha nova: quem clicou em "outro código" já tem o
    // produto na mão e quer bipar, não caçar o campo.
    const nova = linhas.length;
    requestAnimationFrame(() => focusById(`cod-${nova}`));
  }
  function mudarLinha(i: number, patch: Partial<Linha>) {
    setLinhas((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function removerLinha(i: number) {
    setLinhas((prev) => comUnidadeNoTopo(prev.filter((_, idx) => idx !== i)));
    setLinhaARemover(null);
  }
  // Só a embalagem pede confirmação: tirar um fardo muda como a nota entra no
  // estoque. Linha em branco ou apelido de unidade some direto.
  function pedirRemocao(i: number) {
    const l = linhas[i];
    if (l && ehEmbalagem(l, i) && (l.codigo.trim() || l.rotulo.trim())) {
      setLinhaARemover(i);
      return;
    }
    removerLinha(i);
  }
  /**
   * Checa dono de um código avulso (linha extra). A linha do topo tem o seu
   * próprio caminho (`onEanBlur`), que também dispara o enriquecimento.
   */
  async function conferirDono(codigoRaw: string) {
    const codigo = onlyDigits(codigoRaw);
    if (!codigo) return;
    try {
      // O próprio produto em edição não conta como conflito.
      const r = await checkEanTaken(codigo, product?.id);
      setTomados((prev) => {
        const proximo = { ...prev };
        if (r.taken) proximo[codigo] = { id: r.id, nome: r.nome!, sku: r.sku! };
        else delete proximo[codigo];
        return proximo;
      });
    } catch {
      /* silencioso — não bloqueia o cadastro */
    }
  }
  /**
   * Mesmo código em duas linhas: a segunda é que pisca. Vale entre unidade e
   * embalagem também — o leitor não sabe a diferença, e o mesmo código valendo
   * 1 e 6 faz o saldo entrar errado.
   */
  function repetidoNaLista(i: number): boolean {
    const d = onlyDigits(linhas[i]?.codigo ?? "");
    if (!d) return false;
    return linhas.findIndex((l) => onlyDigits(l.codigo) === d) !== i;
  }
  /**
   * Uma linha da lista de códigos. `cabecalho` liga os rótulos das colunas —
   * só a primeira linha de cada grupo carrega.
   */
  function linhaDeCodigo(i: number, cabecalho: boolean) {
    const linha = linhas[i];
    const embalagem = ehEmbalagem(linha, i);
    const dono = tomados[onlyDigits(linha.codigo)];
    const repetido = repetidoNaLista(i);
    return (
      <div key={i} className="flex flex-col gap-1">
        <div
          className={cn(
            "grid grid-cols-1 items-end gap-x-5 gap-y-3",
            embalagem
              ? "sm:grid-cols-[minmax(0,2fr)_5.5rem_minmax(0,2fr)_auto]"
              : "sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_auto]",
          )}
        >
          <Field label={cabecalho ? "Código de barras" : ""} htmlFor={`cod-${i}`}>
            <Input
              id={`cod-${i}`}
              value={linha.codigo}
              onChange={(e) => mudarLinha(i, { codigo: onlyDigits(e.target.value) })}
              onBlur={() => conferirDono(linha.codigo)}
              onKeyDown={enterTo(embalagem ? `fator-${i}` : `rotulo-${i}`)}
              placeholder="789…"
              inputMode="numeric"
              aria-label={`Código de barras ${i + 1}`}
              className={cn(
                "font-mono tracking-wide placeholder:font-sans placeholder:tracking-normal",
                (codShake === i || repetido) && "border-danger",
                codShake === i && "shake-x",
              )}
            />
          </Field>
          {embalagem && (
            <Field label={cabecalho ? "Unidades" : ""} htmlFor={`fator-${i}`}>
              <Input
                id={`fator-${i}`}
                value={linha.fator}
                onChange={(e) => mudarLinha(i, { fator: soInteiro(e.target.value) })}
                onKeyDown={enterTo(`rotulo-${i}`)}
                placeholder="6"
                inputMode="numeric"
                aria-label={`Quantas unidades vêm na embalagem ${i + 1}`}
                className="font-mono"
              />
            </Field>
          )}
          <Field
            label={cabecalho ? (embalagem ? "Embalagem" : "Marca") : ""}
            htmlFor={`rotulo-${i}`}
          >
            <Input
              id={`rotulo-${i}`}
              value={linha.rotulo}
              onChange={(e) => mudarLinha(i, { rotulo: e.target.value })}
              maxLength={embalagem ? undefined : 24}
              placeholder={embalagem ? "Fardo, caixa…" : "Opcional"}
              aria-label={
                embalagem ? `Nome da embalagem ${i + 1}` : `Marca do código ${i + 1}`
              }
            />
          </Field>
          <div className="mb-1.5 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => pedirRemocao(i)}
              title={embalagem ? "Remover esta embalagem" : "Remover este código"}
              aria-label={
                embalagem ? `Remover a embalagem ${i + 1}` : `Remover o código ${i + 1}`
              }
              className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-line text-faint transition-colors hover:border-danger/40 hover:bg-danger-soft hover:text-danger"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
        {(repetido || dono || gtinValido(linha.codigo) === false) && (
          <p
            role="status"
            aria-live="polite"
            className="flex flex-wrap items-center gap-x-1.5 text-xs text-warn"
          >
            <AlertCircle size={12} className="shrink-0" />
            {repetido
              ? "Esse código já está em outra linha."
              : dono
                ? `Já é de "${dono.nome}" (${dono.sku}).`
                : "O dígito verificador não fecha — confira antes de salvar."}
          </p>
        )}
      </div>
    );
  }

  // Só depois de identificar o produto o resto da tela aparece — prefill do
  // encarte já identifica, então pula direto pro resto.
  const [semFoto, setSemFoto] = useState(false);

  // Preço
  const [precoVenda, setPrecoVenda] = useState(moneyToMask(product?.precoVenda));
  const [custo, setCusto] = useState(moneyToMask(product?.custo ?? prefill?.custo));

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

  // Venda +18 — não é fiscal: governa o PDV e o totem. O enriquecimento por
  // EAN marca sozinho quando reconhece bebida alcoólica.
  const [restricaoIdade, setIdade] = useState(product?.restricaoIdade ?? false);
  /** Embalagem esperando confirmação para sair da lista de códigos. */
  const [linhaARemover, setLinhaARemover] = useState<number | null>(null);

  // Locais criados aqui — mesma ideia das categorias: entram na lista antes
  // do refresh, senão o operador cria o local e não consegue selecioná-lo.
  const [extraLocais, setExtraLocais] = useState<StorageOpt[]>([]);
  const [criandoLocal, setCriandoLocal] = useState(false);
  const [novoLocal, setNovoLocal] = useState("");
  const [novoLocalTipo, setNovoLocalTipo] = useState<StorageOpt["tipo"]>("AMBIENTE");
  const [sites, setSites] = useState<{ id: string; nome: string }[] | null>(null);
  const [novoLocalSite, setNovoLocalSite] = useState("");
  const [salvandoLocal, setSalvandoLocal] = useState(false);

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
  const allLocais = useMemo(
    () =>
      [...storage, ...extraLocais].filter(
        (l, i, arr) => arr.findIndex((x) => x.id === l.id) === i,
      ),
    [storage, extraLocais],
  );

  /** Abre o criador e busca os estabelecimentos — só na primeira vez. */
  function abrirCriarLocal() {
    setCriandoLocal(true);
    if (sites !== null) return;
    sitesParaLocal()
      .then((r) => {
        setSites(r);
        if (r.length === 1) setNovoLocalSite(r[0].id);
      })
      .catch(() => setSites([]));
  }

  async function criarLocal() {
    const nome = novoLocal.trim();
    if (nome.length < 2) return;
    const siteId = novoLocalSite || sites?.[0]?.id || "";
    if (!siteId) {
      toast.error(
        "Sem estabelecimento",
        "Cadastre um estabelecimento em Configurações antes de criar locais.",
      );
      return;
    }
    setSalvandoLocal(true);
    try {
      const id = await createStorageLocation({ nome, tipo: novoLocalTipo, siteId });
      const site = sites?.find((x) => x.id === siteId) ?? null;
      setExtraLocais((prev) => [
        ...prev,
        {
          id,
          nome,
          tipo: novoLocalTipo,
          ativo: true,
          siteId,
          siteNome: site?.nome ?? null,
        },
      ]);
      // Criar e não selecionar seria trabalho pela metade.
      setLocation(id);
      setNovoLocal("");
      setCriandoLocal(false);
      toast.success("Local criado", `${nome} já está selecionado.`);
    } catch (e) {
      toast.error("Não deu para criar", e instanceof Error ? e.message : "Tente de novo.");
    } finally {
      setSalvandoLocal(false);
    }
  }

  const brandOptions: ComboOption[] = useMemo(
    () => brands.map((b) => ({ value: b.nome, label: b.nome })),
    [brands],
  );
  // ── Derivados ───────────────────────────────────────────
  // `custo` não tem campo neste formulário de propósito: quem o define é a
  // entrada da nota (custo médio). Ele chega pelo produto em edição ou pelo
  // prefill do encarte, e serve só para calcular a margem na tela.
  const margemPct = margem(parseMoney(precoVenda), parseMoney(custo));
  const verdict = margemVerdict(margemPct);
  const precoNum = parseMoney(precoVenda) ?? 0;
  const custoNum = parseMoney(custo) ?? 0;
  const subAtual = allSubs.find((s) => s.id === subcategoryId);
  // Dígito verificador do GTIN. `false` só quando o comprimento é de GTIN e a
  // conta não fecha — código interno de balança devolve null e não vira aviso.
  const eanComDigitoErrado = gtinValido(ean) === false;
  const localAtual = allLocais.find((l) => l.id === locationId) ?? null;
  const minNum = n(estoqueMinimo) ?? 0;
  const idealNum = n(estoqueIdeal) ?? 0;
  const inicialNum = n(estoqueInicial) ?? 0;
  // Ideal abaixo do mínimo faz a sugestão de compra sair negativa — o erro
  // nasce aqui, silencioso, e só aparece na tela de reposição semanas depois.
  const idealAbaixoDoMinimo = policy.usaIdeal && minNum > 0 && idealNum > 0 && idealNum < minNum;
  // Saldo inicial sem local, num tenant que TEM locais, é quase sempre
  // esquecimento: o saldo entra órfão e some da contagem por local.
  const inicialSemLocal =
    campos.armazenagem &&
    mode === "new" &&
    inicialNum > 0 &&
    !locationId &&
    allLocais.length > 0;
  // Nome tem teto de 50 no campo (NOME_MAX). O contador só aparece na reta
  // final: mostrar "3/50" desde a primeira letra é ruído.
  const nomeLen = nome.trim().length;

  // Régua curta de propósito. O cadastro em branco só precisa saber O QUE é e
  // POR QUANTO sai. Embalagem de compra, fator de conversão, custo, fornecedor
  // e fiscal chegam assinados no XML da primeira nota (ver
  // `enriquecerProdutoComNota`) — cobrar isso aqui é pedir ao operador um dado
  // que ele ainda não tem e que o sistema vai receber de graça.
  const etapas = [
    {
      label: "produto",
      done: nome.trim().length >= 2 && !!subcategoryId,
      focus: "nome",
    },
    { label: "preço", done: precoNum > 0, focus: "preco" },
  ];
  // Só para o brilho do botão Salvar: a régua de progresso saiu junto com o
  // painel lateral — dois campos obrigatórios não pedem barra de etapas.
  const isReady = etapas.every((e) => e.done);
  const margemAnimada = useCountUp(margemPct);

  // Campo obrigatório visitado e ainda vazio — aviso na hora, sem esperar o Salvar.
  const faltando = {
    nome: touched.nome && nome.trim().length < 2,
    sub: touched.sub && !subcategoryId,
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

  useEffect(() => {
    if (!eanShake) return;
    const t = setTimeout(() => setEanShake(false), 400);
    return () => clearTimeout(t);
  }, [eanShake]);

  useEffect(() => {
    if (codShake == null) return;
    const t = setTimeout(() => setCodShake(null), 400);
    return () => clearTimeout(t);
  }, [codShake]);

  /**
   * "Mais configurações" nasce fechado — mas o Salvar pode reclamar de um campo
   * lá dentro. Sem abrir a gaveta antes, o foco iria para um elemento oculto e
   * a tela ficaria parada acusando um erro invisível.
   */
  function revelarSeOculto(el: Element | null) {
    const d = document.getElementById(MAIS_ID) as HTMLDetailsElement | null;
    if (d && el && d.contains(el) && !d.open) d.open = true;
    const c = document.getElementById(CODIGOS_ID) as HTMLDetailsElement | null;
    if (c && el && c.contains(el) && !c.open) c.open = true;
  }

  // ── Teclado: Enter caminha pelo formulário ──────────────
  function focusById(id: string) {
    const el = document.getElementById(id) as HTMLElement | null;
    revelarSeOculto(el);
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
    const proxima = etapas[virou + 1];
    if (virou < 0 || !proxima) return;
    // Nunca rolar enquanto o operador digita — só depois de clique/escolha.
    const ativo = document.activeElement?.tagName;
    if (ativo === "INPUT" || ativo === "TEXTAREA" || ativo === "SELECT") return;
    document
      .getElementById(proxima.focus)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
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
    linhas,
    nome,
    sku,
    marca,
    subcategoryId,
    imagemUrl,
    precoVenda,
    custo,
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
    const d = draft as Partial<typeof snapshot> & {
      codigos?: { codigo: string; rotulo: string }[];
    };
    // Rascunho antigo: antes da lista única só havia `codigos` (todos de
    // unidade), e antes disso só `ean` — que vira a linha 0.
    const retomadas: Linha[] = d.linhas?.length
      ? d.linhas
      : d.codigos?.length
        ? d.codigos.map((c) => ({ ...linhaVazia(c.codigo), rotulo: c.rotulo ?? "" }))
        : [linhaVazia(d.ean ?? "")];
    setLinhas(
      comUnidadeNoTopo(
        // Rascunho de quando a quantidade decidia o tipo: mais de 1 é embalagem.
        retomadas.map((l) => (Number(l.fator) > 1 ? { ...l, pk: true } : l)),
      ),
    );
    setCodigosAbertos(retomadas.length > 1);
    setNome(d.nome ?? "");
    setSku(d.sku ?? "");
    setShowSku(!!d.sku);
    setMarca(d.marca ?? "");
    setSubcategoryId(d.subcategoryId ?? "");
    setImagemUrl(d.imagemUrl ?? "");
    setPrecoVenda(d.precoVenda ?? "");
    setCusto(d.custo ?? "");
    setMin(soInteiro(d.estoqueMinimo ?? ""));
    setIdeal(soInteiro(d.estoqueIdeal ?? ""));
    setLocation(d.locationId ?? "");
    setQuerInicial(d.querInicial ?? null);
    setInicial(soInteiro(d.estoqueInicial ?? ""));
    setIdade(d.restricaoIdade ?? false);
    setDraft(null);
    toast.success("Cadastro retomado", "Continue de onde parou.");
  }

  // ── Preço sugerido: margem mediana praticada na subcategoria ──
  const [sugestao, setSugestao] = useState<{
    margemPct: number;
    base: number;
  } | null>(null);
  useEffect(() => {
    let vivo = true;
    // Só o cadastro mostra a sugestão — na edição nem vale gastar a consulta.
    if (!subcategoryId || mode !== "new") {
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
  }, [subcategoryId, mode]);

  // Preço que zera a diferença para a margem mediana da subcategoria.
  const precoSugerido =
    sugestao && custoNum > 0 && sugestao.margemPct < 100
      ? custoNum / (1 - sugestao.margemPct / 100)
      : null;

  // ── Ações ───────────────────────────────────────────────
  async function buscarEan(codigoRaw?: string) {
    const codigo = codigoRaw ?? ean;
    // Só a BUSCA exige GTIN: a base de fotos responde por código cadastrado na
    // GS1, e código interno de balança não existe para ela. Gravar sem GTIN é
    // livre — o campo não tem comprimento mínimo.
    if (gtinValido(codigo) === null) {
      setEanShake(true);
      toast.error(
        "Busca de foto indisponível",
        "Ela funciona com EAN/GTIN (8, 12, 13 ou 14 dígitos). Envie a imagem à mão.",
      );
      return;
    }
    setError(undefined);
    setSemFoto(false);
    setEnriching(true);
    try {
      const r = await buscarImagemPorEan(codigo);
      switch (r.status) {
        case "encontrada":
          setImagemUrl(r.imagemUrl);
          toast.success("Foto encontrada", "Preencha o nome e a categoria.");
          break;
        case "ja_cadastrado":
          toast.error(
            "Código já cadastrado",
            `${r.produtoExistente.nome} (${r.produtoExistente.sku}).`,
          );
          break;
        case "sem_imagem":
          setSemFoto(true);
          break;
        case "erro":
          toast.error("Não foi possível buscar a foto", "Tente de novo ou envie a imagem à mão.");
          break;
        default:
          break;
      }
      requestAnimationFrame(() => nomeRef.current?.focus());
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
    // Só dígitos, comprimento livre: código de barras é número, e o que não é
    // número nunca bipa. Filtrar aqui evita o espaço colado do leitor antigo e
    // a letra que escapa do teclado numérico do celular.
    setEan(onlyDigits(v));

    const agora = performance.now();
    const st = scan.current;
    if (!st.ultima || agora - st.ultima > 300) st.inicio = agora;
    st.ultima = agora;
    if (st.timer) window.clearTimeout(st.timer);

    const digitos = onlyDigits(v);
    const emRajada = agora - st.inicio < 600 && digitos.length >= 8;
    if (!emRajada || enriching) return;
    // Rajada de código que não é GTIN (interno de balança, etiqueta da loja):
    // não há catálogo externo para consultar, mas saber se o código já tem dono
    // continua valendo. Sem esta guarda o bipe virava um toast de erro.
    if (gtinValido(digitos) === null) {
      st.timer = window.setTimeout(() => conferirDono(digitos), 150);
      return;
    }
    st.timer = window.setTimeout(() => buscarEan(v), 150);
  }

  async function onEanBlur() {
    await conferirDono(ean);
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

    function focusField(id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    revelarSeOculto(el);
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    (el as HTMLElement).focus?.({ preventScroll: true });
  }

  function resetForNext() {
    setLinhas([linhaVazia()]);
    setCodigosAbertos(false);
    setNome("");
    setSku("");
    setMarca("");
    setPrecoVenda("");
    setCusto("");
    setImagemUrl("");
    setShowImgUrl(false);
    setShowSku(false);
    setQuerInicial(null);
    setInicial("");
    setTomados({});
    setSemFoto(false);
    setError(undefined);
  }

  function salvar(andNew = false) {
    // Ctrl+Enter não passa por botão desabilitado: sem esta guarda, dois
    // atalhos seguidos criavam DOIS produtos iguais.
    if (pending) return;
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
    if (idealAbaixoDoMinimo) {
      setError("O estoque ideal precisa ser maior que o mínimo.");
      focusField("ideal");
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

    // Linha repetida é erro do dedo, não intenção: o servidor recusaria o
    // cadastro inteiro por isso. Avisa aqui, antes de gastar a gravação.
    const repetida = linhas.findIndex((_, i) => repetidoNaLista(i));
    if (repetida >= 0) {
      setCodShake(repetida);
      setError("O mesmo código de barras está em duas linhas.");
      focusField(`cod-${repetida}`);
      return;
    }

    // Embalagem que já existia e ficou sem quantidade: gravar assim a apagaria
    // em silêncio, e ela pode estar em pedido ou cotação aberta.
    const semQuantidade = linhas.findIndex(
      (l, i) => ehEmbalagem(l, i) && !((n(l.fator) ?? 0) > 0),
    );
    if (semQuantidade >= 0) {
      setError("Informe quantas unidades vêm nessa embalagem — ou remova a linha.");
      focusField(`fator-${semQuantidade}`);
      return;
    }

    // O grupo decide o destino: unidade vira código de barras do produto,
    // fardo/caixa vira embalagem de compra.
    const barras = linhas
      .map((l, i) => ({ l, i }))
      .filter(({ l, i }) => !ehEmbalagem(l, i))
      .map(({ l, i }) => ({
        codigo: onlyDigits(l.codigo),
        rotulo: l.rotulo.trim() || undefined,
        // Só alimenta o espelho `Product.ean` no servidor — na tela não
        // existe favorito.
        principal: i === 0,
      }))
      .filter((c) => c.codigo);

    const embalagens = linhas
      .filter((l, i) => ehEmbalagem(l, i))
      .map((l) => ({
        // Sem nome, a quantidade nomeia: a embalagem precisa de um para
        // aparecer no pedido e na cotação.
        nome: l.rotulo.trim() || `Embalagem c/ ${n(l.fator)}`,
        ean: onlyDigits(l.codigo) || undefined,
        fatorConversao: n(l.fator)!,
      }));

    // Campos que este formulário NÃO gerencia mais (fornecedor, variação,
    // fiscal, canais online) viajam de volta como vieram na EDIÇÃO. O schema
    // do servidor aplica default `[]`/`false`/`null` no que chega ausente —
    // sem isto, corrigir o nome de um produto apagaria os fornecedores dele,
    // os canais de venda e o perfil fiscal, em silêncio.
    const preservado = product
      ? {
          fiscalProfileId: product.fiscalProfileId ?? undefined,
          gtinTributavel: product.gtinTributavel ?? undefined,
          unidadeTributavel: product.unidadeTributavel ?? undefined,
          fatorConversaoTrib: product.fatorConversaoTrib ?? undefined,
          codigoAnp: product.codigoAnp ?? undefined,
          fornecedoresIds: [...product.fornecedores]
            .sort((a, b) => Number(b.isPrincipal) - Number(a.isPrincipal))
            .map((f) => f.id),
          custoFornecedor: product.custoFornecedor ?? undefined,
          vendeOnline: product.vendeOnline,
          pesoGramas: product.pesoGramas ?? undefined,
          alturaCm: product.alturaCm ?? undefined,
          larguraCm: product.larguraCm ?? undefined,
          comprimentoCm: product.comprimentoCm ?? undefined,
          descricaoOnline: product.descricaoOnline ?? undefined,
          salesChannels: product.salesChannels
            .filter((c) => c.ativo && c.precoCanal != null)
            .map((c) => ({
              canal: c.canal,
              precoCanal: c.precoCanal!,
              descricaoCanal: c.descricaoCanal ?? undefined,
            })),
        }
      : {};

    const input = {
      ...preservado,
      tipo: "SIMPLES" as const,
      sku: sku.trim() || undefined,
      // `ean` vai junto como espelho da linha 0; `codigos` é a lista de verdade
      // e manda quando as duas chegam (ver `principalDosCodigos`).
      ean: onlyDigits(ean) || undefined,
      codigos: barras,
      nome,
      subcategoryId,
      // Campo desligado não manda nada: `undefined` deixa a marca gravada
      // intacta (ver `mexeMarca` em updateProduct). Com o campo ligado, string
      // vazia é o operador limpando de propósito.
      marcaNome: campos.marca ? marca.trim() : undefined,
      brandId:
        campos.marca && product?.brandId && product.marca === marca
          ? product.brandId
          : undefined,
      imagemUrl: imagemUrl || undefined,
      // Produto SIMPLES vende a unidade fechada. Não é escolha: o fracionado
      // por dose é assunto de INSUMO/receita, que tem formulário próprio.
      unidadeBase: "UN" as const,
      vendaUnidade: true,
      fracionavel: false,
      precoVenda: parseMoney(precoVenda),
      custo: parseMoney(custo),
      restricaoIdade,
      // Perfil fiscal, embalagem de compra, fornecedor e canais online não são
      // perguntados aqui: chegam pelo XML da nota (ver enriquecerProdutoComNota)
      // ou pelo sidepanel da lista de produtos. Na criação nascem vazios; na
      // edicao, undefined deixa o que já está gravado intacto.
      controlaEstoque: true,
      // Trunca também aqui: prefill (CSV/EAN) pode trazer decimal.
      estoqueMinimo: Math.trunc(n(estoqueMinimo) ?? 0),
      estoqueIdeal: Math.trunc(n(estoqueIdeal) ?? 0),
      estoqueInicial: querInicial ? Math.trunc(n(estoqueInicial) ?? 0) : 0,
      // `null` limpa; `undefined` (campo desligado) preserva o local gravado.
      locationId: campos.armazenagem ? locationId || null : undefined,
      packagings: embalagens,
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
        router.push(itemId && prefill ? `/fornecedores/${prefill.supplierId}/catalogo` : volta);
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
      router.push(volta);
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
        backHref={volta}
        breadcrumbs={[{ label: "Produtos", href: volta }, { label: title }]}
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

      {/* pb-6 e não pb-28: o rodapé é `sticky`, então ele mesmo ocupa o
          espaço no fim do fluxo. O respiro grande sobrou de quando o
          formulário tinha quatro etapas e rolava muito. */}
      <div className="px-4 pb-6 sm:px-8">
        {/* Um cartão só, largura cheia. Painel lateral ao lado de cinco campos
            vira moldura; a largura rende mais como campo lado a lado. */}
        <div className="flex w-full flex-col gap-4">
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

            {/* ── O cadastro inteiro ──
                Duas faixas, não sete campos soltos: quem lê a tela pela primeira
                vez precisa enxergar "o que é este produto" separado de "como ele
                é classificado e vendido". A grade de 12 colunas só se abre em
                telas largas; abaixo disso empilha em duas e depois em uma. */}
            <section className="fade-up overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface shadow-[var(--shadow-1)]">
              {/* ── Faixa 1 · Identificação ── */}
              <div className="flex flex-col gap-4 p-5 sm:p-6">
                <Eyebrow as="h2" className="text-brand-strong">
                  Identificação
                </Eyebrow>

                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
                  {/* A imagem e a forma de trazê-la ficam juntas: o atalho de
                      colar URL morava lá embaixo, na faixa de preço, e quem
                      clicava nele perdia de vista o quadro que ia mudar. */}
                  <div className="flex shrink-0 flex-col items-center gap-1.5">
                    <ImageThumb
                      imagemUrl={imagemUrl}
                      onPick={() => imgFileRef.current?.click()}
                      onClear={() => setImagemUrl("")}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setShowImgUrl((v) => !v);
                        if (!showImgUrl) requestAnimationFrame(() => focusById("img-url"));
                      }}
                      aria-expanded={showImgUrl}
                      aria-controls="img-url"
                      className="flex items-center gap-1 text-[11px] text-muted underline-offset-2 hover:text-ink hover:underline"
                    >
                      <ImagePlus size={11} /> {showImgUrl ? "Ocultar URL" : "Colar URL"}
                    </button>
                  </div>

                  <div className="grid min-w-0 flex-1 grid-cols-1 items-start gap-x-5 gap-y-4 sm:grid-cols-2 xl:grid-cols-12">
                    {/* Código de barras. Primeiro campo porque quase todo cadastro
                        começa com um bipe — mas é CAMPO, não portão: quem não tem
                        código segue direto para o nome.

                        Este campo é a linha 0 da lista de códigos do produto: o
                        cadastro de quem tem um código só fica idêntico ao que
                        sempre foi, e quem precisa de três clica uma vez. */}
                    <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2 xl:col-span-4">
                      <div className="flex items-center justify-between gap-2">
                        <Label htmlFor={idDoCodigo(0)}>
                          Código de barras
                        </Label>
                        <button
                          type="button"
                          onClick={() => adicionarCodigo()}
                          className="flex shrink-0 items-center gap-1 text-[11px] text-muted underline-offset-2 hover:text-ink hover:underline"
                        >
                          <Plus size={11} /> outro código
                        </button>
                      </div>
                      <div className="relative">
                        <ScanBarcode
                          size={17}
                          aria-hidden
                          className={cn(
                            "pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 transition-colors",
                            enriching ? "text-brand-strong" : "text-muted",
                          )}
                        />
                        <Input
                          id="ean"
                          autoFocus={mode === "new"}
                          value={ean}
                          // Na edição o campo é só um campo: a rajada do leitor
                          // não pode disparar a busca e trocar a foto que o
                          // operador já escolheu.
                          onChange={(e) =>
                            mode === "new"
                              ? onEanChange(e.target.value)
                              : setEan(onlyDigits(e.target.value))
                          }
                          onBlur={onEanBlur}
                          onKeyDown={(e) => {
                            if (e.key !== "Enter") return;
                            e.preventDefault();
                            if (mode === "new" && gtinValido(ean) !== null) buscarEan();
                            else focusById("nome");
                          }}
                          disabled={enriching}
                          aria-busy={enriching}
                          placeholder="7891000315507"
                          inputMode="numeric"
                          className={cn(
                            "pl-10 font-mono tracking-wide placeholder:font-sans placeholder:tracking-normal",
                            mode === "new" && "pr-11",
                            eanShake && "shake-x border-danger",
                          )}
                        />
                        {mode === "new" && (
                          <button
                            type="button"
                            onClick={() => buscarEan()}
                            // Só GTIN tem foto na base externa. Código interno de
                            // balança grava normalmente — só não tem o que buscar.
                            disabled={enriching || gtinValido(ean) === null}
                            title="Buscar foto do produto"
                            aria-label="Buscar foto do produto"
                            className="absolute top-1/2 right-1.5 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-[var(--radius-sm)] text-brand-strong transition-colors hover:bg-brand-soft disabled:cursor-not-allowed disabled:text-faint disabled:hover:bg-transparent"
                          >
                            {enriching ? (
                              <Loader2 size={15} className="animate-spin" />
                            ) : (
                              <ImagePlus size={15} />
                            )}
                          </button>
                        )}
                        {enriching && (
                          <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[var(--radius)]">
                            <div className="scan-line absolute inset-y-1 w-1/3 bg-gradient-to-r from-transparent via-brand/25 to-transparent" />
                          </div>
                        )}
                      </div>

                      {/* O topo é só o bipe do primeiro código de unidade. Outras marcas
                          e o fardo moram na lista lá embaixo, onde a quantidade
                          de cada código fica escrita — é ela que evita o erro
                          caro: código de FARDO gravado como unidade, saldo
                          entrando dividido por 12 até o inventário não fechar. */}
                      <p className="text-xs text-muted">
                        {linhas.length > 1
                          ? `São ${linhas.length} códigos na `
                          : "Outra marca do mesmo item, ou o código do fardo? Vai na "}
                        <button
                          type="button"
                          onClick={() => {
                            setCodigosAbertos(true);
                            requestAnimationFrame(() => focusField("cod-0"));
                          }}
                          className="underline underline-offset-2 hover:text-ink"
                        >
                          lista de códigos do produto
                        </button>
                        .
                      </p>
                    </div>

                    <Field
                      label="Nome do produto"
                      htmlFor="nome"
                      required
                      hint={
                        nomeLen >= 40 ? (
                          <span
                            className={cn(
                              "flex items-center gap-1.5",
                              nomeLen >= NOME_MAX ? "text-warn" : "text-muted",
                            )}
                          >
                            {nomeLen >= NOME_MAX && (
                              <AlertCircle size={12} className="shrink-0" />
                            )}
                            <span className="font-mono">
                              {nomeLen}/{NOME_MAX}
                            </span>
                            — nomes longos cortam na etiqueta e na tela do caixa.
                          </span>
                        ) : undefined
                      }
                      className="min-w-0 xl:col-span-8"
                    >
                      <Input
                        id="nome"
                        ref={nomeRef}
                        value={nome}
                        onChange={(e) => setNome(e.target.value)}
                        onBlur={() => touch("nome")}
                        onKeyDown={enterTo("sub")}
                        maxLength={NOME_MAX}
                        placeholder="Ex.: Heineken Long Neck 330ml"
                        className={cn(
                          "text-[15px] font-medium placeholder:text-sm placeholder:font-normal",
                          faltando.nome && "border-warn",
                        )}
                      />
                    </Field>

                    {/* Campo da URL nasce ao lado do quadro da imagem, na mesma
                        faixa — o que se cola aqui aparece dois centímetros à
                        esquerda, e não numa seção adiante. */}
                    {showImgUrl && (
                      <Field
                        label="URL da imagem"
                        htmlFor="img-url"
                        hint="Cole o endereço de uma imagem da web."
                        className="fade-up sm:col-span-2 xl:col-span-12"
                      >
                        <Input
                          id="img-url"
                          value={imagemUrl.startsWith("data:") ? "" : imagemUrl}
                          onChange={(e) => setImagemUrl(e.target.value)}
                          placeholder="https://…"
                          inputMode="url"
                          className="font-mono text-xs placeholder:font-sans placeholder:text-sm"
                        />
                      </Field>
                    )}

                    {/* Recados da faixa — atravessam a grade inteira para não
                        empurrar campo nenhum de lugar quando aparecem. */}
                    {(eanTaken || eanComDigitoErrado || semFoto) && (
                      <div
                        // Sem isto, quem usa leitor de tela digita o código e não
                        // fica sabendo que já existe produto com ele.
                        role="status"
                        aria-live="polite"
                        className="flex flex-col gap-1.5 sm:col-span-2 xl:col-span-12"
                      >
                        {/* Dígito verificador não fecha. Avisa, não bloqueia:
                            existe catálogo antigo com GTIN errado e código
                            interno que ninguém quer ser impedido de cadastrar —
                            mas quem digitou torto precisa saber agora, e não no
                            caixa com fila. */}
                        {eanComDigitoErrado && (
                          <p className="fade-up flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-warn">
                            <AlertCircle size={13} className="shrink-0" />
                            <span className="min-w-0 flex-1">
                              O dígito verificador deste código não fecha. Confira antes de
                              salvar — código errado não bipa no caixa.
                            </span>
                          </p>
                        )}

                        {eanTaken && (
                          <div className="fade-up flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-warn">
                            <AlertCircle size={13} className="shrink-0" />
                            <span className="min-w-0 flex-1">
                              Já existe um produto com esse código:{" "}
                              <span className="font-medium">{eanTaken.nome}</span> ({eanTaken.sku}
                              ).
                            </span>
                            {eanTaken.id && (
                              <Link
                                href={`/produtos/${eanTaken.id}/editar`}
                                className="flex shrink-0 items-center gap-1 font-medium underline underline-offset-2"
                              >
                                <Pencil size={11} /> Editar o existente
                              </Link>
                            )}
                          </div>
                        )}

                        {semFoto && (
                          <p className="text-xs text-muted">
                            Sem foto na base para este código — envie uma imagem ou siga sem ela.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Faixa 2 · Classificação e preço ── */}
              <div className="flex flex-col gap-4 border-t border-line bg-surface-2/30 p-5 sm:p-6">
                <Eyebrow as="h2">Classificação e preço</Eyebrow>

                <div className="grid grid-cols-1 items-start gap-x-5 gap-y-4 sm:grid-cols-2 xl:grid-cols-12">
                  <Field
                    label="Categoria"
                    htmlFor="sub"
                    required
                    error={faltando.sub ? "Escolha a categoria." : undefined}
                    className="xl:col-span-3"
                  >
                    <div onBlur={() => touch("sub")}>
                      <Combobox
                        id="sub"
                        value={subcategoryId}
                        onChange={setSubcategoryId}
                        options={subOptions}
                        placeholder="Busque ou crie…"
                        emptyText="Nenhuma categoria com esse nome."
                        // Sem marca na tela, o Enter pula direto para o preço.
                        onCommit={() => focusById(campos.marca ? "marca" : "preco")}
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

                  {campos.marca && (
                    <Field label="Marca" htmlFor="marca" className="xl:col-span-3">
                      <Combobox
                        id="marca"
                        value={marca}
                        onChange={setMarca}
                        options={brandOptions}
                        placeholder="Ex.: Heineken"
                        freeText
                        onCommit={() => focusById("preco")}
                        onCreate={(q) => setMarca(q)}
                        createLabel={(q) => `Criar “${q}”`}
                      />
                    </Field>
                  )}

                  {/* Preço fica com os outros obrigatórios. Num painel lateral ele
                      ficava longe do nome e da categoria, e no celular caía depois
                      de tudo — inclusive depois do que é opcional.
                      Produto simples vende sempre por UNIDADE: não há o que
                      escolher, e por isso a unidade não é campo. */}
                  <Field
                    label="Preço de venda"
                    htmlFor="preco"
                    required
                    hint="Por unidade."
                    className="xl:col-span-2"
                  >
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted select-none">
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

                  {/* SKU ao lado do preço: são as duas etiquetas que o operador
                      confere junto — a de prateleira e a de preço. */}
                  {showSku && (
                    <Field
                      label="SKU"
                      htmlFor="sku"
                      hint="Vazio = gerado ao salvar."
                      className="xl:col-span-2"
                    >
                      <Input
                        id="sku"
                        autoFocus={mode !== "edit"}
                        value={sku}
                        onChange={(e) => setSku(e.target.value.toUpperCase())}
                        placeholder={skuPreview(subcategoryId)}
                        className="font-mono placeholder:font-sans placeholder:font-normal placeholder:tracking-normal"
                      />
                    </Field>
                  )}

                  {/* Margem e média da categoria só no CADASTRO, onde ainda
                      não há preço definido e a referência ajuda a chutar o
                      primeiro. Na edição saíram: o custo ali é custo médio de
                      compra, e ver "margem 12%" ao lado do campo empurrava o
                      operador a mexer no preço por causa de um número que muda
                      a cada nota — quem analisa margem tem o relatório. */}
                  {mode === "new" && (verdict || (precoSugerido && sugestao)) && (
                    <div className="flex flex-col justify-end gap-1 text-xs sm:col-span-2 xl:col-span-4 xl:pb-2.5">
                      {verdict && (
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={cn(
                              "flex items-center gap-1 font-mono font-semibold",
                              verdict.tone === "ok" && "text-ok",
                              verdict.tone === "warn" && "text-warn",
                              verdict.tone === "danger" && "text-danger",
                            )}
                          >
                            {verdict.tone === "danger" ? (
                              <TrendingDown size={12} />
                            ) : (
                              <TrendingUp size={12} />
                            )}
                            {margemAnimada}%
                          </span>
                          <span className="text-muted">
                            {verdict.label.toLowerCase()}
                            {custoNum > 0 && ` · lucro ${brl(precoNum - custoNum)} por unidade`}
                          </span>
                        </span>
                      )}
                      {precoSugerido && sugestao && (
                        <button
                          type="button"
                          onClick={() => setPrecoVenda(moneyToMask(precoSugerido))}
                          className="flex flex-wrap items-center gap-1.5 text-left text-accent underline-offset-2 hover:underline"
                        >
                          <Lightbulb size={12} className="shrink-0" />
                          Média em {subAtual?.nome}: {sugestao.margemPct}% → usar{" "}
                          <span className="font-mono font-semibold">{brl(precoSugerido)}</span>
                        </button>
                      )}
                    </div>
                  )}

                </div>

                {/* Venda +18. Não é fiscal: quem obedece isso é o PDV e o totem,
                    que pedem confirmação de idade antes de fechar a venda. O
                    enriquecimento por EAN já marca sozinho em bebida alcoólica —
                    o campo existe para conferir e desmarcar. */}
                <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-ink-2">
                  <input
                    type="checkbox"
                    checked={restricaoIdade}
                    onChange={(e) => setIdade(e.target.checked)}
                    className="cursor-pointer accent-[var(--brand)]"
                  />
                  Venda restrita a maiores de 18 anos
                </label>

                {/* Saída rara vira link, não campo: o SKU nasce da categoria.
                    (A URL da imagem tem o atalho dela junto do quadro, na faixa
                    de identificação.) */}
                {!showSku && (
                  <div className="flex flex-wrap items-center gap-4">
                    <button
                      type="button"
                      id="sku"
                      onClick={() => setShowSku(true)}
                      className="flex items-center gap-1 text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
                    >
                      <Pencil size={12} /> Personalizar SKU
                    </button>
                  </div>
                )}
              </div>
              {/* ── Faixa 3 · Estoque ──
                  Fica no cadastro (e não numa gaveta) porque é a única coisa
                  daqui que a nota NÃO traz: o local é escolha de layout da loja
                  e a contagem inicial é o que faz o mercado que já tem
                  mercadoria na prateleira sair do zero. */}
              <div className="flex flex-col gap-4 border-t border-line p-5 sm:p-6">
                <Eyebrow as="h2">Estoque</Eyebrow>

                {policy.usaGiro && (
                  <p className="flex items-start gap-2 text-xs text-muted">
                    <Sparkles size={13} className="mt-0.5 shrink-0 text-brand" />
                    Sua empresa repõe por rotatividade: a quantidade a comprar sai do giro de
                    venda deste produto, sem meta fixa.
                  </p>
                )}

                <div className="grid grid-cols-1 items-start gap-x-5 gap-y-4 sm:grid-cols-2 xl:grid-cols-12">
                  {/* O campo existe mesmo sem local nenhum cadastrado: escondê-lo
                      fazia quem nunca criou um local nem descobrir que a
                      funcionalidade existe. Quem desligou armazenagem em
                      Configurações é outro caso — ali a decisão é explícita. */}
                  {campos.armazenagem && (
                    <Field
                      label="Local do estoque"
                      htmlFor="loc"
                      // O ícone do tipo aparece no hint porque `select` nativo não
                      // desenha nada dentro das opções — e a temperatura é o que o
                      // operador confere de relance.
                      hint={
                        localAtual ? (
                          <span className="flex items-center gap-1.5">
                            <StorageIcon tipo={localAtual.tipo} size={12} />
                            <span className={STORAGE_COLOR[localAtual.tipo]}>
                              {STORAGE_LABEL[localAtual.tipo]}
                            </span>
                          </span>
                        ) : (
                          "Onde este produto fica guardado."
                        )
                      }
                      className="xl:col-span-3"
                    >
                      <Select
                        id="loc"
                        value={locationId}
                        onChange={(e) => setLocation(e.target.value)}
                        disabled={allLocais.length === 0}
                      >
                        <option value="">
                          {allLocais.length === 0 ? "Nenhum local cadastrado" : "Sem local"}
                        </option>
                        {allLocais.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.nome}
                            {l.siteNome ? ` — ${l.siteNome}` : ""}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}

                  {policy.usaMinimo && (
                    <Field label="Estoque mínimo" htmlFor="min" className="xl:col-span-2">
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
                    <Field
                      label="Estoque ideal"
                      htmlFor="ideal"
                      error={
                        idealAbaixoDoMinimo
                          ? `Precisa ser maior que o mínimo (${minNum}).`
                          : undefined
                      }
                      className="xl:col-span-2"
                    >
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

                  {/* Contagem INICIAL, e só na criação: depois disso quem mexe em
                      saldo é entrada, venda ou ajuste — nunca um formulário de
                      cadastro. Na edição o campo não existe justamente para não
                      parecer que dá para corrigir estoque digitando por cima. */}
                  {mode === "new" && (
                    <>
                      <Field
                        label="Estoque inicial"
                        htmlFor="ini"
                        hint="O que já está na prateleira hoje. Em branco = começa zerado."
                        className="xl:col-span-3"
                      >
                        <Input
                          id="ini"
                          value={estoqueInicial}
                          onChange={(e) => {
                            const v = soInteiro(e.target.value);
                            setInicial(v);
                            setQuerInicial(v !== "" && Number(v) > 0);
                          }}
                          placeholder="0"
                          inputMode="numeric"
                          className="font-mono"
                        />
                      </Field>
                    </>
                  )}
                </div>

                {campos.armazenagem && (criandoLocal ? (
                  <div className="fade-up flex flex-col gap-3 rounded-[var(--radius)] border border-line bg-surface-2/40 p-3 sm:flex-row sm:items-end">
                    <Field label="Nome do local" htmlFor="novo-local" className="min-w-0 flex-1">
                      <Input
                        id="novo-local"
                        autoFocus
                        value={novoLocal}
                        onChange={(e) => setNovoLocal(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void criarLocal();
                          }
                          if (e.key === "Escape") setCriandoLocal(false);
                        }}
                        placeholder="Ex.: Geladeira da frente"
                      />
                    </Field>
                    {/* Três opções: viram botões, não um select. A temperatura é
                        o que distingue um local do outro, e ela se lê pelo ícone
                        muito antes de se ler pela palavra. */}
                    <div className="flex flex-col gap-1.5">
                      <Label>Tipo</Label>
                      <div className="flex gap-1.5" role="group" aria-label="Tipo do local">
                        {(["AMBIENTE", "REFRIGERADO", "CONGELADO"] as const).map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setNovoLocalTipo(t)}
                            aria-pressed={novoLocalTipo === t}
                            className={cn(
                              "flex h-11 items-center gap-1.5 rounded-[var(--radius)] border px-3 text-sm font-medium transition-colors",
                              novoLocalTipo === t
                                ? "border-brand bg-brand-soft text-ink"
                                : "border-line-strong bg-surface text-ink-2 hover:border-brand/40",
                            )}
                          >
                            <StorageIcon tipo={t} size={15} />
                            <span className="hidden sm:inline">{STORAGE_LABEL[t]}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* Só pergunta a loja quando há mais de uma — com uma só, a
                        pergunta tem uma resposta possível. */}
                    {(sites?.length ?? 0) > 1 && (
                      <Field label="Estabelecimento" htmlFor="novo-local-site" className="sm:w-52">
                        <Select
                          id="novo-local-site"
                          value={novoLocalSite}
                          onChange={(e) => setNovoLocalSite(e.target.value)}
                        >
                          {(sites ?? []).map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.nome}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    )}
                    <div className="flex shrink-0 items-center gap-2 pb-0.5">
                      <Button
                        size="sm"
                        onClick={() => void criarLocal()}
                        disabled={salvandoLocal || novoLocal.trim().length < 2}
                      >
                        {salvandoLocal ? <Loader2 size={14} className="animate-spin" /> : "Criar"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setCriandoLocal(false)}>
                        Cancelar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={abrirCriarLocal}
                    className="flex w-fit items-center gap-1 text-xs font-medium text-brand-strong hover:text-brand"
                  >
                    <Plus size={13} />
                    {allLocais.length === 0
                      ? "Criar o primeiro local de estoque"
                      : "Criar local"}
                  </button>
                ))}

                {inicialSemLocal && (
                  <p className="flex items-start gap-2 text-xs text-warn">
                    <AlertCircle size={13} className="mt-0.5 shrink-0" />
                    Este saldo vai entrar sem local. Ele não aparece na contagem por
                    prateleira nem na transferência entre locais até alguém movimentar.
                  </p>
                )}

                {mode === "new" && inicialNum > 0 && custoNum <= 0 && (
                  <p className="flex items-start gap-2 text-xs text-muted">
                    <AlertCircle size={13} className="mt-0.5 shrink-0 text-muted" />
                    Este saldo entra sem custo. A primeira nota de compra deste produto
                    define o custo médio — e a margem só aparece a partir dali.
                  </p>
                )}
              </div>

              {/* ── Códigos deste produto ──
                  Tudo o que responde por ele, em dois grupos: a unidade (o que
                  vende — e que a nota também pode trazer solta) e o fardo ou
                  caixa (só compra). Separados na tela porque a pergunta do
                  operador é "o que passa no caixa?", e misturados ele teria de
                  ler a quantidade linha a linha para responder. A primeira
                  unidade é o mesmo código do campo lá de cima. */}
              <details
                id={CODIGOS_ID}
                open={codigosAbertos}
                onToggle={(e) => setCodigosAbertos(e.currentTarget.open)}
                className="group border-t border-line"
              >
                <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 text-sm text-muted transition-colors hover:text-ink-2 sm:px-6 [&::-webkit-details-marker]:hidden">
                  <ChevronRight
                    size={14}
                    aria-hidden
                    className="shrink-0 transition-transform duration-200 group-open:rotate-90"
                  />
                  Códigos de barras deste produto
                  {linhasPreenchidas > 0 && (
                    <span className="font-mono text-xs text-faint">
                      · {linhasPreenchidas}
                    </span>
                  )}
                </summary>

                <div className="flex flex-col px-5 pb-5 sm:px-6 sm:pb-6">
                  {/* Unidade — o que passa no caixa. */}
                  <div className="flex flex-col gap-3 pb-5">
                    <div className="flex flex-col gap-0.5">
                      <Eyebrow>Unidade · vende e compra</Eyebrow>
                      <p className="text-xs text-muted">
                        O código que passa no caixa — e que a nota de compra também
                        pode trazer. Outra marca do mesmo item entra aqui: mesmo preço,
                        mesmo saldo.
                      </p>
                    </div>
                    {idxUnidades.map((i, k) => linhaDeCodigo(i, k === 0))}
                    <button
                      type="button"
                      onClick={() => adicionarCodigo()}
                      className="flex w-fit items-center gap-1 text-xs font-medium text-brand-strong hover:text-brand"
                    >
                      <Plus size={13} /> Adicionar código de unidade
                    </button>
                  </div>

                  {/* Fardo ou caixa — só entra pela compra. */}
                  <div className="flex flex-col gap-3 border-t border-line pt-5">
                    <div className="flex flex-col gap-0.5">
                      <Eyebrow>Fardo ou caixa · só compra</Eyebrow>
                      <p className="text-xs text-muted">
                        Como o fornecedor entrega, e quantas unidades vêm dentro: um
                        fardo com 6 entra no estoque como 6 unidades. Não passa no
                        caixa. Em branco, a primeira nota deste produto preenche
                        sozinha.
                      </p>
                    </div>
                    {idxEmbalagens.map((i, k) => linhaDeCodigo(i, k === 0))}
                    <button
                      type="button"
                      onClick={() => adicionarCodigo(true)}
                      className="flex w-fit items-center gap-1 text-xs font-medium text-brand-strong hover:text-brand"
                    >
                      <Plus size={13} /> Adicionar fardo ou caixa
                    </button>
                  </div>
                </div>
              </details>
            </section>

            {/* Tudo o que a nota preenche sozinha — ou que só importa em caso
                raro — mora aqui dentro, fechado. */}

            {error && (
              <p className="fade-up flex items-center gap-2 rounded-[var(--radius)] bg-danger-soft px-3 py-2.5 text-sm text-danger">
                <AlertCircle size={15} className="shrink-0" />
                {error}
              </p>
            )}
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
        </span>
        <Button
          variant="ghost"
          onClick={() => router.push(volta)}
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

      {linhaARemover !== null && (
        <ConfirmDialog
          title="Remover embalagem"
          description={
            <>
              A embalagem{" "}
              <span className="font-medium text-ink">
                {linhas[linhaARemover]?.rotulo.trim() || "sem nome"}
              </span>{" "}
              sai deste produto. O código de barras dela deixa de bipar na entrada de
              estoque. A remoção só vale depois de salvar o produto.
            </>
          }
          confirmLabel="Remover"
          onCancel={() => setLinhaARemover(null)}
          onConfirm={() => removerLinha(linhaARemover)}
        />
      )}
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
