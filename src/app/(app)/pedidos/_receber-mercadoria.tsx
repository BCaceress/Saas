"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, FileCode, FileUp, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  abrirRecebimentoAvulsoAction,
  importarXmlRecebimentoAction,
  recebimentoDaChaveAction,
  vincularPedidoAction,
} from "../recebimento/conferencia-actions";
import type { PedidoView } from "./_pedidos";

// ── Painel "Receber mercadoria" ─────────────────────────────────
// Duas perguntas, e só: tenho a nota fiscal ou não tenho?
//
//   1. Tenho a nota — arrastar ou escolher o XML. A importação já abre o
//      recebimento (vale para todo canal), e o painel leva até ele.
//   2. Chegou sem nota — lançar os produtos à mão.
//
// Notas que entram por outros caminhos (tela fiscal, e-mail, SEFAZ) não moram
// aqui: já nascem com recebimento e aparecem direto na lista. Pedido que
// espera mercadoria também tem lugar próprio — o status "Aguardando".
//
// As duas portas terminam num recebimento aberto em /recebimento/[id], onde a
// conferência acontece. Contar caixa é trabalho de tela cheia.

type Etapa = "escolha" | "xml";

export function ReceberMercadoriaPanel({
  pedido,
  open,
  onClose,
  etapaInicial = "escolha",
  /** Libera "Chegou sem nota" — exige `estoque.ajustar`, permissão diferente
   *  de `compras.receber` (quem confere na porta nem sempre pode lançar
   *  estoque direto, sem pedido nenhum por trás). */
  podeAvulso = false,
}: {
  /** O pedido dono desta NF-e, quando o painel foi aberto de dentro dele.
   *  `null` = a nota ainda não sabe a que pedido pertence (ou não pertence a
   *  nenhum) — quem decide isso é a tela do recebimento. */
  pedido: PedidoView | null;
  open: boolean;
  onClose: () => void;
  /** "xml" pula a escolha e já abre o upload — usado de dentro de um pedido. */
  etapaInicial?: Etapa;
  podeAvulso?: boolean;
}) {
  const router = useRouter();
  const [etapa, setEtapa] = useState<Etapa>(etapaInicial);
  const [enviando, setEnviando] = useState(false);
  const [abrindoAvulso, setAbrindoAvulso] = useState(false);

  const alvo = pedido;

  function fechar() {
    onClose();
    // Reset depois da animação de saída do Sheet, não no meio dela.
    setTimeout(() => {
      setEtapa(etapaInicial);
      setAbrindoAvulso(false);
    }, 200);
  }

  function irPara(receiptId: string) {
    fechar();
    router.push(`/recebimento/${receiptId}`);
  }

  async function abrirAvulso() {
    setAbrindoAvulso(true);
    try {
      irPara(await abrirRecebimentoAvulsoAction());
    } catch (e) {
      toast.error("Não deu para abrir o recebimento", e instanceof Error ? e.message : "Tente de novo.");
      setAbrindoAvulso(false);
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

      const importada = resultados.find((r) => r.status === "IMPORTADA" && r.inboundId);
      if (importada?.inboundId) {
        // Já sabemos o pedido (veio de dentro dele) — vincula direto, sem
        // depender da heurística de sugestão.
        let receiptId = importada.receiptId ?? null;
        if (alvo) {
          receiptId = await vincularPedidoAction({
            inboundId: importada.inboundId,
            purchaseOrderId: alvo.id,
          });
        }
        irPara(receiptId ?? importada.inboundId);
        return;
      }

      // Nota que já estava aqui: em vez de só avisar, leva ao recebimento dela
      // — é o que o operador queria ao arrastar o arquivo.
      const duplicada = resultados.find((r) => r.status === "DUPLICADA" && r.chave);
      if (duplicada?.chave) {
        const receiptId = await recebimentoDaChaveAction(duplicada.chave);
        if (receiptId) {
          toast.info("Esta nota já estava no NoHub", "Abrindo o recebimento dela.");
          irPara(receiptId);
        }
      }
    } catch (e) {
      toast.error("Não foi possível ler o arquivo", e instanceof Error ? e.message : "Tente de novo.");
    } finally {
      setEnviando(false);
    }
  }

  const descricao =
    etapa === "escolha"
      ? "Você tem a nota fiscal desta mercadoria? A conferência abre em seguida."
      : alvo
        ? `Importe o XML da nota deste pedido — a conferência de ${alvo.numero} abre em seguida.`
        : "Importe o XML da nota — a conferência abre em seguida.";

  return (
    <Sheet open={open} onClose={fechar} title="Receber mercadoria" description={descricao} width="lg">
      {etapa === "xml" ? (
        <XmlDropzone
          enviando={enviando}
          onArquivos={enviarXml}
          dica={
            alvo
              ? `A nota entra já vinculada a ${alvo.numero}. Aceita .xml e .zip.`
              : "Aceita .xml e .zip."
          }
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          <CartaoXml enviando={enviando} onArquivos={enviarXml} />

          {podeAvulso && (
            <button
              type="button"
              disabled={abrindoAvulso || enviando}
              onClick={() => void abrirAvulso()}
              className="flex cursor-pointer items-center gap-3.5 rounded-xl border border-line bg-surface px-4 py-3.5 text-left transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:outline-none disabled:cursor-default disabled:opacity-60"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
                {abrindoAvulso ? (
                  <Loader2 size={18} className="animate-spin" aria-hidden />
                ) : (
                  <ClipboardList size={18} aria-hidden />
                )}
              </span>
              <span className="min-w-0">
                <span className="block font-display text-sm font-semibold text-ink">
                  Não tenho o XML
                </span>
                <span className="block text-[13px] text-muted">
                  Lance os produtos à mão.
                </span>
              </span>
            </button>
          )}
        </div>
      )}
    </Sheet>
  );
}

