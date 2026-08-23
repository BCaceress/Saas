"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Barcode,
  Building2,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileCode,
  FileUp,
  Loader2,
  PackageSearch,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, Modal, type SheetWidth } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { importarXmlRecebimentoAction, vincularPedidoAction } from "./recebimento/actions";
import { listarPedidosAReceberAction } from "./actions";
import { PedidoReceber } from "./_recebimentos";
import { previsaoLabel, fmtMoney } from "../cotacoes/_ui";
import type { PedidoView } from "./_pedidos";

// ── Painel "Receber mercadoria" ─────────────────────────────────
// Ponto de entrada único do recebimento, aberto a partir de um pedido (card,
// drawer, kanban) ou sem pedido nenhum ("Receber sem pedido"). XML deixa de
// ser tela própria: é só uma das 3 portas — as outras duas reaproveitam
// `PedidoReceber`, que já existe e já grava a entrada.
//
// Quem entra sem pedido escolhe um aqui mesmo: antes, escanear e conferir à
// mão ficavam desabilitados explicando o porquê num `title` que celular
// nenhum mostra — a tela dizia "não" sem dizer "por aqui".

type Etapa = "escolha" | "xml" | "escolher-pedido" | "scan" | "manual";

export function ReceberMercadoriaPanel({
  pedido,
  open,
  onClose,
  etapaInicial = "escolha",
  cega = false,
}: {
  /** `null` = "Receber sem pedido": o painel pede o pedido antes de conferir. */
  pedido: PedidoView | null;
  open: boolean;
  onClose: () => void;
  /** "xml" pula a escolha e já abre o upload — usado pelo botão "Receber pedido". */
  etapaInicial?: Etapa;
  /** Conferência cega ligada nas configurações de estoque do tenant. */
  cega?: boolean;
}) {
  const router = useRouter();
  const [etapa, setEtapa] = useState<Etapa>(etapaInicial);
  const [enviando, setEnviando] = useState(false);
  const [escolhido, setEscolhido] = useState<PedidoView | null>(null);
  const [sujo, setSujo] = useState(false);
  const [confirmandoSaida, setConfirmandoSaida] = useState(false);
  /** Para onde ir depois de escolher o pedido na lista. */
  const destinoRef = useRef<Etapa>("manual");

  const alvo = pedido ?? escolhido;

  function limpar() {
    onClose();
    // Reset depois da animação de saída do Sheet, não no meio dela.
    setTimeout(() => {
      setEtapa(etapaInicial);
      setEscolhido(null);
      setSujo(false);
    }, 200);
  }

  function fechar() {
    // Conferência em andamento não some por um clique no fundo da gaveta.
    if (sujo) {
      setConfirmandoSaida(true);
      return;
    }
    limpar();
  }

  function irPara(destino: Etapa) {
    if (alvo) {
      setEtapa(destino);
      return;
    }
    destinoRef.current = destino;
    setEtapa("escolher-pedido");
  }

  async function enviarXml(arquivos: FileList | File[]) {
    const lista = Array.from(arquivos);
    if (lista.length === 0) return;

    setEnviando(true);
    try {
      const form = new FormData();
      for (const f of lista) form.append("arquivos", f);
      const resultados = await importarXmlRecebimentoAction(form);

      for (const r of resultados.filter((r) => r.status === "ERRO")) {
        toast.error(r.arquivo, r.motivo);
      }
      const duplicadas = resultados.filter((r) => r.status === "DUPLICADA");
      if (duplicadas.length > 0) {
        toast.info(
          duplicadas.length === 1 ? "Nota já importada" : `${duplicadas.length} notas já importadas`,
          "A chave de acesso já existe aqui — mercadoria não entra duas vezes.",
        );
      }

      const importada = resultados.find((r) => r.status === "IMPORTADA" && r.inboundId);
      if (!importada?.inboundId) return;

      // Já sabemos o pedido (veio de um card/drawer específico) — vincula
      // direto, sem depender da heurística de sugestão.
      if (alvo) {
        await vincularPedidoAction({ inboundId: importada.inboundId, purchaseOrderId: alvo.id });
      }

      limpar();
      router.push(`/pedidos/recebimento/${importada.inboundId}`);
    } catch (e) {
      toast.error("Não foi possível ler o arquivo", e instanceof Error ? e.message : "Tente de novo.");
    } finally {
      setEnviando(false);
    }
  }

  // A conferência precisa de espaço (lista, contador, detalhes por linha); a
  // escolha das portas, não. A largura acompanha o que está na tela.
  const largura: SheetWidth = etapa === "scan" || etapa === "manual" ? "2xl" : etapa === "escolher-pedido" ? "xl" : "lg";

  const descricao =
    etapa === "escolha"
      ? "Escolha como deseja iniciar o recebimento."
      : etapa === "escolher-pedido"
        ? "De qual pedido é esta mercadoria?"
        : alvo
          ? `${alvo.supplierNome} · ${alvo.numero}`
          : "Importe o XML para localizar ou criar o pedido.";

  return (
    <>
      <Sheet open={open} onClose={fechar} title="Receber mercadoria" description={descricao} width={largura}>
        {etapa === "escolha" && (
          <div className="flex flex-col gap-2.5">
            <OpcaoCard
              icon={FileCode}
              destaque
              titulo="Importar XML"
              descricao="Conciliar automaticamente a NF-e com o pedido."
              onClick={() => setEtapa("xml")}
            />
            <OpcaoCard
              icon={Barcode}
              titulo="Escanear produtos"
              descricao="Conferir os itens usando leitor ou câmera."
              nota={alvo ? undefined : "Você escolhe o pedido no próximo passo."}
              onClick={() => irPara("scan")}
            />
            <OpcaoCard
              icon={ClipboardList}
              titulo="Conferência manual"
              descricao="Receber a mercadoria mesmo sem XML."
              nota={alvo ? undefined : "Você escolhe o pedido no próximo passo."}
              onClick={() => irPara("manual")}
            />
          </div>
        )}

        {etapa === "xml" && (
          <XmlDropzone enviando={enviando} onArquivos={enviarXml} onVoltar={() => setEtapa("escolha")} />
        )}

        {etapa === "escolher-pedido" && (
          <EscolherPedido
            onVoltar={() => setEtapa("escolha")}
            onEscolher={(p) => {
              setEscolhido(p);
              setEtapa(destinoRef.current);
            }}
          />
        )}

        {etapa === "scan" && alvo && (
          <div className="flex flex-col gap-3">
            <Voltar onClick={() => setEtapa("escolha")} />
            <PedidoReceber key={alvo.id} pedido={alvo} onDone={limpar} onSujoChange={setSujo} cega={cega} modoScan />
          </div>
        )}

        {etapa === "manual" && alvo && (
          <div className="flex flex-col gap-3">
            <Voltar onClick={() => setEtapa("escolha")} />
            <PedidoReceber key={alvo.id} pedido={alvo} onDone={limpar} onSujoChange={setSujo} cega={cega} />
          </div>
        )}
      </Sheet>

      <Modal
        open={confirmandoSaida}
        onClose={() => setConfirmandoSaida(false)}
        title="Sair da conferência?"
        description="A contagem fica guardada neste aparelho e volta quando você abrir de novo."
        width="md"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setConfirmandoSaida(false)} className="flex-1">
              Continuar conferindo
            </Button>
            <Button
              onClick={() => {
                setConfirmandoSaida(false);
                limpar();
              }}
              className="flex-1"
            >
              Sair
            </Button>
          </div>
        }
      >
        <p className="text-[13px] text-ink-2">
          Nada entra no estoque até você gerar a entrada — sair agora não move saldo nenhum.
        </p>
      </Modal>
    </>
  );
}

