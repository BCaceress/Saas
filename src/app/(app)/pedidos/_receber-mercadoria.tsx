"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ClipboardList, FileCode, FileUp, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  importarXmlRecebimentoAction,
  vincularPedidoAction,
  abrirRecebimentoAvulsoAction,
} from "../recebimento/conferencia-actions";
import type { PedidoView } from "./_pedidos";

// ── Painel "Receber mercadoria" ─────────────────────────────────
// Ponto de entrada do recebimento a partir de FORA de um pedido: chegou uma
// nota, ou chegou mercadoria sem papel nenhum. Duas portas, e só.
//
// "A partir de um pedido" NÃO mora aqui de propósito. Pedido que espera
// mercadoria já tem lugar próprio — a aba "Aguardando recebimento", com o
// botão "Iniciar recebimento" na linha do pedido. Ter a mesma operação em duas
// portas é como o mesmo caminhão vira dois recebimentos.
//
// As duas portas terminam no MESMO lugar: um recebimento aberto em
// /recebimento/[id], onde a conferência acontece. O painel só descobre de onde
// a mercadoria veio; contar caixa é trabalho de tela cheia.

type Etapa = "escolha" | "xml";

export function ReceberMercadoriaPanel({
  pedido,
  open,
  onClose,
  etapaInicial = "escolha",
  /** Libera o cartão "Recebimento avulso" — exige `estoque.ajustar`, permissão
   *  diferente de `compras.receber` (quem confere na porta nem sempre pode
   *  lançar estoque direto, sem pedido nenhum por trás). */
  podeAvulso = false,
}: {
  /** O pedido dono desta NF-e, quando o painel foi aberto de dentro dele.
   *  `null` = a nota ainda não sabe a que pedido pertence (ou não pertence a
   *  nenhum) — quem decide isso é a tela do recebimento. */
  pedido: PedidoView | null;
  open: boolean;
  onClose: () => void;
  /** "xml" pula a escolha e já abre o upload — usado pelo "Importar NF-e" do pedido. */
  etapaInicial?: Etapa;
  podeAvulso?: boolean;
}) {
  const router = useRouter();
  const [etapa, setEtapa] = useState<Etapa>(etapaInicial);
  const [enviando, setEnviando] = useState(false);

  const alvo = pedido;

  function limpar() {
    onClose();
    // Reset depois da animação de saída do Sheet, não no meio dela.
    setTimeout(() => setEtapa(etapaInicial), 200);
  }

  const fechar = limpar;

  async function abrirAvulso() {
    setEnviando(true);
    try {
      const id = await abrirRecebimentoAvulsoAction();
      limpar();
      router.push(`/recebimento/${id}`);
    } catch (e) {
      toast.error(
        "Não deu para abrir o recebimento",
        e instanceof Error ? e.message : "Tente de novo.",
      );
      setEnviando(false);
    }
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
      let receiptId = importada.receiptId ?? null;
      if (alvo) {
        receiptId = await vincularPedidoAction({
          inboundId: importada.inboundId,
          purchaseOrderId: alvo.id,
        });
      }

      limpar();
      router.push(`/recebimento/${receiptId ?? importada.inboundId}`);
    } catch (e) {
      toast.error("Não foi possível ler o arquivo", e instanceof Error ? e.message : "Tente de novo.");
    } finally {
      setEnviando(false);
    }
  }

  const descricao =
    etapa === "escolha"
      ? "Escolha de onde vem esta mercadoria. A conferência abre em seguida."
      : alvo
        ? `Importe o XML da nota deste pedido — a conferência de ${alvo.numero} abre em seguida.`
        : "Importe o XML — depois você escolhe se ele vira pedido, entra num existente ou é só conferência.";

  return (
    <>
      <Sheet open={open} onClose={fechar} title="Receber mercadoria" description={descricao} width="lg">
        {etapa === "escolha" && (
          <div className="flex flex-col gap-2.5">
            <OpcaoCard
              icon={FileCode}
              destaque
              titulo="Importar NF-e"
              descricao="Receba uma mercadoria através do XML da NF-e."
              nota="O NoHub cria o recebimento com os produtos da nota. Havendo pedido relacionado, você o vincula durante o processo."
              onClick={() => setEtapa("xml")}
            />
            {podeAvulso && (
              <OpcaoCard
                icon={ClipboardList}
                titulo="Recebimento avulso"
                descricao="Registre uma entrada manual de produtos."
                nota="Sem pedido, sem cotação e sem NF-e."
                onClick={() => void abrirAvulso()}
              />
            )}
            {/* Pedido esperando mercadoria não entra por aqui: ele já tem a sua
                fila. Dizer onde fica evita a caçada — e evita a segunda porta. */}
            <p className="px-1 text-[12px] text-muted">
              Recebendo um pedido que já existe? Ele está na aba{" "}
              <strong className="font-semibold text-ink-2">Aguardando recebimento</strong>, com o
              botão “Iniciar recebimento” na própria linha.
            </p>
          </div>
        )}

        {etapa === "xml" && (
          <XmlDropzone
            enviando={enviando}
            onArquivos={enviarXml}
            onVoltar={etapa === etapaInicial ? undefined : () => setEtapa("escolha")}
          />
        )}
      </Sheet>
    </>
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
  /** Ausente quando o upload É a tela — abrir "voltar" para uma escolha que
   *  nunca apareceu só confundiria. */
  onVoltar?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [sobre, setSobre] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      {onVoltar && <Voltar onClick={onVoltar} />}
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
            O NoHub lê a nota e, quando reconhece o pedido, concilia sozinho. Sem pedido, você
            escolhe: gerar um pela nota ou só conferir a mercadoria. Aceita .xml e .zip.
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
