"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, CircleX, FileText, MoreVertical } from "lucide-react";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Badge } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import type { RecebimentoView } from "../_data";
import { PainelNota } from "./_painel-nota";
import { buscarXmlDaNota, salvarComoArquivo } from "./_xml";

// ============================================================
// As peças que as duas etapas do recebimento usam: o topo (cabeçalho e avisos
// do documento) e o rodapé de ação. Moram fora de `_client.tsx` porque a etapa
// da nota e a conferência são telas diferentes do mesmo recebimento.
//
// Não há trilho de etapas: são duas, e cada uma leva à outra por um botão — o
// rodapé da nota abre a conferência, e o cabeçalho da conferência volta à nota.
//
// Cada fato tem um lugar só. O topo diz QUAL recebimento é; a etapa 1 guarda
// o que a nota diz (fornecedor, valores, pedido, produtos); a etapa 2 guarda o
// que a doca contou. Nada aqui repete o que a etapa mostra logo abaixo.
// ============================================================

/** As duas telas do recebimento: a nota com seus produtos, e a contagem. */
export type EtapaId = "nota" | "conferencia";

// ── Rodapé de ação ──────────────────────────────────────────

/**
 * A barra que fecha as duas etapas.
 *
 * `sticky`, não `fixed`: fixo se ancora na viewport inteira, passa por baixo
 * da sidebar e obriga a chutar um `pb-24` que o texto de duas linhas do
 * celular estoura — escondendo o último item da nota.
 *
 * Uma casca só para as duas etapas, e ela responde só duas coisas — quanto
 * falta e o que acontece ao apertar. Os totais ficam onde já estavam.
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
 * foi contado e, dentro dele, o que ainda pede decisão. Quem está na doca olha
 * de longe, com a caixa na mão — texto de 13px não se lê nessa distância.
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

// ── Topo ────────────────────────────────────────────────────

/**
 * O que as duas etapas têm em cima: qual recebimento é e o que o documento
 * tem a avisar. Um componente só — antes cada etapa
 * montava o seu, e as duas discordavam sobre onde ficava o menu da nota.
 */
export function Topo({
  dados,
  etapa,
  podeTratarNota,
  podeBaixarXml,
  onCancelar,
}: {
  dados: RecebimentoView;
  etapa: EtapaId;
  /** Decide sobre o DOCUMENTO: descartar, estornar, dar entrada sem conferir. */
  podeTratarNota: boolean;
  /** Abre e baixa o XML guardado (`fiscal.baixar`). */
  podeBaixarXml: boolean;
  /** Abandonar a conferência sem mover estoque. Ausente = não cabe agora. */
  onCancelar?: () => void;
}) {
  const { recebimento, nota, pedido, semPedido, resumo, escolherPorta } = dados;
  const naConferencia = etapa === "conferencia";
  // Antes da conferência não há linha conciliada: a conta vem dos itens do XML.
  const semProduto = escolherPorta
    ? dados.itensNota.filter((i) => !i.productId).length
    : resumo.produtosNovos;

  const cabecalho = (menuDoDocumento?: React.ReactNode) => (
    <Cabecalho
      recebimento={recebimento}
      nota={nota}
      // Com nota, as duas etapas têm o mesmo título — "Recebimento REC-x" e a
      // identidade da NF-e embaixo. Quem manda e qual pedido moram nos cartões
      // da etapa 1, a um clique ("Nota e produtos").
      resumido={Boolean(nota)}
      // Na etapa 1 o XML tem botão próprio, ao lado dos dados do documento.
      xmlNaTela={!naConferencia}
      podeBaixarXml={podeBaixarXml}
      pedidoNumero={naConferencia ? (pedido?.numero ?? null) : null}
      semPedido={naConferencia && semPedido}
      menuDoDocumento={menuDoDocumento}
      onCancelar={onCancelar}
      // Da contagem, um clique de volta ao que a nota diz. Sem nota, a
      // conferência é a tela inteira e não há para onde voltar.
      linkDaNota={naConferencia && nota ? `/recebimento/${recebimento.id}?etapa=nota` : null}
    />
  );

  const encerrado = <AvisoEncerrado recebimento={recebimento} />;

  if (nota && podeTratarNota) {
    return (
      <PainelNota nota={nota} faltamRelacionar={semProduto} emConferencia={!escolherPorta}>
        {({ alertas, menu }) => (
          <>
            {cabecalho(menu)}
            {encerrado}
            {alertas}
          </>
        )}
      </PainelNota>
    );
  }

  return (
    <>
      {cabecalho()}
      {encerrado}
    </>
  );
}