// ── Escolha do pedido ─────────────────────────────────────────

function EscolherPedido({
  onVoltar,
  onEscolher,
}: {
  onVoltar: () => void;
  onEscolher: (p: PedidoView) => void;
}) {
  const [pedidos, setPedidos] = useState<PedidoView[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");

  useEffect(() => {
    listarPedidosAReceberAction()
      .then((lista) => setPedidos(lista as PedidoView[]))
      .catch((e: unknown) => setErro(e instanceof Error ? e.message : "Não foi possível listar os pedidos."));
  }, []);

  const termo = busca.trim().toLowerCase();
  const visiveis = (pedidos ?? []).filter(
    (p) => !termo || `${p.numero} ${p.supplierNome}`.toLowerCase().includes(termo),
  );

  return (
    <div className="flex flex-col gap-3">
      <Voltar onClick={onVoltar} />

      {pedidos === null && !erro && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
          <Loader2 size={16} className="animate-spin" aria-hidden /> Buscando pedidos abertos…
        </div>
      )}

      {erro && <p className="rounded-[var(--radius)] bg-danger-soft px-3.5 py-2.5 text-sm text-danger">{erro}</p>}

      {pedidos !== null && pedidos.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-[var(--radius-lg)] border border-line bg-surface px-6 py-12 text-center">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-surface-2 text-muted">
            <PackageSearch size={20} aria-hidden />
          </span>
          <p className="text-sm font-medium text-ink">Nenhum pedido aberto nesta loja</p>
          <p className="max-w-xs text-[13px] text-muted">
            Mercadoria sem pedido entra pelo XML — a nota localiza ou cria o pedido sozinha.
          </p>
        </div>
      )}

      {pedidos !== null && pedidos.length > 0 && (
        <>
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Filtrar por número ou fornecedor"
            aria-label="Filtrar pedidos"
            className="h-10 w-full rounded-full border border-line-button bg-surface px-4 text-sm text-ink placeholder:text-faint focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:outline-none"
          />
          <ul className="flex flex-col gap-1.5">
            {visiveis.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onEscolher(p)}
                  className="flex w-full items-center gap-3 rounded-[var(--radius-lg)] border border-line bg-surface px-3.5 py-3 text-left transition-colors hover:bg-surface-2"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-muted">
                    <Building2 size={16} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink">{p.supplierNome}</span>
                      <span className="shrink-0 font-mono text-[11px] text-faint">{p.numero}</span>
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 text-[12px] text-muted">
                      <span className="flex items-center gap-1">
                        <CalendarClock size={12} aria-hidden /> {previsaoLabel(p.previsaoEntrega)}
                      </span>
                      <span className="tabular-nums">
                        {p.totalItems} {p.totalItems === 1 ? "item" : "itens"}
                      </span>
                      <span className="tabular-nums">{fmtMoney(p.valorTotal)}</span>
                      {p.status === "RECEBIDO_PARCIAL" && (
                        <span className="rounded-full bg-brand-soft px-1.5 py-px text-[10px] font-semibold text-brand">
                          parcial
                        </span>
                      )}
                    </span>
                  </span>
                  <ChevronRight size={16} className="shrink-0 text-faint" aria-hidden />
                </button>
              </li>
            ))}
            {visiveis.length === 0 && (
              <li className="rounded-[var(--radius)] border border-line bg-surface px-4 py-6 text-center text-[13px] text-muted">
                Nenhum pedido com “{busca.trim()}”.
              </li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}

function Voltar({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 self-start text-xs font-medium text-muted hover:text-ink"
    >
      <ChevronLeft size={14} /> Voltar às opções
    </button>
  );
}

function OpcaoCard({
  icon: Icon,
  titulo,
  descricao,
  nota,
  onClick,
  destaque = false,
}: {
  icon: React.ElementType;
  titulo: string;
  descricao: string;
  /** Aviso de contexto — visível sempre, não escondido num tooltip. */
  nota?: string;
  onClick: () => void;
  destaque?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-start gap-3.5 rounded-xl border px-4 py-3.5 text-left transition-colors",
        destaque ? "border-brand/30 bg-brand-soft hover:bg-brand-soft/80" : "border-line bg-surface hover:bg-surface-2",
      )}
    >
      <span
        className={cn(
          "grid h-10 w-10 shrink-0 place-items-center rounded-lg",
          destaque ? "bg-brand text-on-brand" : "bg-surface-2 text-muted",
        )}
      >
        <Icon size={18} aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block font-display text-sm font-semibold text-ink">{titulo}</span>
        <span className="block text-[13px] text-muted">{descricao}</span>
        {nota && <span className="mt-0.5 block text-[12px] text-faint">{nota}</span>}
      </span>
    </button>
  );
}

