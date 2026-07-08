"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  Search,
  Sparkles,
  Mic,
  MicOff,
  TrendingUp,
  Percent,
  CreditCard,
  ChartColumnBig,
  TriangleAlert,
  FlaskConical,
  Boxes,
  Truck,
  Landmark,
  Activity,
  PackageSearch,
  ShoppingCart,
  FileText,
  Eye,
  Download,
  Share2,
  Check,
  type LucideIcon,
} from "lucide-react";
import { Modal, Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RelatorioIA } from "../ia/_ia";
import type { ModeloId } from "../_modelos";

/* ------------------------------------------------------------------ */
/* Catálogo                                                            */
/* ------------------------------------------------------------------ */

type CardRelatorio = {
  id: string; // rota /relatorios/{id}
  nome: string;
  descricao: string;
  icon: LucideIcon;
  /** Modelo de PDF correspondente (rota /documento/{modelo}). */
  modelo?: ModeloId;
  /** Pergunta contextual enviada à IA pelo botão "Analisar com IA". */
  perguntaIA: string;
  /** Termos extras para a busca (sem acento, minúsculas). */
  keywords: string[];
};

type Grupo = {
  id: string;
  nome: string;
  descricao: string;
  icon: LucideIcon;
  itens: CardRelatorio[];
};

const CATALOGO: Grupo[] = [
  {
    id: "financeiro",
    nome: "Financeiro",
    descricao: "Receita, margem e rentabilidade",
    icon: Landmark,
    itens: [
      {
        id: "vendas",
        nome: "Receita",
        descricao: "Faturamento, ticket médio e tendência de vendas por período.",
        icon: TrendingUp,
        modelo: "vendas-resumo",
        perguntaIA: "Resuma minhas vendas dos últimos 30 dias e destaque o que mudou",
        keywords: ["faturamento", "receita", "vendas", "ticket", "quanto vendi"],
      },
      {
        id: "margem",
        nome: "Margem",
        descricao: "Margem bruta, CMV e rentabilidade de cada produto.",
        icon: Percent,
        modelo: "margem-produto",
        perguntaIA: "Produtos com margem abaixo de 20% nos últimos 30 dias",
        keywords: ["margem", "cmv", "lucro", "rentabilidade", "menor margem"],
      },
      {
        id: "pagamentos",
        nome: "Pagamentos e caixa",
        descricao: "Mix de formas de pagamento e fechamentos de caixa.",
        icon: CreditCard,
        modelo: "caixa",
        perguntaIA: "Quanto vendi por método de pagamento este mês",
        keywords: ["pix", "cartao", "dinheiro", "caixa", "fechamento", "pagamento"],
      },
      {
        id: "abc",
        nome: "Curva ABC",
        descricao: "Classificação A/B/C dos produtos por participação no faturamento.",
        icon: ChartColumnBig,
        modelo: "abc",
        perguntaIA: "Curva ABC do faturamento do mês",
        keywords: ["abc", "curva", "pareto", "top produtos", "classificacao"],
      },
    ],
  },
  {
    id: "operacao",
    nome: "Operação",
    descricao: "Perdas, produção e operação diária",
    icon: Activity,
    itens: [
      {
        id: "perdas",
        nome: "Perdas e quebras",
        descricao: "Produtos baixados como perda no período, com custo total.",
        icon: TriangleAlert,
        modelo: "perdas",
        perguntaIA: "Maiores perdas por custo nos últimos 30 dias",
        keywords: ["perda", "quebra", "avaria", "vencido", "baixa"],
      },
      {
        id: "producao",
        nome: "Produção e drinks",
        descricao: "Rentabilidade de bebidas personalizadas e consumo de insumos.",
        icon: FlaskConical,
        perguntaIA: "Qual a rentabilidade das minhas bebidas produzidas este mês",
        keywords: ["drink", "producao", "insumo", "receita de drink", "bebida"],
      },
    ],
  },
  {
    id: "estoque",
    nome: "Estoque",
    descricao: "Posição, ruptura e giro de estoque",
    icon: PackageSearch,
    itens: [
      {
        id: "estoque",
        nome: "Inventário",
        descricao: "Posição atual do estoque, ruptura e valor parado por produto.",
        icon: Boxes,
        modelo: "estoque-posicao",
        perguntaIA: "Produtos parados com mais valor em estoque",
        keywords: ["estoque", "inventario", "saldo", "ruptura", "parado", "giro"],
      },
    ],
  },
  {
    id: "compras",
    nome: "Compras",
    descricao: "Entradas e fornecedores",
    icon: ShoppingCart,
    itens: [
      {
        id: "compras",
        nome: "Compras do período",
        descricao: "Entradas de mercadoria por produto e total por fornecedor.",
        icon: Truck,
        modelo: "compras",
        perguntaIA: "Compras por fornecedor nos últimos 30 dias",
        keywords: ["compra", "fornecedor", "entrada", "pedido", "recebimento"],
      },
    ],
  },
];

