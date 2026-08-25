"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CalendarClock,
  Camera,
  CheckCheck,
  ChevronDown,
  FileText,
  Loader2,
  Minus,
  PackageCheck,
  PackagePlus,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Wallet,
} from "lucide-react";
import { cn, moneyToMask, parseMoney } from "@/lib/utils";
import { Modal } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { Scanner } from "@/components/mobile/scanner";
import { useLeitorTeclado } from "@/lib/hooks/use-leitor-teclado";
import { receberTransferenciaAction, receberPedidoCompraAction } from "../estoque/actions";
import {
  buscarCodigosDeBarrasAction,
  buscarProdutoPorCodigoAction,
  buscarProdutosRecebimentoAction,
  type ProdutoRecebimento,
} from "./actions";
import { fmtMoney, fmtQtd, previsaoLabel, Thumb } from "../cotacoes/_ui";
import { BonusBadge } from "./_bonus";
import type { TipoItemPedido } from "./_types";

// ── Tipos ─────────────────────────────────────────────────────

type PedidoItem = {
  id: string;
  productId: string;
  nome: string;
  sku: string;
  imagemUrl: string | null;
  /** Sabor/cor pedido nesta linha — conferido na porta, somado no produto. */
  variacaoNome?: string | null;
  packagingId?: string | null;
  packagingNome: string | null;
  tipo: TipoItemPedido;
  qtdPedida: number;
  qtdRecebida: number;
  custoUnitario: number;
};
type Pedido = {
  id: string;
  numero: string;
  status: string;
  supplierNome: string;
  siteNome: string;
  previsaoEntrega: string | null;
  valorTotal: number;
  observacao: string | null;
  items: PedidoItem[];
};

type TransferItem = { productId: string; nome: string; sku: string; imagemUrl: string | null; qtdExpedida: number };
export type Transfer = {
  id: string;
  origemNome: string;
  destinoNome: string;
  expedidoEm: string | null;
  observacao: string | null;
  items: TransferItem[];
};

/** Item que chegou fora do pedido — só existe até a entrada ser gerada. */
type ExtraLinha = {
  key: string;
  produto: ProdutoRecebimento;
  packagingId: string | null;
  quantidade: number;
  custoUnitario: number;
  validade: string;
  lote: string;
  motivo: string;
};

type Rascunho = {
  em: number;
  recebido: Record<string, number>;
  tocados: string[];
  custos: Record<string, number>;
  validades: Record<string, string>;
  lotes: Record<string, string>;
  motivos: Record<string, string>;
  extras: ExtraLinha[];
  numeroNota: string;
};

// Motivos combinam com os do recebimento por XML — a mesma divergência
// precisa ter o mesmo nome nas duas portas, senão o relatório não fecha.
const MOTIVOS = [
  { id: "FALTOU", label: "Faltou produto" },
  { id: "AVARIA", label: "Avaria no transporte" },
  { id: "RECUSADO", label: "Produto recusado" },
  { id: "QUANTIDADE", label: "Quantidade diferente" },
  { id: "PRECO", label: "Preço diferente do combinado" },
  { id: "SOBRA", label: "Veio a mais" },
  { id: "OUTRO", label: "Outro" },
] as const;

const RASCUNHO_PREFIXO = "nohub-conferencia-";
/** Rascunho velho é lixo: quem volta no dia seguinte reconta, não confia. */
const RASCUNHO_VALIDADE_MS = 12 * 60 * 60 * 1000;

/** Rascunho guardado neste aparelho. Ilegível ou velho demais = nenhum. */
function lerRascunho(chave: string): Rascunho | null {
  if (typeof window === "undefined") return null;
  try {
    const cru = localStorage.getItem(chave);
    if (!cru) return null;
    const d = JSON.parse(cru) as Rascunho;
    if (!d?.em || Date.now() - d.em > RASCUNHO_VALIDADE_MS) {
      localStorage.removeItem(chave);
      return null;
    }
    return d;
  } catch {
    return null;
  }
}

/** Bipe curto: confirmação sonora vale mais que um toast na doca. */
function tocarBipe(ok: boolean) {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = ok ? 950 : 200;
    gain.gain.value = 0.05;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (ok ? 0.07 : 0.18));
    osc.onended = () => void ctx.close();
  } catch {
    // Navegador sem áudio (ou sem gesto do usuário ainda): silêncio serve.
  }
}

// ── Conferência de pedido de fornecedor ───────────────────────
// A porta é o lugar mais apressado da operação: a tela precisa caber numa
// mão, contar sozinha o que é bipado, e não deixar NADA passar em silêncio —
// nem diferença de quantidade, nem custo que subiu, nem caixa que veio a
// mais. O que não for explicado aqui vira discussão sem prova daqui a um mês.

