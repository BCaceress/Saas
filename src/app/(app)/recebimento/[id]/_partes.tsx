"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Check, CircleX, FileText, MoreVertical, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Menu, MenuItem } from "@/components/ui/menu";
import { fmtMoney } from "../../cotacoes/_catalogo/ui";
import type { RecebimentoView } from "../_data";

// ============================================================
// As peças que todas as etapas do recebimento usam: o cabeçalho, o trilho e o
// rodapé de ação. Moram fora de `_client.tsx` porque a entrada da nota e a
// conferência são telas diferentes do mesmo recebimento — e as duas precisam
// dizer onde a pessoa está do mesmo jeito.
// ============================================================

// ── Trilho ──────────────────────────────────────────────────

export type EtapaId = "nota" | "pedido" | "produtos" | "conferencia";

const ETAPAS: Record<EtapaId, { titulo: string; ajuda: string }> = {
  nota: { titulo: "Nota", ajuda: "Confira o que o NoHub leu do XML" },
  pedido: { titulo: "Pedido", ajuda: "Diga se esta nota fatura um pedido seu" },
  produtos: { titulo: "Produtos", ajuda: "Relacione os itens da nota aos seus produtos" },
  conferencia: { titulo: "Conferência", ajuda: "Conte o que chegou e receba no estoque" },
};

/**
 * A conferência é a última etapa: confirmar a entrada é o botão dela, não uma
 * tela a mais. Preço de venda se cuida no cadastro do produto.
 */
export const ETAPAS_COM_NOTA: EtapaId[] = ["nota", "pedido", "produtos", "conferencia"];

/**
 * O trilho do recebimento. As etapas são sempre as mesmas e sempre visíveis: o
 * operador precisa saber em que pé está uma nota que abriu ontem e voltou a
 * abrir hoje — e o que ainda falta antes de a mercadoria virar saldo.
 *
 * Etapa já visitada é botão: voltar para rever o pedido não pode exigir o
 * "voltar" do navegador. Etapa adiante só abre quando `onIr` a aceita.
 */
