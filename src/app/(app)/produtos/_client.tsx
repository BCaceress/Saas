"use client";

import {
  Fragment, createContext, useContext, useMemo, useState, useTransition, useRef, useEffect, useCallback,
} from "react";
import { createPortal } from "react-dom";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Plus, Tag, FolderTree, Warehouse, Truck, Upload, Search, Settings2,
  Pencil, ChevronDown,
  MoreVertical, EyeOff, Eye, X,
  Barcode, Hash, ChevronLeft, ChevronRight,
  ArrowUp, ArrowDown, ChevronsUpDown, Globe, SlidersHorizontal, Columns3,
  Download, Rows2, Rows3, LayoutGrid, FilterX, Percent, BottleWine, Printer, ImagePlus,
  Box, Refrigerator, Snowflake, Check as CheckIcon,
  TrendingUp, Clock, FileSpreadsheet, ChevronUp,
} from "lucide-react";
import { cn, brl, margem, maskMoney, moneyToMask, parseMoney } from "@/lib/utils";
import { thumbSrc } from "@/lib/imagem";
import { POLICY_PADRAO, type EstoquePolicy } from "@/lib/estoque-estrategia";
import { Button } from "@/components/ui/button";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, Select } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { PageHeader } from "@/components/app/page-header";
import { navIcon } from "@/components/app/nav-config";
import {
  ProductSidePanel, stockLevel, TIPO_LABEL, TIPO_ICON, STOCK_COLOR, STOCK_TITLE, STOCK_TEXT,
} from "@/components/app/product-side-panel";
import { TipoIcone } from "@/components/app/produto-tipo";
import {
  painelCsv, painelEtiquetas, painelGerenciar, painelImagens, painelLote,
  prepararGerenciar, prepararLote,
} from "./_sheets/_despachante";
import type { ProdutoImagem } from "./_sheets/imagens-sheet";
import type { ProdutoLote } from "./_sheets/lote-sheet";
import { archiveProduct, getGerenciarExtras } from "./actions";
import {
  buscarProdutos, linhasParaExport, linhasSelecionadas, opcoesDoLote, produtosDoLote,
  selecionarIdsDoFiltro, setPrecoVenda,
} from "./list-actions";
import { consultaParaParams, contarFiltros, soFiltro, STATUS_PADRAO } from "./_url";
import {
  COL_LABEL, COL_ORDER, DEFAULT_COLS, DEFAULT_INFO, INFO_LABEL, INFO_ORDER,
  type ColKey, type Density, type InfoKey,
} from "./_colunas";
import { CardsSkeleton } from "./_skeleton";
import {
  SelecaoProvider, useNovaSelecao, useQtdDaPagina, useQtdSelecionada, useSelecao, useSelecionado,
} from "@/components/app/selecao";
import { useOpcoes } from "./_opcoes";
import { baixarXlsx } from "@/lib/baixar-xlsx";
import {
  SEM_MARCA, SEM_TAG,
  type LoteOpcoes,
  type ProductRow, type ProductPackagingItem, type ProdutoConsulta, type ProdutoFlags,
  type ProdutoGiro, type ProdutoSortDir, type ProdutoSortField,
  type ProdutosPagina,
} from "./_types";
import type { GerenciarExtras } from "./_data";

type SheetKind = null | "brand" | "category" | "storage" | "supplier" | "csv" | "imagens" | "lote";

/**
 * Teto de produtos por rodada de busca de imagem. A cota da base de códigos é
 * finita: melhor rodar em tandas e ver o resultado do que queimar tudo de uma vez.
 */
const IMAGENS_POR_RODADA = 100;

/** Onde a listagem guarda o lugar em que o operador parou antes do cadastro. */
const CHAVE_VOLTA = "produtos:volta";

const POR_PAGINA = [25, 50, 100, 200];

/**
 * Lista vazia estável para os painéis que abrem antes dos dados chegarem.
 * Um `[]` novo a cada renderização trocaria a prop e faria o painel redesenhar
 * a lista à toa enquanto ela ainda é um placeholder.
 */
const LISTA_VAZIA: [] = [];

/**
 * `kind: "full"` do `router.prefetch` — pré-busca a rota RENDERIZADA, com os
 * dados, e não só até a fronteira do `loading.tsx`.
 *
 * O tipo (`PrefetchKind`) não é exportado por `next/navigation`; o valor é a
 * string. Em vez de importar de dentro de `next/dist`, que muda de lugar entre
 * versões, o tipo sai da própria assinatura do router: se o Next mexer na API,
 * isto quebra no `tsc` em vez de virar prefetch silenciosamente ignorado.
 */
type OpcoesPrefetch = NonNullable<
  Parameters<ReturnType<typeof useRouter>["prefetch"]>[1]
>;
const PREFETCH_COMPLETO = "full" as OpcoesPrefetch["kind"];

/** Quantidade de estoque exibível (null = produto sem controle de estoque). */
function stockQty(p: ProductRow): number | null {
  if (p.disponibilidadeDerivada !== null) return p.disponibilidadeDerivada;
  const semControle =
    p.tipo === "PERSONALIZADO" ||
    (p.tipo === "INSUMO" && p.estoque.minimo <= 0 && p.estoque.ideal <= 0);
  if (semControle) return null;
  return p.estoque.fechado;
}

/** Cor da margem por faixa de saúde (negativa/magra/saudável). */
function margemColor(m: number | null): string {
  if (m == null) return "text-faint";
  if (m < 0) return "text-danger";
  if (m < 15) return "text-warn";
  return "text-ok";
}

function principalFornecedor(p: ProductRow) {
  return p.fornecedores.find((f) => f.isPrincipal) ?? p.fornecedores[0];
}

/**
 * Ícone/cor do local seguem o tipo de armazenagem escolhido no Estoque —
 * mesma tabela usada em /estoque/saldos e em Configurações → Lojas.
 */
type StorageTipo = "AMBIENTE" | "REFRIGERADO" | "CONGELADO";
const STORAGE_TIPO_ICON: Record<StorageTipo, React.ElementType> = {
  AMBIENTE: Box,
  REFRIGERADO: Refrigerator,
  CONGELADO: Snowflake,
};
const STORAGE_TIPO_COLOR: Record<StorageTipo, string> = {
  AMBIENTE: "text-brand",
  REFRIGERADO: "text-ok",
  CONGELADO: "text-blue-500",
};

type LocalEmUso = { nome: string; tipo: StorageTipo | null };

/** Locais de armazenagem em uso (loja/local ativos, sem repetir nome). */
function locaisEmUso(p: ProductRow): LocalEmUso[] {
  const porNome = new Map<string, LocalEmUso>();
  for (const l of p.locais) {
    if (!l.siteAtivo || l.locationAtivo === false) continue;
    if (!l.locationNome || porNome.has(l.locationNome)) continue;
    porNome.set(l.locationNome, { nome: l.locationNome, tipo: l.locationTipo ?? null });
  }
  return [...porNome.values()];
}

/**
 * Indicador de garrafa aberta: sinal "+" fora do badge, garrafa dentro do chip
 * âmbar. Sem `title` (evita o tooltip preto nativo do navegador) — o estado já
 * é óbvio pelo ícone; detalhe fica no hint de estoque por loja.
 */
function AbertaBadge({ size = 16 }: { size?: number }) {
  return (
    <span className="ml-0.5 inline-flex items-center gap-1 text-warn">
      <span className="text-[12px] font-bold leading-none">+</span>
      <span className="inline-flex items-center rounded-full bg-warn/10 p-1">
        <BottleWine size={size} className="shrink-0" aria-label="Tem garrafa aberta" />
      </span>
    </span>
  );
}

const FLAG_LABEL: Record<keyof ProdutoFlags, string> = {
  semImagem: "Sem imagem", semEan: "Sem código de barras",
  semFiscal: "Sem perfil fiscal", online: "Vende online", maiorIdade: "Restrição +18",
};

const TIPO_FILTRO_LABEL: Record<string, string> = {
  SIMPLES: "Simples", COMBO: "Combo", PERSONALIZADO: "Receita", INSUMO: "Insumo",
};
const STATUS_LABEL: Record<string, string> = { ativos: "Ativos", inativos: "Inativos" };

// ── Persistência leve de preferências de exibição ────────────────────────────
function readLS<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

/** Lista de colunas ligadas, no formato que vai (e volta) da URL. */
function colsDaString(s: string | null): Record<ColKey, boolean> | null {
  if (s == null) return null;
  const ligadas = new Set(s.split(",").filter(Boolean));
  return Object.fromEntries(COL_ORDER.map((k) => [k, ligadas.has(k)])) as Record<ColKey, boolean>;
}