/** Recebimento fechado: a tela inteira vira leitura, e isto diz por quê. */
function AvisoEncerrado({ recebimento }: { recebimento: RecebimentoView["recebimento"] }) {
  if (recebimento.status === "FINALIZADO") {
    return (
      <p className="rounded-[var(--radius)] bg-ok-soft px-4 py-3 text-[13px] text-ok">
        Recebimento {recebimento.numero} finalizado — a mercadoria já entrou no estoque.
      </p>
    );
  }
  if (recebimento.status === "CANCELADO") {
    return (
      <p className="rounded-[var(--radius)] bg-surface-2 px-4 py-3 text-[13px] text-muted">
        Recebimento cancelado
        {recebimento.canceladoMotivo ? `: ${recebimento.canceladoMotivo}` : "."} Nada entrou no
        estoque.
      </p>
    );
  }
  return null;
}

// ── Cabeçalho ───────────────────────────────────────────────

/**
 * Identidade, e só: quem mandou, qual nota, em qual loja. Valor, parcelas e a
 * origem do pedido são conteúdo da etapa 1 — aqui eles eram a mesma informação
 * repetida em corpo menor.
 *
 * `resumido` vale nas duas etapas quando há nota: o fornecedor e o pedido têm
 * cartão próprio na etapa 1, então o cabeçalho diz só qual recebimento é e
 * qual NF-e — igual na nota e na conferência. Sem nota (pedido sem XML,
 * avulso) não há etapa 1, e o cabeçalho completo é o único lugar desses dados.
 */
const STATUS_RECEBIMENTO: Record<
  RecebimentoView["recebimento"]["status"],
  { rotulo: string; tom: "neutral" | "brand" | "ok" | "warn" | "danger" }
> = {
  PENDENTE: { rotulo: "A conferir", tom: "warn" },
  EM_CONFERENCIA: { rotulo: "Em conferência", tom: "brand" },
  DIVERGENCIA: { rotulo: "Com divergência", tom: "danger" },
  FINALIZADO: { rotulo: "Concluído", tom: "ok" },
  CANCELADO: { rotulo: "Cancelado", tom: "neutral" },
};

/** "NF-e 234517 · Série 39 · Emitida em 07/10/2026" — como o papel identifica a nota. */
function IdentidadeDaNota({
  nota,
  solta,
}: {
  nota: NonNullable<RecebimentoView["nota"]>;
  /** Dentro de outra linha de texto: sem o parágrafo próprio. */
  solta?: boolean;
}) {
  const conteudo = (
    <>
      NF-e <span className="font-mono text-ink-2">{nota.numero}</span>
      {" · Série "}
      <span className="font-mono text-ink-2">{nota.serie}</span>
      {" · Emitida em "}
      {new Date(nota.dataEmissao).toLocaleDateString("pt-BR")}
    </>
  );
  if (solta) return conteudo;
  return <p className="truncate text-[13px] text-muted">{conteudo}</p>;
}

