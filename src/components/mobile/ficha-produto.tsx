import {
  Boxes,
  CalendarClock,
  PackageOpen,
  Store,
  TriangleAlert,
} from "lucide-react";
import { brl, cn } from "@/lib/utils";
import { AcoesProduto, type AcaoInicial } from "@/components/mobile/acoes-produto";
import { Badge, Card } from "@/components/ui/misc";
import { NIVEL_COBERTURA_LABEL, type NivelCobertura } from "@/lib/estoque-estrategia";
import type { FichaProduto, LoteFicha } from "@/app/(mobile)/m/_produto-data";

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
      {ficha.embalagens.length > 0 && <Embalagens ficha={ficha} />}
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
              {e.fator.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}{" "}
              {ficha.unidadeBase.toLowerCase()}
            </strong>
            .
          </>
        )}{" "}
        Os saldos abaixo estão em unidades.
      </p>
    </div>
  );
}

function PrecoECusto({ ficha }: { ficha: FichaProduto }) {
  // Sem nenhuma das duas permissões o cartão inteiro sai — melhor que três
  // traços alinhados sem explicação.
  if (ficha.precoVenda == null && ficha.custoMedio == null) return null;

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
      {ficha.custoMedio != null && (
        <div className="flex-1 p-4">
          <p className="text-xs text-ink-2">Custo médio</p>
          <p className="font-display text-xl font-semibold text-ink">
            {brl(ficha.custoMedio)}
          </p>
          {ficha.margemPct != null && (
            <p
              className={cn(
                "mt-0.5 text-xs font-medium",
                ficha.margemPct < 0 ? "text-danger" : "text-ok",
              )}
            >
              margem {ficha.margemPct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
            </p>
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

function Estoque({ ficha }: { ficha: FichaProduto }) {
  const c = ficha.cobertura;
  const tom = c ? NIVEL_TOM[c.nivel] : null;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-end gap-4 p-4">
        <div>
          <p className="text-xs text-ink-2">Em estoque</p>
          <p className="font-display text-3xl leading-none font-semibold text-ink tabular-nums">
            {ficha.totalFechado.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}
          </p>
          <p className="mt-1 text-xs text-muted">{ficha.unidadeBase.toLowerCase()} fechadas</p>
        </div>

        {ficha.totalAberto > 0 && (
          <div>
            <p className="text-xs text-ink-2">Aberto</p>
            <p className="font-display text-xl leading-none font-semibold text-accent tabular-nums">
              {ficha.totalAberto.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}
            </p>
          </div>
        )}

        {c && tom && (
          <div className="ml-auto text-right">
            <Badge tone={tom.badge}>{NIVEL_COBERTURA_LABEL[c.nivel]}</Badge>
            <p className="mt-1 text-xs text-muted">dura {c.label}</p>
          </div>
        )}
      </div>

      {c && c.sugestao > 0 && (
        <p className="border-t border-line bg-surface-2 px-4 py-2 text-[13px] text-ink-2">
          Sugestão de compra:{" "}
          <strong className="font-semibold text-ink">
            {c.sugestao.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}{" "}
            {ficha.unidadeBase.toLowerCase()}
          </strong>
        </p>
      )}

      {/* Por loja só quando há mais de uma: numa loja só, repetiria o total. */}
      {ficha.saldos.length > 1 && (
        <div className="divide-y divide-line border-t border-line">
          {ficha.saldos.map((s) => (
            <div
              key={s.siteId ?? "global"}
              className="flex items-center gap-2 px-4 py-2 text-[13px]"
            >
              <Store className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-ink-2">{s.siteNome}</span>
              <span className="font-medium text-ink tabular-nums">
                {s.fechado.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}
              </span>
              {s.aberto > 0 && (
                <span className="text-accent tabular-nums">
                  +{s.aberto.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
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

function Embalagens({ ficha }: { ficha: FichaProduto }) {
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-1.5 font-display text-base font-semibold text-ink">
        <Boxes className="h-4 w-4 text-muted" aria-hidden />
        Embalagens
      </h2>
      <Card className="divide-y divide-line overflow-hidden">
        {ficha.embalagens.map((e) => (
          <div key={e.id} className="flex items-center gap-2 px-4 py-2.5 text-[13px]">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-ink">{e.nome}</p>
              {e.ean && <p className="font-mono text-xs text-muted">{e.ean}</p>}
            </div>
            <span className="text-ink-2 tabular-nums">
              {e.fator.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}{" "}
              {ficha.unidadeBase.toLowerCase()}
            </span>
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