function XmlDropzone({
  enviando,
  onArquivos,
  onVoltar,
}: {
  enviando: boolean;
  onArquivos: (arquivos: FileList | File[]) => void;
  onVoltar: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [sobre, setSobre] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <Voltar onClick={onVoltar} />
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setSobre(true);
        }}
        onDragLeave={() => setSobre(false)}
        onDrop={(e) => {
          e.preventDefault();
          setSobre(false);
          onArquivos(e.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center gap-3 rounded-[var(--radius-lg)] border border-dashed px-6 py-10 text-center transition-colors",
          sobre ? "border-brand bg-brand-soft" : "border-line bg-surface",
        )}
      >
        <div className="flex h-11 w-11 items-center justify-center rounded-[var(--radius)] bg-brand-soft text-brand">
          {enviando ? (
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          ) : (
            <FileUp className="h-5 w-5" aria-hidden />
          )}
        </div>
        <div>
          <p className="font-display text-[15px] font-semibold text-ink">Arraste o XML da nota aqui</p>
          <p className="mx-auto mt-1 max-w-md text-[13px] text-muted">
            O NoHub lê a nota e concilia com o pedido automaticamente. Aceita .xml e .zip.
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".xml,.zip,text/xml,application/xml,application/zip"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && onArquivos(e.target.files)}
        />
        <Button type="button" onClick={() => inputRef.current?.click()} disabled={enviando} variant="secondary">
          {enviando ? "Lendo a nota…" : "Escolher arquivo"}
        </Button>
      </div>
    </div>
  );
}