export function ProdutosClient(props: {
  pagina: ProdutosPagina;
  consultaInicial: ProdutoConsulta;
  initialFornecedorNome?: string;
  /** Estratégia de estoque — define as colunas do importador de CSV. */
  policy?: EstoquePolicy;
}) {
  const {
    pagina, consultaInicial,
    initialFornecedorNome, policy = POLICY_PADRAO,
  } = props;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [navegando, start] = useTransition();
  const [ocupado, setOcupado] = useState(false);

  // Vêm do layout: não se refazem a cada mudança de filtro.
  const { categoryOpts, subOpts, brandOpts, siteOpts, tagOpts } = useOpcoes();
  const { rows, giro, total, totalGeral } = pagina;

  const [sheet, setSheet] = useState<SheetKind>(null);
  const fecharSheet = useCallback(() => setSheet(null), []);

  // Pedaços de JavaScript dos painéis. O `true` só marca quem precisa AGORA —
  // quem já pré-buscou (hover em "Gerenciar", seleção em lote) recebe o módulo
  // pronto e o painel abre sem passar por "Carregando…".
  const Gerenciar = painelGerenciar.useModulo(
    sheet === "brand" || sheet === "category" || sheet === "storage" || sheet === "supplier",
  );
  const Csv = painelCsv.useModulo(sheet === "csv");
  const Imagens = painelImagens.useModulo(sheet === "imagens");
  const Lote = painelLote.useModulo(sheet === "lote");

  /** Fila da busca de imagens — congelada na abertura do painel. */
  const [imagensAlvo, setImagensAlvo] = useState<ProdutoImagem[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<ProductRow | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  // Dados dos sheets de "Gerenciar" (categorias/armazenagem/fornecedores) só
  // são buscados quando o usuário de fato abre o menu — não no load da página.
  const [extras, setExtras] = useState<GerenciarExtras | null>(null);
  const extrasRequested = useRef(false);
  const ensureExtras = useCallback(() => {
    if (extrasRequested.current) return;
    extrasRequested.current = true;
    getGerenciarExtras().then(setExtras);
  }, []);

  /**
   * Primeiro sinal de intenção no menu "Gerenciar": põe no forno o pedaço de
   * JavaScript dos painéis E a consulta que eles precisam. Chegar no clique com
   * as duas coisas prontas é o que faz o painel abrir de uma vez só, em vez de
   * entrar vazio e se preencher depois.
   *
   * `pointerdown` cobre o toque, onde `mouseenter` só dispara junto com o clique.
   */
  const aquecerGerenciar = useCallback(() => {
    prepararGerenciar();
    ensureExtras();
  }, [ensureExtras]);

  /**
   * Listas do painel de lote (fornecedores, perfis fiscais, locais). Vêm de uma
   * ação própria e enxuta em vez de `getGerenciarExtras`: o painel desenha dois
   * selects e uma lista de nomes, não precisa do endereço nem do logo de cada
   * fornecedor. No servidor sai do cache das opções do formulário.
   *
   * Categorias, subcategorias e marcas nem entram aqui — já estão no cliente,
   * vindas do layout.
   */
  const [loteOpcoes, setLoteOpcoes] = useState<LoteOpcoes | null>(null);
  const loteRequested = useRef(false);
  const ensureLoteOpcoes = useCallback(() => {
    if (loteRequested.current) return;
    loteRequested.current = true;
    opcoesDoLote()
      .then(setLoteOpcoes)
      .catch(() => {
        // Painel abre do mesmo jeito: os blocos remotos ficam vazios e o
        // operador ainda renomeia, reprecifica e recategoriza.
        loteRequested.current = false;
      });
  }, []);

  /** Primeiro sinal de intenção na barra de seleção: código E dados no forno. */
  const aquecerLote = useCallback(() => {
    prepararLote();
    ensureLoteOpcoes();
  }, [ensureLoteOpcoes]);

  // ── Consulta (filtro + ordem + página) ──
  // O estado local responde ao teclado na hora; a URL — e com ela o servidor —
  // é atualizada em seguida, com debounce. Fonte de verdade dos DADOS é sempre
  // o que o RSC devolveu; daí `rows` vir de props, não de estado.
  const [consulta, setConsulta] = useState<ProdutoConsulta>(consultaInicial);
  const chaveServidor = consultaParaParams(consultaInicial).toString();
  const [chaveAdotada, setChaveAdotada] = useState(chaveServidor);

  // Voltar/avançar no navegador (ou refresh do RSC) manda: adota o que veio.
  // Ajuste durante o render, não em efeito — evita o flash da tela com o filtro
  // antigo antes do efeito rodar.
  // Páginas extras que o "Carregar mais" do mobile empilhou sobre a do servidor.
  const [maisRows, setMaisRows] = useState<ProductRow[]>([]);
  const [maisGiro, setMaisGiro] = useState<Record<string, ProdutoGiro>>({});
  const [carregandoMais, setCarregandoMais] = useState(false);

  if (chaveServidor !== chaveAdotada) {
    setChaveAdotada(chaveServidor);
    setConsulta(consultaInicial);
    // Filtro/ordem/página mudaram: o que estava empilhado é de outra consulta.
    setMaisRows([]);
    setMaisGiro({});
  }

  // Preferências de exibição: URL manda (link compartilhável), navegador é o
  // padrão de quem abre /produtos sem parâmetro nenhum.
  const [cols, setCols] = useState<Record<ColKey, boolean>>(
    () => colsDaString(searchParams.get("cols")) ?? readLS("produtos:cols", DEFAULT_COLS),
  );
  const [info, setInfo] = useState<Record<InfoKey, boolean>>(() => {
    const daUrl = searchParams.get("info");
    if (daUrl == null) return readLS("produtos:info", DEFAULT_INFO);
    const ligadas = new Set(daUrl.split(",").filter(Boolean));
    return Object.fromEntries(INFO_ORDER.map((k) => [k, ligadas.has(k)])) as Record<InfoKey, boolean>;
  });
  const [density, setDensity] = useState<Density>(
    () => readLS("produtos:ui", { density: "compact" as Density }).density,
  );
  useEffect(() => { try { localStorage.setItem("produtos:cols", JSON.stringify(cols)); } catch {} }, [cols]);
  useEffect(() => { try { localStorage.setItem("produtos:info", JSON.stringify(info)); } catch {} }, [info]);
  useEffect(() => { try { localStorage.setItem("produtos:ui", JSON.stringify({ density })); } catch {} }, [density]);

  /** URL completa da tela: consulta + colunas + informativos. */
  const paramsDaTela = useCallback(
    (c: ProdutoConsulta, cl: Record<ColKey, boolean>, inf: Record<InfoKey, boolean>) => {
      const p = consultaParaParams(c);
      if (c.fornecedorId && initialFornecedorNome) p.set("fornecedorNome", initialFornecedorNome);
      const ligadas = COL_ORDER.filter((k) => cl[k]);
      const padraoCols = COL_ORDER.filter((k) => DEFAULT_COLS[k]);
      if (ligadas.join(",") !== padraoCols.join(",")) p.set("cols", ligadas.join(","));
      const infoLigadas = INFO_ORDER.filter((k) => inf[k]);
      const padraoInfo = INFO_ORDER.filter((k) => DEFAULT_INFO[k]);
      if (infoLigadas.join(",") !== padraoInfo.join(",")) p.set("info", infoLigadas.join(","));
      return p.toString();
    },
    [initialFornecedorNome],
  );

  const alvoUrl = paramsDaTela(consulta, cols, info);
  const urlAtual = searchParams.toString();

  // Debounce só vale para quem digita. Clicar num select, marcar um chip ou
  // trocar a ordenação é uma decisão pronta: esperar 300ms ali não economiza
  // consulta nenhuma, só faz a tela parecer travada.
  const qAnterior = useRef(consulta.q);
  useEffect(() => {
    const digitou = consulta.q !== qAnterior.current;
    qAnterior.current = consulta.q;
    if (alvoUrl === urlAtual) return;

    const ir = () =>
      start(() => router.replace(alvoUrl ? `/produtos?${alvoUrl}` : "/produtos", { scroll: false }));

    if (!digitou) {
      ir();
      return;
    }
    const t = setTimeout(ir, 300);
    return () => clearTimeout(t);
  }, [alvoUrl, urlAtual, consulta.q, router]);

  // Próxima página no forno assim que a atual assenta: paginar catálogo é
  // clicar seguido, e o RSC dela já chega pronto.
  useEffect(() => {
    if (alvoUrl !== urlAtual) return;
    const proxima = new URLSearchParams(urlAtual);
    proxima.set("pg", String(consulta.pagina + 1));
    const t = setTimeout(() => router.prefetch(`/produtos?${proxima.toString()}`), 400);
    return () => clearTimeout(t);
  }, [alvoUrl, urlAtual, consulta.pagina, router]);

  // Volta do cadastro: a URL já traz filtros/página (veio no `voltar`), falta
  // devolver a rolagem. Só restaura se a listagem for a mesma que saiu daqui —
  // entrar por /produtos limpo tem que abrir no topo.
  useEffect(() => {
    let bruto: string | null = null;
    try {
      bruto = sessionStorage.getItem(CHAVE_VOLTA);
      if (bruto) sessionStorage.removeItem(CHAVE_VOLTA);
    } catch {}
    if (!bruto) return;
    let alvo: { busca?: string; y?: number };
    try { alvo = JSON.parse(bruto); } catch { return; }
    if (!alvo.y || alvo.busca !== window.location.search) return;
    // Duas frames: a virtualização precisa medir as linhas antes, senão a
    // página ainda é curta demais e o scroll é aparado.
    const id = requestAnimationFrame(() =>
      requestAnimationFrame(() => window.scrollTo(0, alvo.y!)),
    );
    return () => cancelAnimationFrame(id);
  }, []);

  // Seleção em lote (atravessa páginas: guarda ids, não linhas).
  // Fora do estado do React de propósito — ver `_selecao.tsx`.
  const selecao = useNovaSelecao();
  const [etiquetasAlvo, setEtiquetasAlvo] = useState<ProductRow[]>([]);
  const [etiquetasOpen, setEtiquetasOpen] = useState(false);
  const Etiquetas = painelEtiquetas.useModulo(etiquetasOpen);

  /** Muda a consulta e volta para a página 1 (salvo quando é a própria página). */
  const aplicar = useCallback((patch: Partial<ProdutoConsulta>) => {
    setConsulta((c) => ({ ...c, ...patch, pagina: patch.pagina ?? 1 }));
    if (patch.pagina === undefined) selecao.limpar();
  }, [selecao]);

  const aplicarFlag = useCallback((k: keyof ProdutoFlags, valor?: boolean) => {
    setConsulta((c) => ({
      ...c,
      pagina: 1,
      flags: { ...c.flags, [k]: valor ?? !c.flags[k] },
    }));
    selecao.limpar();
  }, [selecao]);

  function toggleSort(field: ProdutoSortField) {
    setConsulta((c) => ({
      ...c,
      pagina: 1,
      sort: field,
      dir:
        c.sort === field
          ? c.dir === "asc" ? "desc" : "asc"
          : field === "nome" || field === "marca" || field === "tipo" || field === "categoria" || field === "fornecedor"
            ? "asc"
            : "desc",
    }));
  }

  const filtrosAtivos = contarFiltros(consulta);

  const limparFiltros = useCallback(() => {
    setConsulta((c) => ({
      ...c,
      q: "", tipo: "", sub: "", marca: "", fornecedorId: "", siteId: "", tag: "",
      status: STATUS_PADRAO,
      flags: {
        semImagem: false, semEan: false, semFiscal: false,
        online: false, maiorIdade: false,
      },
      pagina: 1,
    }));
    selecao.limpar();
  }, [selecao]);

  /**
   * Sai da listagem levando o estado dela junto: a URL viaja no `voltar` (o
   * cadastro devolve o operador nela) e a rolagem fica guardada na aba. Voltar
   * do cadastro e cair no topo de /produtos sem filtro é perder o lugar na
   * prateleira — em catálogo de 3 mil itens isso custa caro.
   */
  const sairPara = useCallback((destino: string) => {
    try {
      sessionStorage.setItem(
        CHAVE_VOLTA,
        JSON.stringify({ busca: window.location.search, y: window.scrollY }),
      );
    } catch {}
    router.push(`${destino}${alvoUrl ? `?voltar=${encodeURIComponent(alvoUrl)}` : ""}`);
  }, [router, alvoUrl]);

  function novo(tipo: "simples" | "insumo" | "combo" | "personalizado") { sairPara(`/produtos/novo/${tipo}`); }
  function editar(p: ProductRow) { sairPara(`/produtos/${p.id}/editar`); }

  /**
   * Cadastro no forno quando o mouse encosta na linha.
   *
   * Sem isto o clique em "Editar" só COMEÇA a baixar o JS do formulário (ele é
   * grande) — e a tela fica em branco pelo caminho inteiro. Passar o mouse já
   * traz a casca do cadastro; o clique vira troca de tela, não download.
   *
   * `Set` de guarda: o mouse atravessa a mesma linha várias vezes numa lista
   * de 200 itens, e o Next não deduplica pedido já servido. Cada produto entra
   * na fila uma vez só.
   */
  const prefetchados = useRef<Set<string>>(new Set());
  const prefetchEditar = useCallback((id: string) => {
    if (prefetchados.current.has(id)) return;
    prefetchados.current.add(id);
    router.prefetch(`/produtos/${id}/editar`);
  }, [router]);

  /**
   * Prefetch COMPLETO — traz os dados do produto, não só a casca.
   *
   * `router.prefetch()` sem opção pára no `loading.tsx`: chega a casca e o
   * JavaScript, mas a consulta do produto só sai no clique. Com `kind: "full"`
   * o servidor renderiza a página inteira e o clique vira troca de tela, sem
   * ida ao servidor.
   *
   * NÃO usar isso no hover da linha: numa lista de 200 itens, passar o mouse
   * varrendo a tabela dispararia 200 renders completos no servidor e 200
   * consultas no Neon. Fica reservado ao sinal de um produto só — a ficha
   * aberta, onde o operador já escolheu.
   */
  const completos = useRef<Set<string>>(new Set());
  const prefetchEditarCompleto = useCallback((id: string) => {
    if (completos.current.has(id)) return;
    completos.current.add(id);
    router.prefetch(`/produtos/${id}/editar`, { kind: PREFETCH_COMPLETO });
  }, [router]);

  // Ficha aberta é o sinal de intenção mais forte que existe — e é o único que
  // o toque dá, porque no celular `pointerenter` só dispara junto com o clique.
  useEffect(() => {
    if (selectedProduct) prefetchEditarCompleto(selectedProduct.id);
  }, [selectedProduct, prefetchEditarCompleto]);

  /** Inativar/ativar com volta atrás: a ação é reversível, o modal seria atrito. */
  function toggleInativo(p: ProductRow) {
    const alvo = !p.ativo;
    setOcupado(true);
    archiveProduct(p.id, alvo)
      .then(() => {
        router.refresh();
        toast.success(
          alvo ? `${p.nome} ativado` : `${p.nome} inativado`,
          undefined,
          {
            rotulo: "Desfazer",
            onClick: async () => {
              await archiveProduct(p.id, !alvo);
              router.refresh();
            },
          },
        );
      })
      .catch((e) => toast.error("Não deu para mudar a situação", e instanceof Error ? e.message : undefined))
      .finally(() => setOcupado(false));
  }

  // ── Seleção ──
  const pageIds = useMemo(() => rows.map((p) => p.id), [rows]);

  // `lista` explícita porque o mobile empilha páginas: o índice do card não é o
  // mesmo índice de `rows` depois do primeiro "Carregar mais".
  const toggleRow = useCallback(
    (id: string, idx: number, shift = false, lista: ProductRow[] = rows) => {
      selecao.alternar(id, idx, shift, lista);
    },
    [selecao, rows],
  );

  async function selecionarTudoDoFiltro() {
    setOcupado(true);
    try {
      const ids = await selecionarIdsDoFiltro(soFiltro(consulta));
      selecao.definir(ids);
      toast.info(`${ids.length} produtos selecionados`, "Vale para todas as páginas do filtro.");
    } catch (e) {
      toast.error("Não deu para selecionar tudo", e instanceof Error ? e.message : undefined);
    } finally {
      setOcupado(false);
    }
  }

  /** Linhas completas dos selecionados — a seleção pode estar fora da página. */
  async function linhasDaSelecao(): Promise<ProductRow[]> {
    const ids = selecao.lista();
    const naPagina = new Map(rows.map((r) => [r.id, r]));
    if (ids.every((id) => naPagina.has(id))) return ids.map((id) => naPagina.get(id)!);
    return linhasSelecionadas(ids);
  }

  /**
   * Roda uma ação em lote e solta a seleção. Os painéis (imagens, etiquetas,
   * lote) congelam a fila que receberam, então limpar aqui não muda o
   * que eles vão processar — e evita que a próxima ação pegue de carona uma
   * seleção que o operador já considerava resolvida.
   */
  async function comSelecao(fn: (linhas: ProductRow[]) => void) {
    setOcupado(true);
    try {
      fn(await linhasDaSelecao());
      selecao.limpar();
    } catch (e) {
      toast.error("Não deu para carregar a seleção", e instanceof Error ? e.message : undefined);
    } finally {
      setOcupado(false);
    }
  }

  // ── Exportação ──
  /** Sem seleção, exporta o filtro inteiro (não só a página na tela). */
  async function exportar(formato: "csv" | "xlsx") {
    setOcupado(true);
    try {
      const { linhas, giroExport } = selecao.tamanho
        ? { linhas: await linhasDaSelecao(), giroExport: giro }
        : await linhasParaExport(soFiltro(consulta), consulta.sort, consulta.dir).then((r) => ({
            linhas: r.rows,
            giroExport: r.giro,
          }));
      const tabela = montarTabela(linhas, giroExport, cols, info);
      if (formato === "csv") baixarCsv(tabela);
      else {
        baixarXlsx({
          nomeArquivo: `produtos-${new Date().toISOString().slice(0, 10)}.xlsx`,
          aba: "Produtos",
          cabecalho: tabela.cabecalho,
          linhas: tabela.linhas,
        });
      }
      selecao.limpar();
    } catch (e) {
      toast.error("Não deu para exportar", e instanceof Error ? e.message : undefined);
    } finally {
      setOcupado(false);
    }
  }

  // ── Imagens por código de barras ──
  function abrirImagens(lista: ProductRow[]) {
    setImagensAlvo(
      lista.slice(0, IMAGENS_POR_RODADA).map<ProdutoImagem>((p) => ({
        id: p.id,
        nome: p.nome,
        sku: p.sku,
        ean: p.ean,
        imagemUrl: p.imagemUrl,
      })),
    );
    setSheet("imagens");
  }

  // ── Edição em lote (categoria, marca, preço, fornecedores) ──
  /** Fila congelada na abertura do painel — mesma ideia da busca de imagens. */
  const [loteAlvo, setLoteAlvo] = useState<ProdutoLote[]>([]);

  /**
   * Abre o painel de lote SEM esperar nada.
   *
   * A fila leve (nome/SKU/tipo) sai da página quando a seleção cabe nela; só
   * quem selecionou além da tela paga uma consulta — e mesmo essa devolve três
   * campos, não a linha inteira com estoque, fornecedores e etiquetas.
   */
  async function abrirLote() {
    const ids = selecao.lista();
    if (!ids.length) return;
    aquecerLote();
    const naPagina = new Map(rowsMobile.map((r) => [r.id, r]));
    const daPagina = ids.every((id) => naPagina.has(id))
      ? ids.map((id) => {
          const r = naPagina.get(id)!;
          return { id: r.id, nome: r.nome, sku: r.sku, tipo: r.tipo };
        })
      : null;

    if (daPagina) {
      setLoteAlvo(daPagina);
      setSheet("lote");
      selecao.limpar();
      return;
    }

    setOcupado(true);
    try {
      setLoteAlvo(await produtosDoLote(ids));
      setSheet("lote");
      selecao.limpar();
    } catch (e) {
      toast.error("Não deu para carregar a seleção", e instanceof Error ? e.message : undefined);
    } finally {
      setOcupado(false);
    }
  }

  const carregando = navegando || ocupado;
  const temProdutos = totalGeral > 0;
  /** Qualquer camada modal na tela (slide-over, sidepanel do produto, visualizador). */
  const painelAberto = sheet !== null || etiquetasOpen || !!selectedProduct || !!imageUrl;
  const denso = density === "denso";
  const cozy = density === "cozy";
  const cellPad = denso ? "py-1" : "py-1.5";

  const totalPaginas = Math.max(1, Math.ceil(total / consulta.porPagina));
  const paginaAtual = Math.min(consulta.pagina, totalPaginas);
  const inicio = (paginaAtual - 1) * consulta.porPagina;

  // ── "Carregar mais" (mobile) ──
  // No celular a paginação numerada é atrito: o operador rola. A lista empilha
  // páginas em cima da que o RSC entregou, em vez de trocá-la.
  const rowsMobile = maisRows.length ? [...rows, ...maisRows] : rows;
  const giroMobile = maisRows.length ? { ...giro, ...maisGiro } : giro;
  const temMais = inicio + rowsMobile.length < total;

  async function carregarMais() {
    if (carregandoMais) return;
    setCarregandoMais(true);
    try {
      const proxima = paginaAtual + Math.floor(maisRows.length / consulta.porPagina) + 1;
      const p = await buscarProdutos({ ...consulta, pagina: proxima });
      setMaisRows((r) => [...r, ...p.rows]);
      setMaisGiro((g) => ({ ...g, ...p.giro }));
    } catch {
      toast.error("Não foi possível carregar", "Verifique a conexão e tente de novo.");
    } finally {
      setCarregandoMais(false);
    }
  }

  // Chips: o operador precisa ver O QUÊ está filtrando, não só quantos filtros.
  const chips = useMemo(() => {
    const lista: { key: string; label: string; limpar: () => void }[] = [];
    if (consulta.q) lista.push({ key: "q", label: `"${consulta.q}"`, limpar: () => aplicar({ q: "" }) });
    if (consulta.tipo) {
      lista.push({
        key: "tipo",
        label: TIPO_FILTRO_LABEL[consulta.tipo] ?? consulta.tipo,
        limpar: () => aplicar({ tipo: "" }),
      });
    }
    if (consulta.sub) {
      const nome = consulta.sub.startsWith("cat:")
        ? categoryOpts.find((c) => c.id === consulta.sub.slice(4))?.nome
        : subOpts.find((s) => s.id === consulta.sub)?.nome;
      lista.push({ key: "sub", label: nome ?? "Categoria", limpar: () => aplicar({ sub: "" }) });
    }
    if (consulta.marca) {
      const nome = consulta.marca === SEM_MARCA
        ? "Sem marca"
        : brandOpts.find((b) => b.id === consulta.marca)?.nome ?? "Marca";
      lista.push({ key: "marca", label: nome, limpar: () => aplicar({ marca: "" }) });
    }
    if (consulta.fornecedorId) {
      lista.push({
        key: "forn",
        label: initialFornecedorNome || "Fornecedor",
        limpar: () => aplicar({ fornecedorId: "" }),
      });
    }
    if (consulta.siteId) {
      lista.push({
        key: "loja",
        label: siteOpts.find((s) => s.id === consulta.siteId)?.nome ?? "Loja",
        limpar: () => aplicar({ siteId: "" }),
      });
    }
    if (consulta.tag) {
      const nome = consulta.tag === SEM_TAG
        ? "Sem etiqueta"
        : tagOpts.find((t) => t.id === consulta.tag)?.nome ?? "Etiqueta";
      lista.push({ key: "tag", label: nome, limpar: () => aplicar({ tag: "" }) });
    }
    if (consulta.status !== STATUS_PADRAO) {
      lista.push({
        key: "status",
        label: STATUS_LABEL[consulta.status] ?? consulta.status,
        limpar: () => aplicar({ status: STATUS_PADRAO }),
      });
    }
    (Object.keys(FLAG_LABEL) as (keyof ProdutoFlags)[]).forEach((k) => {
      if (consulta.flags[k]) {
        lista.push({ key: k, label: FLAG_LABEL[k], limpar: () => aplicarFlag(k, false) });
      }
    });
    return lista;
  }, [consulta, categoryOpts, subOpts, brandOpts, siteOpts, tagOpts, initialFornecedorNome, aplicar, aplicarFlag]);

  return (
    <SelecaoProvider store={selecao}>
    <TooltipLayer>
      <PageHeader
        title="Produtos"
        icon={navIcon("/produtos")}
        innerClassName="max-w-none"
        actions={
          <>
            <Menu
              align="end"
              trigger={
                <Button
                  variant="secondary"
                  size="sm"
                  className="gap-1.5 border-transparent"
                  onMouseEnter={aquecerGerenciar}
                  onPointerDown={aquecerGerenciar}
                  onFocus={aquecerGerenciar}
                >
                  <Settings2 size={15} /> Gerenciar
                  <ChevronDown size={14} className="-mr-0.5 text-muted" />
                </Button>
              }
            >
              <MenuItem icon={<Tag size={15} />} onClick={() => setSheet("brand")}>Marcas</MenuItem>
              <MenuItem icon={<FolderTree size={15} />} onClick={() => { ensureExtras(); setSheet("category"); }}>Categorias</MenuItem>
              <MenuItem icon={<Warehouse size={15} />} onClick={() => { ensureExtras(); setSheet("storage"); }}>Armazenagem</MenuItem>
              <MenuItem icon={<Truck size={15} />} onClick={() => { ensureExtras(); setSheet("supplier"); }}>Fornecedores</MenuItem>
              <div className="my-1 h-px bg-line" role="separator" />
              <MenuItem icon={<Upload size={15} />} onClick={() => setSheet("csv")}>Importar CSV</MenuItem>
            </Menu>

            <div className="inline-flex shadow-[var(--shadow-1)] rounded-full">
              <Button size="sm" onClick={() => novo("simples")} className="gap-1.5 rounded-r-none shadow-none">
                <Plus size={15} /> Novo produto
              </Button>
              <Menu
                align="end"
                trigger={
                  <Button size="sm" aria-label="Escolher tipo de produto" className="rounded-l-none border-l border-on-brand/25 px-2 shadow-none">
                    <ChevronDown size={16} />
                  </Button>
                }
              >
                <MenuItem icon={<TipoIcone tipo="SIMPLES" size={15} />} onClick={() => novo("simples")}>Produto simples</MenuItem>
                <MenuItem icon={<TipoIcone tipo="COMBO" size={15} />} onClick={() => novo("combo")}>Kit / combo</MenuItem>
                <MenuItem icon={<TipoIcone tipo="INSUMO" size={15} />} onClick={() => novo("insumo")}>Insumo</MenuItem>
              </Menu>
            </div>
          </>
        }
      />

      <div className="w-full rounded-[var(--radius-lg)] bg-surface p-3 shadow-[var(--shadow-float)] sm:p-4">
        {temProdutos && (
          <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-line bg-surface-2 p-2">
            <div className="relative min-w-48 flex-1">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
              <Input
                value={consulta.q}
                onChange={(e) => aplicar({ q: e.target.value })}
                placeholder="Buscar nome, SKU ou código de barras"
                className="h-9 rounded-full border-line bg-surface pl-9"
              />
            </div>
            {cols.tipo && (
              <Select value={consulta.tipo} onChange={(e) => aplicar({ tipo: e.target.value })} containerClassName="w-auto" className="h-9 rounded-full bg-surface">
                <option value="">Todos os tipos</option>
                <option value="SIMPLES">Simples</option>
                <option value="COMBO">Combo</option>
                <option value="PERSONALIZADO">Receita</option>
                <option value="INSUMO">Insumo</option>
              </Select>
            )}
            {cols.categoria && (
              <Select value={consulta.sub} onChange={(e) => aplicar({ sub: e.target.value })} containerClassName="w-auto" className="h-9 rounded-full bg-surface">
                <option value="">Toda categoria</option>
                {/* A categoria é a própria opção (filtra tudo dela); as subcategorias
                    vêm indentadas abaixo. optgroup não serve: rótulo de grupo não
                    é clicável.
                    Negrito na categoria e recuo com espaço inseparável (o navegador
                    engole espaço comum dentro de <option>). */}
                {categoryOpts.map((c) => (
                  <Fragment key={c.id}>
                    <option value={`cat:${c.id}`} className="font-semibold" style={{ fontWeight: 600 }}>
                      {c.nome}
                    </option>
                    {subOpts
                      .filter((s) => s.categoryId === c.id)
                      .map((s) => (
                        <option key={s.id} value={s.id} style={{ fontWeight: 400 }}>
                          {"    "}{s.nome}
                        </option>
                      ))}
                  </Fragment>
                ))}
              </Select>
            )}
            {cols.marca && (
              <Select value={consulta.marca} onChange={(e) => aplicar({ marca: e.target.value })} containerClassName="w-auto" className="h-9 rounded-full bg-surface">
                <option value="">Toda marca</option>
                {brandOpts.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}
                <option value={SEM_MARCA}>Sem marca</option>
              </Select>
            )}
            {/* Loja só faz sentido em quem tem mais de uma. */}
            {siteOpts.length > 1 && (
              <Select value={consulta.siteId} onChange={(e) => aplicar({ siteId: e.target.value })} containerClassName="w-auto" className="h-9 rounded-full bg-surface">
                <option value="">Todas as lojas</option>
                {siteOpts.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </Select>
            )}
            {tagOpts.length > 0 && (
              <Select value={consulta.tag} onChange={(e) => aplicar({ tag: e.target.value })} containerClassName="w-auto" className="h-9 rounded-full bg-surface">
                <option value="">Toda etiqueta</option>
                {tagOpts.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
                <option value={SEM_TAG}>Sem etiqueta</option>
              </Select>
            )}
            <Select value={consulta.status} onChange={(e) => aplicar({ status: e.target.value })} containerClassName="w-auto" className="h-9 rounded-full bg-surface">
              <option value="ativos">Ativos</option>
              <option value="inativos">Inativos</option>
            </Select>

            {/* Mais filtros (booleanos de higiene/negócio) */}
            <Menu
              align="end"
              trigger={
                <button
                  type="button"
                  className={cn(
                    "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
                    Object.values(consulta.flags).some(Boolean)
                      ? "border-brand/40 bg-brand-soft text-brand-strong"
                      : "border-line bg-surface text-ink-2 hover:bg-surface-2",
                  )}
                >
                  <SlidersHorizontal size={14} /> Mais filtros
                  {Object.values(consulta.flags).filter(Boolean).length > 0 && (
                    <span className="grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] font-bold text-on-brand">
                      {Object.values(consulta.flags).filter(Boolean).length}
                    </span>
                  )}
                </button>
              }
            >
              <div className="px-1 py-0.5">
                {(Object.keys(FLAG_LABEL) as (keyof ProdutoFlags)[]).map((k) => (
                  <CheckRow
                    key={k}
                    checked={consulta.flags[k]}
                    label={FLAG_LABEL[k]}
                    onChange={() => aplicarFlag(k)}
                  />
                ))}
              </div>
            </Menu>

            {/* Colunas + densidade */}
            <Menu
              align="end"
              trigger={
                <button
                  type="button"
                  aria-label="Colunas e densidade"
                  className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-xs font-medium text-ink-2 transition-colors hover:bg-surface-2"
                >
                  <Columns3 size={14} /> Exibição
                </button>
              }
            >
              <p className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-faint">Colunas</p>
              {COL_ORDER.map((k) => (
                <CheckRow
                  key={k}
                  checked={cols[k]}
                  label={COL_LABEL[k]}
                  onChange={() => {
                    setCols((c) => ({ ...c, [k]: !c[k] }));
                    // Desliga o filtro junto — não faz sentido filtrar por uma coluna escondida.
                    if (cols[k]) {
                      if (k === "tipo") aplicar({ tipo: "" });
                      if (k === "categoria") aplicar({ sub: "" });
                      if (k === "marca") aplicar({ marca: "" });
                    }
                  }}
                />
              ))}
              <div className="my-1 h-px bg-line" role="separator" />
              <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-faint">Informativos</p>
              {INFO_ORDER.map((k) => (
                <CheckRow
                  key={k}
                  checked={info[k]}
                  label={INFO_LABEL[k]}
                  onChange={() => setInfo((c) => ({ ...c, [k]: !c[k] }))}
                />
              ))}
              <div className="my-1 h-px bg-line" role="separator" />
              <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-faint">Densidade</p>
              <div className="flex gap-1 px-1.5 pb-1">
                <DensityBtn active={density === "denso"} onClick={() => setDensity("denso")} icon={<Rows3 size={14} />}>Densa</DensityBtn>
                <DensityBtn active={density === "compact"} onClick={() => setDensity("compact")} icon={<Rows2 size={14} />}>Média</DensityBtn>
                <DensityBtn active={density === "cozy"} onClick={() => setDensity("cozy")} icon={<LayoutGrid size={14} />}>Card</DensityBtn>
              </div>
            </Menu>

            {filtrosAtivos > 0 && (
              <button
                type="button"
                onClick={limparFiltros}
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <FilterX size={14} /> Limpar ({filtrosAtivos})
              </button>
            )}
          </div>
        )}

        {/* Chips do que está filtrando agora */}
        {chips.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {chips.map((c) => (
              <span
                key={c.key}
                className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand-strong"
              >
                {c.key === "forn" && <Truck size={12} />}
                {c.label}
                <button
                  type="button"
                  onClick={c.limpar}
                  className="cursor-pointer rounded-full p-0.5 hover:bg-brand/15"
                  aria-label={`Remover filtro ${c.label}`}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="relative">
        {/* Trocar filtro NÃO limpa a tabela: as linhas atuais seguem legíveis a
            70% com um sweep discreto por cima, e voltam a 100% em 150ms quando
            a nova consulta chega. Cobrir tudo com linhas-fantasma fazia a tela
            piscar duas vezes a cada tecla. */}
        {carregando && <span className="sr-only" role="status">Carregando produtos…</span>}
        <div className={cn("relative", carregando && "sk-stale pointer-events-none")}>
        {!temProdutos ? (
          <EmptyState onNew={() => novo("simples")} onCsv={() => setSheet("csv")} />
        ) : total === 0 ? (
          <SemResultado chips={chips} onLimparTudo={limparFiltros} />
        ) : cozy ? (
          <>
            {/* ── Cards (densidade confortável — todas as telas) ── */}
            <div
              role="list"
              className={cn(
                "mt-4 grid grid-cols-1 gap-3 transition-opacity duration-150 ease-out sm:grid-cols-2 xl:grid-cols-3",
                carregando && "opacity-70",
              )}
            >
              {rows.map((p, idx) => (
                <ProductCard
                  key={p.id}
                  p={p}
                  giro={giro[p.id]}
                  big
                  cols={cols}
                  info={info}
                  onToggle={(shift) => toggleRow(p.id, idx, shift)}
                  onOpen={() => setSelectedProduct(p)}
                  onImage={p.imagemUrl ? () => setImageUrl(p.imagemUrl) : undefined}
                  onEdit={() => editar(p)}
                  onArchive={() => toggleInativo(p)}
                  onBuscarImagem={() => abrirImagens([p])}
                  onIntent={() => prefetchEditar(p.id)}
                />
              ))}
            </div>
          </>
        ) : (
          <>
            {/* ── Tabela (md+) ──
                `table-fixed`: sem ele a largura das colunas dança conforme o
                tamanho dos nomes de cada página, e a tabela "pisca" ao paginar.
                Cabeçalho grudado porque 200 linhas rolam para longe dele. */}
            <div className="mt-4 hidden overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface md:block">
              <table className="w-full table-fixed text-left">
                <thead className="sticky top-0 z-10 border-b border-line bg-surface-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
                  <tr>
                    <th className="w-10 px-3 py-2.5">
                      <CheckDaPagina ids={pageIds} />
                    </th>
                    <SortableTh label="Produto" field="nome" sort={consulta.sort} dir={consulta.dir} onSort={toggleSort} />
                    {cols.marca && <SortableTh label="Marca" field="marca" sort={consulta.sort} dir={consulta.dir} onSort={toggleSort} className="hidden w-36 xl:table-cell" />}
                    {cols.tipo && <SortableTh label="Tipo" field="tipo" sort={consulta.sort} dir={consulta.dir} onSort={toggleSort} className="hidden w-28 lg:table-cell" />}
                    {cols.categoria && <SortableTh label="Categoria" field="categoria" sort={consulta.sort} dir={consulta.dir} onSort={toggleSort} className="hidden w-44 lg:table-cell" />}
                    <SortableTh label="Preço" field="preco" sort={consulta.sort} dir={consulta.dir} onSort={toggleSort} className="w-32" />
                    {cols.local && <th className="hidden w-36 px-4 py-2.5 lg:table-cell">Local</th>}
                    {cols.margem && <SortableTh label="Margem" field="margem" sort={consulta.sort} dir={consulta.dir} onSort={toggleSort} className="hidden w-24 sm:table-cell" />}
                    {cols.fornecedor && <SortableTh label="Fornecedor" field="fornecedor" sort={consulta.sort} dir={consulta.dir} onSort={toggleSort} className="hidden w-40 md:table-cell" />}
                    {cols.estoque && <SortableTh label="Estoque" field="estoque" sort={consulta.sort} dir={consulta.dir} onSort={toggleSort} className="w-28" />}
                    {cols.vendas && <SortableTh label="Vendas 30d" field="vendas" sort={consulta.sort} dir={consulta.dir} onSort={toggleSort} className="hidden w-24 lg:table-cell" />}
                    {cols.parado && <SortableTh label="Parado há" field="parado" sort={consulta.sort} dir={consulta.dir} onSort={toggleSort} className="hidden w-24 lg:table-cell" />}
                    <th className="w-10 px-3 py-2.5" />
                  </tr>
                </thead>
                {/* Só o corpo esmaece: o cabeçalho das colunas é informação boa
                    e continua nítido enquanto a nova consulta não chega. */}
                <tbody
                  className={cn(
                    "divide-y divide-line transition-opacity duration-150 ease-out",
                    carregando && "opacity-70",
                  )}
                >
                  {rows.map((p, idx) => {
                    const level = stockLevel(p);
                    const principal = principalFornecedor(p);
                    return (
                      // A linha inteira continua clicável (o mouse espera isso),
                      // mas quem carrega o papel de botão é o nome do produto —
                      // `role="button"` no <tr> aninha botão dentro de botão e
                      // o leitor de tela não sabe o que anunciar.
                      //
                      // O realce de "marcada" sai do CSS (`:has`), não do React:
                      // é o que permite marcar a caixa sem redesenhar a linha
                      // inteira — e, antes, a tabela inteira.
                      <tr
                        key={p.id}
                        onClick={() => setSelectedProduct(p)}
                        onPointerEnter={() => prefetchEditar(p.id)}
                        className={cn(
                          "group relative cursor-pointer transition-colors hover:bg-brand-soft/30 focus-within:bg-brand-soft/30",
                          "has-[input:checked]:bg-brand-soft/40",
                          !p.ativo && "opacity-50",
                        )}
                      >
                        <td className={cn("px-3", cellPad)} onClick={(e) => e.stopPropagation()}>
                          <CheckLinha
                            id={p.id}
                            idx={idx}
                            onToggle={toggleRow}
                            label={`Selecionar ${p.nome}`}
                          />
                        </td>

                        {/* Produto */}
                        <td className={cn("px-4", cellPad)}>
                          <div className="flex items-center gap-3">
                            {!denso && (
                              <Thumb
                                url={p.imagemUrl}
                                tipo={p.tipo}
                                onClickImage={p.imagemUrl ? () => setImageUrl(p.imagemUrl) : undefined}
                              />
                            )}
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); setSelectedProduct(p); }}
                                  className="min-w-0 cursor-pointer truncate rounded-sm text-left text-[13px] font-semibold leading-snug text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand"
                                >
                                  {p.nome}
                                </button>
                                {p.vendeOnline && (
                                  <Globe size={12} className="shrink-0 text-brand" aria-label="Vende online" />
                                )}
                                {info.restricao && p.restricaoIdade && (
                                  <span className="inline-flex items-center rounded-full border border-danger/30 bg-danger/10 px-1 py-px text-[9px] font-bold text-danger">+18</span>
                                )}
                              </div>
                              {(info.sku || p.ean) && !denso && (
                                <BarcodeCell sku={p.sku} ean={p.ean} packagings={p.packagings} showSku={info.sku} />
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Marca (coluna opcional) */}
                        {cols.marca && (
                          <td className={cn("hidden px-4 xl:table-cell", cellPad)}>
                            {p.marca ? (
                              <span className="text-[12px] text-ink-2">{p.marca}</span>
                            ) : (
                              <span className="text-[11px] text-faint">—</span>
                            )}
                          </td>
                        )}

                        {/* Tipo */}
                        {cols.tipo && (
                          <td className={cn("hidden px-4 lg:table-cell", cellPad)}>
                            <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-2">
                              <span className="text-faint">{TIPO_ICON[p.tipo]}</span>
                              {TIPO_LABEL[p.tipo]}
                            </span>
                          </td>
                        )}

                        {/* Categoria */}
                        {cols.categoria && (
                          <td className={cn("hidden px-4 lg:table-cell", cellPad)}>
                            <div className="text-[13px] font-medium text-ink-2">{p.subcategoriaNome}</div>
                            {!denso && <div className="mt-0.5 text-[11px] text-faint">{p.categoriaNome}</div>}
                          </td>
                        )}

                        {/* Preço — editável na própria linha */}
                        <td className={cn("px-4", cellPad)} onClick={(e) => e.stopPropagation()}>
                          <PriceCell
                            produtoId={p.id}
                            nome={p.nome}
                            tipo={p.tipo}
                            precoVenda={p.precoVenda}
                            custo={p.custo}
                            onSalvo={() => router.refresh()}
                          />
                        </td>

                        {/* Local de estoque */}
                        {cols.local && (
                          <td className={cn("hidden px-4 lg:table-cell", cellPad)}>
                            <LocalCell locais={locaisEmUso(p)} />
                          </td>
                        )}

                        {/* Margem */}
                        {cols.margem && (
                          <td className={cn("hidden px-4 sm:table-cell", cellPad)}>
                            <MargemCell precoVenda={p.precoVenda} custo={p.custo} tipo={p.tipo} />
                          </td>
                        )}

                        {/* Fornecedor */}
                        {cols.fornecedor && (
                          <td className={cn("hidden px-4 md:table-cell", cellPad)}>
                            {principal ? (
                              <span className="text-[12px] text-ink-2 leading-snug">{principal.nome}</span>
                            ) : (
                              <span className="text-[11px] text-faint">—</span>
                            )}
                          </td>
                        )}

                        {/* Estoque */}
                        {cols.estoque && (
                          <td className={cn("px-4", cellPad)}>
                            <StockCell p={p} level={level} />
                          </td>
                        )}

                        {/* Giro */}
                        {cols.vendas && (
                          <td className={cn("hidden px-4 lg:table-cell", cellPad)}>
                            <VendasCell giro={giro[p.id]} tipo={p.tipo} />
                          </td>
                        )}
                        {cols.parado && (
                          <td className={cn("hidden px-4 lg:table-cell", cellPad)}>
                            <ParadoCell giro={giro[p.id]} tipo={p.tipo} />
                          </td>
                        )}

                        {/* Ações */}
                        <td className={cn("px-3", cellPad)} onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end">
                            <Menu
                              align="end"
                              trigger={
                                <button
                                  className="cursor-pointer rounded-[var(--radius-sm)] p-1.5 text-faint transition-colors hover:bg-surface-2 hover:text-ink"
                                  aria-label="Mais ações"
                                >
                                  <MoreVertical size={16} />
                                </button>
                              }
                            >
                              <MenuItem icon={<Pencil size={15} />} onClick={() => editar(p)}>Editar</MenuItem>
                              <MenuItem
                                icon={<ImagePlus size={15} />}
                                onClick={() => abrirImagens([p])}
                                disabled={!p.ean}
                              >
                                Buscar imagem
                              </MenuItem>
                              <div className="my-1 h-px bg-line" role="separator" />
                              <MenuItem
                                icon={p.ativo ? <EyeOff size={15} /> : <Eye size={15} />}
                                onClick={() => toggleInativo(p)}
                              >
                                {p.ativo ? "Inativar" : "Ativar"}
                              </MenuItem>
                            </Menu>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ── Cards (mobile — densidade compacta) ── */}
            <ListaCards
              rows={rowsMobile}
              atenuado={carregando}
              giro={giroMobile}
              cols={cols}
              info={info}
              onToggle={(id, idx, shift) => toggleRow(id, idx, shift, rowsMobile)}
              onOpen={setSelectedProduct}
              onImage={setImageUrl}
              onEdit={editar}
              onArchive={toggleInativo}
              onBuscarImagem={(p) => abrirImagens([p])}
              onIntent={(p) => prefetchEditar(p.id)}
            />

            {/* Rolagem infinita: as linhas já carregadas ficam onde estão; só as
                novas entram como esqueleto, no lugar exato onde vão aparecer. */}
            {carregandoMais && (
              <CardsSkeleton
                linhas={Math.min(4, Math.max(1, total - inicio - rowsMobile.length))}
                className="sk-fade-in mt-2 md:hidden"
              />
            )}

            {temMais && !carregandoMais && (
              <div className="mt-3 md:hidden">
                <Button variant="ghost" className="w-full" onClick={carregarMais}>
                  {`Carregar mais ${Math.min(consulta.porPagina, total - inicio - rowsMobile.length)}`}
                </Button>
              </div>
            )}
          </>
        )}
        </div>
        </div>

        {/* ── Paginação ── */}
        {temProdutos && total > 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 px-1">
            <div className="flex items-center gap-2 text-xs text-faint">
              <span>
                {inicio + 1}–{Math.min(inicio + consulta.porPagina, total)} de {total}
                {totalGeral !== total ? ` (${totalGeral} no total)` : ""}
              </span>
              <span className="text-line">·</span>
              <label className="flex items-center gap-1.5">
                Exibir
                <select
                  value={consulta.porPagina}
                  onChange={(e) => aplicar({ porPagina: Number(e.target.value) })}
                  className="h-7 cursor-pointer appearance-none rounded-lg border border-line bg-surface px-2 text-xs font-medium text-ink focus:border-brand focus:outline-none"
                >
                  {POR_PAGINA.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
                por página
              </label>
              <SelecionarTudo total={total} onSelecionar={selecionarTudoDoFiltro} />
            </div>

            {totalPaginas > 1 && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => aplicar({ pagina: Math.max(1, paginaAtual - 1) })}
                  disabled={paginaAtual <= 1}
                  className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-line bg-surface text-ink transition-colors hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-40"
                  aria-label="Página anterior"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="min-w-20 text-center text-xs font-medium text-muted">
                  Página {paginaAtual} de {totalPaginas}
                </span>
                <button
                  onClick={() => aplicar({ pagina: Math.min(totalPaginas, paginaAtual + 1) })}
                  disabled={paginaAtual >= totalPaginas}
                  className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-line bg-surface text-ink transition-colors hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-40"
                  aria-label="Próxima página"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Slide-overs ──
            Cada painel vive num pedaço próprio de JavaScript (ver
            `_sheets/_despachante.tsx`). Enquanto o pedaço não chega, entra o
            `LoadingSheet`; quando os DADOS é que faltam, o painel abre inteiro
            e só a lista fica em placeholder (`carregando`) — assim o Sheet monta
            uma vez só e a animação de entrada não roda duas vezes. */}
        {sheet === "brand" && (
          Gerenciar
            ? <Gerenciar.BrandSheet open onClose={fecharSheet} brands={brandOpts} />
            : <LoadingSheet title="Marcas" onClose={fecharSheet} />
        )}
        {sheet === "category" && (
          Gerenciar
            ? <Gerenciar.CategorySheet
                open
                onClose={fecharSheet}
                tree={extras?.categoryTree ?? LISTA_VAZIA}
                carregando={!extras}
                onChanged={() => getGerenciarExtras().then(setExtras)}
              />
            : <LoadingSheet title="Categorias" onClose={fecharSheet} />
        )}
        {sheet === "storage" && (
          Gerenciar
            ? <Gerenciar.StorageSheet
                open
                onClose={fecharSheet}
                locations={extras?.storageOpts ?? LISTA_VAZIA}
                sites={extras?.siteOpts ?? LISTA_VAZIA}
                carregando={!extras}
              />
            : <LoadingSheet title="Armazenagem" onClose={fecharSheet} />
        )}
        {sheet === "supplier" && (
          Gerenciar
            ? <Gerenciar.SupplierSheet
                open
                onClose={fecharSheet}
                suppliers={extras?.supplierRows ?? LISTA_VAZIA}
                carregando={!extras}
              />
            : <LoadingSheet title="Fornecedores" onClose={fecharSheet} />
        )}
        {sheet === "csv" && (
          Csv
            ? <Csv.CsvSheet open onClose={fecharSheet} policy={policy} />
            : <LoadingSheet title="Importar CSV" onClose={fecharSheet} />
        )}
        {sheet === "imagens" && (
          Imagens
            ? <Imagens.ImagensSheet
                open
                onClose={fecharSheet}
                produtos={imagensAlvo}
                onAplicado={() => router.refresh()}
              />
            : <LoadingSheet title="Buscar imagens" onClose={fecharSheet} />
        )}
        {/* Abre com o que já está no cliente (categoria, marca, nome, preço) e
            completa os blocos remotos quando eles chegam — em vez de segurar o
            painel inteiro atrás de uma consulta. */}
        {sheet === "lote" && (
          Lote
            ? <Lote.LoteSheet
                open
                onClose={fecharSheet}
                produtos={loteAlvo}
                categorias={categoryOpts}
                subcategorias={subOpts}
                brands={brandOpts}
                suppliers={loteOpcoes?.suppliers}
                fiscais={loteOpcoes?.fiscais}
                locais={loteOpcoes?.locais}
                carregandoOpcoes={!loteOpcoes}
                onAplicado={() => { selecao.limpar(); router.refresh(); }}
              />
            : <LoadingSheet title="Editar em lote" onClose={fecharSheet} />
        )}
      </div>

      {/* ── Barra de ações em lote ──
          Some enquanto um painel está aberto: ela é `fixed` no rodapé e, vindo
          depois no DOM, ficava por cima do rodapé do slide-over — engolindo o
          botão de salvar do painel que ela mesma abriu.
          Quem conta os selecionados é ela, não a listagem: assim marcar a
          primeira caixa acende a barra sem redesenhar a tabela. */}
      <BulkBar
        escondida={painelAberto}
        ocupado={ocupado}
        onEditar={abrirLote}
        onAquecerEditar={aquecerLote}
        onEtiquetas={() => comSelecao((l) => { setEtiquetasAlvo(l); setEtiquetasOpen(true); })}
        onExportar={exportar}
        onImagens={() => comSelecao(abrirImagens)}
        onLimpar={() => selecao.limpar()}
      />

      {etiquetasOpen && (
        Etiquetas
          ? <Etiquetas.EtiquetasSheet
              open
              onClose={() => setEtiquetasOpen(false)}
              products={etiquetasAlvo}
            />
          : <LoadingSheet title="Etiquetas" onClose={() => setEtiquetasOpen(false)} />
      )}

      {selectedProduct && (() => {
        // Posição na página que está na tela — navegar não muda de página.
        const idx = rows.findIndex((r) => r.id === selectedProduct.id);
        return (
          <ProductSidePanel
            key={selectedProduct.id}
            product={selectedProduct}
            onClose={() => setSelectedProduct(null)}
            onEdit={() => sairPara(`/produtos/${selectedProduct.id}/editar`)}
            navegacao={
              idx >= 0
                ? {
                    posicao: inicio + idx + 1,
                    total,
                    onAnterior: idx > 0 ? () => setSelectedProduct(rows[idx - 1]) : undefined,
                    onProximo: idx < rows.length - 1 ? () => setSelectedProduct(rows[idx + 1]) : undefined,
                  }
                : undefined
            }
          />
        );
      })()}

      {imageUrl && <ImageViewer url={imageUrl} onClose={() => setImageUrl(null)} />}
    </TooltipLayer>
    </SelecaoProvider>
  );
}

// ── Vazio por filtro ─────────────────────────────────────────────────────────

/** Vazio que diz QUAL filtro esvaziou a tela e deixa tirar só ele. */
function SemResultado({
  chips, onLimparTudo,
}: {
  chips: { key: string; label: string; limpar: () => void }[];
  onLimparTudo: () => void;
}) {
  const ultimo = chips[chips.length - 1];
  return (
    <div className="mt-12 flex flex-col items-center gap-3 text-center">
      <p className="text-sm text-muted">
        {chips.length === 0
          ? "Nenhum produto por aqui."
          : chips.length === 1
            ? `Nenhum produto em "${chips[0].label}".`
            : `Nenhum produto bate com os ${chips.length} filtros.`}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {ultimo && (
          <Button variant="outline" size="sm" onClick={ultimo.limpar} className="gap-1.5">
            <X size={15} /> Tirar “{ultimo.label}”
          </Button>
        )}
        {chips.length > 1 && (
          <Button variant="ghost" size="sm" onClick={onLimparTudo} className="gap-1.5">
            <FilterX size={15} /> Limpar tudo
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Cabeçalho ordenável ───────────────────────────────────────────────────────

function SortableTh({
  label, field, sort, dir, onSort, className,
}: {
  label: string;
  field: ProdutoSortField;
  sort: ProdutoSortField;
  dir: ProdutoSortDir;
  onSort: (f: ProdutoSortField) => void;
  className?: string;
}) {
  const active = sort === field;
  return (
    <th className={cn("px-4 py-2.5", className)}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={cn(
          "-mx-1 inline-flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 uppercase transition-colors hover:text-ink",
          active && "text-ink",
        )}
        aria-label={`Ordenar por ${label}`}
      >
        {label}
        {active
          ? (dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)
          : <ChevronsUpDown size={12} className="opacity-40" />}
      </button>
    </th>
  );
}

// ── Checkbox (com estado indeterminado e seleção por intervalo) ──────────────

function Check({
  checked, indeterminate, onChange, label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (shift: boolean) => void;
  label: string;
}) {
  const shiftRef = useRef(false);
  return (
    <span className="relative inline-flex">
      <Checkbox
        checked={checked}
        indeterminate={indeterminate}
        onChange={() => onChange(shiftRef.current)}
        // Só o teclado chega até aqui pelo clique (o alvo abaixo cobre o mouse);
        // o evento de change não carrega o shift, o clique carrega.
        onClick={(e) => { shiftRef.current = e.shiftKey; e.stopPropagation(); }}
        aria-label={label}
      />
      {/*
        Alvo de clique de 32px sobre um desenho de 16px.
        Marcar quarenta produtos em sequência com uma pastilha de 16px é mira,
        não trabalho — e no toque a caixa fica abaixo do mínimo confortável.
        A camada é absoluta, então o alvo cresce sem empurrar nada no layout.
      */}
      <span
        aria-hidden
        className="absolute -inset-2 cursor-pointer"
        onClick={(e) => { e.stopPropagation(); onChange(e.shiftKey); }}
      />
    </span>
  );
}

/**
 * Caixa de uma linha da tabela.
 *
 * É o único pedaço da linha que acompanha a seleção — assina só o próprio id.
 * Marcar uma caixa numa página de 200 produtos re-renderiza este componente e
 * mais nada: o realce da linha vem do CSS (`has-[input:checked]`).
 */
function CheckLinha({
  id, idx, onToggle, label,
}: {
  id: string;
  idx: number;
  onToggle: (id: string, idx: number, shift: boolean) => void;
  label: string;
}) {
  const marcado = useSelecionado(id);
  return (
    <Check
      checked={marcado}
      onChange={(shift) => onToggle(id, idx, shift)}
      label={label}
    />
  );
}

/** Mesma ideia, no card: o índice já vem embutido no `onToggle` de quem lista. */
function CheckProduto({
  id, onToggle, label,
}: {
  id: string;
  onToggle: (shift: boolean) => void;
  label: string;
}) {
  const marcado = useSelecionado(id);
  return <Check checked={marcado} onChange={onToggle} label={label} />;
}

/**
 * "Todos desta página" — assina o total e conta quantos desta página estão
 * marcados. Fora da listagem de propósito: a tabela inteira não pode
 * re-renderizar por causa deste tique.
 */
function CheckDaPagina({ ids }: { ids: string[] }) {
  const selecao = useSelecao();
  const marcados = useQtdDaPagina(ids);
  const todos = ids.length > 0 && marcados === ids.length;
  return (
    <Check
      checked={todos}
      indeterminate={!todos && marcados > 0}
      onChange={() => selecao.alternarVarios(ids, !todos)}
      label="Selecionar todos desta página"
    />
  );
}

function CheckRow({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-2 text-sm text-ink transition-colors hover:bg-surface-2">
      <Checkbox checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}

function DensityBtn({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border px-2 py-1.5 text-xs font-medium transition-colors",
        active ? "border-brand/40 bg-brand-soft text-brand-strong" : "border-line text-ink-2 hover:bg-surface-2",
      )}
    >
      {icon} {children}
    </button>
  );
}

// ── Barra de ações em lote (flutuante) ───────────────────────────────────────

/** Atalho "Selecionar todos os N" — só aparece quando ainda falta alguém. */
function SelecionarTudo({ total, onSelecionar }: { total: number; onSelecionar: () => void }) {
  const marcados = useQtdSelecionada();
  if (marcados >= total) return null;
  return (
    <>
      <span className="text-line">·</span>
      <button
        type="button"
        onClick={onSelecionar}
        className="cursor-pointer font-medium text-brand-strong underline-offset-2 hover:underline"
      >
        Selecionar todos os {total}
      </button>
    </>
  );
}

function BulkBar({
  escondida, ocupado, onEditar, onAquecerEditar, onEtiquetas, onExportar, onImagens, onLimpar,
}: {
  /** Um painel está aberto: a barra sai da frente (ver comentário na chamada). */
  escondida: boolean;
  ocupado: boolean;
  /** Nomes, categoria/subcategoria, marca, preço, fiscal e fornecedores. */
  onEditar: () => void;
  /** Mouse/dedo encostou no botão: põe código e listas no forno antes do clique. */
  onAquecerEditar: () => void;
  onEtiquetas: () => void;
  onExportar: (formato: "csv" | "xlsx") => void;
  onImagens: () => void;
  onLimpar: () => void;
}) {
  const count = useQtdSelecionada();

  // Selecionou algo? Os painéis que a barra abre já vão para o forno — quando o
  // operador clicar em "Editar em lote", o pedaço de JavaScript já chegou.
  useEffect(() => {
    if (count > 0) prepararLote();
  }, [count]);

  if (count === 0 || escondida) return null;

  return (
    // z-40: um degrau abaixo do slide-over (z-50). Empatar em 50 fazia a ordem
    // do DOM decidir quem cobre quem — e a barra ganhava.
    <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <div className="flex flex-wrap items-center justify-center gap-2 rounded-full border border-line bg-surface px-3 py-2 shadow-[var(--shadow-2)]">
        <span className="pl-1 pr-1 text-sm font-medium text-ink">
          {count} selecionado{count === 1 ? "" : "s"}
        </span>
        <div className="h-5 w-px bg-line" />
        <Button
          size="sm"
          onClick={onEditar}
          onPointerEnter={onAquecerEditar}
          onPointerDown={onAquecerEditar}
          onFocus={onAquecerEditar}
          disabled={ocupado}
          className="gap-1.5"
        >
          <SlidersHorizontal size={15} /> Editar em lote
        </Button>
        <Button variant="ghost" size="sm" onClick={onEtiquetas} disabled={ocupado} className="gap-1.5">
          <Printer size={15} /> Imprimir etiquetas
        </Button>
        <Button variant="ghost" size="sm" onClick={onImagens} disabled={ocupado} className="gap-1.5">
          <ImagePlus size={15} /> Buscar imagens
        </Button>
        <Menu
          align="end"
          trigger={
            <Button variant="ghost" size="sm" disabled={ocupado} className="gap-1.5">
              <Download size={15} /> Exportar
              <ChevronUp size={14} className="-mr-0.5 text-muted" />
            </Button>
          }
        >
          <MenuItem icon={<FileSpreadsheet size={15} />} onClick={() => onExportar("xlsx")}>
            Planilha (.xlsx)
          </MenuItem>
          <MenuItem icon={<Download size={15} />} onClick={() => onExportar("csv")}>
            CSV
          </MenuItem>
        </Menu>
        <button
          type="button"
          onClick={onLimpar}
          className="ml-1 cursor-pointer rounded-full p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          aria-label="Limpar seleção"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

// ── Card mobile ──────────────────────────────────────────────────────────────

/**
 * Card de produto — usado no mobile (sempre) e na densidade "Card"
 * (grid em todas as telas). `big` deixa o card mais espaçoso e mostra
 * categoria/tipo, que não cabem na versão compacta do mobile.
 */
function ProductCard({
  p, giro, onToggle, onOpen, onImage, onEdit, onArchive, onBuscarImagem, onIntent, big, cols, info,
}: {
  p: ProductRow;
  giro?: ProdutoGiro;
  onToggle: (shift: boolean) => void;
  onOpen: () => void;
  onImage?: () => void;
  onEdit: () => void;
  onArchive: () => void;
  /** Mouse/dedo encostou no card — hora de pré-buscar o cadastro. */
  onIntent?: () => void;
  /** Busca a foto do produto pelo código de barras. */
  onBuscarImagem: () => void;
  big?: boolean;
  cols: Record<ColKey, boolean>;
  info: Record<InfoKey, boolean>;
}) {
  const level = stockLevel(p);
  const qty = stockQty(p);
  const m = p.tipo === "INSUMO" ? null : margem(p.precoVenda, p.custo);
  const principal = principalFornecedor(p);

  // Metadados (tipo/categoria/marca/fornecedor) — só no card grande, e só o que
  // estiver ligado em Exibição → Colunas.
  const metaParts: { key: string; node: React.ReactNode }[] = [];
  if (cols.tipo) metaParts.push({ key: "tipo", node: <span className="inline-flex items-center gap-1">{TIPO_ICON[p.tipo]}{TIPO_LABEL[p.tipo]}</span> });
  if (cols.categoria && p.categoriaNome) metaParts.push({ key: "cat", node: p.categoriaNome });
  if (cols.local) {
    const locais = locaisEmUso(p);
    if (locais.length) {
      const [primeiro] = locais;
      const Icon = primeiro.tipo ? STORAGE_TIPO_ICON[primeiro.tipo] : Warehouse;
      const cor = primeiro.tipo ? STORAGE_TIPO_COLOR[primeiro.tipo] : undefined;
      metaParts.push({
        key: "local",
        node: (
          <span className="inline-flex items-center gap-1">
            <Icon size={11} className={cor} />
            {primeiro.nome}
            {locais.length > 1 ? ` +${locais.length - 1}` : ""}
          </span>
        ),
      });
    }
  }
  if (cols.marca && p.marca) metaParts.push({ key: "marca", node: p.marca });
  if (cols.fornecedor && principal) metaParts.push({ key: "forn", node: principal.nome });

  return (
    // `role="listitem"` num <div> e não um <li>: a lista virtualizada precisa
    // envolver cada card num elemento posicionado, e <li> dentro de <li> é HTML
    // inválido. A semântica de lista fica preservada para o leitor de tela.
    <div
      role="listitem"
      onPointerEnter={onIntent}
      className={cn(
        "flex items-start gap-3 rounded-[var(--radius)] border border-line bg-surface",
        big ? "p-3.5" : "items-center p-2.5",
        // Realce de "marcado" pelo CSS — o card não re-renderiza por causa da caixa.
        "has-[input:checked]:border-brand/40 has-[input:checked]:bg-brand-soft/40",
        !p.ativo && "opacity-50",
      )}
    >
      <CheckProduto id={p.id} onToggle={onToggle} label={`Selecionar ${p.nome}`} />
      {/*
        A miniatura é irmã do botão que abre a ficha, não filha dele: `Thumb` é
        um `<button>` (abre a foto em tela cheia) e `<button>` dentro de
        `<button>` é HTML inválido — o React acusava hydration mismatch e
        rejogava a lista inteira no cliente a cada carregamento.
      */}
      <Thumb url={p.imagemUrl} tipo={p.tipo} onClickImage={onImage} big={big} />
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 gap-3 text-left">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={cn("truncate font-semibold text-ink", big ? "text-[14px]" : "text-[13px]")}>{p.nome}</span>
            {p.vendeOnline && <Globe size={12} className="shrink-0 text-brand" />}
            {info.restricao && p.restricaoIdade && (
              <span className="inline-flex items-center rounded-full border border-danger/30 bg-danger/10 px-1 py-px text-[9px] font-bold text-danger">+18</span>
            )}
          </div>

          {(info.sku || p.ean) && (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px] text-muted">
              {info.sku && (
                <span className="inline-flex items-center gap-1"><Hash size={10} className="shrink-0" />{p.sku}</span>
              )}
              {p.ean && (
                <span className="inline-flex items-center gap-1"><Barcode size={10} className="shrink-0" />{p.ean}</span>
              )}
            </div>
          )}

          {big && metaParts.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-faint">
              {metaParts.map((part, i) => (
                <span key={part.key} className="inline-flex items-center gap-1">
                  {i > 0 && <span className="text-line">·</span>}
                  {part.node}
                </span>
              ))}
            </div>
          )}

          <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]", big ? "mt-2" : "mt-1.5")}>
            <span className="inline-flex items-center gap-1">
              <Tag size={11} className="shrink-0 text-faint" />
              {p.tipo === "INSUMO"
                ? <span className="text-faint">uso interno</span>
                : <span className="font-mono font-medium text-ink tnum">{brl(p.precoVenda)}</span>}
            </span>
            {cols.margem && m !== null && (
              <span className="inline-flex items-center gap-1 border-l border-line pl-3">
                <Percent size={11} className="shrink-0 text-faint" />
                <span className={cn("font-medium", margemColor(m))}>{m}%</span>
              </span>
            )}
            {cols.estoque && (
              <span className={cn("inline-flex items-center gap-1 border-l border-line pl-3 font-medium", STOCK_TEXT[level])}>
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STOCK_COLOR[level])} />
                {qty !== null ? `${qty} un` : STOCK_TITLE[level]}
                {p.estoque.aberto > 0 && <AbertaBadge size={15} />}
              </span>
            )}
            {cols.vendas && p.tipo !== "INSUMO" && (
              <span className="inline-flex items-center gap-1 border-l border-line pl-3 text-muted">
                <TrendingUp size={11} className="shrink-0 text-faint" />
                <span className="font-mono tnum">{giro?.vendas30d ?? 0}</span> em 30d
              </span>
            )}
            {cols.parado && p.tipo !== "INSUMO" && (
              <span className="inline-flex items-center gap-1 border-l border-line pl-3 text-muted">
                <Clock size={11} className="shrink-0 text-faint" />
                {giro?.diasSemVenda == null ? "nunca vendeu" : `${giro.diasSemVenda}d parado`}
              </span>
            )}
          </div>
        </div>
      </button>
      <Menu
        align="end"
        trigger={
          <button className="shrink-0 cursor-pointer rounded-[var(--radius-sm)] p-1.5 text-faint hover:bg-surface-2 hover:text-ink" aria-label="Mais ações">
            <MoreVertical size={16} />
          </button>
        }
      >
        <MenuItem icon={<Pencil size={15} />} onClick={onEdit}>Editar</MenuItem>
        <MenuItem icon={<ImagePlus size={15} />} onClick={onBuscarImagem} disabled={!p.ean}>
          Buscar imagem
        </MenuItem>
        <div className="my-1 h-px bg-line" role="separator" />
        <MenuItem icon={p.ativo ? <EyeOff size={15} /> : <Eye size={15} />} onClick={onArchive}>
          {p.ativo ? "Inativar" : "Ativar"}
        </MenuItem>
      </Menu>
    </div>
  );
}

// ── Exportação CSV ────────────────────────────────────────────────────────────

type Tabela = { cabecalho: string[]; linhas: (string | number | null)[][] };

/**
 * Monta a tabela do export a partir do que está na tela: as colunas ligadas em
 * Exibição, na ordem da tabela. Planilha que não bate com a tela é planilha que
 * ninguém confere.
 *
 * Números saem como número (não como texto com vírgula) — quem abre no Excel
 * quer somar a coluna. A vírgula decimal fica a cargo do CSV.
 */
function montarTabela(
  rows: ProductRow[],
  giro: Record<string, ProdutoGiro>,
  cols: Record<ColKey, boolean>,
  info: Record<InfoKey, boolean>,
): Tabela {
  type Coluna = { titulo: string; valor: (p: ProductRow) => string | number | null };

  const colunas: Coluna[] = [{ titulo: "Nome", valor: (p) => p.nome }];
  if (info.sku) colunas.push({ titulo: "SKU", valor: (p) => p.sku });
  colunas.push({ titulo: "EAN", valor: (p) => p.ean });
  if (cols.marca) colunas.push({ titulo: "Marca", valor: (p) => p.marca });
  if (cols.tipo) colunas.push({ titulo: "Tipo", valor: (p) => TIPO_LABEL[p.tipo] ?? p.tipo });
  if (cols.categoria) {
    colunas.push({ titulo: "Categoria", valor: (p) => p.categoriaNome });
    colunas.push({ titulo: "Subcategoria", valor: (p) => p.subcategoriaNome });
  }
  if (cols.local) {
    colunas.push({ titulo: "Local", valor: (p) => locaisEmUso(p).map((l) => l.nome).join(" / ") });
  }
  colunas.push({ titulo: "Preço", valor: (p) => p.precoVenda });
  colunas.push({ titulo: "Custo", valor: (p) => p.custo });
  if (cols.margem) {
    colunas.push({ titulo: "Margem %", valor: (p) => margem(p.precoVenda, p.custo) });
  }
  if (cols.estoque) colunas.push({ titulo: "Estoque", valor: (p) => stockQty(p) });
  if (cols.fornecedor) {
    colunas.push({ titulo: "Fornecedor", valor: (p) => principalFornecedor(p)?.nome ?? "" });
  }
  if (cols.vendas) colunas.push({ titulo: "Vendas 30d", valor: (p) => giro[p.id]?.vendas30d ?? 0 });
  if (cols.parado) {
    colunas.push({ titulo: "Dias sem venda", valor: (p) => giro[p.id]?.diasSemVenda ?? null });
  }
  if (info.restricao) colunas.push({ titulo: "+18", valor: (p) => (p.restricaoIdade ? "Sim" : "Não") });
  colunas.push({ titulo: "Ativo", valor: (p) => (p.ativo ? "Sim" : "Não") });

  return {
    cabecalho: colunas.map((c) => c.titulo),
    linhas: rows.map((p) => colunas.map((c) => c.valor(p))),
  };
}

function csvCell(v: string | number | null): string {
  if (v == null) return "";
  // Vírgula decimal: no CSV o separador é `;`, então não conflita.
  const s = typeof v === "number" ? String(v).replace(".", ",") : v;
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function baixarCsv(t: Tabela) {
  const linhas = t.linhas.map((l) => l.map(csvCell).join(";"));
  const csv = "﻿" + [t.cabecalho.join(";"), ...linhas].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `produtos-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Thumb com hover e clique ──────────────────────────────────────────────────

function Thumb({
  url, tipo, onClickImage, big,
}: {
  url: string | null;
  tipo: string;
  onClickImage?: () => void;
  big?: boolean;
}) {
  const size = big ? "h-12 w-12" : "h-9 w-9";
  if (url) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClickImage?.(); }}
        className={cn("relative shrink-0 cursor-zoom-in overflow-hidden rounded-[var(--radius-sm)] border border-line group/img", size)}
      >
        {/*
          `<img>` cru em vez de next/image: a foto pode vir de qualquer host
          (base de EAN, URL colada pelo operador, data: de upload) e o
          componente estoura quando o host não está na allowlist. `thumbSrc`
          resolve isso por fora — manda pelo otimizador o que ele aceita (WebP a
          36px em vez do arquivo cheio) e devolve o resto intacto.
        */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={thumbSrc(url, big ? 128 : 96)}
          alt=""
          loading="lazy"
          decoding="async"
          width={big ? 48 : 36}
          height={big ? 48 : 36}
          className="h-full w-full object-cover"
        />
        <span className="absolute inset-0 grid place-items-center bg-ink/25 opacity-0 transition-opacity group-hover/img:opacity-100">
          <Eye size={big ? 16 : 13} className="text-white drop-shadow" />
        </span>
      </button>
    );
  }
  return (
    <span className={cn("grid shrink-0 place-items-center rounded-[var(--radius-sm)] border border-line bg-surface-2 text-faint", size)}>
      <TipoIcone tipo={tipo} size={big ? 18 : 15} />
    </span>
  );
}

// ── Lista de cards (mobile), virtualizada ────────────────────────────────────

/**
 * A partir de quantos cards vale virtualizar.
 *
 * Abaixo disso o DOM inteiro é barato e vale mais manter o comportamento nativo:
 * o Ctrl+F do navegador só acha o que está renderizado, e virtualizar cedo custa
 * essa busca sem devolver nada em troca. Acima disso — o "Carregar mais" empilha
 * página sobre página e a lista não tem teto — o custo se inverte.
 */
const LIMIAR_VIRTUAL = 120;

/** Altura estimada de um card compacto; o virtualizador remede cada um ao montar. */
const ALTURA_CARD = 88;

function ListaCards({
  rows, giro, cols, info, atenuado, onToggle, onOpen, onImage, onEdit, onArchive, onBuscarImagem, onIntent,
}: {
  rows: ProductRow[];
  giro: Record<string, ProdutoGiro>;
  /** Consulta nova em voo: os cards atuais ficam a 70% em vez de sumir. */
  atenuado?: boolean;
  cols: Record<ColKey, boolean>;
  info: Record<InfoKey, boolean>;
  onToggle: (id: string, idx: number, shift: boolean) => void;
  onOpen: (p: ProductRow) => void;
  onImage: (url: string) => void;
  onEdit: (p: ProductRow) => void;
  onArchive: (p: ProductRow) => void;
  onBuscarImagem: (p: ProductRow) => void;
  onIntent: (p: ProductRow) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [offsetTopo, setOffsetTopo] = useState(0);

  const virtual = rows.length > LIMIAR_VIRTUAL;

  // Quem rola é a janela, não um container: assim o cabeçalho grudado e a
  // rolagem do resto da página continuam funcionando como antes.
  const virtualizer = useWindowVirtualizer({
    count: virtual ? rows.length : 0,
    estimateSize: () => ALTURA_CARD,
    overscan: 6,
    scrollMargin: offsetTopo,
    getItemKey: (i) => rows[i]?.id ?? i,
  });

  // `scrollMargin` precisa saber onde a lista começa na página.
  useEffect(() => {
    if (!virtual) return;
    const medir = () => setOffsetTopo(ref.current?.offsetTop ?? 0);
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, [virtual]);

  const card = (p: ProductRow, idx: number) => (
    <ProductCard
      p={p}
      giro={giro[p.id]}
      cols={cols}
      info={info}
      onToggle={(shift) => onToggle(p.id, idx, shift)}
      onOpen={() => onOpen(p)}
      onImage={p.imagemUrl ? () => onImage(p.imagemUrl!) : undefined}
      onEdit={() => onEdit(p)}
      onArchive={() => onArchive(p)}
      onBuscarImagem={() => onBuscarImagem(p)}
      onIntent={() => onIntent(p)}
    />
  );

  const atenuacao = cn("transition-opacity duration-150 ease-out", atenuado && "opacity-70");

  if (!virtual) {
    return (
      <div role="list" ref={ref} className={cn("mt-4 space-y-2 md:hidden", atenuacao)}>
        {rows.map((p, idx) => (
          <Fragment key={p.id}>{card(p, idx)}</Fragment>
        ))}
      </div>
    );
  }

  return (
    <div
      role="list"
      ref={ref}
      className={cn("relative mt-4 md:hidden", atenuacao)}
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((item) => {
        const p = rows[item.index];
        if (!p) return null;
        return (
          <div
            key={item.key}
            ref={virtualizer.measureElement}
            data-index={item.index}
            // `space-y` não alcança filho posicionado: o respiro entre os cards
            // vira padding DENTRO do elemento medido, senão os cards colam.
            className="absolute inset-x-0 top-0 pb-2"
            style={{ transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)` }}
          >
            {card(p, item.index)}
          </div>
        );
      })}
    </div>
  );
}

// ── Camada única de tooltip ──────────────────────────────────────────────────

/**
 * Um estado e um portal para a tabela inteira, em vez de um par por célula.
 *
 * Antes cada `BarcodeCell` e cada `StockCell` guardava `show` + `pos` próprios:
 * a 200 linhas por página isso é ~800 `useState` vivos só para desenhar um
 * balão de cada vez. Aqui o estado mora no provider; a célula só avisa "abre
 * isto ancorado em mim".
 *
 * Dois detalhes fazem o ganho existir:
 *
 * - a API (`mostrar`/`esconder`) é memoizada e nunca muda, então consumir o
 *   contexto não re-renderiza célula nenhuma;
 * - `children` chega como prop de quem está FORA do provider, então quando o
 *   estado muda o React reconhece o mesmo elemento e não reconcilia a tabela.
 *
 * O conteúdo entra como função, não como JSX: assim a linha que ninguém está
 * apontando não paga para montar um balão que não aparece.
 */
type TooltipAlvo = { top: number; left: number; render: () => React.ReactNode };

const TooltipCtx = createContext<{
  mostrar: (el: HTMLElement | null, render: () => React.ReactNode) => void;
  esconder: () => void;
}>({ mostrar: () => {}, esconder: () => {} });

function TooltipLayer({ children }: { children: React.ReactNode }) {
  const [alvo, setAlvo] = useState<TooltipAlvo | null>(null);

  const api = useMemo(
    () => ({
      mostrar: (el: HTMLElement | null, render: () => React.ReactNode) => {
        const r = el?.getBoundingClientRect();
        if (!r) return;
        setAlvo({ top: r.top + window.scrollY, left: r.left + window.scrollX, render });
      },
      esconder: () => setAlvo(null),
    }),
    [],
  );

  return (
    <TooltipCtx.Provider value={api}>
      {children}
      {alvo &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed z-100 min-w-50 max-w-70 rounded-lg border border-line bg-surface p-2.5 shadow-lg"
            style={{ top: alvo.top - 8, left: alvo.left, transform: "translateY(-100%)" }}
            onMouseLeave={api.esconder}
          >
            {alvo.render()}
          </div>,
          document.body,
        )}
    </TooltipCtx.Provider>
  );
}

const useTooltip = () => useContext(TooltipCtx);

// ── Célula de códigos de barra com tooltip portal ────────────────────────────

function BarcodeCell({
  sku, ean, packagings, showSku = true,
}: {
  sku: string;
  ean: string | null;
  packagings: ProductPackagingItem[];
  showSku?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const tip = useTooltip();

  const codes = [
    ean ? { label: "Unid.", code: ean } : null,
    ...packagings.filter((pk) => !!pk.ean).map((pk) => ({
      label: `${pk.nome} ${pk.fatorConversao}x`,
      code: pk.ean!,
    })),
  ].filter(Boolean) as { label: string; code: string }[];

  const hasCodes = codes.length > 0;

  function handleEnter() {
    if (!hasCodes) return;
    tip.mostrar(ref.current, () => (
      <>
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-faint">
          <Barcode size={11} /> Códigos de barra
        </div>
        <div className="space-y-1">
          {codes.map((item) => (
            <div key={item.code} className="flex items-center gap-3 text-[11px]">
              <span className="w-20 shrink-0 text-faint">{item.label}</span>
              <span className="font-mono text-ink">{item.code}</span>
            </div>
          ))}
        </div>
      </>
    ));
  }

  return (
    <>
      <div
        ref={ref}
        className={cn("mt-0.5 flex items-center gap-3", hasCodes && "cursor-help")}
        onMouseEnter={handleEnter}
        onMouseLeave={tip.esconder}
      >
        {showSku && (
          <span className="inline-flex items-center gap-1 font-mono text-[11px] text-ink-2">
            <Hash size={10} className="shrink-0 text-muted" />
            {sku}
          </span>
        )}
        {ean && (
          <span className="inline-flex items-center gap-1 font-mono text-[11px] text-ink-2">
            <Barcode size={10} className="shrink-0 text-muted" />
            {ean}
          </span>
        )}
      </div>

    </>
  );
}

// ── Visualizador de imagem em tela cheia ────────────────────────────────────

function ImageViewer({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", fn);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", fn);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-8"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-ink/85 backdrop-blur-sm" aria-hidden />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={thumbSrc(url, 1080)}
        alt=""
        className="relative max-h-full max-w-full rounded-[var(--radius-lg)] object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        onClick={onClose}
        className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/25"
        aria-label="Fechar"
      >
        <X size={18} />
      </button>
    </div>
  );
}

// ── Célula de estoque (número inline + medidor + tooltip por loja) ────────────

function StockCell({ p, level }: { p: ProductRow; level: "ok" | "warn" | "danger" }) {
  const ref = useRef<HTMLDivElement>(null);
  const tip = useTooltip();

  const qty = stockQty(p);
  const semControle = qty === null;

  // Só locais ativos (locationAtivo === false = arquivado); agrupa por loja.
  const lojas = useMemo(() => {
    const map = new Map<string, { siteNome: string; fechado: number; aberto: number }>();
    for (const l of p.locais) {
      if (!l.siteAtivo) continue;
      if (l.locationAtivo === false) continue;
      const cur = map.get(l.siteId) ?? { siteNome: l.siteNome, fechado: 0, aberto: 0 };
      cur.fechado += l.fechado;
      cur.aberto += l.aberto;
      map.set(l.siteId, cur);
    }
    return [...map.values()];
  }, [p.locais]);

  const hasDetail = lojas.length > 0;

  function handleEnter() {
    if (!hasDetail) return;
    tip.mostrar(ref.current, () => (
      <>
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-faint">Estoque por loja</p>
        <ul className="space-y-2">
          {lojas.map((l, i) => (
            <li key={i} className="text-[12px] leading-snug">
              <span className="font-semibold text-ink-2">{l.siteNome}</span>
              <p className="text-muted">
                <span className="font-mono font-medium text-ink tnum">{l.fechado}</span> un.
                {/* aberto é o ml/g restante da garrafa em uso, não uma contagem — só existe 1 aberta por vez. */}
                {l.aberto > 0 && (
                  <>
                    {" "}e{" "}
                    <span className="font-mono font-medium text-ink tnum">1</span> aberta
                  </>
                )}
              </p>
            </li>
          ))}
        </ul>
      </>
    ));
  }

  if (semControle) {
    // Mesma voz do preço de insumo ("uso interno"): informação de rodapé, não dado.
    return <span className="text-[11px] text-faint">Sem controle</span>;
  }

  return (
    <>
      <div
        ref={ref}
        className={cn("inline-flex", hasDetail && "cursor-help")}
        onMouseEnter={handleEnter}
        onMouseLeave={tip.esconder}
      >
        <span className={cn("inline-flex items-center gap-1.5 text-[12px] font-medium", STOCK_TEXT[level])}>
          <span className={cn("h-2 w-2 shrink-0 rounded-full", STOCK_COLOR[level])} />
          <span className="font-mono tnum text-[13px]">{qty}</span>
          <span className="text-[11px] font-normal text-muted">un</span>
          {p.estoque.aberto > 0 && <AbertaBadge size={16} />}
        </span>
      </div>

    </>
  );
}

// ── Células de giro ──────────────────────────────────────────────────────────

function VendasCell({ giro, tipo }: { giro?: ProdutoGiro; tipo: string }) {
  if (tipo === "INSUMO") return <span className="text-[11px] text-faint">—</span>;
  const n = giro?.vendas30d ?? 0;
  return (
    <span className={cn("font-mono text-[13px] tnum", n > 0 ? "font-medium text-ink" : "text-faint")}>
      {n}
    </span>
  );
}

function ParadoCell({ giro, tipo }: { giro?: ProdutoGiro; tipo: string }) {
  if (tipo === "INSUMO") return <span className="text-[11px] text-faint">—</span>;
  const d = giro?.diasSemVenda;
  if (d == null) return <span className="text-[11px] text-muted">nunca vendeu</span>;
  return (
    <span
      className={cn(
        "font-mono text-[12px] tnum",
        d >= 60 ? "font-medium text-danger" : d >= 30 ? "text-warn" : "text-ink-2",
      )}
    >
      {d}d
    </span>
  );
}

// ── Célula de preço: tooltip (custo × venda) + edição inline ─────────────────

/**
 * Duplo clique abre o campo na própria linha. Remarcar preço é a operação mais
 * repetida da tela — mandar para o cadastro inteiro custa quatro cliques e uma
 * navegação por produto.
 */
function PriceCell({
  produtoId, nome, tipo, precoVenda, custo, onSalvo,
}: {
  produtoId: string;
  nome: string;
  tipo: string;
  precoVenda: number | null;
  custo: number | null;
  onSalvo: () => void;
}) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState("");
  const [salvando, setSalvando] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const hasBoth = precoVenda != null && custo != null;

  function abrir() {
    if (tipo === "INSUMO") return;
    setValor(moneyToMask(precoVenda));
    setEditando(true);
    setShow(false);
  }

  function salvar() {
    const novo = parseMoney(valor);
    if (novo === precoVenda || (novo == null && precoVenda == null)) {
      setEditando(false);
      return;
    }
    setSalvando(true);
    setPrecoVenda(produtoId, novo)
      .then(() => {
        setEditando(false);
        toast.success(`${nome}: ${novo == null ? "preço removido" : brl(novo)}`);
        onSalvo();
      })
      .catch((e) =>
        toast.error("Não deu para salvar o preço", e instanceof Error ? e.message : undefined),
      )
      .finally(() => setSalvando(false));
  }

  function handleEnter() {
    if (!hasBoth || editando) return;
    const rect = ref.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.top + window.scrollY, left: rect.left + window.scrollX });
    setShow(true);
  }

  if (tipo === "INSUMO") return <span className="text-[11px] text-faint">uso interno</span>;

  if (editando) {
    // h-7 nos três: a linha não pode crescer ao entrar em edição, senão a
    // tabela inteira desce dois pixels e o olho perde o lugar.
    return (
      <div className="flex h-7 items-center gap-1">
        <Input
          autoFocus
          value={valor}
          onChange={(e) => setValor(maskMoney(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); salvar(); }
            if (e.key === "Escape") { e.preventDefault(); setEditando(false); }
          }}
          disabled={salvando}
          inputMode="numeric"
          aria-label={`Preço de ${nome}`}
          className="h-7 w-24 px-2 text-right font-mono text-[13px]"
        />
        <button
          type="button"
          onClick={salvar}
          disabled={salvando}
          aria-label="Salvar preço"
          className="grid h-7 w-7 cursor-pointer place-items-center rounded-full text-ok transition-colors hover:bg-ok-soft disabled:opacity-40"
        >
          <CheckIcon size={14} />
        </button>
        <button
          type="button"
          onClick={() => setEditando(false)}
          aria-label="Cancelar"
          className="grid h-7 w-7 cursor-pointer place-items-center rounded-full text-faint transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <>
      <div
        ref={ref}
        onDoubleClick={abrir}
        className={cn("group/preco flex h-7 items-center gap-1.5", hasBoth && "cursor-help")}
        onMouseEnter={handleEnter}
        onMouseLeave={() => setShow(false)}
        title="Duplo clique para remarcar"
      >
        {precoVenda != null
          ? <span className="font-mono text-[13px] font-medium text-ink tnum">{brl(precoVenda)}</span>
          : <span className="text-[11px] font-medium text-warn">Sem preço</span>}
        <button
          type="button"
          onClick={abrir}
          aria-label={`Editar preço de ${nome}`}
          className="cursor-pointer rounded-full p-1 text-faint opacity-0 transition-opacity hover:bg-surface-2 hover:text-ink group-hover/preco:opacity-100 focus-visible:opacity-100"
        >
          <Pencil size={12} />
        </button>
      </div>

      {show && hasBoth && typeof document !== "undefined" && createPortal(
        <div
          className="fixed z-[100] min-w-[180px] rounded-lg border border-line bg-surface p-2.5 shadow-lg"
          style={{ top: pos.top - 8, left: pos.left, transform: "translateY(-100%)" }}
          onMouseEnter={() => setShow(true)}
          onMouseLeave={() => setShow(false)}
        >
          <div className="space-y-1.5 text-[12px]">
            <div className="flex items-center justify-between gap-4">
              <span className="text-faint">Preço base</span>
              <span className="font-mono font-medium text-ink tnum">{brl(custo)}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-faint">Preço de venda</span>
              <span className="font-mono font-medium text-ink tnum">{brl(precoVenda)}</span>
            </div>
            {margem(precoVenda, custo) !== null && (
              <div className="border-t border-line pt-1.5 flex items-center justify-between gap-4">
                <span className="text-faint">Margem</span>
                <span className={cn("font-mono font-medium tnum", margemColor(margem(precoVenda, custo)))}>{margem(precoVenda, custo)}%</span>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

// ── Célula de local de armazenagem ───────────────────────────────────────────

function LocalCell({ locais }: { locais: LocalEmUso[] }) {
  if (locais.length === 0) return <span className="text-[11px] text-faint">—</span>;
  const [primeiro] = locais;
  const Icon = primeiro.tipo ? STORAGE_TIPO_ICON[primeiro.tipo] : Warehouse;
  const cor = primeiro.tipo ? STORAGE_TIPO_COLOR[primeiro.tipo] : "text-faint";
  return (
    <span
      className="inline-flex items-center gap-1 text-[12px] text-ink-2"
      title={locais.map((l) => l.nome).join(" · ")}
    >
      <Icon size={12} className={cn("shrink-0", cor)} />
      <span className="truncate">{primeiro.nome}</span>
      {locais.length > 1 && (
        <span className="text-[11px] text-faint">+{locais.length - 1}</span>
      )}
    </span>
  );
}

// ── Célula de margem (colorida por faixa) ────────────────────────────────────

function MargemCell({ precoVenda, custo, tipo }: { precoVenda: number | null; custo: number | null; tipo: string }) {
  if (tipo === "INSUMO") return <span className="text-[11px] text-faint">—</span>;
  const m = margem(precoVenda, custo);
  if (m === null) return <span className="text-[11px] text-faint">—</span>;
  return <span className={cn("text-[12px] font-semibold tnum", margemColor(m))}>{m}%</span>;
}

/**
 * Painel enquanto o pedaço de JavaScript dele ainda vem pela rede.
 *
 * Só aparece para quem clicou sem passar o mouse antes (toque, teclado rápido);
 * com o hover, o módulo já está em memória e o painel de verdade abre direto.
 * Placeholder em vez de "Carregando…": o painel já nasce com a forma que vai
 * ter, então nada salta de lugar quando ele chega.
 */
function LoadingSheet({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <Sheet open onClose={onClose} title={title}>
      <div className="space-y-2" aria-hidden>
        <div className="sk-shimmer h-9 rounded-full" />
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-line px-3 py-3">
            <div className={cn("sk-shimmer h-3.5 rounded-full", i % 2 ? "w-2/5" : "w-3/5")} />
          </div>
        ))}
      </div>
      <span className="sr-only" role="status">Carregando…</span>
    </Sheet>
  );
}

function EmptyState({ onNew, onCsv }: { onNew: () => void; onCsv: () => void }) {
  return (
    <div className="mt-10 flex flex-col items-center gap-4 rounded-[var(--radius-lg)] border border-dashed border-line-strong bg-surface px-6 py-16 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-brand-soft text-brand-strong">
        <TipoIcone tipo="SIMPLES" size={26} />
      </span>
      <div>
        <h2 className="font-display text-lg font-semibold text-ink">Comece pela sua prateleira</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
          Escaneie um código de barras e deixe a IA preencher, ou traga sua planilha atual de uma vez.
        </p>
      </div>
      <div className="flex gap-2">
        <Button onClick={onNew} className="gap-1.5"><Plus size={16} /> Cadastrar produto</Button>
        {/* Catálogo vazio é a primeira tela de todo mercado novo: o importador
            entra no forno antes do clique para não abrir em placeholder. */}
        <Button
          variant="outline"
          onClick={onCsv}
          onPointerEnter={() => painelCsv.preparar()}
          onFocus={() => painelCsv.preparar()}
          className="gap-1.5"
        >
          <Upload size={16} /> Importar CSV
        </Button>
      </div>
    </div>
  );
}