function Cabecalho({
  recebimento,
  nota,
  resumido,
  xmlNaTela,
  podeBaixarXml,
  pedidoNumero,
  semPedido,
  menuDoDocumento,
  onCancelar,
  linkDaNota,
}: {
  recebimento: RecebimentoView["recebimento"];
  /** Nulo é caso normal: recebimento de pedido sem XML, ou avulso. */
  nota: RecebimentoView["nota"];
  resumido?: boolean;
  /** A tela já tem botão de XML — o menu não repete. */
  xmlNaTela?: boolean;
  podeBaixarXml: boolean;
  pedidoNumero: string | null;
  /** Conferência aberta sem pedido. */
  semPedido?: boolean;
  /** Itens de menu das decisões do documento — só para quem trata a nota. */
  menuDoDocumento?: React.ReactNode;
  onCancelar?: () => void;
  /** Endereço da etapa da nota — só na conferência. */
  linkDaNota?: string | null;
}) {
  const xmlNoMenu = Boolean(nota?.temXml) && !xmlNaTela && podeBaixarXml;
  const temMenu = Boolean(xmlNoMenu || menuDoDocumento || onCancelar);

  return (
    <div className="flex items-start gap-3">
      <Link
        href="/recebimento"
        className="mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line-button text-ink-2 transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        aria-label="Voltar para os recebimentos"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
      </Link>

      {/* Hierarquia: quem mandou > qual documento > onde. Na etapa 1 quem manda
          e qual documento têm cartão próprio logo abaixo — sobra o recebimento. */}
      {resumido ? (
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-[20px] font-semibold text-ink">
            Recebimento <span className="font-mono">{recebimento.numero}</span>
          </h1>
          {nota && <IdentidadeDaNota nota={nota} />}
        </div>
      ) : (
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[11px] font-semibold tracking-wider text-faint">
            {recebimento.numero}
          </p>
          <h1 className="truncate font-display text-[20px] font-semibold text-ink">
            {recebimento.supplierNome ?? "Sem fornecedor"}
          </h1>
          <p className="truncate text-[13px] text-muted">
            {nota ? (
              <IdentidadeDaNota nota={nota} solta />
            ) : (
              <>
                {recebimento.numeroNota ? (
                  <span className="font-mono">NF {recebimento.numeroNota} (sem XML)</span>
                ) : (
                  <span>Sem nota fiscal</span>
                )}
                {" · "}
                {recebimento.siteNome}
              </>
            )}
            {pedidoNumero && (
              <>
                {" · pedido "}
                <span className="font-mono text-ink-2">{pedidoNumero}</span>
              </>
            )}
            {semPedido && " · sem pedido"}
          </p>
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
        </div>
      )}

      {/* Em que pé está o recebimento, à direita do título — o mesmo selo
          nas duas etapas. */}
      <Badge
        tone={STATUS_RECEBIMENTO[recebimento.status].tom}
        className="mt-1.5 shrink-0 px-2.5 py-1 text-[12px]"
      >
        {STATUS_RECEBIMENTO[recebimento.status].rotulo}
      </Badge>

      {linkDaNota && (
        <Link
          href={linkDaNota}
          className="mt-1 inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-line-button bg-surface px-3.5 text-[13px] font-medium text-ink transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        >
          <FileText className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Nota e produtos</span>
          <span className="sm:hidden">Nota</span>
        </Link>
      )}

      {/* Um menu só para o recebimento e para o documento dele. O que não é a
          decisão da vez sai do caminho: baixar o XML, descartar a nota e
          cancelar a conferência são coisas que se faz uma vez. */}
      {temMenu && (
        <Menu
          trigger={
            <button
              type="button"
              className="mt-1 grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full border border-line-button text-ink-2 transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              aria-label="Mais opções deste recebimento"
            >
              <MoreVertical className="h-4 w-4" aria-hidden />
            </button>
          }
        >
          {nota && xmlNoMenu && (
            // O contador pede o XML, e sem isto o operador volta ao e-mail do
            // fornecedor procurar o anexo que já está guardado aqui.
            <MenuItem
              icon={<FileText size={15} />}
              onClick={() => {
                buscarXmlDaNota(nota.id, nota.chave)
                  .then(salvarComoArquivo)
                  .catch((e: unknown) =>
                    toast.error(
                      "Não deu para baixar o XML",
                      e instanceof Error ? e.message : "Tente de novo.",
                    ),
                  );
              }}
            >
              Baixar XML
            </MenuItem>
          )}
          {menuDoDocumento}
          {onCancelar && (
            <MenuItem icon={<CircleX size={15} />} onClick={onCancelar} danger>
              Cancelar recebimento
            </MenuItem>
          )}
        </Menu>
      )}
    </div>
  );
}