/**
 * "Tenho a nota fiscal": o cartão É a área de soltar o arquivo — clicar abre o
 * seletor, arrastar importa. Antes eram dois passos (cartão → tela de upload)
 * para a mesma coisa.
 */
function CartaoXml({
  enviando,
  onArquivos,
}: {
  enviando: boolean;
  onArquivos: (arquivos: FileList | File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [sobre, setSobre] = useState(false);

  return (
    <>
      <button
        type="button"
        disabled={enviando}
        onClick={() => inputRef.current?.click()}
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
          "flex cursor-pointer items-center gap-3.5 rounded-xl border px-4 py-3.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:outline-none disabled:cursor-default",
          sobre
            ? "border-brand bg-brand-soft"
            : "border-dashed border-brand/50 bg-surface hover:bg-brand-soft/40",
        )}
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand text-on-brand">
          {enviando ? (
            <Loader2 size={18} className="animate-spin" aria-hidden />
          ) : (
            <FileCode size={18} aria-hidden />
          )}
        </span>
        <span className="min-w-0">
          <span className="block font-display text-sm font-semibold text-ink">
            {enviando ? "Lendo a nota…" : "Tenho a nota fiscal"}
          </span>
          <span className="block text-[13px] text-muted">
            {sobre ? "Solte para importar." : "Arraste o XML aqui ou clique para escolher (.xml ou .zip)."}
          </span>
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        // Só extensões: com tipo MIME no `accept`, o Chrome no Windows resolve
        // cada um no registro antes de abrir o seletor — e trava a janela.
        accept=".xml,.zip"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) onArquivos(e.target.files);
          e.target.value = "";
        }}
      />
    </>
  );
}

function XmlDropzone({
  enviando,
  onArquivos,
  dica,
}: {
  enviando: boolean;
  onArquivos: (arquivos: FileList | File[]) => void;
  dica: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [sobre, setSobre] = useState(false);

  return (
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
        <p className="mx-auto mt-1 max-w-md text-[13px] text-muted">{dica}</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".xml,.zip"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) onArquivos(e.target.files);
          e.target.value = "";
        }}
      />
      <Button type="button" onClick={() => inputRef.current?.click()} disabled={enviando} variant="secondary">
        {enviando ? "Lendo a nota…" : "Escolher arquivo"}
      </Button>
    </div>
  );
}
