"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Barcode, ChevronLeft, ClipboardList, FileCode, FileUp, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { importarXmlRecebimentoAction, vincularPedidoAction } from "../recebimento/actions";
import { PedidoReceber } from "./_recebimentos";
import type { PedidoView } from "./_pedidos";

// ── Painel "Receber mercadoria" ─────────────────────────────────
// Ponto de entrada único do recebimento, aberto a partir de um pedido (card,
// drawer, kanban) ou sem pedido nenhum ("Receber sem pedido"). XML deixa de
// ser tela própria: é só uma das 3 portas — as outras duas reaproveitam
// `PedidoReceber`, que já existe e já grava a entrada.

type Etapa = "escolha" | "xml" | "scan" | "manual";

export function ReceberMercadoriaPanel({
  pedido,
  open,
  onClose,
  etapaInicial = "escolha",
}: {
  /** `null` = "Receber sem pedido": só XML fica disponível (acha ou cria o pedido). */
  pedido: PedidoView | null;
  open: boolean;
  onClose: () => void;
  /** "xml" pula a escolha e já abre o upload — usado pelo botão "Receber pedido". */
  etapaInicial?: Etapa;
}) {
  const router = useRouter();
  const [etapa, setEtapa] = useState<Etapa>(etapaInicial);
  const [enviando, setEnviando] = useState(false);

  function fechar() {
    onClose();
    // Reset depois da animação de saída do Sheet, não no meio dela.
    setTimeout(() => setEtapa(etapaInicial), 200);
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
      if (pedido) {
        await vincularPedidoAction({ inboundId: importada.inboundId, purchaseOrderId: pedido.id });
      }

      fechar();
      router.push(`/recebimento/${importada.inboundId}`);
    } catch (e) {
      toast.error("Não foi possível ler o arquivo", e instanceof Error ? e.message : "Tente de novo.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={fechar}
      title="Receber mercadoria"
      description={
        etapa === "escolha"
          ? "Escolha como deseja iniciar o recebimento."
          : pedido
            ? `${pedido.supplierNome} · ${pedido.numero}`
            : "Importe o XML para localizar ou criar o pedido."
      }
      width="lg"
    >
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
            disabled={!pedido}
            disabledHint="Escolha o recebimento a partir de um pedido para escanear os itens dele."
            onClick={() => setEtapa("scan")}
          />
          <OpcaoCard
            icon={ClipboardList}
            titulo="Conferência manual"
            descricao="Receber a mercadoria mesmo sem XML."
            disabled={!pedido}
            disabledHint="Escolha o recebimento a partir de um pedido para conferir manualmente."
            onClick={() => setEtapa("manual")}
          />
        </div>
      )}

      {etapa === "xml" && (
        <XmlDropzone enviando={enviando} onArquivos={enviarXml} onVoltar={() => setEtapa("escolha")} />
      )}

      {etapa === "scan" && pedido && (
        <div className="flex flex-col gap-3">
          <Voltar onClick={() => setEtapa("escolha")} />
          <PedidoReceber pedido={pedido} onDone={fechar} modoScan />
        </div>
      )}

      {etapa === "manual" && pedido && (
        <div className="flex flex-col gap-3">
          <Voltar onClick={() => setEtapa("escolha")} />
          <PedidoReceber pedido={pedido} onDone={fechar} />
        </div>
      )}
    </Sheet>
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
  onClick,
  destaque = false,
  disabled = false,
  disabledHint,
}: {
  icon: React.ElementType;
  titulo: string;
  descricao: string;
  onClick: () => void;
  destaque?: boolean;
  disabled?: boolean;
  disabledHint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? disabledHint : undefined}
      className={cn(
        "flex items-start gap-3.5 rounded-xl border px-4 py-3.5 text-left transition-colors",
        disabled
          ? "cursor-not-allowed border-line bg-surface-2/40 opacity-60"
          : destaque
            ? "border-brand/30 bg-brand-soft hover:bg-brand-soft/80"
            : "border-line bg-surface hover:bg-surface-2",
      )}
    >
      <span
        className={cn(
          "grid h-10 w-10 shrink-0 place-items-center rounded-lg",
          destaque && !disabled ? "bg-brand text-on-brand" : "bg-surface-2 text-muted",
        )}
      >
        <Icon size={18} aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block font-display text-sm font-semibold text-ink">{titulo}</span>
        <span className="block text-[13px] text-muted">{descricao}</span>
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
