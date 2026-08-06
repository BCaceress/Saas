"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, Loader2, TriangleAlert, Wallet } from "lucide-react";
import { brl, cn } from "@/lib/utils";
import { Badge, Card } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import {
  TecladoNumerico,
  VisorQuantidade,
  paraNumero,
} from "@/components/mobile/teclado-numerico";
import { metodoLabel } from "@/lib/pagamento-labels";
import {
  abrirCaixaAction,
  movimentarCaixaAction,
  fecharCaixaAction,
} from "@/app/(app)/vendas/caixa/actions";
import type { CaixaInfo } from "@/components/app/caixa-sheet";

type Site = { id: string; nome: string };
type Painel = null | "sangria" | "suprimento" | "fechar" | "abrir";

export function CaixaClient({
  caixa,
  sites,
  limiteGaveta,
  podeSangria,
  podeFechar,
}: {
  caixa: CaixaInfo | null;
  sites: Site[];
  limiteGaveta: number | null;
  podeSangria: boolean;
  podeFechar: boolean;
}) {
  const [painel, setPainel] = React.useState<Painel>(null);

  if (!caixa) {
    return (
      <>
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-surface-2 text-muted">
            <Wallet className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <p className="font-display text-base font-semibold text-ink">
              Nenhum caixa aberto
            </p>
            <p className="mt-1 text-sm text-ink-2">
              Abra o caixa para começar a registrar vendas.
            </p>
          </div>
          <Button onClick={() => setPainel("abrir")}>Abrir caixa</Button>
        </Card>

        {painel === "abrir" && (
          <SheetAbrir sites={sites} onFechar={() => setPainel(null)} />
        )}
      </>
    );
  }

  const r = caixa.relatorio;
  const emGaveta = r ? r.esperadoDinheiro : caixa.valorAbertura;
  const estourouGaveta = limiteGaveta != null && emGaveta > limiteGaveta;

  return (
    <div className="space-y-3">
      <Card className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-ink-2">Esperado na gaveta</p>
            <p
              className={cn(
                "font-display text-3xl leading-none font-semibold",
                estourouGaveta ? "text-warn" : "text-ink",
              )}
            >
              {brl(emGaveta)}
            </p>
          </div>
          <Badge tone="ok">Aberto</Badge>
        </div>

        <p className="mt-2 text-xs text-muted">
          desde{" "}
          {caixa.abertaEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          {r && ` · ${r.numVendas} ${r.numVendas === 1 ? "venda" : "vendas"}`}
        </p>

        {estourouGaveta && (
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-warn-soft p-2.5 text-[13px] text-warn">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            Acima do limite de {brl(limiteGaveta)} definido para a gaveta. Considere uma
            sangria.
          </p>
        )}
      </Card>

      {r && (
        <Card className="divide-y divide-line overflow-hidden">
          <Linha label="Abertura" valor={r.valorAbertura} />
          {r.suprimentos > 0 && <Linha label="Suprimentos" valor={r.suprimentos} />}
          {r.sangrias > 0 && <Linha label="Sangrias" valor={-r.sangrias} />}
          <Linha label="Vendas em dinheiro" valor={r.vendasDinheiro} />
          {Object.entries(r.totalPorMetodo)
            .filter(([metodo]) => metodo !== "DINHEIRO")
            .map(([metodo, valor]) => (
              <Linha key={metodo} label={metodoLabel(metodo)} valor={valor} discreto />
            ))}
        </Card>
      )}

      <div className="grid grid-cols-2 gap-2">
        {podeSangria && (
          <>
            <Button variant="secondary" onClick={() => setPainel("sangria")} size="lg">
              <ArrowUpRight className="h-4 w-4" aria-hidden />
              Sangria
            </Button>
            <Button variant="secondary" onClick={() => setPainel("suprimento")} size="lg">
              <ArrowDownLeft className="h-4 w-4" aria-hidden />
              Suprimento
            </Button>
          </>
        )}
      </div>

      {podeFechar && (
        <Button onClick={() => setPainel("fechar")} className="w-full" size="lg">
          Fechar caixa
        </Button>
      )}

      {(painel === "sangria" || painel === "suprimento") && (
        <SheetMovimento
          sessaoId={caixa.id}
          tipo={painel === "sangria" ? "SANGRIA" : "SUPRIMENTO"}
          onFechar={() => setPainel(null)}
        />
      )}

      {painel === "fechar" && (
        <SheetFechar
          sessaoId={caixa.id}
          esperado={r?.esperadoDinheiro ?? caixa.valorAbertura}
          onFechar={() => setPainel(null)}
        />
      )}
    </div>
  );
}

function Linha({
  label,
  valor,
  discreto = false,
}: {
  label: string;
  valor: number;
  discreto?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 text-[13px]">
      <span className={discreto ? "text-muted" : "text-ink-2"}>{label}</span>
      <span
        className={cn(
          "font-medium tabular-nums",
          valor < 0 ? "text-danger" : discreto ? "text-muted" : "text-ink",
        )}
      >
        {brl(valor)}
      </span>
    </div>
  );
}

function SheetAbrir({ sites, onFechar }: { sites: Site[]; onFechar: () => void }) {
  const router = useRouter();
  const [valor, setValor] = React.useState("");
  const [site, setSite] = React.useState(sites[0]?.id ?? "");
  const [salvando, setSalvando] = React.useState(false);

  async function abrir() {
    setSalvando(true);
    try {
      await abrirCaixaAction({ siteId: site, valorAbertura: paraNumero(valor) });
      toast.success("Caixa aberto.");
      router.refresh();
      onFechar();
    } catch (e) {
      toast.error("Não foi possível abrir", e instanceof Error ? e.message : undefined);
      setSalvando(false);
    }
  }

  return (
    <BottomSheet
      open
      onClose={onFechar}
      titulo="Abrir caixa"
      descricao="Quanto tem na gaveta agora?"
      rodape={
        <Button onClick={abrir} disabled={salvando || !site} className="w-full" size="lg">
          {salvando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Abrir
        </Button>
      }
    >
      <div className="space-y-3 pb-2">
        {sites.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {sites.map((s) => (
              <Chip key={s.id} ativo={site === s.id} onClick={() => setSite(s.id)}>
                {s.nome}
              </Chip>
            ))}
          </div>
        )}
        <VisorQuantidade valor={valor} unidade="R$" />
        {/* Duas casas: dinheiro tem centavos, e três confundiria com quantidade. */}
        <TecladoNumerico valor={valor} onChange={setValor} decimais={2} />
      </div>
    </BottomSheet>
  );
}

function SheetMovimento({
  sessaoId,
  tipo,
  onFechar,
}: {
  sessaoId: string;
  tipo: "SANGRIA" | "SUPRIMENTO";
  onFechar: () => void;
}) {
  const router = useRouter();
  const [valor, setValor] = React.useState("");
  const [motivo, setMotivo] = React.useState("");
  const [salvando, setSalvando] = React.useState(false);

  const sugestoes =
    tipo === "SANGRIA"
      ? ["Retirada para cofre", "Depósito bancário", "Pagamento de despesa"]
      : ["Troco inicial", "Reforço de troco"];

  async function registrar() {
    setSalvando(true);
    try {
      await movimentarCaixaAction({
        cashSessionId: sessaoId,
        tipo,
        valor: paraNumero(valor),
        motivo,
      });
      toast.success(tipo === "SANGRIA" ? "Sangria registrada." : "Suprimento registrado.");
      router.refresh();
      onFechar();
    } catch (e) {
      toast.error("Não foi possível registrar", e instanceof Error ? e.message : undefined);
      setSalvando(false);
    }
  }

  return (
    <BottomSheet
      open
      onClose={onFechar}
      titulo={tipo === "SANGRIA" ? "Sangria" : "Suprimento"}
      descricao={
        tipo === "SANGRIA" ? "Tira dinheiro da gaveta." : "Coloca dinheiro na gaveta."
      }
      rodape={
        <Button
          onClick={registrar}
          disabled={salvando || paraNumero(valor) <= 0 || motivo.trim().length < 2}
          className="w-full"
          size="lg"
        >
          {salvando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Registrar
        </Button>
      }
    >
      <div className="space-y-3 pb-2">
        <VisorQuantidade valor={valor} unidade="R$" />
        <TecladoNumerico valor={valor} onChange={setValor} decimais={2} />
        <div className="flex flex-wrap gap-1.5">
          {sugestoes.map((s) => (
            <Chip key={s} ativo={motivo === s} onClick={() => setMotivo(motivo === s ? "" : s)}>
              {s}
            </Chip>
          ))}
        </div>
        <input
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Motivo"
          aria-label="Motivo"
          className="min-h-11 w-full rounded-full border border-line-button bg-surface px-4 text-sm text-ink placeholder:text-faint focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        />
      </div>
    </BottomSheet>
  );
}

/**
 * Fechamento com contagem cega: o esperado só aparece DEPOIS de a pessoa
 * digitar o que contou. Mostrar antes transformaria a conferência em cópia.
 */
function SheetFechar({
  sessaoId,
  esperado,
  onFechar,
}: {
  sessaoId: string;
  esperado: number;
  onFechar: () => void;
}) {
  const router = useRouter();
  const [valor, setValor] = React.useState("");
  const [revelou, setRevelou] = React.useState(false);
  const [salvando, setSalvando] = React.useState(false);

  const contado = paraNumero(valor);
  const quebra = contado - esperado;

  async function fechar() {
    setSalvando(true);
    try {
      await fecharCaixaAction({ cashSessionId: sessaoId, valorFechamento: contado });
      toast.success("Caixa fechado.", `Quebra de ${brl(quebra)}.`);
      router.refresh();
      onFechar();
    } catch (e) {
      toast.error("Não foi possível fechar", e instanceof Error ? e.message : undefined);
      setSalvando(false);
    }
  }

  return (
    <BottomSheet
      open
      onClose={onFechar}
      titulo="Fechar caixa"
      descricao="Conte o dinheiro da gaveta e informe o total."
      rodape={
        revelou ? (
          <Button onClick={fechar} disabled={salvando} className="w-full" size="lg">
            {salvando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Confirmar fechamento
          </Button>
        ) : (
          <Button
            onClick={() => setRevelou(true)}
            disabled={valor === ""}
            className="w-full"
            size="lg"
          >
            Conferir
          </Button>
        )
      }
    >
      <div className="space-y-3 pb-2">
        <VisorQuantidade valor={valor} unidade="R$" />

        {revelou ? (
          <div className="rounded-xl border border-line bg-surface-2 p-4 text-center">
            <p className="text-xs text-ink-2">Esperado</p>
            <p className="font-display text-xl font-semibold text-ink">{brl(esperado)}</p>
            <p
              className={cn(
                "mt-2 text-sm font-medium",
                Math.abs(quebra) < 0.01
                  ? "text-ok"
                  : quebra < 0
                    ? "text-danger"
                    : "text-warn",
              )}
            >
              {Math.abs(quebra) < 0.01
                ? "Bateu certinho."
                : quebra < 0
                  ? `Faltam ${brl(Math.abs(quebra))}`
                  : `Sobram ${brl(quebra)}`}
            </p>
          </div>
        ) : (
          <TecladoNumerico valor={valor} onChange={setValor} decimais={2} />
        )}
      </div>
    </BottomSheet>
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
