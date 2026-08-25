"use client";

import { useMemo, useState, useTransition } from "react";
import {
  AlertTriangle,
  CalendarClock,
  Layers,
  SlidersHorizontal,
  TrendingDown,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TEXTO_RECUSA,
  avaliarFaixas,
  somarOportunidades,
  type ContextoItem,
  type LimitesEscala,
  type Oportunidade,
} from "@/lib/compras/escalas";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import { EstadoVazio, Metrica, MetricaGrid, fmtMoney, fmtPreco, fmtQtd } from "../_catalogo/ui";
import { SupplierAvatar } from "../_ui";
import type { ConviteCotacao, ItemCotacao } from "../_compra-types";
import { salvarLimitesEscalaAction } from "../_compra-actions";

// ── Lente "Melhor oportunidade" ─────────────────────────────
//
// A outra lente responde "quanto custa o que eu preciso". Esta responde a
// pergunta que o comprador de bebida faz no telefone: "e se eu levar mais?".
//
// O desenho inteiro existe para NÃO virar um botão de comprar demais. A faixa
// mais barata é sempre a maior, então a tela nunca mostra só o preço: cada
// linha de promoção carrega os quatro números que decidem — economia na cesta,
// desembolso extra, dias de estoque que a sobra cria e o risco de vencer antes
// de girar. Faixa reprovada continua visível, riscada e com o motivo escrito:
// esconder ensinaria o operador a desconfiar da tela.
//
// As travas ficam AQUI, no alto, e não numa tela de configuração: quem está
// decidindo a compra é quem sabe quanto caixa tem hoje.

/** Uma promoção concreta: de quem, de qual item, e o que ela faz. */
export type Sugestao = {
  itemId: string;
  conviteId: string;
  oportunidade: Oportunidade;
};

