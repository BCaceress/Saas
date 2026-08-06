"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import {
  TecladoNumerico,
  VisorQuantidade,
  paraNumero,
} from "@/components/mobile/teclado-numerico";
import {
  registrarAjusteAction,
  registrarPerdaAction,
  registrarTransferenciaAction,
} from "@/app/(app)/estoque/actions";
import type { SaldoRow } from "@/app/(app)/estoque/_data";

export type Acao = "ajuste" | "perda" | "transferencia";

type Site = { id: string; nome: string };

/**
 * Ações rápidas de estoque no celular.
 *
 * Nenhuma regra nova: cada uma chama a MESMA server action do desktop, que já
 * confere permissão por loja (`txp`/`txpDepois`), bloqueia escrita com
 * assinatura suspensa e aplica o FEFO em `lib/estoque.ts`. O que muda aqui é
 * só a forma de digitar: teclado grande, motivo por chip, um campo por vez.
 */

const CONFIG: Record<
  Acao,
  { titulo: string; descricao: string; verbo: string; motivos: string[]; assinado: boolean }
> = {
  ajuste: {
    titulo: "Ajustar saldo",
    descricao: "Corrige a diferença entre o sistema e a prateleira.",
    verbo: "Ajustar",
    // Ajuste soma ou subtrai — o sinal é escolhido na tela.
    motivos: ["Contagem divergente", "Erro de lançamento", "Sobra encontrada", "Uso interno"],
    assinado: true,
  },
  perda: {
    titulo: "Registrar perda",
    descricao: "Sai do estoque e entra no relatório de perdas.",
    verbo: "Registrar",
    motivos: ["Quebra", "Vencimento", "Avaria", "Furto", "Deterioração"],
    assinado: false,
  },
  transferencia: {
    titulo: "Transferir",
    descricao: "Move unidades desta loja para outra.",
    verbo: "Transferir",
    motivos: [],
    assinado: false,
  },
};

export function AcaoEstoqueSheet({
  row,
  acao,
  sites,
  siteAtivo,
  onFechar,
  onConcluir,
}: {
  row: SaldoRow;
  acao: Acao;
  sites: Site[];
  siteAtivo: string | null;
  onFechar: () => void;
  onConcluir: (mensagem: string) => void;
}) {
  const cfg = CONFIG[acao];

  const [quantidade, setQuantidade] = React.useState("");
  const [sinal, setSinal] = React.useState<1 | -1>(1);
  const [motivo, setMotivo] = React.useState<string>("");
  const [observacao, setObservacao] = React.useState("");
  const [destino, setDestino] = React.useState<string>("");
  const [salvando, setSalvando] = React.useState(false);

  const qtd = paraNumero(quantidade);
  const origem = siteAtivo ?? sites[0]?.id ?? "";
  const outrasLojas = sites.filter((s) => s.id !== origem);

  // As actions exigem motivo com 3+ caracteres. O chip preenche; o campo livre
  // complementa. Sem chip escolhido, o texto sozinho vale.
  const texto = [motivo, observacao.trim()].filter(Boolean).join(" — ");

  const podeSalvar =
    qtd > 0 &&
    !salvando &&
    (acao === "transferencia" ? Boolean(destino) : texto.trim().length >= 3);

  async function salvar() {
    if (!podeSalvar) return;
    setSalvando(true);
    try {
      if (acao === "ajuste") {
        await registrarAjusteAction({
          siteId: origem,
          productId: row.productId,
          deltaFechado: qtd * sinal,
          observacao: texto,
        });
        onConcluir(`Saldo ajustado em ${sinal > 0 ? "+" : "−"}${qtd}.`);
      } else if (acao === "perda") {
        await registrarPerdaAction({
          siteId: origem,
          productId: row.productId,
          deltaFechado: qtd,
          observacao: texto,
        });
        onConcluir(`Perda de ${qtd} registrada.`);
      } else {
        await registrarTransferenciaAction({
          origemSiteId: origem,
          destinoSiteId: destino,
          items: [{ productId: row.productId, quantidade: qtd }],
          observacao: observacao.trim() || null,
        });
        const nome = sites.find((s) => s.id === destino)?.nome ?? "outra loja";
        onConcluir(`${qtd} enviadas para ${nome}.`);
      }
    } catch (e) {
      toast.error(
        "Não foi possível concluir",
        e instanceof Error ? e.message : "Tente de novo em instantes.",
      );
    } finally {
      setSalvando(false);
    }
  }

  return (
    <BottomSheet
      open
      onClose={onFechar}
      titulo={cfg.titulo}
      descricao={
        <span className="line-clamp-1">
          {row.nome} · <span className="font-mono text-xs">{row.sku}</span>
        </span>
      }
      rodape={
        <Button onClick={salvar} disabled={!podeSalvar} className="w-full" size="lg">
          {salvando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {cfg.verbo}
        </Button>
      }
    >
      <div className="space-y-3 pb-2">
        {cfg.assinado && (
          <div className="grid grid-cols-2 gap-2">
            <BotaoSinal ativo={sinal === 1} onClick={() => setSinal(1)} tom="ok">
              Entrou
            </BotaoSinal>
            <BotaoSinal ativo={sinal === -1} onClick={() => setSinal(-1)} tom="danger">
              Saiu
            </BotaoSinal>
          </div>
        )}

        <VisorQuantidade
          valor={quantidade}
          unidade={row.unidadeBase.toLowerCase()}
          atual={row.estoqueFechado}
        />

        <TecladoNumerico valor={quantidade} onChange={setQuantidade} decimais={3} />

        {acao === "transferencia" ? (
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink">Para qual loja?</p>
            {outrasLojas.length === 0 ? (
              <p className="text-[13px] text-muted">
                Só existe uma loja ativa — não há para onde transferir.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {outrasLojas.map((s) => (
                  <Chip key={s.id} ativo={destino === s.id} onClick={() => setDestino(s.id)}>
                    {s.nome}
                  </Chip>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink">Motivo</p>
            <div className="flex flex-wrap gap-1.5">
              {cfg.motivos.map((m) => (
                <Chip key={m} ativo={motivo === m} onClick={() => setMotivo(motivo === m ? "" : m)}>
                  {m}
                </Chip>
              ))}
            </div>
          </div>
        )}

        <input
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          placeholder={acao === "transferencia" ? "Observação (opcional)" : "Detalhar (opcional)"}
          aria-label="Observação"
          className="min-h-11 w-full rounded-full border border-line-button bg-surface px-4 text-sm text-ink placeholder:text-faint focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        />
      </div>
    </BottomSheet>
  );
}

function BotaoSinal({
  ativo,
  onClick,
  tom,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  tom: "ok" | "danger";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        "min-h-11 cursor-pointer rounded-xl border text-sm font-medium transition-colors",
        ativo
          ? tom === "ok"
            ? "border-transparent bg-ok-soft text-ok"
            : "border-transparent bg-danger-soft text-danger"
          : "border-line-button bg-surface text-ink-2",
      )}
    >
      {children}
    </button>
  );
}

function Chip({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        "min-h-9 cursor-pointer rounded-full border px-3 text-[13px] font-medium",
        ativo
          ? "border-transparent bg-brand text-on-brand"
          : "border-line-button bg-surface text-ink-2",
      )}
    >
      {children}
    </button>
  );
}
