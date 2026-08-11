import {
  Box,
  Boxes,
  CalendarClock,
  PackageOpen,
  Refrigerator,
  Snowflake,
  Store,
  TrendingUp,
  TriangleAlert,
  Warehouse,
} from "lucide-react";
import { brl, cn } from "@/lib/utils";
import { AcoesProduto, type AcaoInicial } from "@/components/mobile/acoes-produto";
import { BotaoCopiar } from "@/components/mobile/copiar";
import { AbertaBadge, SaldoUn } from "@/components/mobile/saldo-unidades";
import { Badge, Card } from "@/components/ui/misc";
import type { NivelCobertura, TipoControleEstoque } from "@/lib/estoque-estrategia";
import type { FichaProduto, LoteFicha, TipoLocal } from "@/app/(mobile)/m/_produto-data";

/**
 * Ficha do produto no celular — a tela mais aberta da superfície mobile.
 *
 * Ordem pensada para quem está de pé na gôndola: primeiro o que identifica
 * (nome, marca, SKU), depois preço, depois saldo e cobertura, e só então
 * validade e embalagens. Custo e margem só aparecem para quem tem permissão —
 * o servidor já entrega null, aqui não há o que esconder.
 */

const NIVEL_TOM: Record<NivelCobertura, { badge: "danger" | "warn" | "ok" | "neutral"; barra: string }> = {
  "muito-baixo": { badge: "danger", barra: "bg-danger" },
  atencao: { badge: "warn", barra: "bg-warn" },
  ideal: { badge: "ok", barra: "bg-ok" },
  "sem-giro": { badge: "neutral", barra: "bg-muted" },
};

/**
 * Nome curto da estratégia de reposição da empresa. Os rótulos longos de
 * `CONTROLE_LABELS` são de tela de configuração — num selo de canto de cartão
 * "Controle por rotatividade" quebra em três linhas.
 */
const ESTRATEGIA_CURTA: Record<TipoControleEstoque, string> = {
  MINIMO: "Mínimo",
  MINIMO_IDEAL: "Mínimo + ideal",
  ROTATIVIDADE: "Em giro",
};

const un = (v: number) =>
  `${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} un`;

/** Mesmos ícones e cores dos locais de armazenagem na tela de computador. */
const LOCAL_ICONE: Record<TipoLocal, typeof Box> = {
  AMBIENTE: Box,
  REFRIGERADO: Refrigerator,
  CONGELADO: Snowflake,
};
const LOCAL_COR: Record<TipoLocal, string> = {
  AMBIENTE: "text-brand",
  REFRIGERADO: "text-ok",
  CONGELADO: "text-blue-500",
};

const STATUS_LOTE: Record<LoteFicha["status"], { tom: "danger" | "warn" | "ok" | "neutral"; label: string }> = {
  vencido: { tom: "danger", label: "Vencido" },
  vencendo: { tom: "warn", label: "Vencendo" },
  ok: { tom: "ok", label: "No prazo" },
  "sem-validade": { tom: "neutral", label: "Sem validade" },
};

export function FichaProdutoView({ ficha }: { ficha: FichaProduto }) {
  return (
    <div className="space-y-3">
      <Identificacao ficha={ficha} />
      {ficha.embalagemCasada && <AvisoEmbalagem ficha={ficha} />}
      <PrecoECusto ficha={ficha} />
      {ficha.controlaEstoque ? <Estoque ficha={ficha} /> : <SemControle />}
      {ficha.lotes.length > 0 && <Lotes lotes={ficha.lotes} />}
      <Embalagens ficha={ficha} />
      <VendaRecente ficha={ficha} />
    </div>
  );
}

function Identificacao({ ficha }: { ficha: FichaProduto }) {
  return (
    <Card className="flex gap-3 p-4">
      {ficha.imagemUrl ? (
        /* <img> cru, como no resto do app (produtos/_form, estoque/validade):
           a URL é arbitrária — Cosmos ou upload do tenant — e next/image
           exigiria allowlist por host em remotePatterns. */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={ficha.imagemUrl}
          alt=""
          className="h-16 w-16 shrink-0 rounded-lg border border-line object-contain"
        />
      ) : (
        <span className="grid h-16 w-16 shrink-0 place-items-center rounded-lg border border-line bg-surface-2 text-muted">
          <PackageOpen className="h-6 w-6" aria-hidden />
        </span>
      )}

      <div className="min-w-0 flex-1">
        <p className="font-display leading-tight font-semibold text-ink">{ficha.nome}</p>
        <p className="mt-0.5 text-xs text-ink-2">
          {[ficha.marca, ficha.categoria].filter(Boolean).join(" · ") || "Sem marca"}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {/* SKU em mono: é código, se lê caractere a caractere. */}
          <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-2">
            {ficha.sku}
          </span>
          {ficha.ean && (
            <span className="font-mono text-[11px] text-muted">{ficha.ean}</span>
          )}
          {!ficha.ativo && <Badge tone="warn">Inativo</Badge>}
        </div>
      </div>
    </Card>
  );
}