export function PedidoReceber({
  pedido,
  onDone,
  modoScan = false,
  cega = false,
  onSujoChange,
}: {
  pedido: Pedido;
  onDone: () => void;
  /** Liga o bipe (leitor USB/BT + câmera) — soma 1 na linha certa a cada leitura. */
  modoScan?: boolean;
  /** Conferência cega: o esperado só aparece depois de a linha ser contada. */
  cega?: boolean;
  /** Avisa o painel que há contagem em andamento (confirma antes de fechar). */
  onSujoChange?: (sujo: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const rascunhoKey = `${RASCUNHO_PREFIXO}${pedido.id}`;

  // Uma conferência de 80 linhas é meia hora de trabalho. Fechar a gaveta sem
  // querer não pode apagar isso — o rascunho fica no aparelho e a contagem
  // nasce de onde parou (estado inicial, não efeito: a tela nunca chega a
  // pintar a contagem vazia por um quadro).
  const [rascunho] = useState(() => lerRascunho(`${RASCUNHO_PREFIXO}${pedido.id}`));

  const restanteDe = useCallback(
    (it: PedidoItem) => Math.max(0, it.qtdPedida - it.qtdRecebida),
    [],
  );
  const contagemLimpa = useCallback(
    () => (cega ? {} : Object.fromEntries(pedido.items.map((it) => [it.id, Math.max(0, it.qtdPedida - it.qtdRecebida)]))),
    [cega, pedido.items],
  );

  const [numeroNota, setNumeroNota] = useState(rascunho?.numeroNota ?? "");
  const [gerarFinanceiro, setGerarFinanceiro] = useState(false);
  const [vencimento, setVencimento] = useState("");
  const [codigos, setCodigos] = useState<Record<string, string[]>>({});
  const [camera, setCamera] = useState(false);

  // itemId (linha do pedido, não productId — um produto pode ter linha de
  // compra e linha de bonificação separadas) -> recebido agora.
  const [recebido, setRecebido] = useState<Record<string, number>>(
    () => rascunho?.recebido ?? contagemLimpa(),
  );
  // Linha "contada" é a que alguém tocou. Na cega é o que libera o esperado;
  // nas duas é o que faz o contador de progresso dizer a verdade.
  const [tocados, setTocados] = useState<Set<string>>(() => new Set(rascunho?.tocados ?? []));
  const [custos, setCustos] = useState<Record<string, number>>(() => rascunho?.custos ?? {});
  const [validades, setValidades] = useState<Record<string, string>>(() => rascunho?.validades ?? {});
  const [lotes, setLotes] = useState<Record<string, string>>(() => rascunho?.lotes ?? {});
  const [motivos, setMotivos] = useState<Record<string, string>>(() => rascunho?.motivos ?? {});
  const [extras, setExtras] = useState<ExtraLinha[]>(() => rascunho?.extras ?? []);

  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<"todos" | "pendentes" | "divergentes">("todos");
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const [bipado, setBipado] = useState<string | null>(null);
  const [restaurado, setRestaurado] = useState(!!rascunho);

  const [motivoDe, setMotivoDe] = useState<string | null>(null);
  const [extraAberto, setExtraAberto] = useState<{ produto?: ProdutoRecebimento; packagingId?: string | null } | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  const linhaRefs = useRef<Record<string, HTMLLIElement | null>>({});

  const sujo = tocados.size > 0 || extras.length > 0;

  // A ref evita que um callback inline do painel (identidade nova a cada
  // render) transforme este aviso num laço de renderizações.
  const avisarSujo = useRef(onSujoChange);
  useEffect(() => {
    avisarSujo.current = onSujoChange;
  }, [onSujoChange]);
  useEffect(() => {
    avisarSujo.current?.(sujo);
  }, [sujo]);

  useEffect(() => {
    if (!sujo) return;
    const t = setTimeout(() => {
      try {
        const d: Rascunho = {
          em: Date.now(),
          recebido,
          tocados: [...tocados],
          custos,
          validades,
          lotes,
          motivos,
          extras,
          numeroNota,
        };
        localStorage.setItem(rascunhoKey, JSON.stringify(d));
      } catch {
        // Sem espaço no navegador: a conferência continua, só não sobrevive ao F5.
      }
    }, 400);
    return () => clearTimeout(t);
  }, [sujo, recebido, tocados, custos, validades, lotes, motivos, extras, numeroNota, rascunhoKey]);

  function descartarRascunho() {
    try {
      localStorage.removeItem(rascunhoKey);
    } catch {
      /* nada a fazer */
    }
  }

  function recomecar() {
    descartarRascunho();
    setRecebido(contagemLimpa());
    setTocados(new Set());
    setCustos({});
    setValidades({});
    setLotes({});
    setMotivos({});
    setExtras([]);
    setRestaurado(false);
  }

  // ── Bipe ──────────────────────────────────────────────────
  // EAN do produto e da embalagem escolhida na linha do pedido, uma consulta
  // só (a linha é em unidade de compra — bipar sempre soma 1).
  useEffect(() => {
    if (!modoScan) return;
    const itens = pedido.items.map((it) => ({
      itemId: it.id,
      productId: it.productId,
      packagingId: it.packagingId ?? null,
    }));
    buscarCodigosDeBarrasAction(itens)
      .then(setCodigos)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modoScan, pedido.id]);

  const porCodigo = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const [itemId, lista] of Object.entries(codigos)) {
      for (const c of lista) mapa.set(c, itemId);
    }
    return mapa;
  }, [codigos]);

  const realcar = useCallback((itemId: string) => {
    setBipado(itemId);
    requestAnimationFrame(() =>
      linhaRefs.current[itemId]?.scrollIntoView({ block: "center", behavior: "smooth" }),
    );
  }, []);

  useEffect(() => {
    if (!bipado) return;
    const t = setTimeout(() => setBipado(null), 1400);
    return () => clearTimeout(t);
  }, [bipado]);

  const aoLerCodigo = useCallback(
    (codigo: string) => {
      const itemId = porCodigo.get(codigo) ?? porCodigo.get(codigo.toLowerCase());
      if (itemId) {
        setRecebido((prev) => ({ ...prev, [itemId]: (prev[itemId] ?? 0) + 1 }));
        setTocados((prev) => new Set(prev).add(itemId));
        setFiltro("todos");
        setBusca("");
        realcar(itemId);
        tocarBipe(true);
        return;
      }
      // Fora do pedido não é erro: é o item que o fornecedor mandou a mais.
      tocarBipe(false);
      buscarProdutoPorCodigoAction(codigo)
        .then((achado) => {
          if (!achado) {
            toast.error("Código desconhecido", `${codigo} não está no pedido nem no catálogo.`);
            return;
          }
          const jaTem = extras.find(
            (e) => e.produto.id === achado.produto.id && e.packagingId === achado.packagingId,
          );
          if (jaTem) {
            setExtras((prev) =>
              prev.map((e) => (e.key === jaTem.key ? { ...e, quantidade: e.quantidade + 1 } : e)),
            );
            toast.info(achado.produto.nome, `${jaTem.quantidade + 1} fora do pedido.`);
            return;
          }
          setExtraAberto({ produto: achado.produto, packagingId: achado.packagingId });
        })
        .catch(() => toast.error("Não deu para consultar o código", "Tente de novo."));
    },
    [porCodigo, realcar, extras],
  );

  // Sem foco em campo nenhum — quem confere tem o leitor numa mão e a caixa na outra.
  useLeitorTeclado(aoLerCodigo, { ativo: modoScan });

  // ── Edição das linhas ─────────────────────────────────────
  const setQtd = (itemId: string, v: number) => {
    setRecebido((p) => ({ ...p, [itemId]: Math.max(0, v) }));
    setTocados((p) => new Set(p).add(itemId));
  };
  const somar = (itemId: string, delta: number) =>
    setQtd(itemId, Math.max(0, (recebido[itemId] ?? 0) + delta));

  const produtos = useMemo(() => pedido.items.filter((it) => it.tipo === "COMPRA"), [pedido.items]);
  const bonificados = useMemo(() => pedido.items.filter((it) => it.tipo !== "COMPRA"), [pedido.items]);

  /** Estado de cada linha — uma conta só, usada pelo filtro, pelo resumo e pela régua. */
  const estados = useMemo(() => {
    const mapa = new Map<
      string,
      {
        restante: number;
        agora: number;
        dif: number;
        custo: number;
        custoAlterado: boolean;
        contado: boolean;
        divergente: boolean;
        precisaMotivo: boolean;
      }
    >();
    for (const it of pedido.items) {
      const restante = restanteDe(it);
      const agora = recebido[it.id] ?? 0;
      const custo = custos[it.id] ?? it.custoUnitario;
      const custoAlterado = it.tipo === "COMPRA" && Math.abs(custo - it.custoUnitario) > 0.004;
      const dif = agora - restante;
      const contado = tocados.has(it.id);
      // Linha que ninguém contou não é divergência — é linha que fica para o
      // próximo recebimento (parcial). Cobrar motivo dela transformaria a
      // conferência cega numa parede de 30 justificativas.
      const divergente = contado && (Math.abs(dif) > 0.0001 || custoAlterado);
      const precisaMotivo = divergente && !motivos[it.id];
      mapa.set(it.id, { restante, agora, dif, custo, custoAlterado, contado, divergente, precisaMotivo });
    }
    return mapa;
  }, [pedido.items, recebido, custos, motivos, tocados, restanteDe]);

  const resumo = useMemo(() => {
    let completos = 0;
    let faltantes = 0;
    let valorRecebido = 0;
    let valorPendente = 0;
    let divergentes = 0;
    let semMotivo = 0;
    for (const it of pedido.items) {
      const e = estados.get(it.id)!;
      if (e.agora >= e.restante && e.restante > 0) completos += 1;
      else if (e.agora < e.restante) faltantes += 1;
      if (e.divergente) divergentes += 1;
      if (e.precisaMotivo) semMotivo += 1;
      if (it.tipo === "COMPRA") {
        valorRecebido += e.agora * e.custo;
        valorPendente += Math.max(0, e.restante - e.agora) * e.custo;
      }
    }
    for (const ex of extras) valorRecebido += ex.quantidade * ex.custoUnitario;
    return { completos, faltantes, valorRecebido, valorPendente, divergentes, semMotivo };
  }, [pedido.items, estados, extras]);

  const conferidos = tocados.size;
  const totalLinhas = pedido.items.length;
  const algumItem = pedido.items.some((it) => (recebido[it.id] ?? 0) > 0) || extras.length > 0;
  const parcial = pedido.status === "RECEBIDO_PARCIAL";
  const podeGerar = algumItem && resumo.semMotivo === 0 && !pending;

  function receberTudo() {
    setRecebido(Object.fromEntries(pedido.items.map((it) => [it.id, restanteDe(it)])));
    setTocados(new Set(pedido.items.map((it) => it.id)));
  }

  const visiveis = useCallback(
    (lista: PedidoItem[]) => {
      const termo = busca.trim().toLowerCase();
      return lista.filter((it) => {
        const e = estados.get(it.id)!;
        if (filtro === "pendentes" && e.contado) return false;
        if (filtro === "divergentes" && !e.divergente) return false;
        if (!termo) return true;
        return `${it.nome} ${it.sku}`.toLowerCase().includes(termo);
      });
    },
    [busca, filtro, estados],
  );

  const produtosVisiveis = visiveis(produtos);
  const bonificadosVisiveis = visiveis(bonificados);
  const nadaVisivel =
    produtosVisiveis.length === 0 && bonificadosVisiveis.length === 0 && extras.length === 0;

  function receber() {
    setError(null);
    const items = pedido.items.map((it) => {
      const e = estados.get(it.id)!;
      return {
        itemId: it.id,
        qtdRecebida: e.agora,
        validade: validades[it.id] || null,
        lote: lotes[it.id] || null,
        custoUnitario: it.tipo === "COMPRA" ? e.custo : null,
        motivoDivergencia: motivos[it.id] || null,
      };
    });
    startTransition(async () => {
      try {
        await receberPedidoCompraAction({
          pedidoId: pedido.id,
          numeroNota: numeroNota || null,
          gerarFinanceiro,
          vencimento: gerarFinanceiro && vencimento ? vencimento : null,
          items,
          extras: extras.map((ex) => ({
            productId: ex.produto.id,
            packagingId: ex.packagingId,
            quantidade: ex.quantidade,
            custoUnitario: ex.custoUnitario,
            validade: ex.validade || null,
            lote: ex.lote || null,
            motivo: ex.motivo,
          })),
        });
        descartarRascunho();
        setConfirmando(false);
        toast.success("Entrada registrada.", "Saldo, custo médio e o pedido já foram atualizados.");
        onDone();
        router.refresh();
      } catch (e) {
        setConfirmando(false);
        setError(e instanceof Error ? e.message : "Erro ao receber.");
      }
    });
  }

  const itemDoMotivo = motivoDe ? pedido.items.find((it) => it.id === motivoDe) : null;

  return (
    <div className="flex flex-col gap-4">
      {modoScan && camera && (
        <Scanner
          onCodigo={aoLerCodigo}
          continuo
          onFechar={() => setCamera(false)}
          dica="Bipe a unidade ou a embalagem do pedido"
        />
      )}

      {restaurado && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[var(--radius)] border border-brand/30 bg-brand-soft px-3.5 py-2.5 text-[13px] text-ink">
          <RotateCcw size={14} className="shrink-0 text-brand" aria-hidden />
          <span className="min-w-0 flex-1">Contagem retomada de onde você parou neste aparelho.</span>
          <button
            type="button"
            onClick={recomecar}
            className="font-medium text-brand underline-offset-2 hover:underline"
          >
            Recomeçar do zero
          </button>
        </div>
      )}

      {/* Contexto + progresso: o que estou conferindo e o quanto já andei */}
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <CalendarClock size={13} /> {previsaoLabel(pedido.previsaoEntrega)} · {pedido.siteNome}
            {parcial && (
              <span className="rounded-full bg-brand-soft px-1.5 py-px text-[10px] font-semibold text-brand">
                parcial
              </span>
            )}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {modoScan && (
              <Chip onClick={() => setCamera(true)} icon={Camera}>
                Bipar com a câmera
              </Chip>
            )}
            <Chip onClick={() => setExtraAberto({})} icon={PackagePlus}>
              Item fora do pedido
            </Chip>
            {!cega && (
              <Chip onClick={receberTudo} icon={CheckCheck} iconClass="text-ok">
                Chegou tudo
              </Chip>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-300"
              style={{ width: `${totalLinhas ? (conferidos / totalLinhas) * 100 : 0}%` }}
            />
          </div>
          <span className="shrink-0 text-[11px] font-medium tabular-nums text-muted">
            {conferidos} de {totalLinhas} conferidos
          </span>
        </div>
      </div>

      {cega && (
        <p className="rounded-[var(--radius)] bg-surface-2/70 px-3.5 py-2.5 text-[12px] text-muted">
          <strong className="font-semibold text-ink">Conferência cega.</strong> Conte o que está na
          mão — a quantidade do pedido só aparece depois que você digitar a sua.
        </p>
      )}

      {modoScan && (
        <p className="rounded-[var(--radius)] bg-surface-2/60 px-3.5 py-2 text-[12px] text-muted">
          Leitor USB/Bluetooth já está ativo — é só bipar. Código de fora do pedido abre o item extra.
        </p>
      )}

      {/* Busca + recortes: pedido de 80 linhas não se confere rolando */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-faint"
            aria-hidden
          />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Achar item por nome ou SKU"
            aria-label="Buscar item do pedido"
            className="h-10 w-full rounded-full border border-line-button bg-surface pr-4 pl-9 text-sm text-ink placeholder:text-faint focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:outline-none"
          />
        </div>
        <div className="flex items-center gap-1 rounded-full bg-surface-2 p-1">
          <Aba ativo={filtro === "todos"} onClick={() => setFiltro("todos")}>
            Todos
          </Aba>
          <Aba ativo={filtro === "pendentes"} onClick={() => setFiltro("pendentes")}>
            A conferir {totalLinhas - conferidos > 0 && `(${totalLinhas - conferidos})`}
          </Aba>
          <Aba ativo={filtro === "divergentes"} onClick={() => setFiltro("divergentes")}>
            Divergentes {resumo.divergentes > 0 && `(${resumo.divergentes})`}
          </Aba>
        </div>
      </div>

      {resumo.semMotivo > 0 && (
        <button
          type="button"
          onClick={() => setFiltro("divergentes")}
          className="flex items-start gap-2.5 rounded-[var(--radius)] border border-accent/40 bg-accent-soft px-3.5 py-2.5 text-left text-[13px] text-accent transition-colors hover:bg-accent-soft/70"
        >
          <AlertTriangle size={15} className="mt-px shrink-0" aria-hidden />
          <span>
            <strong className="font-semibold">
              {resumo.semMotivo} {resumo.semMotivo === 1 ? "divergência sem motivo" : "divergências sem motivo"}
            </strong>{" "}
            — diga o que aconteceu antes de gerar a entrada. É o que sustenta a cobrança depois.
          </span>
        </button>
      )}

      {/* Itens — produtos e bonificações conferidos separadamente, nunca misturados */}
      {produtosVisiveis.length > 0 && (
        <Secao titulo="Produtos">
          {produtosVisiveis.map((it) => (
            <LinhaConferencia
              key={it.id}
              ref={(el) => {
                linhaRefs.current[it.id] = el;
              }}
              item={it}
              estado={estados.get(it.id)!}
              cega={cega}
              parcial={parcial}
              realcado={bipado === it.id}
              aberto={!!abertos[it.id]}
              motivo={motivos[it.id] ?? ""}
              validade={validades[it.id] ?? ""}
              lote={lotes[it.id] ?? ""}
              onToggle={() => setAbertos((p) => ({ ...p, [it.id]: !p[it.id] }))}
              onQtd={(v) => setQtd(it.id, v)}
              onSomar={(d) => somar(it.id, d)}
              onCusto={(v) => setCustos((p) => ({ ...p, [it.id]: v }))}
              onValidade={(v) => setValidades((p) => ({ ...p, [it.id]: v }))}
              onLote={(v) => setLotes((p) => ({ ...p, [it.id]: v }))}
              onMotivo={() => setMotivoDe(it.id)}
            />
          ))}
        </Secao>
      )}

      {bonificadosVisiveis.length > 0 && (
        <Secao titulo="Bonificações" tom="violet">
          {bonificadosVisiveis.map((it) => (
            <LinhaConferencia
              key={it.id}
              ref={(el) => {
                linhaRefs.current[it.id] = el;
              }}
              item={it}
              estado={estados.get(it.id)!}
              cega={cega}
              parcial={parcial}
              realcado={bipado === it.id}
              aberto={!!abertos[it.id]}
              motivo={motivos[it.id] ?? ""}
              validade={validades[it.id] ?? ""}
              lote={lotes[it.id] ?? ""}
              onToggle={() => setAbertos((p) => ({ ...p, [it.id]: !p[it.id] }))}
              onQtd={(v) => setQtd(it.id, v)}
              onSomar={(d) => somar(it.id, d)}
              onCusto={(v) => setCustos((p) => ({ ...p, [it.id]: v }))}
              onValidade={(v) => setValidades((p) => ({ ...p, [it.id]: v }))}
              onLote={(v) => setLotes((p) => ({ ...p, [it.id]: v }))}
              onMotivo={() => setMotivoDe(it.id)}
            />
          ))}
        </Secao>
      )}

      {extras.length > 0 && (
        <Secao titulo="Fora do pedido" tom="accent">
          {extras.map((ex) => (
            <li key={ex.key} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5">
              <Thumb url={ex.produto.imagemUrl} nome={ex.produto.nome} size={36} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{ex.produto.nome}</p>
                <p className="truncate font-mono text-[11px] text-faint">
                  {ex.produto.sku}
                  {ex.packagingId && (
                    <span className="font-sans">
                      {" · "}
                      {ex.produto.packagings.find((p) => p.id === ex.packagingId)?.nome}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 truncate text-[12px] text-accent">{ex.motivo}</p>
              </div>
              <div className="text-right text-sm">
                <p className="font-semibold tabular-nums text-ink">{fmtQtd(ex.quantidade)}</p>
                <p className="text-[11px] tabular-nums text-muted">{fmtMoney(ex.custoUnitario)} cada</p>
              </div>
              <button
                type="button"
                onClick={() => setExtras((p) => p.filter((e) => e.key !== ex.key))}
                aria-label={`Remover ${ex.produto.nome}`}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-danger-soft hover:text-danger"
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </Secao>
      )}

      {nadaVisivel && (
        <p className="rounded-[var(--radius)] border border-line bg-surface px-4 py-6 text-center text-[13px] text-muted">
          {busca.trim()
            ? `Nenhum item com “${busca.trim()}”.`
            : filtro === "pendentes"
              ? "Tudo conferido — nenhuma linha pendente."
              : "Nenhuma divergência até aqui."}
        </p>
      )}

      {/* Nota + financeiro */}
      <div className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-line bg-surface px-4 py-3.5">
        <label className="flex items-center gap-2 text-xs font-medium text-muted">
          <FileText size={14} className="shrink-0 text-faint" />
          <input
            value={numeroNota}
            onChange={(e) => setNumeroNota(e.target.value)}
            placeholder="Nº da nota fiscal (opcional)"
            className="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
          />
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-muted">
          <input
            type="checkbox"
            checked={gerarFinanceiro}
            onChange={(e) => setGerarFinanceiro(e.target.checked)}
            className="accent-brand"
          />
          <Wallet size={13} /> Lançar em contas a pagar
        </label>
        {gerarFinanceiro && (
          <div className="flex flex-wrap items-end gap-3 border-t border-line pt-3">
            <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-faint">
              Vencimento
              <input
                type="date"
                value={vencimento}
                onChange={(e) => setVencimento(e.target.value)}
                className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
              />
            </label>
            <p className="min-w-0 flex-1 text-[12px] text-muted">
              Título de <strong className="font-semibold text-ink">{fmtMoney(resumo.valorRecebido)}</strong>{" "}
              para {pedido.supplierNome}.{" "}
              {vencimento ? "Vence na data informada." : "Sem data, vale o prazo do fornecedor."}
            </p>
          </div>
        )}
      </div>

      {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      {/* Rodapé grudado: o resumo e a ação acompanham a rolagem */}
      <div className="sticky bottom-0 -mx-5 mt-1 border-t border-line bg-surface/95 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="text-muted">
              Completos <span className="font-semibold tabular-nums text-ok">{resumo.completos}</span>
            </span>
            <span className="text-muted">
              Faltando{" "}
              <span className={cn("font-semibold tabular-nums", resumo.faltantes > 0 ? "text-danger" : "text-faint")}>
                {resumo.faltantes}
              </span>
            </span>
            <span className="text-muted">
              Recebendo <span className="font-semibold tabular-nums text-ink">{fmtMoney(resumo.valorRecebido)}</span>
            </span>
            {resumo.valorPendente > 0.004 && (
              <span className="text-muted">
                Pendente <span className="font-semibold tabular-nums text-warn">{fmtMoney(resumo.valorPendente)}</span>
              </span>
            )}
          </div>
          <Button onClick={() => setConfirmando(true)} disabled={!podeGerar} className="shrink-0">
            <PackageCheck size={15} aria-hidden />
            Gerar entrada
          </Button>
        </div>
        {resumo.semMotivo > 0 && (
          <p className="mt-1.5 text-[11px] text-accent">
            Falta explicar {resumo.semMotivo} {resumo.semMotivo === 1 ? "divergência" : "divergências"}.
          </p>
        )}
      </div>

      {itemDoMotivo && (
        <MotivoModal
          item={itemDoMotivo}
          estado={estados.get(itemDoMotivo.id)!}
          atual={motivos[itemDoMotivo.id] ?? ""}
          onClose={() => setMotivoDe(null)}
          onConfirmar={(texto) => {
            setMotivos((p) => ({ ...p, [itemDoMotivo.id]: texto }));
            setMotivoDe(null);
          }}
        />
      )}

      {extraAberto && (
        <ExtraModal
          inicial={extraAberto}
          onClose={() => setExtraAberto(null)}
          onAdicionar={(linha) => {
            setExtras((p) => [...p, linha]);
            setExtraAberto(null);
            toast.success(linha.produto.nome, "Entrou como item fora do pedido.");
          }}
        />
      )}

      <Modal
        open={confirmando}
        onClose={() => setConfirmando(false)}
        title="Gerar entrada no estoque"
        description="Isto atualiza saldo, custo médio, histórico de compras e o status do pedido. Não dá para desfazer por aqui."
        width="md"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setConfirmando(false)} className="flex-1">
              Voltar
            </Button>
            <Button onClick={receber} disabled={pending} className="flex-1">
              {pending ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <PackageCheck size={15} aria-hidden />}
              Confirmar entrada
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-2.5 text-[13px] text-ink-2">
          <Resumo rotulo="Itens que entram" valor={String(pedido.items.filter((it) => (recebido[it.id] ?? 0) > 0).length + extras.length)} />
          <Resumo rotulo="Valor da mercadoria" valor={fmtMoney(resumo.valorRecebido)} />
          <Resumo rotulo="Nota fiscal" valor={numeroNota.trim() || "sem número"} />
          {totalLinhas - conferidos > 0 && (
            <p className="rounded-[var(--radius)] bg-accent-soft px-3 py-2 text-accent">
              {totalLinhas - conferidos}{" "}
              {totalLinhas - conferidos === 1 ? "linha não foi conferida" : "linhas não foram conferidas"} —{" "}
              {cega ? "entram como zero." : "entram com a quantidade do pedido."}
            </p>
          )}
          {resumo.divergentes > 0 && (
            <p className="rounded-[var(--radius)] bg-surface-2 px-3 py-2 text-muted">
              {resumo.divergentes} {resumo.divergentes === 1 ? "divergência registrada" : "divergências registradas"} com
              motivo na linha do tempo do pedido.
            </p>
          )}
          {gerarFinanceiro && (
            <p className="rounded-[var(--radius)] bg-brand-soft px-3 py-2 text-ink">
              Nasce um título de {fmtMoney(resumo.valorRecebido)} em contas a pagar.
            </p>
          )}
          {!numeroNota.trim() && (
            <p className="rounded-[var(--radius)] bg-surface-2 px-3 py-2 text-muted">
              Sem número de nota, a entrada fica marcada como aguardando documento — quando o XML
              chegar, vincule em vez de receber de novo.
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}

// ── Peças da conferência ──────────────────────────────────────

function Resumo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <p className="flex items-baseline justify-between gap-3">
      <span className="text-muted">{rotulo}</span>
      <span className="font-semibold tabular-nums text-ink">{valor}</span>
    </p>
  );
}

function Chip({
  onClick,
  icon: Icon,
  iconClass,
  children,
}: {
  onClick: () => void;
  icon: React.ElementType;
  iconClass?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-surface-2"
    >
      <Icon size={13} className={iconClass} aria-hidden /> {children}
    </button>
  );
}

function Aba({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={ativo}
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors",
        ativo ? "bg-surface text-ink shadow-[var(--shadow-1)]" : "text-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function Secao({
  titulo,
  tom = "neutro",
  children,
}: {
  titulo: string;
  tom?: "neutro" | "violet" | "accent";
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-faint">{titulo}</p>
      <ul
        className={cn(
          "divide-y rounded-xl border",
          tom === "violet"
            ? "divide-violet/20 border-violet/30 bg-violet-soft/20"
            : tom === "accent"
              ? "divide-accent/20 border-accent/40 bg-accent-soft/30"
              : "divide-line border-line",
        )}
      >
        {children}
      </ul>
    </div>
  );
}

type EstadoLinha = {
  restante: number;
  agora: number;
  dif: number;
  custo: number;
  custoAlterado: boolean;
  contado: boolean;
  divergente: boolean;
  precisaMotivo: boolean;
};

/**
 * Uma linha da conferência. O caminho curto (contar) fica sempre à vista; o
 * caminho longo (validade, lote, custo) mora atrás de um toque — na porta,
 * três campos abertos em toda linha são ruído, não recurso.
 */
function LinhaConferencia({
  ref,
  item: it,
  estado: e,
  cega,
  parcial,
  realcado,
  aberto,
  motivo,
  validade,
  lote,
  onToggle,
  onQtd,
  onSomar,
  onCusto,
  onValidade,
  onLote,
  onMotivo,
}: {
  ref?: React.Ref<HTMLLIElement>;
  item: PedidoItem;
  estado: EstadoLinha;
  cega: boolean;
  parcial: boolean;
  realcado: boolean;
  aberto: boolean;
  motivo: string;
  validade: string;
  lote: string;
  onToggle: () => void;
  onQtd: (v: number) => void;
  onSomar: (delta: number) => void;
  onCusto: (v: number) => void;
  onValidade: (v: string) => void;
  onLote: (v: string) => void;
  onMotivo: () => void;
}) {
  // A máscara só existe ENQUANTO alguém digita; fora disso ela é derivada do
  // custo. Assim rascunho restaurado e "recomeçar do zero" aparecem sozinhos,
  // sem um efeito de sincronia para brigar com a digitação.
  const [digitandoCusto, setDigitandoCusto] = useState<string | null>(null);
  const custoMask = digitandoCusto ?? moneyToMask(e.custo);
  const mostrarEsperado = !cega || e.contado;

  return (
    <li
      ref={ref}
      className={cn(
        "flex flex-col gap-2.5 px-3.5 py-3 transition-colors duration-500",
        realcado && "bg-brand-soft",
      )}
    >
      <div className="flex items-center gap-3">
        <Thumb url={it.imagemUrl} nome={it.nome} size={40} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-sm font-medium text-ink">
            {it.nome}
            {it.variacaoNome && (
              <span className="shrink-0 rounded-full border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted">
                {it.variacaoNome}
              </span>
            )}
            {it.tipo !== "COMPRA" && <BonusBadge tipo={it.tipo} />}
          </p>
          <p className="truncate font-mono text-[11px] text-faint">
            {it.sku}
            {it.packagingNome ? <span className="font-sans"> · {it.packagingNome}</span> : null}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
            {mostrarEsperado ? (
              <span className="tabular-nums">
                pedido {fmtQtd(e.restante)}
                {parcial && it.qtdRecebida > 0 && (
                  <span className="text-ok"> · já {fmtQtd(it.qtdRecebida)}</span>
                )}
              </span>
            ) : (
              <span className="text-faint">conte para ver o pedido</span>
            )}
            {mostrarEsperado && Math.abs(e.dif) > 0.0001 && (
              <span className={cn("font-semibold tabular-nums", e.dif < 0 ? "text-danger" : "text-warn")}>
                {e.dif > 0 ? "+" : ""}
                {fmtQtd(e.dif)}
              </span>
            )}
            {it.tipo === "COMPRA" && (
              <span className={cn("tabular-nums", e.custoAlterado ? "font-semibold text-warn" : "text-faint")}>
                {fmtMoney(e.custo)}
                {e.custoAlterado && <span className="text-faint"> (era {fmtMoney(it.custoUnitario)})</span>}
              </span>
            )}
          </p>
        </div>

        {/* Contador: alvo de dedo, não de mouse */}
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onSomar(-1)}
            aria-label={`Tirar 1 de ${it.nome}`}
            className="grid h-9 w-9 place-items-center rounded-full border border-line text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <Minus size={15} />
          </button>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step={1}
            value={e.contado || !cega ? e.agora : ""}
            placeholder={cega ? "0" : undefined}
            onChange={(ev) => onQtd(Number(ev.target.value))}
            aria-label={`Quantidade recebida de ${it.nome}`}
            className={cn(
              "h-9 w-16 rounded-lg border bg-surface px-2 text-center text-sm font-semibold tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)",
              !mostrarEsperado
                ? "border-line text-ink focus-visible:border-brand"
                : e.dif < 0
                  ? "border-danger text-danger"
                  : e.dif > 0
                    ? "border-warn text-warn"
                    : "border-line text-ink focus-visible:border-brand",
            )}
          />
          <button
            type="button"
            onClick={() => onSomar(1)}
            aria-label={`Somar 1 em ${it.nome}`}
            className="grid h-9 w-9 place-items-center rounded-full border border-line text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <Plus size={15} />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={aberto}
          className="flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[11px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <ChevronDown size={12} className={cn("transition-transform", aberto && "rotate-180")} aria-hidden />
          {validade || lote || e.custoAlterado ? "Detalhes preenchidos" : "Validade, lote e custo"}
        </button>

        {e.divergente &&
          (motivo ? (
            <button
              type="button"
              onClick={onMotivo}
              className="min-w-0 truncate rounded-full bg-surface-2 px-2.5 py-1 text-[11px] text-muted transition-colors hover:text-ink"
            >
              {motivo}
            </button>
          ) : (
            <button
              type="button"
              onClick={onMotivo}
              className="flex items-center gap-1 rounded-full border border-accent/50 bg-accent-soft px-2.5 py-1 text-[11px] font-semibold text-accent transition-colors hover:bg-accent-soft/70"
            >
              <AlertTriangle size={12} aria-hidden /> Informar motivo
            </button>
          ))}
      </div>

      {aberto && (
        <div className="flex flex-wrap items-end gap-2.5 rounded-[var(--radius)] bg-surface-2/60 px-3 py-2.5">
          <Campo rotulo="Validade">
            <input
              type="date"
              value={validade}
              onChange={(ev) => onValidade(ev.target.value)}
              className="rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
            />
          </Campo>
          <Campo rotulo="Lote">
            <input
              type="text"
              value={lote}
              onChange={(ev) => onLote(ev.target.value)}
              placeholder="—"
              className="w-24 rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
            />
          </Campo>
          {it.tipo === "COMPRA" && (
            <Campo rotulo="Custo da nota">
              <input
                type="text"
                inputMode="decimal"
                value={custoMask}
                onChange={(ev) => {
                  setDigitandoCusto(ev.target.value);
                  onCusto(parseMoney(ev.target.value) ?? 0);
                }}
                onBlur={() => setDigitandoCusto(null)}
                className={cn(
                  "w-24 rounded-md border bg-surface px-2 py-1 text-right text-[12px] tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)",
                  e.custoAlterado ? "border-warn text-warn" : "border-line text-ink focus-visible:border-brand",
                )}
              />
            </Campo>
          )}
          {it.tipo === "COMPRA" && (
            <p className="min-w-0 flex-1 text-[11px] text-muted">
              Negociado {fmtMoney(it.custoUnitario)}. O que você digitar aqui é o que entra no custo
              médio — o pedido continua guardando o combinado.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-faint">
      {rotulo}
      {children}
    </label>
  );
}

// ── Motivo da divergência ─────────────────────────────────────
// Sem isto a diferença entrava muda: o estoque batia, e no dia da cobrança
// ninguém sabia dizer se faltou na carga ou se o conferente errou.

function MotivoModal({
  item,
  estado,
  atual,
  onClose,
  onConfirmar,
}: {
  item: PedidoItem;
  estado: EstadoLinha;
  atual: string;
  onClose: () => void;
  onConfirmar: (texto: string) => void;
}) {
  const sugerido = estado.custoAlterado && Math.abs(estado.dif) < 0.0001 ? "PRECO" : estado.dif < 0 ? "FALTOU" : estado.dif > 0 ? "SOBRA" : "OUTRO";
  const [motivo, setMotivo] = useState<string>(sugerido);
  const [observacao, setObservacao] = useState(atual.includes(": ") ? atual.split(": ").slice(1).join(": ") : "");
  const rotulo = MOTIVOS.find((m) => m.id === motivo)?.label ?? "Outro";

  return (
    <Modal
      open
      onClose={onClose}
      title="O que aconteceu?"
      description={item.nome}
      width="md"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose} className="flex-1">
            Cancelar
          </Button>
          <Button
            onClick={() => onConfirmar(observacao.trim() ? `${rotulo}: ${observacao.trim()}` : rotulo)}
            className="flex-1"
          >
            Registrar motivo
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="rounded-[var(--radius)] bg-surface-2 px-3.5 py-2.5 text-[13px] text-muted">
          {Math.abs(estado.dif) > 0.0001 && (
            <>
              Pedido <strong className="text-ink">{fmtQtd(estado.restante)}</strong>, conferido{" "}
              <strong className="text-ink">{fmtQtd(estado.agora)}</strong> ({estado.dif > 0 ? "+" : ""}
              {fmtQtd(estado.dif)}).{" "}
            </>
          )}
          {estado.custoAlterado && (
            <>
              Custo {estado.custo > item.custoUnitario ? "subiu" : "caiu"} de{" "}
              {fmtMoney(item.custoUnitario)} para <strong className="text-ink">{fmtMoney(estado.custo)}</strong>.
            </>
          )}
        </p>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-[13px] font-medium text-ink">Motivo</legend>
          {MOTIVOS.map((m) => (
            <label
              key={m.id}
              className={cn(
                "flex cursor-pointer items-center gap-2.5 rounded-[var(--radius)] border px-3.5 py-2 text-[13px] transition-colors",
                motivo === m.id ? "border-brand bg-brand-soft text-ink" : "border-line hover:bg-surface-2",
              )}
            >
              <input
                type="radio"
                name="motivo-conferencia"
                className="accent-[var(--brand)]"
                checked={motivo === m.id}
                onChange={() => setMotivo(m.id)}
              />
              {m.label}
            </label>
          ))}
        </fieldset>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink">
            Detalhe <span className="text-muted">(opcional)</span>
          </span>
          <textarea
            value={observacao}
            onChange={(ev) => setObservacao(ev.target.value)}
            rows={2}
            maxLength={200}
            placeholder="Ex.: 2 caixas amassadas, motorista levou de volta."
            className="w-full rounded-[var(--radius)] border border-line-strong bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-faint focus-visible:border-brand/70 focus-visible:ring-1 focus-visible:ring-(--ring) focus-visible:outline-none"
          />
          <span className="text-[12px] text-muted">Fica na linha do tempo do pedido, com seu nome e a hora.</span>
        </label>
      </div>
    </Modal>
  );
}

// ── Item fora do pedido ───────────────────────────────────────

function ExtraModal({
  inicial,
  onClose,
  onAdicionar,
}: {
  inicial: { produto?: ProdutoRecebimento; packagingId?: string | null };
  onClose: () => void;
  onAdicionar: (linha: ExtraLinha) => void;
}) {
  const [termo, setTermo] = useState("");
  const [resultados, setResultados] = useState<ProdutoRecebimento[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [produto, setProduto] = useState<ProdutoRecebimento | null>(inicial.produto ?? null);
  const [packagingId, setPackagingId] = useState<string | null>(inicial.packagingId ?? null);
  const [quantidade, setQuantidade] = useState(1);
  const [custoMask, setCustoMask] = useState(() => moneyToMask(inicial.produto?.custoMedio ?? 0));
  const [validade, setValidade] = useState("");
  const [lote, setLote] = useState("");
  const [motivo, setMotivo] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      if (termo.trim().length < 2) {
        setResultados([]);
        return;
      }
      setBuscando(true);
      buscarProdutosRecebimentoAction(termo)
        .then(setResultados)
        .catch(() => setResultados([]))
        .finally(() => setBuscando(false));
    }, 250);
    return () => clearTimeout(t);
  }, [termo]);

  const custo = parseMoney(custoMask) ?? 0;
  const podeAdicionar = !!produto && quantidade > 0 && motivo.trim().length >= 3;

  return (
    <Modal
      open
      onClose={onClose}
      title="Item fora do pedido"
      description="Chegou o que ninguém pediu. Registre aqui — vira linha do pedido com quantidade pedida zero."
      width="md"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose} className="flex-1">
            Cancelar
          </Button>
          <Button
            disabled={!podeAdicionar}
            className="flex-1"
            onClick={() =>
              produto &&
              onAdicionar({
                key: `${produto.id}-${packagingId ?? "un"}-${Date.now()}`,
                produto,
                packagingId,
                quantidade,
                custoUnitario: custo,
                validade,
                lote,
                motivo: motivo.trim(),
              })
            }
          >
            Adicionar item
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {produto ? (
          <div className="flex items-center gap-3 rounded-[var(--radius)] border border-line bg-surface-2/50 px-3.5 py-2.5">
            <Thumb url={produto.imagemUrl} nome={produto.nome} size={40} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{produto.nome}</p>
              <p className="truncate font-mono text-[11px] text-faint">{produto.sku}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setProduto(null);
                setPackagingId(null);
              }}
              className="text-[12px] font-medium text-brand hover:underline"
            >
              Trocar
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden />
              <input
                autoFocus
                value={termo}
                onChange={(ev) => setTermo(ev.target.value)}
                placeholder="Buscar no catálogo por nome, SKU ou código"
                className="h-10 w-full rounded-full border border-line-button bg-surface pr-4 pl-9 text-sm text-ink placeholder:text-faint focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:outline-none"
              />
            </div>
            {buscando && <p className="px-1 text-[12px] text-muted">Procurando…</p>}
            {!buscando && termo.trim().length >= 2 && resultados.length === 0 && (
              <p className="rounded-[var(--radius)] bg-surface-2 px-3 py-2.5 text-[12px] text-muted">
                Nada com “{termo.trim()}”. Produto que não existe no catálogo precisa ser cadastrado
                antes de dar entrada.
              </p>
            )}
            <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
              {resultados.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setProduto(p);
                      setPackagingId(p.packagings.find((pk) => pk.isCompraDefault)?.id ?? null);
                      setCustoMask(moneyToMask(p.custoMedio ?? 0));
                    }}
                    className="flex w-full items-center gap-3 rounded-[var(--radius)] px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
                  >
                    <Thumb url={p.imagemUrl} nome={p.nome} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-ink">{p.nome}</span>
                      <span className="block truncate font-mono text-[11px] text-faint">{p.sku}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {produto && (
          <>
            {produto.packagings.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium text-ink">Unidade de entrada</span>
                <div className="flex flex-wrap gap-1.5">
                  <Opcao ativo={packagingId === null} onClick={() => setPackagingId(null)}>
                    Unidade
                  </Opcao>
                  {produto.packagings.map((pk) => (
                    <Opcao key={pk.id} ativo={packagingId === pk.id} onClick={() => setPackagingId(pk.id)}>
                      {pk.nome} ({fmtQtd(pk.fatorConversao)} un)
                    </Opcao>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-end gap-3">
              <Campo rotulo="Quantidade">
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={quantidade}
                  onChange={(ev) => setQuantidade(Math.max(0, Number(ev.target.value)))}
                  className="h-9 w-20 rounded-lg border border-line bg-surface px-2 text-center text-sm font-semibold tabular-nums text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
                />
              </Campo>
              <Campo rotulo="Custo unitário">
                <input
                  type="text"
                  inputMode="decimal"
                  value={custoMask}
                  onChange={(ev) => setCustoMask(ev.target.value)}
                  onBlur={() => setCustoMask(moneyToMask(custo))}
                  className="h-9 w-28 rounded-lg border border-line bg-surface px-2 text-right text-sm tabular-nums text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
                />
              </Campo>
              <Campo rotulo="Validade">
                <input
                  type="date"
                  value={validade}
                  onChange={(ev) => setValidade(ev.target.value)}
                  className="h-9 rounded-lg border border-line bg-surface px-2 text-[12px] text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
                />
              </Campo>
              <Campo rotulo="Lote">
                <input
                  type="text"
                  value={lote}
                  onChange={(ev) => setLote(ev.target.value)}
                  placeholder="—"
                  className="h-9 w-24 rounded-lg border border-line bg-surface px-2 text-[12px] text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
                />
              </Campo>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink">Por que veio fora do pedido?</span>
              <input
                value={motivo}
                onChange={(ev) => setMotivo(ev.target.value)}
                maxLength={200}
                placeholder="Ex.: bonificação combinada por telefone."
                className="w-full rounded-[var(--radius)] border border-line-strong bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-faint focus-visible:border-brand/70 focus-visible:ring-1 focus-visible:ring-(--ring) focus-visible:outline-none"
              />
              <span className="flex items-center gap-1.5 text-[12px] text-muted">
                <Sparkles size={12} aria-hidden /> Vira observação da linha e entra na linha do tempo.
              </span>
            </label>
          </>
        )}
      </div>
    </Modal>
  );
}

function Opcao({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors",
        ativo ? "border-brand bg-brand-soft text-ink" : "border-line text-muted hover:bg-surface-2 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

// ── Conferência de transferência (CD → loja) ──────────────────

export function TransferReceber({ transfer, onDone }: { transfer: Transfer; onDone: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [contagem, setContagem] = useState<Record<string, number>>(() =>
    Object.fromEntries(transfer.items.map((it) => [it.productId, it.qtdExpedida])),
  );

  const setQtd = (productId: string, qtd: number) => setContagem((p) => ({ ...p, [productId]: Math.max(0, qtd) }));

  const temDivergencia = transfer.items.some((it) => (contagem[it.productId] ?? it.qtdExpedida) !== it.qtdExpedida);

  function receber() {
    setError(null);
    const items = transfer.items.map((it) => ({ productId: it.productId, qtdRecebida: contagem[it.productId] ?? it.qtdExpedida }));
    startTransition(async () => {
      try {
        await receberTransferenciaAction({ transferId: transfer.id, items });
        onDone();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao receber.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {transfer.observacao && <p className="text-xs text-faint">{transfer.observacao}</p>}

      <div className="flex flex-col gap-2">
        {transfer.items.map((it) => {
          const recebida = contagem[it.productId] ?? it.qtdExpedida;
          const divergente = recebida !== it.qtdExpedida;
          return (
            <div key={it.productId} className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2">
              <Thumb url={it.imagemUrl} nome={it.nome} size={36} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink">{it.nome}</p>
                <p className="font-mono text-[11px] text-faint">{it.sku} · expedido {fmtQtd(it.qtdExpedida)}</p>
              </div>
              <div className="flex w-28 flex-col gap-1">
                <label className="text-[10px] font-semibold text-faint">Recebido</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={recebida}
                  onChange={(e) => setQtd(it.productId, Number(e.target.value))}
                  className={cn(
                    "rounded-lg border bg-surface px-3 py-1.5 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)",
                    divergente ? "border-danger text-danger" : "border-line text-ink focus-visible:border-brand",
                  )}
                />
              </div>
            </div>
          );
        })}
      </div>

      {temDivergencia && (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
          Divergência detectada — a diferença será registrada como perda de trânsito.
        </p>
      )}

      {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={receber}
          disabled={pending}
          className="flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-60"
        >
          {pending ? <Loader2 size={14} className="animate-spin" /> : <PackageCheck size={14} />}
          Confirmar recebimento
        </button>
      </div>
    </div>
  );
}