/** Chips de sugestão: ou abrem um relatório, ou perguntam direto à IA. */
const CHIPS: ({ label: string } & (
  | { tipo: "relatorio"; href: string }
  | { tipo: "ia"; pergunta: string }
))[] = [
  { label: "Receita hoje", tipo: "relatorio", href: "/relatorios/vendas?periodo=hoje" },
  { label: "Top produtos", tipo: "ia", pergunta: "Top 10 produtos mais vendidos em 30 dias" },
  { label: "Curva ABC", tipo: "relatorio", href: "/relatorios/abc" },
  { label: "Estoque parado", tipo: "ia", pergunta: "Produtos parados com mais valor em estoque" },
  { label: "Margem abaixo de 20%", tipo: "ia", pergunta: "Produtos com margem abaixo de 20% este mês" },
  { label: "Perdas", tipo: "relatorio", href: "/relatorios/perdas" },
  { label: "Compras", tipo: "relatorio", href: "/relatorios/compras" },
  { label: "Caixa", tipo: "relatorio", href: "/relatorios/pagamentos" },
];

const PRESETS = [
  { id: "hoje", label: "Hoje" },
  { id: "7d", label: "7 dias" },
  { id: "30d", label: "30 dias" },
  { id: "mes", label: "Este mês" },
  { id: "custom", label: "Personalizado" },
];

/* ------------------------------------------------------------------ */
/* Persistência local (últimas gerações e documentos recentes)         */
/* ------------------------------------------------------------------ */

type DocRecente = { modelo: string; nome: string; url: string; ts: number };
type Atividade = Record<string, number>; // cardId -> timestamp da última consulta

const LS_DOCS = "nohub.analises.docs";
const LS_ATIVIDADE = "nohub.analises.atividade";

const DOCS_VAZIO: DocRecente[] = [];
const ATIVIDADE_VAZIA: Atividade = {};

/**
 * localStorage como store externo (useSyncExternalStore): sem hydration
 * mismatch, sem setState em effect, e sincroniza entre abas via "storage".
 */
const ouvintes = new Set<() => void>();
const cacheLocal = new Map<string, { raw: string | null; valor: unknown }>();

function lerLocal<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  const c = cacheLocal.get(key);
  if (c && c.raw === raw) return c.valor as T;
  let valor: T;
  try {
    valor = raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    valor = fallback;
  }
  cacheLocal.set(key, { raw, valor });
  return valor;
}

function escreverLocal(key: string, valor: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(valor));
  } catch {}
  ouvintes.forEach((fn) => fn());
}

function assinarLocal(fn: () => void) {
  ouvintes.add(fn);
  window.addEventListener("storage", fn);
  return () => {
    ouvintes.delete(fn);
    window.removeEventListener("storage", fn);
  };
}

function useLocalJson<T>(key: string, fallback: T): T {
  return useSyncExternalStore(
    assinarLocal,
    () => lerLocal(key, fallback),
    () => fallback,
  );
}

function registrarAtividade(cardId: string) {
  escreverLocal(LS_ATIVIDADE, {
    ...lerLocal(LS_ATIVIDADE, ATIVIDADE_VAZIA),
    [cardId]: Date.now(),
  });
}

function registrarDoc(doc: Omit<DocRecente, "ts">) {
  const atuais = lerLocal(LS_DOCS, DOCS_VAZIO);
  escreverLocal(
    LS_DOCS,
    [{ ...doc, ts: Date.now() }, ...atuais.filter((d) => d.url !== doc.url)].slice(0, 8),
  );
}

function tempoRelativo(ts: number): string {
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `há ${d} d`;
  return `há ${Math.floor(d / 30)} mês${Math.floor(d / 30) > 1 ? "es" : ""}`;
}

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    // remove diacríticos (combining marks)
    .replace(/[\u0300-\u036f]/g, "");
}

/* ------------------------------------------------------------------ */
/* Hub                                                                 */
/* ------------------------------------------------------------------ */