/** Bipou o fardo, não a unidade — o número na tela é em unidades. */
function AvisoEmbalagem({ ficha }: { ficha: FichaProduto }) {
  const e = ficha.embalagemCasada!;
  return (
    <div className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-line bg-accent-soft p-3">
      <Boxes className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
      <p className="text-[13px] text-ink">
        Você leu o código de <strong className="font-semibold">{e.nome.toLowerCase()}</strong>.
        {e.fator > 0 && (
          <>
            {" "}
            1 {e.nome.toLowerCase()} ={" "}
            <strong className="font-semibold">
              {e.fator.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} un
            </strong>
            .
          </>
        )}{" "}
        Os saldos abaixo estão em unidades.
      </p>
    </div>
  );
}

/**
 * Venda · custo · margem, lado a lado.
 *
 * Os três juntos porque a pergunta na gôndola é sempre a mesma — "dá para
 * baixar esse preço?" — e ela não se responde com dois dos três.
 *
 * O custo aqui é o PREÇO DE CUSTO do cadastro, não o custo médio: é o número
 * que o operador negocia com o fornecedor e reconhece de cabeça. Sem preço de
 * custo cadastrado, a coluna (e a margem) simplesmente não aparece.
 */
function PrecoECusto({ ficha }: { ficha: FichaProduto }) {
  const custo = ficha.custo;
  // Sem nenhuma das duas permissões o cartão inteiro sai — melhor que três
  // traços alinhados sem explicação.
  if (ficha.precoVenda == null && custo == null) return null;

  return (
    <Card className="flex divide-x divide-line">
      {ficha.precoVenda != null && (
        <div className="flex-1 p-4">
          <p className="text-xs text-ink-2">Preço de venda</p>
          <p className="font-display text-xl font-semibold text-ink">
            {brl(ficha.precoVenda)}
          </p>
        </div>
      )}
      {custo != null && (
        <div className="flex-1 p-4">
          <p className="text-xs text-ink-2">Preço de custo</p>
          <p className="font-display text-xl font-semibold text-ink">{brl(custo)}</p>
        </div>
      )}
      {ficha.margemPct != null && (
        <div className="flex-1 p-4">
          <p className="text-xs text-ink-2">Margem</p>
          <p
            className={cn(
              "font-display text-xl font-semibold",
              ficha.margemPct < 0 ? "text-danger" : "text-ok",
            )}
          >
            {ficha.margemPct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
          </p>
          {ficha.precoVenda != null && custo != null && (
            <p className="mt-0.5 text-xs text-muted">{brl(ficha.precoVenda - custo)} por un</p>
          )}
        </div>
      )}
    </Card>
  );
}

function SemControle() {
  return (
    <Card className="flex items-center gap-2 p-4 text-[13px] text-ink-2">
      <TriangleAlert className="h-4 w-4 shrink-0 text-muted" aria-hidden />
      Este item não controla estoque.
    </Card>
  );
}

/**
 * Saldo em UNIDADES — nunca em ml/g.
 *
 * `unidadeBase` descreve o conteúdo da embalagem (uma garrafa de 1000 ml), não
 * a contagem: `estoqueFechado` é sempre "quantas embalagens". A sobra da que
 * está aberta entra como sinal (`SaldoUn`), não como número somável.
 *
 * O canto direito mostra a meta que a empresa DE FATO usa: mínimo, mínimo +
 * ideal ou giro (ver `lib/estoque-estrategia`). Mostrar "ideal" para quem
 * trabalha só com piso é inventar meta que ninguém definiu. Cada linha de baixo
 * é uma loja: onde o produto está guardado e quanto tem ali.
 */
function Estoque({ ficha }: { ficha: FichaProduto }) {
  const c = ficha.cobertura;
  const tom = c ? NIVEL_TOM[c.nivel] : null;
  const e = ficha.estrategia;

  // Metas do produto inteiro: a meta por loja continua existindo, mas o topo do
  // cartão fala do total — é ele que está no número grande ao lado.
  const totalMinimo = ficha.saldos.reduce((a, s) => a + s.minimo, 0);
  const totalIdeal = ficha.saldos.reduce((a, s) => a + s.ideal, 0);

  // O "informativo" da estratégia: por giro, quantos dias a compra cobre; por
  // meta fixa, o piso (e o ideal, quando a empresa usa os dois).
  const informativo = e.usaGiro
    ? [
        `cobre ${e.diasCobertura} ${e.diasCobertura === 1 ? "dia" : "dias"}`,
        c ? `dura ${c.label}` : null,
      ]
    : [
        e.usaMinimo ? `mínimo ${un(totalMinimo)}` : null,
        e.usaIdeal ? `ideal ${un(totalIdeal)}` : null,
        c ? `dura ${c.label}` : null,
      ];

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start gap-4 p-4">
        <div className="min-w-0">
          <p className="text-xs text-ink-2">Em estoque</p>
          <p className="font-display text-3xl leading-none font-semibold text-ink tabular-nums">
            {ficha.totalFechado.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}
            <span className="ml-1 text-base font-normal text-muted">un</span>
          </p>
          {ficha.totalAberto > 0 && (
            <p className="mt-1.5">
              <AbertaBadge />
            </p>
          )}
        </div>

        {/* Selo com a estratégia que ESTA empresa usa, na cor do nível de
            cobertura: em uma olhada, "como eu reponho" e "estou bem?". */}
        <div className="ml-auto min-w-0 text-right">
          <Badge tone={tom?.badge ?? "neutral"}>{ESTRATEGIA_CURTA[e.tipo]}</Badge>
          <p className="mt-1 text-xs text-muted">
            {informativo.filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>

      {c && c.sugestao > 0 && (
        <p className="border-t border-line bg-surface-2 px-4 py-2 text-[13px] text-ink-2">
          Sugestão de compra:{" "}
          <strong className="font-semibold text-ink">{un(c.sugestao)}</strong>
        </p>
      )}

      {/* Uma linha por loja, mesmo com loja única: é onde mora o local de
          guarda, que o total não tem como mostrar. Tudo em UMA linha — loja,
          local e saldo — porque a leitura é horizontal: "onde e quanto". */}
      <div className="divide-y divide-line border-t border-line">
        {ficha.saldos.map((s) => (
          <div
            key={s.siteId ?? "global"}
            className="flex items-center gap-2 px-4 py-2.5 text-[13px]"
          >
            <Store className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
            <span className="min-w-0 shrink truncate text-ink-2">{s.siteNome}</span>
            <span className="shrink-0 text-faint">·</span>
            <Local nome={s.localNome} tipo={s.localTipo} />
            <span className="ml-auto shrink-0">
              <SaldoUn fechado={s.fechado} aberto={s.aberto} tom="text-ink" />
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/**
 * Giro recente em uma frase — o contraponto do saldo: "sai, ou está parado?"
 *
 * A média por dia sai destes mesmos 30 dias, e não de `cobertura.mediaDia`: lá
 * a janela é a da estratégia da empresa (pode ser 15 ou 90 dias), e dois números
 * com bases diferentes na mesma frase é convite a conta errada.
 */
function VendaRecente({ ficha }: { ficha: FichaProduto }) {
  const q = ficha.vendidos30d;
  const porDia = q / 30;
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-brand">
        <TrendingUp className="h-4 w-4" aria-hidden />
      </span>
      <p className="text-[13px] text-ink-2">
        {q > 0 ? (
          <>
            <strong className="font-semibold text-ink">{un(q)}</strong> vendidas nos
            últimos 30 dias ·{" "}
            {porDia.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} por dia
          </>
        ) : (
          "Nenhuma unidade vendida nos últimos 30 dias."
        )}
      </p>
    </Card>
  );
}

/** Onde o produto fica guardado — ícone do tipo, como em /estoque no computador. */
function Local({ nome, tipo }: { nome: string | null; tipo: TipoLocal | null }) {
  if (!nome) return <span className="shrink-0 text-xs text-faint">sem local</span>;
  const Icone = tipo ? LOCAL_ICONE[tipo] : Warehouse;
  return (
    <span className="flex min-w-0 shrink items-center gap-1 text-muted">
      <Icone
        className={cn("h-3.5 w-3.5 shrink-0", tipo ? LOCAL_COR[tipo] : "text-faint")}
        aria-hidden
      />
      <span className="truncate">{nome}</span>
    </span>
  );
}

function Lotes({ lotes }: { lotes: LoteFicha[] }) {
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-1.5 font-display text-base font-semibold text-ink">
        <CalendarClock className="h-4 w-4 text-muted" aria-hidden />
        Validade
      </h2>
      <Card className="divide-y divide-line overflow-hidden">
        {lotes.map((l) => {
          const s = STATUS_LOTE[l.status];
          return (
            <div key={l.id} className="flex items-center gap-2 px-4 py-2.5 text-[13px]">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-ink">
                  {l.validade
                    ? new Date(l.validade).toLocaleDateString("pt-BR")
                    : "Sem validade"}
                </p>
                <p className="truncate text-xs text-muted">
                  {l.lote ? `lote ${l.lote}` : "sem lote"}
                  {l.diasParaVencer != null &&
                    (l.diasParaVencer < 0
                      ? ` · venceu há ${Math.abs(l.diasParaVencer)} d`
                      : ` · faltam ${l.diasParaVencer} d`)}
                </p>
              </div>
              <span className="font-medium text-ink tabular-nums">
                {l.quantidade.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}
              </span>
              <Badge tone={s.tom}>{s.label}</Badge>
            </div>
          );
        })}
      </Card>
      <p className="px-1 text-xs text-muted">
        Ordenado por vencimento — o primeiro da lista é o primeiro a sair.
      </p>
    </section>
  );
}

/**
 * Embalagens em que este produto entra e sai, da unidade para cima.
 *
 * Uma linha só por embalagem — "Unidade · 1 un" à esquerda, o código de barras
 * e o botão de copiar à direita. O código fica encostado no botão de propósito:
 * ler treze dígitos da tela para digitar em outro lugar é onde nasce o erro, e
 * o botão elimina a digitação.
 *
 * Some inteira quando não há nada além da unidade: uma tabela de conversão de
 * uma linha só ("1 unidade = 1 unidade") não informa nada.
 */
function Embalagens({ ficha }: { ficha: FichaProduto }) {
  const linhas = [
    { id: "unidade", nome: "Unidade", ean: ficha.ean, fator: 1 },
    ...ficha.embalagens.filter((e) => e.fator > 1),
  ];
  if (linhas.length < 2) return null;

  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-1.5 font-display text-base font-semibold text-ink">
        <Boxes className="h-4 w-4 text-muted" aria-hidden />
        Embalagens
      </h2>
      <Card className="divide-y divide-line overflow-hidden">
        {linhas.map((e) => (
          <div key={e.id} className="flex items-center gap-2 py-1.5 pr-2 pl-4 text-[13px]">
            <span className="shrink-0 font-medium text-ink">{e.nome}</span>
            <span className="shrink-0 text-ink-2 tabular-nums">{un(e.fator)}</span>
            {e.ean ? (
              <>
                <span className="ml-auto truncate font-mono text-xs text-muted">
                  {e.ean}
                </span>
                <BotaoCopiar valor={e.ean} rotulo={`código de barras de ${e.nome.toLowerCase()}`} />
              </>
            ) : (
              <span className="ml-auto pr-2 text-xs text-faint">sem código de barras</span>
            )}
          </div>
        ))}
      </Card>
    </section>
  );
}

/**
 * Rodapé de ações da ficha.
 *
 * Fica aqui como reexport para que quem já renderiza a ficha não precise saber
 * que agora existe um grafo de client components por trás (sheets, teclado,
 * fila de etiquetas). Quem tem a ficha em mãos continua escrevendo
 * `<FichaProdutoView />` + `<AcoesFicha />`.
 */
export function AcoesFicha({
  ficha,
  inicial,
  onAtualizar,
}: {
  ficha: FichaProduto;
  inicial?: AcaoInicial | null;
  onAtualizar?: () => void;
}) {
  return <AcoesProduto ficha={ficha} inicial={inicial} onAtualizar={onAtualizar} />;
}