export function Trilho({
  etapas,
  atual,
  avisos,
  onIr,
}: {
  etapas: EtapaId[];
  atual: EtapaId;
  /** Pendência curta ao lado do título ("5", "2"). Só número: é contagem. */
  avisos?: Partial<Record<EtapaId, number>>;
  /** Ausente = trilho só informa. Devolver para onde dá para ir é do dono. */
  onIr?: (etapa: EtapaId) => void;
}) {
  const posicao = etapas.indexOf(atual);

  return (
    <div className="flex flex-col gap-1">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
        {etapas.map((id, i) => {
          const feita = i < posicao;
          const ativa = i === posicao;
          const aviso = avisos?.[id] ?? 0;
          const clicavel = Boolean(onIr) && feita;
          const conteudo = (
            <>
              <span
                className={cn(
                  "grid h-5 w-5 place-items-center rounded-full text-[11px] font-semibold",
                  ativa && "bg-brand text-on-brand",
                  feita && (aviso > 0 ? "bg-accent-soft text-accent" : "bg-ok-soft text-ok"),
                  !ativa && !feita && "bg-surface-2 text-faint",
                )}
                aria-hidden
              >
                {feita && aviso === 0 ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              <span
                className={cn(
                  "text-[12px]",
                  ativa ? "font-semibold text-ink" : feita ? "text-muted" : "text-faint",
                )}
              >
                {ETAPAS[id].titulo}
              </span>
              {aviso > 0 && (
                <span className="rounded-full bg-accent-soft px-1.5 font-mono text-[11px] font-semibold text-accent">
                  {aviso}
                  <span className="sr-only"> {aviso === 1 ? "pendência" : "pendências"}</span>
                </span>
              )}
            </>
          );
          return (
            <React.Fragment key={id}>
              {i > 0 && <span className="h-px w-3 bg-line sm:w-5" aria-hidden />}
              <li aria-current={ativa ? "step" : undefined}>
                {clicavel ? (
                  <button
                    type="button"
                    onClick={() => onIr?.(id)}
                    className="flex items-center gap-1.5 rounded-full px-2 py-1 transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                  >
                    {conteudo}
                  </button>
                ) : (
                  <span
                    className={cn(
                      "flex items-center gap-1.5 rounded-full px-2 py-1",
                      // Só a etapa atual ganha fundo: um trilho em que todos os
                      // passos pesam igual não diz onde a pessoa está.
                      ativa && "bg-brand-soft",
                    )}
                  >
                    {conteudo}
                  </span>
                )}
              </li>
            </React.Fragment>
          );
        })}
      </ol>
      <p className="text-[13px] text-muted">{ETAPAS[atual].ajuda}</p>
    </div>
  );
}

// ── Rodapé de ação ──────────────────────────────────────────

/**
 * A barra que fecha as duas etapas.
 *
 * `sticky`, não `fixed`: fixo se ancora na viewport inteira, passa por baixo
 * da sidebar e obriga a chutar um `pb-24` que o texto de duas linhas do
 * celular estoura — escondendo o último item da nota.
 *
 * Uma casca só para as duas etapas. Antes cada uma desenhava a sua: mesma
 * altura, mesmo botão, e os números do topo repetidos aqui embaixo em corpo
 * menor. Agora o rodapé responde só duas coisas — quanto falta e o que
 * acontece ao apertar —, e os totais ficam onde já estavam.
 */
export function RodapeAcao({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 z-30 -mx-1 mt-auto sm:-mx-2">
      {/* Véu curto: diz que a lista continua por baixo da barra, em vez de a
          última linha parecer cortada por um traço. */}
      <div
        aria-hidden
        className="pointer-events-none h-5 bg-gradient-to-b from-transparent to-surface"
      />
      <div className="border-t border-line bg-surface/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * "12 de 40" é um número que se lê; a barra é um estado que se vê.
 *
 * Dois saldos na mesma régua, como o medidor de estoque do produto: o que já
 * foi feito e, dentro dele, o que ainda pede decisão. Quem está na doca olha
 * de longe, com a caixa na mão — texto de 13px não se lê nessa distância.
 *
 * Serve as duas etapas: relacionar produto e contar mercadoria são a mesma
 * pergunta ("quanto falta para poder receber?") em momentos diferentes.
 */
export function MedidorRodape({
  total,
  feitos,
  atencao,
  rotulo,
  rotuloPlural,
}: {
  total: number;
  feitos: number;
  /** Subconjunto de `feitos` que ainda espera uma decisão. */
  atencao: number;
  rotulo: string;
  rotuloPlural: string;
}) {
  const pctFeito = total > 0 ? (feitos / total) * 100 : 0;
  const pctAtencao = total > 0 ? (Math.min(atencao, feitos) / total) * 100 : 0;

  return (
    <div>
      <p className="flex items-baseline gap-2 font-display text-[15px] font-semibold text-ink">
        <span className="tabular-nums">
          {feitos} de {total}
        </span>
        <span className="text-[13px] font-normal text-muted">
          {total === 1 ? rotulo : rotuloPlural}
        </span>
      </p>
      <div
        className="mt-1.5 flex h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-valuenow={feitos}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={rotuloPlural}
      >
        {/* A fatia de atenção é subconjunto da feita — some da barra verde
            para não somar mais de 100%. */}
        <span
          className="h-full bg-ok transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${pctFeito - pctAtencao}%` }}
        />
        <span
          className="h-full bg-accent transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${pctAtencao}%` }}
        />
      </div>
    </div>
  );
}

// ── Cabeçalho ───────────────────────────────────────────────

export function Cabecalho({
  recebimento,
  nota,
  pedidoNumero,
  semPedido,
  titulo,
  semParcelas,
  onDesvincular,
  onCancelar,
}: {
  /**
   * A tarefa da tela, no lugar do nome do fornecedor. Na etapa da nota o
   * fornecedor é uma das coisas a conferir — está na lista logo abaixo, e
   * repeti-lo no título é dizer a mesma coisa duas vezes.
   */
  titulo?: string;
  /** As parcelas já aparecem no corpo da etapa: não repetir aqui. */
  semParcelas?: boolean;
  recebimento: RecebimentoView["recebimento"];
  /** Nulo é caso normal: recebimento de pedido sem XML, ou avulso. */
  nota: RecebimentoView["nota"];
  pedidoNumero: string | null;
  /** Conferência aberta sem pedido — o rótulo do voltar muda com isso. */
  semPedido?: boolean;
  onDesvincular?: () => void;
  /** Abandonar a conferência sem mover estoque. */
  onCancelar?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-start gap-3">
      <Link
        href="/pedidos"
        className="mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line-button text-ink-2 hover:bg-surface-2"
        aria-label="Voltar para os pedidos de compra"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
      </Link>

      {/* Hierarquia: quem mandou > qual papel > quanto. O nome do fornecedor é
          o que o operador procura na tela cheia de notas; "Recebimento
          inteligente" é onde ele está, não o que ele está olhando. */}
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">
          <span className="font-mono">{recebimento.numero}</span>
          <span aria-hidden>·</span>
          <span>Recebimento</span>
        </p>
        <h1 className="truncate font-display text-[20px] font-semibold text-ink">
          {titulo ?? recebimento.supplierNome ?? "Sem fornecedor"}
        </h1>
        <p className="truncate text-[13px] text-muted">
          {nota ? (
            <span className="font-mono">
              NF {nota.numero}/{nota.serie}
            </span>
          ) : recebimento.numeroNota ? (
            <span className="font-mono">NF {recebimento.numeroNota} (sem XML)</span>
          ) : (
            <span>Sem nota fiscal</span>
          )}
          {" · "}
          {recebimento.siteNome}
          {pedidoNumero && (
            <>
              {" · pedido "}
              <span className="font-mono text-ink-2">{pedidoNumero}</span>
            </>
          )}
        </p>
        {semPedido && (
          <p className="mt-1 text-[12px] text-muted">
            Sem pedido — a nota é a referência do que deveria vir.
          </p>
        )}
        {!nota && !pedidoNumero && (
          <p className="mt-1 text-[12px] text-muted">
            Recebimento avulso — sem pedido e sem nota. Some o que chegou.
          </p>
        )}
        {!nota && pedidoNumero && (
          <p className="mt-1 text-[12px] text-muted">
            Sem XML por enquanto. Você pode receber assim e vincular a NF-e quando ela chegar.
          </p>
        )}
        {nota?.vinculoAutomatico && pedidoNumero && (
          <p className="mt-1 text-[12px] text-brand">
            Pedido {pedidoNumero} encontrado automaticamente pela nota.
          </p>
        )}
        {nota && !semParcelas && nota.duplicatas.length > 0 && (
          <p className="mt-1 text-[12px] text-muted">
            {nota.duplicatas.length === 1 ? "Vencimento" : `${nota.duplicatas.length} parcelas`}:{" "}
            {nota.duplicatas
              .map(
                (d) =>
                  `${new Date(d.vencimento).toLocaleDateString("pt-BR")} ${fmtMoney(d.valor)}`,
              )
              .join(" · ")}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-start gap-3">
        {nota && (
          <p className="text-right">
            <span className="block font-mono text-[20px] font-semibold text-ink">
              {fmtMoney(nota.valorTotal)}
            </span>
            <span className="block text-[11px] text-faint">total da nota</span>
          </p>
        )}

        {/* O que não é a decisão da vez sai do caminho. Baixar o XML e trocar
            a forma de receber são coisas que se faz uma vez por nota — não
            merecem competir com o botão de receber. */}
        <Menu
          trigger={
            <button
              type="button"
              className="grid h-9 w-9 place-items-center rounded-full border border-line-button text-ink-2 transition-colors hover:bg-surface-2"
              aria-label="Mais opções desta nota"
            >
              <MoreVertical className="h-4 w-4" aria-hidden />
            </button>
          }
        >
          {nota?.temXml && (
            // O contador pede o XML, e sem isto o operador volta ao e-mail do
            // fornecedor procurar o anexo que já está guardado aqui.
            <MenuItem
              icon={<FileText size={15} />}
              onClick={() => {
                window.location.href = `/api/fiscal/entrada/${nota.id}/xml`;
              }}
            >
              Baixar XML
            </MenuItem>
          )}
          {onDesvincular && (pedidoNumero || semPedido) && (
            <MenuItem icon={<Undo2 size={15} />} onClick={onDesvincular}>
              {pedidoNumero ? "Trocar pedido" : "Trocar forma de receber"}
            </MenuItem>
          )}
          {onCancelar && (
            <MenuItem icon={<CircleX size={15} />} onClick={onCancelar} danger>
              Cancelar recebimento
            </MenuItem>
          )}
        </Menu>
      </div>
    </div>
  );
}
