"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Copy, PackageCheck, Receipt, Trash2, Undo2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/sheet";
import { Field } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { maskCnpj } from "@/lib/masks";
import {
  candidatasEntradaManualAction,
  descartarNotaAction,
  receberNotaAction,
  vincularEntradaManualAction,
} from "@/app/(app)/fiscal/notas-recebidas/actions";
import {
  desvincularNotaAction,
  entradaDaNotaAction,
  estornarEntradaAction,
} from "@/app/(app)/estoque/estorno-actions";
import { fmtMoney } from "../../cotacoes/_ui";
import type { NotaRecebimento } from "../_data";

// ============================================================
// O documento, ao lado do trabalho.
//
// Antes isto era uma tela inteira em /fiscal/notas-recebidas, aberta por cima
// da mesma nota que o recebimento estava conferindo — duas telas discutindo o
// mesmo registro. Aqui é um painel: quem trata a nota (contador, `fiscal.importar`)
// vê os dados do documento e as decisões que são DELE — descartar, documentar
// uma entrada já lançada à mão, estornar, receber sem conferir.
//
// O que NÃO está aqui é de propósito: escolher pedido e conferir mercadoria
// são as etapas 2 e 3 do trilho, e repetir a decisão em dois lugares é como se
// criava divergência.
// ============================================================

type Candidata = Awaited<ReturnType<typeof candidatasEntradaManualAction>>[number];