export function LenteOportunidade({
  itens,
  respondidos,
  superficie = "desktop",
  limites,
  onLimites,
  escolhas,
  quantidades,
  editavel,
  onAplicarFaixa,
  onAplicarTodas,
}: {
  itens: ItemCotacao[];
  respondidos: ConviteCotacao[];
  /**
   * No celular as travas descem para uma folha e as três métricas viram uma
   * tira compacta: config e resumo somavam ~330px acima do conteúdo — antes
   * de a primeira promoção aparecer na tela.
   */
  superficie?: "desktop" | "mobile";
  limites: LimitesEscala;
  onLimites: (l: LimitesEscala) => void;
  escolhas: Record<string, string | null>;
  quantidades: Record<string, number>;
  editavel: boolean;
  /** Levar esta faixa: escolhe o fornecedor E muda a quantidade do item. */
  onAplicarFaixa: (itemId: string, conviteId: string, quantidade: number) => void;
  onAplicarTodas: (sugestoes: Sugestao[]) => void;
}) {
  // Todas as faixas de todos os fornecedores, avaliadas contra as travas de
  // agora. Recalcula quando o operador mexe num limite — é o que faz a régua
  // parecer régua, e não um parecer fixo.
  const analise = useMemo(
    () =>
      itens.map((item) => {
        const porFornecedor = respondidos.flatMap((c) => {
          const r = c.respostas.find((x) => x.quotationItemId === item.id);
          if (!r?.disponivel || r.faixas.length === 0) return [];
          const ctx: ContextoItem = {
            quantidadePedida: item.quantidade,
            precoBase: r.precoUnitario,
            fatorEmbalagem: item.fatorEmbalagem,
            consumoDiarioUnidades: item.consumoDiarioUnidades,
            estoqueAtualUnidades: item.estoqueAtual,
            validadeTipicaDias: item.validadeTipicaDias,
          };
          return [
            {
              convite: c,
              precoBase: r.precoUnitario,
              oportunidades: avaliarFaixas(ctx, r.faixas, limites),
            },
          ];
        });
        return { item, porFornecedor };
      }),
    [itens, respondidos, limites],
  );

  // A recomendação por item: entre as aprovadas de TODOS os fornecedores,
  // a de maior economia. Comparar dentro de um fornecedor só perderia o caso
  // comum — quem tem a promoção nem sempre é quem tem o melhor preço-base.
  const recomendadas = useMemo<Sugestao[]>(
    () =>
      analise.flatMap(({ item, porFornecedor }) => {
        const candidatas = porFornecedor.flatMap((f) =>
          f.oportunidades
            .filter((o) => o.compensa)
            .map((o) => ({ itemId: item.id, conviteId: f.convite.id, oportunidade: o })),
        );
        if (candidatas.length === 0) return [];
        return [
          candidatas.reduce((melhor, c) =>
            c.oportunidade.economia > melhor.oportunidade.economia ? c : melhor,
          ),
        ];
      }),
    [analise],
  );

  const mobile = superficie === "mobile";
  const [travasAbertas, setTravasAbertas] = useState(false);

  const resumo = somarOportunidades(recomendadas.map((s) => s.oportunidade));
  const comFaixa = analise.filter((a) => a.porFornecedor.length > 0);

  if (comFaixa.length === 0) {
    return (
      <EstadoVazio
        icon={<Layers size={20} />}
        titulo="Nenhuma promoção por volume ainda"
        descricao="Esta cotação pede preço por escala, mas nenhum fornecedor informou faixa até agora. Assim que alguém responder com uma, ela aparece aqui com a conta de quanto compensa."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {mobile ? (
        <>
          {/* A régua vira UMA linha: o que ela está fazendo agora, e um toque
              para mexer. Três campos numéricos abertos empurravam a primeira
              promoção para fora da tela. */}
          <button
            type="button"
            onClick={() => setTravasAbertas(true)}
            aria-haspopup="dialog"
            className="flex min-h-11 items-center gap-2 rounded-[var(--radius-lg)] border border-line bg-surface px-3 py-2 text-left"
          >
            <SlidersHorizontal size={14} className="shrink-0 text-muted" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-medium text-ink">Até onde vale a pena</span>
              <span className="block truncate font-mono text-[11px] tabular-nums text-muted">
                {resumoLimites(limites)}
              </span>
            </span>
            <span className="shrink-0 text-[12px] font-medium text-brand">ajustar</span>
          </button>

          <TiraResumoEscala resumo={resumo} />
        </>
      ) : (
        <>
          <Travas limites={limites} onLimites={onLimites} editavel={editavel} />

          <MetricaGrid className="grid-cols-1 sm:grid-cols-3 lg:grid-cols-3">
            <Metrica
              label="Economia se levar as promoções"
              valor={fmtMoney(resumo.economia)}
              sub={
                resumo.itens === 0
                  ? "nenhuma faixa passou nas suas travas"
                  : `${resumo.itens} ${resumo.itens === 1 ? "item" : "itens"} com promoção que compensa`
              }
              tom="ok"
              icon={<TrendingDown size={13} />}
            />
            <Metrica
              label="Sai do caixa a mais, hoje"
              valor={fmtMoney(resumo.investimentoExtra)}
              sub="contra comprar só o que foi cotado"
              tom="brand"
              icon={<Wallet size={13} />}
            />
            <Metrica
              label="Maior cobertura resultante"
              valor={
                resumo.maiorCoberturaDias === null ? "—" : `${resumo.maiorCoberturaDias} dias`
              }
              sub="o item que mais fica na prateleira"
              icon={<CalendarClock size={13} />}
            />
          </MetricaGrid>
        </>
      )}

      {editavel && recomendadas.length > 0 && (
        <button
          type="button"
          onClick={() => onAplicarTodas(recomendadas)}
          className={cn(
            "min-h-11 rounded-full bg-brand px-4 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong",
            mobile ? "w-full" : "self-start py-2",
          )}
        >
          Levar as {recomendadas.length} que compensam
        </button>
      )}

      <ul className="flex flex-col gap-3">
        {comFaixa.map(({ item, porFornecedor }) => (
          <CardEscala
            key={item.id}
            item={item}
            porFornecedor={porFornecedor}
            escolhido={escolhas[item.id] ?? null}
            quantidadeAtual={quantidades[item.id] ?? item.quantidade}
            editavel={editavel}
            onAplicarFaixa={onAplicarFaixa}
          />
        ))}
      </ul>

      {mobile && (
        <BottomSheet
          open={travasAbertas}
          onClose={() => setTravasAbertas(false)}
          titulo="Até onde vale a pena"
          descricao="Sem limite, a promoção mais barata é sempre a maior — e a conta some no capital parado."
          rodape={
            <button
              type="button"
              onClick={() => setTravasAbertas(false)}
              className="min-h-12 w-full rounded-full bg-brand text-sm font-semibold text-on-brand"
            >
              Aplicar
            </button>
          }
        >
          <Travas limites={limites} onLimites={onLimites} editavel={editavel} semMoldura />
        </BottomSheet>
      )}
    </div>
  );
}

/** A régua em uma linha, para caber no botão que abre a folha. */
function resumoLimites(l: LimitesEscala): string {
  return [
    `≥ ${l.economiaMinPct}% de desconto`,
    `até ${l.coberturaMaxDias} dias de estoque`,
    l.capitalExtraMax === null ? "sem teto de caixa" : `até ${fmtMoney(l.capitalExtraMax)}`,
  ].join(" · ");
}

/**
 * Os três números do resumo no celular. `MetricaGrid` é `grid-cols-2` na base:
 * com três filhos ela deixava o terceiro pendurado em meia largura, e a 19px
 * um `R$ 1.234,56` não cabe em 120px de coluna. Rótulo à esquerda, número à
 * direita, uma linha cada.
 */
function TiraResumoEscala({
  resumo,
}: {
  resumo: ReturnType<typeof somarOportunidades>;
}) {
  const linhas = [
    {
      icone: <TrendingDown size={13} aria-hidden />,
      label: "Economia se levar",
      valor: fmtMoney(resumo.economia),
      cor: "text-ok",
    },
    {
      icone: <Wallet size={13} aria-hidden />,
      label: "Sai do caixa hoje",
      valor: fmtMoney(resumo.investimentoExtra),
      cor: "text-brand",
    },
    {
      icone: <CalendarClock size={13} aria-hidden />,
      label: "Maior cobertura",
      valor: resumo.maiorCoberturaDias === null ? "—" : `${resumo.maiorCoberturaDias} dias`,
      cor: "text-ink",
    },
  ];

  return (
    <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
      {linhas.map((l) => (
        <li key={l.label} className="flex items-center justify-between gap-3 px-3.5 py-2">
          <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
            {l.icone}
            <span className="truncate">{l.label}</span>
          </span>
          <span className={cn("shrink-0 font-mono text-[14px] font-semibold tabular-nums", l.cor)}>
            {l.valor}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ── Travas do comprador ─────────────────────────────────────

function Travas({
  limites,
  onLimites,
  editavel,
  semMoldura = false,
}: {
  limites: LimitesEscala;
  onLimites: (l: LimitesEscala) => void;
  editavel: boolean;
  /** Dentro da folha a borda e o título já existem em volta. */
  semMoldura?: boolean;
}) {
  const [salvando, startSalvar] = useTransition();
  /** `null` = ainda não salvou nesta sessão; string = o que foi gravado. */
  const [salvo, setSalvo] = useState<string | null>(null);
  const assinatura = JSON.stringify(limites);

  return (
    <div
      className={cn(
        "flex flex-col gap-2.5",
        !semMoldura && "rounded-[var(--radius-lg)] border border-line bg-surface p-3.5",
      )}
    >
      {!semMoldura && (
        <div>
          <p className="text-[13px] font-medium text-ink">Até onde vale a pena</p>
          <p className="text-[12px] text-muted">
            Sem limite, a promoção mais barata é sempre a maior — e a conta some no capital
            parado. Estes são os seus.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Trava
          label="Desconto mínimo"
          sufixo="%"
          valor={limites.economiaMinPct}
          editavel={editavel}
          onValor={(v) => onLimites({ ...limites, economiaMinPct: v ?? 0 })}
        />
        <Trava
          label="Estoque extra até"
          sufixo="dias"
          valor={limites.coberturaMaxDias}
          editavel={editavel}
          onValor={(v) => onLimites({ ...limites, coberturaMaxDias: v ?? 0 })}
        />
        <Trava
          label="Desembolso extra até"
          prefixo="R$"
          valor={limites.capitalExtraMax}
          placeholder="sem teto"
          editavel={editavel}
          onValor={(v) => onLimites({ ...limites, capitalExtraMax: v })}
        />
      </div>

      {/* Mexer na régua vale só para esta cotação; virar padrão é decisão à
          parte. Sem essa separação, um teste de "e se eu afrouxar?" mudaria a
          régua de todas as compras seguintes sem ninguém perceber. */}
      {editavel && (
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            disabled={salvando || salvo === assinatura}
            onClick={() =>
              startSalvar(async () => {
                await salvarLimitesEscalaAction(limites);
                setSalvo(assinatura);
              })
            }
            className="text-[12px] text-muted underline-offset-4 transition-colors hover:text-ink hover:underline disabled:no-underline disabled:opacity-60"
          >
            {salvando ? "Salvando…" : "Usar como padrão nas próximas cotações"}
          </button>
          {salvo === assinatura && !salvando && (
            <span className="text-[12px] text-ok">salvo</span>
          )}
        </div>
      )}
    </div>
  );
}

function Trava({
  label,
  valor,
  onValor,
  prefixo,
  sufixo,
  placeholder,
  editavel,
}: {
  label: string;
  valor: number | null;
  onValor: (v: number | null) => void;
  prefixo?: string;
  sufixo?: string;
  placeholder?: string;
  editavel: boolean;
}) {
  const id = `trava-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <label htmlFor={id} className="flex flex-col gap-1">
      <span className="text-[12px] font-medium text-ink-2">{label}</span>
      <span className="flex items-center gap-1.5 rounded-[var(--radius)] border border-line bg-surface px-3 py-2">
        {prefixo && <span className="text-[12px] text-faint">{prefixo}</span>}
        <input
          id={id}
          inputMode="decimal"
          disabled={!editavel}
          value={valor === null ? "" : String(valor).replace(".", ",")}
          placeholder={placeholder}
          onChange={(e) => {
            const bruto = e.target.value.replace(",", ".").replace(/[^\d.]/g, "");
            onValor(bruto === "" ? null : Number(bruto));
          }}
          className="min-w-0 flex-1 bg-transparent text-right font-mono text-sm tabular-nums text-ink outline-none placeholder:font-sans placeholder:text-faint disabled:opacity-60"
        />
        {sufixo && <span className="text-[12px] text-faint">{sufixo}</span>}
      </span>
    </label>
  );
}

// ── Card de um item, com as faixas de cada fornecedor ───────

type PorFornecedor = {
  convite: ConviteCotacao;
  precoBase: number;
  oportunidades: Oportunidade[];
};

function CardEscala({
  item,
  porFornecedor,
  escolhido,
  quantidadeAtual,
  editavel,
  onAplicarFaixa,
}: {
  item: ItemCotacao;
  porFornecedor: PorFornecedor[];
  escolhido: string | null;
  quantidadeAtual: number;
  editavel: boolean;
  onAplicarFaixa: (itemId: string, conviteId: string, quantidade: number) => void;
}) {
  const emb = item.embalagemNome ?? "un";
  const coberturaHoje =
    item.consumoDiarioUnidades && item.consumoDiarioUnidades > 0 && item.estoqueAtual !== null
      ? Math.round(item.estoqueAtual / item.consumoDiarioUnidades)
      : null;

  return (
    <li className="rounded-[var(--radius-lg)] border border-line bg-surface p-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 flex-1 text-sm font-semibold text-ink">{item.descricao}</p>
        <span className="shrink-0 font-mono text-[12px] tabular-nums text-muted">
          pedido: {fmtQtd(item.quantidade)} {emb}
        </span>
      </div>

      {/* O contexto que decide: o que já está na prateleira e por quantos dias
          ele dura. Sem isto, "leve 10" é palpite. */}
      <p className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-faint">
        {item.estoqueAtual !== null && <span>tem {fmtQtd(item.estoqueAtual)} un. na loja</span>}
        {coberturaHoje !== null && <span>dura {coberturaHoje} dias no giro atual</span>}
        {item.validadeTipicaDias !== null && (
          <span>validade típica {item.validadeTipicaDias} dias</span>
        )}
        {item.consumoDiarioUnidades === null && <span>sem histórico de venda</span>}
      </p>

      <ul className="mt-2.5 flex flex-col gap-2.5">
        {porFornecedor.map(({ convite, precoBase, oportunidades }) => (
          <li key={convite.id} className="rounded-[var(--radius)] border border-line p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <SupplierAvatar
                  nome={convite.supplierNome}
                  logoUrl={convite.supplierLogoUrl}
                  size={18}
                />
                <span className="truncate text-[13px] font-medium text-ink">
                  {convite.supplierNome}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[12px] tabular-nums text-muted">
                {fmtPreco(precoBase)} <span className="font-sans text-faint">no pedido</span>
              </span>
            </div>

            <ul className="mt-2 flex flex-col gap-1.5">
              {oportunidades.map((o) => (
                <LinhaFaixa
                  key={o.quantidade}
                  o={o}
                  emb={emb}
                  ativa={escolhido === convite.id && quantidadeAtual === o.quantidade}
                  editavel={editavel}
                  onAplicar={() => onAplicarFaixa(item.id, convite.id, o.quantidade)}
                />
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </li>
  );
}

/**
 * Uma faixa de promoção.
 *
 * Era `flex-wrap justify-between`: em 390px os quatro números caíam em ordem
 * imprevisível e os três da direita viravam um bolo sem rótulo. Agora são duas
 * linhas fixas — a oferta em cima, a conta embaixo numa grade de três colunas
 * com o rótulo por escrito. O que decide não pode depender da largura da tela.
 */
function LinhaFaixa({
  o,
  emb,
  ativa,
  editavel,
  onAplicar,
}: {
  o: Oportunidade;
  emb: string;
  ativa: boolean;
  editavel: boolean;
  onAplicar: () => void;
}) {
  const barrada = !o.compensa;
  return (
    <li>
      <button
        type="button"
        // Faixa reprovada não é clicável: o operador pode afrouxar a trava
        // logo acima e ela volta. Deixar clicar seria transformar a régua em
        // enfeite no primeiro clique.
        disabled={!editavel || barrada}
        onClick={onAplicar}
        aria-pressed={ativa}
        className={cn(
          "flex min-h-11 w-full flex-col gap-1.5 rounded-[var(--radius)] border px-2.5 py-2 text-left transition-colors",
          ativa
            ? "border-brand bg-brand text-on-brand"
            : barrada
              ? "border-dashed border-line bg-surface-2/50"
              : "border-line bg-surface hover:bg-accent-soft",
          (!editavel || barrada) && "cursor-default",
        )}
      >
        <span className="flex items-baseline justify-between gap-2">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span
              className={cn(
                "font-mono text-[13px] font-semibold tabular-nums",
                ativa ? "" : barrada ? "text-muted line-through" : "text-ink",
              )}
            >
              {fmtQtd(o.quantidade)} {emb}
            </span>
            <span
              className={cn(
                "font-mono text-[13px] tabular-nums",
                ativa ? "text-on-brand/80" : barrada ? "text-faint" : "text-accent",
              )}
            >
              {fmtPreco(o.precoUnitario)}
            </span>
          </span>
          <span
            className={cn(
              "shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
              ativa
                ? "bg-on-brand/15 text-on-brand"
                : barrada
                  ? "text-faint"
                  : "bg-accent-soft text-accent",
            )}
          >
            −{o.economiaPct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
          </span>
        </span>

        {barrada ? (
          <span className="flex items-center gap-1 text-[11px] font-medium text-muted">
            <AlertTriangle size={11} aria-hidden />
            {TEXTO_RECUSA[o.recusas[0]]}
          </span>
        ) : (
          <span
            className={cn(
              "grid grid-cols-3 gap-2 border-t pt-1.5 text-[11px] tabular-nums",
              ativa ? "border-on-brand/20 text-on-brand/80" : "border-line text-muted",
            )}
          >
            <span className="flex min-w-0 flex-col">
              <span className={cn("truncate", ativa ? "" : "text-faint")}>economiza</span>
              <span className={cn("font-mono font-semibold", ativa ? "" : "text-ok")}>
                {fmtMoney(o.economia)}
              </span>
            </span>
            <span className="flex min-w-0 flex-col">
              <span className={cn("truncate", ativa ? "" : "text-faint")}>sai hoje</span>
              <span className={cn("font-mono font-semibold", ativa ? "" : "text-ink-2")}>
                +{fmtMoney(o.investimentoExtra)}
              </span>
            </span>
            <span className="flex min-w-0 flex-col">
              <span className={cn("truncate", ativa ? "" : "text-faint")}>estoque</span>
              <span className={cn("font-mono font-semibold", ativa ? "" : "text-ink-2")}>
                {o.coberturaTotalDias === null ? "—" : `${o.coberturaTotalDias} dias`}
              </span>
            </span>
          </span>
        )}
      </button>
    </li>
  );
}
