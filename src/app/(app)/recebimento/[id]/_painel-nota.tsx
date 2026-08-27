"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Copy, MoreVertical, PackageCheck, Receipt, Trash2, Undo2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Menu, MenuItem } from "@/components/ui/menu";
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

/**
 * As decisões do documento que exigem motivo.
 *
 * Todas as três mexem em coisa feita — a nota some da fila, o saldo volta, o
 * vínculo se desfaz — e todas gravam o porquê no histórico. O texto de cada
 * uma diz a CONSEQUÊNCIA, não o mecanismo: quem clica em "Estornar" precisa
 * saber que os títulos em aberto são cancelados junto, antes de confirmar.
 */
type Confirmacao = "DESCARTAR" | "ESTORNAR" | "DESVINCULAR";

const CONFIRMACOES: Record<
  Confirmacao,
  { titulo: string; descricao: string; hint: string; placeholder: string; cta: string; fazendo: string }
> = {
  DESCARTAR: {
    titulo: "Descartar nota",
    descricao: "A nota some da fila de entrada e não movimenta estoque.",
    hint: "Fica registrado na nota.",
    placeholder: "Ex.: já lancei essa nota à mão",
    cta: "Descartar",
    fazendo: "Descartando…",
  },
  ESTORNAR: {
    titulo: "Estornar entrada",
    descricao:
      "A mercadoria sai do estoque, o custo médio volta ao que era e os títulos em aberto desta nota são cancelados.",
    hint: "Fica no histórico da entrada, com seu nome e a hora.",
    placeholder: "Ex.: nota lançada em duplicidade",
    cta: "Estornar entrada",
    fazendo: "Estornando…",
  },
  DESVINCULAR: {
    titulo: "Desfazer vínculo",
    descricao:
      "A nota deixa de documentar aquela entrada e volta para a fila. O estoque não se mexe.",
    hint: "Fica no histórico das duas pontas.",
    placeholder: "Ex.: é a nota de outra entrega",
    cta: "Desfazer vínculo",
    fazendo: "Desfazendo…",
  },
};

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
  // As três decisões do documento pedem a mesma coisa — um motivo que fica no
  // histórico — e por isso passam pelo mesmo diálogo. Antes duas delas usavam
  // `window.prompt`: caixinha do browser, sem estilo, sem dizer a consequência
  // e sem validar as três letras que o servidor exige.
  const [confirmando, setConfirmando] = React.useState<Confirmacao | null>(null);
  const [motivo, setMotivo] = React.useState("");
  /**
   * Dar entrada sem conferir não pede motivo — pede que a pessoa saiba o que
   * está pulando. A mercadoria vira saldo pela quantidade da nota, sem
   * ninguém abrir uma caixa, e isso não se descobre depois do clique.
   */
  const [confirmandoEntrada, setConfirmandoEntrada] = React.useState(false);
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
        setConfirmandoEntrada(false);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao gerar a entrada.");
      }
    });
  }

  function pedirMotivo(tipo: Confirmacao) {
    setMotivo("");
    setConfirmando(tipo);
  }

  function estornar(motivo: string) {
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
        setConfirmando(null);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao estornar.");
      }
    });
  }

  function desvincular(motivo: string) {
    start(async () => {
      try {
        await desvincularNotaAction({ inboundId: nota.id, motivo });
        toast.success("Vínculo desfeito.", "A entrada voltou a aguardar documento.");
        setConfirmando(null);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao desfazer o vínculo.");
      }
    });
  }

  function descartar(motivo: string) {
    start(async () => {
      try {
        await descartarNotaAction({ inboundId: nota.id, motivo });
        toast.success("Nota descartada.");
        setConfirmando(null);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao descartar.");
      }
    });
  }

  function confirmar() {
    const texto = motivo.trim();
    if (texto.length < 3 || !confirmando) return;
    if (confirmando === "DESCARTAR") descartar(texto);
    else if (confirmando === "ESTORNAR") estornar(texto);
    else desvincular(texto);
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
              <Button
                variant="ghost"
                size="sm"
                onClick={() => pedirMotivo("DESCARTAR")}
                disabled={pending}
              >
                <Trash2 size={15} /> Descartar
              </Button>
            )}
            {/* O resto das decisões do documento entra no menu. "Dar entrada
                sem conferir" em botão no topo da tela era um atalho com peso
                de caminho principal: pulava a conferência inteira com um
                clique, ao lado do que o operador clica o tempo todo. */}
            <Menu
              trigger={
                <button
                  type="button"
                  disabled={pending}
                  className="grid h-8 w-8 place-items-center rounded-full border border-line-button text-ink-2 transition-colors hover:bg-surface-2 disabled:opacity-50"
                  aria-label="Mais opções do documento"
                >
                  <MoreVertical size={15} aria-hidden />
                </button>
              }
            >
              {/* Atalho, não caminho: nota de serviço, frete ou compra que o
                  operador já conferiu no papel não precisa de contagem. Some
                  assim que há conferência aberta — aí o botão da etapa 3 manda. */}
              {editavel && !emConferencia && (
                <MenuItem
                  icon={<PackageCheck size={15} />}
                  disabled={pending || faltamRelacionar > 0}
                  onClick={() => setConfirmandoEntrada(true)}
                >
                  Dar entrada sem conferir
                </MenuItem>
              )}
              {/* Desfazer é operação de verdade, não “registre um ajuste”:
                  volta o saldo, cancela os títulos e libera a nota. */}
              {nota.status === "RECEBIDO" && (
                <MenuItem
                  icon={<Undo2 size={15} />}
                  disabled={pending}
                  onClick={() => pedirMotivo("ESTORNAR")}
                >
                  Estornar entrada
                </MenuItem>
              )}
              {nota.status === "VINCULADO" && (
                <MenuItem
                  icon={<Unlink size={15} />}
                  disabled={pending}
                  onClick={() => pedirMotivo("DESVINCULAR")}
                >
                  Desfazer vínculo
                </MenuItem>
              )}
              {editavel && emConferencia && nota.status !== "RECEBIDO" && (
                <MenuItem disabled>Conferência aberta — dê entrada pela etapa 3</MenuItem>
              )}
            </Menu>
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

      {confirmandoEntrada && (
        <Modal
          open
          onClose={() => setConfirmandoEntrada(false)}
          title="Dar entrada sem conferir"
          description="A mercadoria será lançada no estoque pela quantidade que a nota informa, sem a conferência física."
          width="md"
        >
          <div className="space-y-3 text-[13px] text-ink-2">
            <p>
              Ninguém vai abrir caixa: o saldo sobe exatamente como a NF-e diz, e o custo médio
              é recalculado com o custo dela. Falta, sobra ou avaria só aparecem no próximo
              inventário.
            </p>
            <p className="rounded-[var(--radius)] bg-surface-2 px-3 py-2 text-muted">
              Use quando não há mercadoria para contar (serviço, frete) ou quando a conferência
              já foi feita no papel.
            </p>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setConfirmandoEntrada(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button onClick={receberSemConferir} disabled={pending}>
              {pending ? "Gerando…" : "Receber no estoque"}
            </Button>
          </div>
        </Modal>
      )}

      {confirmando && (
        <Modal
          open
          onClose={() => setConfirmando(null)}
          title={CONFIRMACOES[confirmando].titulo}
          description={CONFIRMACOES[confirmando].descricao}
          width="md"
        >
          <Field
            label="Motivo"
            htmlFor="motivo"
            hint={CONFIRMACOES[confirmando].hint}
          >
            <Input
              id="motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder={CONFIRMACOES[confirmando].placeholder}
              autoFocus
              // Enter fecha o assunto: são três palavras num campo só, e
              // obrigar a mirar o botão é pedágio em cima de quem já digitou.
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirmar();
                }
              }}
            />
          </Field>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmando(null)} disabled={pending}>
              Cancelar
            </Button>
            {/* O servidor exige três letras. Barrar aqui evita o vaivém de
                clicar, tomar erro de validação e voltar ao mesmo campo. */}
            <Button onClick={confirmar} disabled={pending || motivo.trim().length < 3}>
              {pending ? CONFIRMACOES[confirmando].fazendo : CONFIRMACOES[confirmando].cta}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