export function PainelNota({
  nota,
  faltamRelacionar,
  emConferencia,
}: {
  nota: NotaRecebimento;
  /** Itens sem produto no catálogo — trava a entrada direta. */
  faltamRelacionar: number;
  /** Já há linhas de conferência: receber sem conferir deixa de fazer sentido. */
  emConferencia: boolean;
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [descartando, setDescartando] = React.useState(false);
  const [motivoDescarte, setMotivoDescarte] = React.useState("");
  // Entradas lançadas à mão que esta nota pode estar documentando. Sem esta
  // pergunta, receber a nota somaria a mesma mercadoria pela segunda vez.
  const [candidatas, setCandidatas] = React.useState<Candidata[] | null>(null);

  const editavel = nota.status === "PENDENTE" || nota.status === "CONCILIADO";

  React.useEffect(() => {
    if (!editavel || !nota.supplierId) return;
    let vivo = true;
    candidatasEntradaManualAction(nota.id)
      .then((r) => vivo && setCandidatas(r))
      .catch(() => vivo && setCandidatas([]));
    return () => {
      vivo = false;
    };
  }, [nota.id, nota.supplierId, editavel]);

  function receberSemConferir() {
    start(async () => {
      try {
        // O operador viu a lista de candidatas nesta tela; se mandou receber
        // mesmo assim, a decisão é dele e o servidor não barra de novo.
        await receberNotaAction(nota.id, (candidatas?.length ?? 0) > 0);
        toast.success("Entrada gerada.", "Estoque e custo médio atualizados.");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao gerar a entrada.");
      }
    });
  }

  function estornar() {
    const motivo = window.prompt(
      "Por que esta entrada está sendo estornada? O saldo volta e os títulos em aberto são cancelados.",
    );
    if (!motivo?.trim()) return;
    start(async () => {
      try {
        const entrada = await entradaDaNotaAction(nota.id);
        if (!entrada) {
          toast.error("Não foi possível localizar a entrada desta nota.");
          return;
        }
        const r = await estornarEntradaAction({ purchaseId: entrada.id, motivo });
        toast.success(
          "Entrada estornada.",
          r.titulosCancelados > 0
            ? `${r.itens} item(ns) saíram do estoque e ${r.titulosCancelados} título(s) foram cancelados.`
            : `${r.itens} item(ns) saíram do estoque.`,
        );
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao estornar.");
      }
    });
  }

  function desvincular() {
    const motivo = window.prompt("Por que este vínculo está errado?");
    if (!motivo?.trim()) return;
    start(async () => {
      try {
        await desvincularNotaAction({ inboundId: nota.id, motivo });
        toast.success("Vínculo desfeito.", "A entrada voltou a aguardar documento.");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao desfazer o vínculo.");
      }
    });
  }

  function descartar() {
    start(async () => {
      try {
        await descartarNotaAction({ inboundId: nota.id, motivo: motivoDescarte });
        toast.success("Nota descartada.");
        setDescartando(false);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao descartar.");
      }
    });
  }

  return (
    <>
      <section className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-line bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 font-display text-[14px] font-semibold text-ink">
              <Receipt size={15} className="shrink-0 text-faint" aria-hidden />
              Nota fiscal {nota.numero}/{nota.serie}
            </h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px] text-faint">
              <span>{maskCnpj(nota.cnpj)}</span>
              {nota.uf && <span>· {nota.uf}</span>}
              <span className="break-all">· {nota.chave}</span>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(nota.chave);
                  toast.success("Chave copiada.");
                }}
                className="cursor-pointer text-muted transition-colors hover:text-brand"
                aria-label="Copiar chave de acesso"
                title="Copiar chave de acesso"
              >
                <Copy size={12} />
              </button>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {editavel && (
              <Button variant="ghost" size="sm" onClick={() => setDescartando(true)} disabled={pending}>
                <Trash2 size={15} /> Descartar
              </Button>
            )}
            {/* Atalho, não caminho: nota de serviço, frete ou compra que o
                operador já conferiu no papel não precisa de contagem. Some
                assim que há conferência aberta — aí o botão da etapa 3 manda. */}
            {editavel && !emConferencia && (
              <Button
                variant="secondary"
                size="sm"
                onClick={receberSemConferir}
                disabled={pending || faltamRelacionar > 0}
                title={
                  faltamRelacionar > 0
                    ? "Termine a etapa 1: há item sem produto no catálogo."
                    : undefined
                }
              >
                <PackageCheck size={15} />
                {pending ? "Gerando…" : "Dar entrada sem conferir"}
              </Button>
            )}
            {/* Desfazer é operação de verdade, não “registre um ajuste”:
                volta o saldo, cancela os títulos e libera a nota. */}
            {nota.status === "RECEBIDO" && (
              <Button variant="ghost" size="sm" onClick={estornar} disabled={pending}>
                <Undo2 size={15} /> Estornar entrada
              </Button>
            )}
            {nota.status === "VINCULADO" && (
              <Button variant="ghost" size="sm" onClick={desvincular} disabled={pending}>
                <Unlink size={15} /> Desfazer vínculo
              </Button>
            )}
          </div>
        </div>

        {nota.status === "DESCARTADO" && nota.observacao && (
          <p className="text-[13px] text-muted">Motivo do descarte: {nota.observacao}</p>
        )}

        {nota.semEstoqueMotivo && (
          <p className="flex items-start gap-2 rounded-[var(--radius-md)] border border-line bg-surface-2 px-3.5 py-3 text-[13px] text-muted">
            <Receipt size={15} className="mt-0.5 shrink-0 text-faint" />
            <span>
              {nota.semEstoqueMotivo}
              {nota.status === "SEM_ESTOQUE" &&
                " O valor entrou em Contas a pagar — nada foi somado ao saldo."}
            </span>
          </p>
        )}

        {editavel && candidatas && candidatas.length > 0 && (
          <div className="flex flex-col gap-2.5 rounded-[var(--radius-md)] border border-accent/40 bg-accent-soft p-3.5">
            <p className="flex items-start gap-2 text-sm font-medium text-accent">
              <Copy size={15} className="mt-0.5 shrink-0" />
              Esta mercadoria já pode ter entrado à mão
            </p>
            <p className="text-xs text-accent/90">
              Se uma destas entradas é esta mesma nota, vincule as duas: o documento fica
              registrado e o estoque não sobe de novo. Se são compras diferentes, é só receber
              normalmente.
            </p>
            <ul className="flex flex-col gap-1.5">
              {candidatas.map((c) => (
                <li
                  key={c.purchaseId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] border border-line bg-surface px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-ink">
                      Entrada de {new Date(c.data).toLocaleDateString("pt-BR")} ·{" "}
                      <span className="font-mono">{fmtMoney(c.valorTotal)}</span>
                      <span className="ml-2 text-[11px] text-muted">
                        {c.itens} {c.itens === 1 ? "item" : "itens"}
                      </span>
                    </p>
                    <p className="text-[11px] text-muted">{c.motivos.join(" · ")}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        try {
                          await vincularEntradaManualAction({
                            inboundId: nota.id,
                            purchaseId: c.purchaseId,
                          });
                          toast.success(
                            "Nota vinculada à entrada.",
                            "O estoque não foi movimentado de novo.",
                          );
                          router.refresh();
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Falha ao vincular.");
                        }
                      })
                    }
                  >
                    É esta entrada
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <Modal
        open={descartando}
        onClose={() => setDescartando(false)}
        title="Descartar nota"
        description="A nota some da fila de entrada e não movimenta estoque."
        width="md"
      >
        <Field label="Motivo" htmlFor="motivo" hint="Fica registrado na nota.">
          <Input
            id="motivo"
            value={motivoDescarte}
            onChange={(e) => setMotivoDescarte(e.target.value)}
            placeholder="Ex.: já lancei essa nota à mão"
          />
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDescartando(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={descartar} disabled={pending}>
            {pending ? "Descartando…" : "Descartar"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