export function HubAnalises() {
  const [busca, setBusca] = useState("");
  const [gravando, setGravando] = useState(false);
  const [ia, setIa] = useState<{ open: boolean; pergunta?: string }>({ open: false });
  const [pdf, setPdf] = useState<CardRelatorio | null>(null);
  const [periodo, setPeriodo] = useState("30d");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [copiado, setCopiado] = useState<string | null>(null);

  const docs = useLocalJson(LS_DOCS, DOCS_VAZIO);
  const atividade = useLocalJson(LS_ATIVIDADE, ATIVIDADE_VAZIA);

  const inputRef = useRef<HTMLInputElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);

  // "/" foca a busca de qualquer lugar da página.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      inputRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function perguntarIA(pergunta?: string) {
    const q = (pergunta ?? busca).trim();
    setIa({ open: true, pergunta: q.length >= 3 ? q : undefined });
  }

  function abrirPdf(card: CardRelatorio) {
    setPeriodo("30d");
    setDe("");
    setAte("");
    setPdf(card);
  }

  function gerarPdf() {
    if (!pdf?.modelo) return;
    const qs = new URLSearchParams();
    qs.set("periodo", periodo);
    if (periodo === "custom") {
      if (de) qs.set("de", de);
      if (ate) qs.set("ate", ate);
    }
    const url = `/documento/${pdf.modelo}?${qs.toString()}`;
    window.open(url, "_blank", "noopener");
    registrarAtividade(pdf.id);
    registrarDoc({ modelo: pdf.modelo, nome: pdf.nome, url });
    setPdf(null);
  }

  async function compartilharDoc(doc: DocRecente) {
    const absoluta = `${window.location.origin}${doc.url}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: doc.nome, url: absoluta });
        return;
      } catch {}
    }
    await navigator.clipboard.writeText(absoluta);
    setCopiado(doc.url);
    setTimeout(() => setCopiado(null), 2000);
  }

  function toggleVoz() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechAPI) {
      alert("Seu navegador não suporta reconhecimento de voz. Use Chrome ou Edge.");
      return;
    }
    if (gravando && recognitionRef.current) {
      recognitionRef.current.stop();
      setGravando(false);
      return;
    }
    const rec = new SpeechAPI();
    rec.lang = "pt-BR";
    rec.continuous = false;
    rec.interimResults = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (event: any) => {
      const texto: string = event.results[0][0].transcript;
      setBusca((prev) => (prev ? `${prev} ${texto}` : texto));
      setGravando(false);
      inputRef.current?.focus();
    };
    rec.onerror = () => setGravando(false);
    rec.onend = () => setGravando(false);
    recognitionRef.current = rec;
    rec.start();
    setGravando(true);
  }

  // Busca filtra o catálogo ao vivo; Enter vira pergunta pra IA.
  const termo = normalizar(busca.trim());
  const grupos = useMemo(() => {
    if (!termo) return CATALOGO;
    return CATALOGO.map((g) => ({
      ...g,
      itens: g.itens.filter((item) =>
        [item.nome, item.descricao, g.nome, ...item.keywords].some((t) =>
          normalizar(t).includes(termo),
        ),
      ),
    })).filter((g) => g.itens.length > 0);
  }, [termo]);

  const semResultado = termo.length > 0 && grupos.length === 0;

  return (
    <div className="space-y-10">
      {/* ------------------------------------------------------------ */}
      {/* Busca inteligente — entrada única da tela                     */}
      {/* ------------------------------------------------------------ */}
      <section className="space-y-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (busca.trim().length >= 3) perguntarIA();
          }}
          className={cn(
            "flex h-14 items-center gap-2 rounded-(--radius) border border-line bg-surface pl-4 pr-2",
            "shadow-(--shadow-float) transition-shadow",
            "focus-within:border-brand/50 focus-within:shadow-[0_0_0_4px_var(--ring),var(--shadow-float)]",
          )}
        >
          <Search size={19} className="shrink-0 text-faint" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setBusca("")}
            placeholder="Pesquise um relatório ou faça uma pergunta para a IA…"
            aria-label="Pesquisar relatório ou perguntar à IA"
            className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-faint"
          />
          <kbd className="hidden shrink-0 rounded-md border border-line px-1.5 py-0.5 font-mono text-[11px] text-faint sm:block">
            /
          </kbd>
          <button
            type="button"
            onClick={toggleVoz}
            title={gravando ? "Parar gravação" : "Falar (pt-BR)"}
            className={cn(
              "grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-full transition-colors",
              gravando
                ? "animate-pulse bg-danger-soft text-danger"
                : "text-muted hover:bg-surface-2 hover:text-ink",
            )}
          >
            {gravando ? <MicOff size={17} aria-hidden /> : <Mic size={17} aria-hidden />}
          </button>
          <button
            type="button"
            onClick={() => perguntarIA()}
            className="flex h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-brand px-4 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
          >
            <Sparkles size={15} aria-hidden />
            <span className="hidden sm:inline">Perguntar à IA</span>
            <span className="sm:hidden">IA</span>
          </button>
        </form>

        {/* Sugestões rápidas */}
        <div className="flex flex-wrap gap-2" aria-label="Sugestões rápidas">
          {CHIPS.map((chip) =>
            chip.tipo === "relatorio" ? (
              <Link
                key={chip.label}
                href={chip.href}
                className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-[13px] font-medium text-muted transition-colors hover:border-brand/40 hover:bg-brand-soft hover:text-ink"
              >
                {chip.label}
              </Link>
            ) : (
              <button
                key={chip.label}
                type="button"
                onClick={() => perguntarIA(chip.pergunta)}
                className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-1.5 text-[13px] font-medium text-muted transition-colors hover:border-brand/40 hover:bg-brand-soft hover:text-ink"
              >
                <Sparkles size={12} className="text-brand" aria-hidden />
                {chip.label}
              </button>
            ),
          )}
        </div>
      </section>

      {/* ------------------------------------------------------------ */}
      {/* Categorias e cards                                            */}
      {/* ------------------------------------------------------------ */}
      {semResultado ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-line py-14 text-center">
          <Search size={22} className="text-faint" aria-hidden />
          <div>
            <p className="text-sm font-medium text-ink">
              Nenhum relatório corresponde a “{busca.trim()}”
            </p>
            <p className="mt-1 text-sm text-muted">
              A IA pode responder — ela consulta seus dados reais.
            </p>
          </div>
          <Button size="sm" onClick={() => perguntarIA()}>
            <Sparkles size={14} /> Perguntar à IA
          </Button>
        </div>
      ) : (
        grupos.map((grupo) => {
          const GrupoIcon = grupo.icon;
          return (
            <section key={grupo.id} aria-label={grupo.nome}>
              <div className="mb-4 flex items-center gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-sm bg-surface-2 text-muted">
                  <GrupoIcon size={15} aria-hidden />
                </span>
                <div>
                  <h2 className="font-display text-base font-bold text-ink">{grupo.nome}</h2>
                  <p className="text-[13px] text-muted">{grupo.descricao}</p>
                </div>
                <span className="ml-2 h-px flex-1 bg-line" aria-hidden />
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {grupo.itens.map((item) => {
                  const Icon = item.icon;
                  const ts = atividade[item.id];
                  return (
                    <article
                      key={item.id}
                      className={cn(
                        "group flex flex-col rounded-lg border border-line bg-surface",
                        "transition-all motion-safe:hover:-translate-y-0.5 hover:border-brand/50 hover:shadow-(--shadow-float)",
                      )}
                    >
                      <div className="flex flex-1 flex-col gap-3 p-5">
                        <div className="flex items-start justify-between">
                          <span className="grid h-10 w-10 place-items-center rounded-sm bg-brand-softer text-brand">
                            <Icon size={18} aria-hidden />
                          </span>
                          {ts && (
                            <span className="mt-0.5 text-[11px] text-faint">
                              Consultado {tempoRelativo(ts)}
                            </span>
                          )}
                        </div>
                        <div>
                          <h3 className="font-display text-sm font-bold text-ink transition-colors group-hover:text-brand">
                            {item.nome}
                          </h3>
                          <p className="mt-1 text-[13px] leading-snug text-muted">
                            {item.descricao}
                          </p>
                        </div>
                      </div>

                      {/* Ações — sempre no rodapé do card */}
                      <div className="flex items-center border-t border-line">
                        <Link
                          href={`/relatorios/${item.id}`}
                          onClick={() => registrarAtividade(item.id)}
                          className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 py-2.5 text-[13px] font-medium text-muted transition-colors hover:bg-brand-soft hover:text-brand"
                        >
                          <Eye size={14} aria-hidden />
                          Abrir
                        </Link>
                        <span className="h-5 w-px bg-line" aria-hidden />
                        <button
                          type="button"
                          onClick={() => {
                            registrarAtividade(item.id);
                            perguntarIA(item.perguntaIA);
                          }}
                          title="Analisar com IA"
                          className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 py-2.5 text-[13px] font-medium text-muted transition-colors hover:bg-brand-soft hover:text-brand"
                        >
                          <Sparkles size={14} aria-hidden />
                          IA
                        </button>
                        {item.modelo && (
                          <>
                            <span className="h-5 w-px bg-line" aria-hidden />
                            <button
                              type="button"
                              onClick={() => abrirPdf(item)}
                              title="Gerar PDF"
                              className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 py-2.5 text-[13px] font-medium text-muted transition-colors hover:bg-brand-soft hover:text-brand"
                            >
                              <FileText size={14} aria-hidden />
                              PDF
                            </button>
                          </>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })
      )}

      {/* ------------------------------------------------------------ */}
      {/* Documentos recentes                                           */}
      {/* ------------------------------------------------------------ */}
      <section id="documentos" aria-label="Documentos recentes">
        <div className="mb-4 flex items-center gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-sm bg-surface-2 text-muted">
            <FileText size={15} aria-hidden />
          </span>
          <div>
            <h2 className="font-display text-base font-bold text-ink">Documentos recentes</h2>
            <p className="text-[13px] text-muted">PDFs gerados neste navegador</p>
          </div>
          <span className="ml-2 h-px flex-1 bg-line" aria-hidden />
        </div>

        {docs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line px-5 py-8 text-center">
            <p className="text-sm text-muted">
              Nenhum documento gerado ainda. Use a ação{" "}
              <span className="font-medium text-ink">PDF</span> em qualquer relatório acima — o
              documento aparece aqui.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
            {docs.map((doc) => (
              <li key={doc.url} className="flex items-center gap-3 px-4 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-sm bg-surface-2 text-muted">
                  <FileText size={15} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{doc.nome}</p>
                  <p className="text-[11px] text-faint">Gerado {tempoRelativo(doc.ts)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => window.open(doc.url, "_blank", "noopener")}
                    title="Visualizar"
                    className="grid h-8 w-8 cursor-pointer place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                  >
                    <Eye size={15} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => window.open(doc.url, "_blank", "noopener")}
                    title="Baixar (imprimir ou salvar como PDF)"
                    className="grid h-8 w-8 cursor-pointer place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                  >
                    <Download size={15} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => compartilharDoc(doc)}
                    title={copiado === doc.url ? "Link copiado" : "Compartilhar"}
                    className="grid h-8 w-8 cursor-pointer place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                  >
                    {copiado === doc.url ? (
                      <Check size={15} className="text-ok" aria-hidden />
                    ) : (
                      <Share2 size={15} aria-hidden />
                    )}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------------------ */}
      {/* Drawer da IA — o assistente nunca tira o usuário da tela      */}
      {/* ------------------------------------------------------------ */}
      <Sheet
        open={ia.open}
        onClose={() => setIa({ open: false })}
        title="Assistente de análises"
        description="Pergunte sobre vendas, estoque, margem ou perdas — em português."
        width="2xl"
      >
        <RelatorioIA compacto perguntaInicial={ia.pergunta} />
      </Sheet>

      {/* Modal de parâmetros do PDF */}
      <Modal
        open={!!pdf}
        onClose={() => setPdf(null)}
        title={pdf ? `${pdf.nome} em PDF` : ""}
        description={
          pdf?.modelo === "estoque-posicao"
            ? "Usa o saldo de estoque ao vivo — abre em nova aba para impressão ou PDF."
            : "Escolha o período. O documento abre em nova aba para impressão ou PDF."
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setPdf(null)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={gerarPdf}>
              <FileText size={15} /> Gerar PDF
            </Button>
          </div>
        }
      >
        {pdf?.modelo !== "estoque-posicao" && (
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted">
                Período
              </label>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPeriodo(p.id)}
                    className={cn(
                      "cursor-pointer rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                      periodo === p.id
                        ? "border-brand bg-brand text-on-brand"
                        : "border-line text-muted hover:text-ink",
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            {periodo === "custom" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">De</label>
                  <input
                    type="date"
                    value={de}
                    onChange={(e) => setDe(e.target.value)}
                    className="h-10 w-full rounded-(--radius) border border-line bg-surface px-3 text-sm text-ink"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">Até</label>
                  <input
                    type="date"
                    value={ate}
                    onChange={(e) => setAte(e.target.value)}
                    className="h-10 w-full rounded-(--radius) border border-line bg-surface px-3 text-sm text-ink"
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
