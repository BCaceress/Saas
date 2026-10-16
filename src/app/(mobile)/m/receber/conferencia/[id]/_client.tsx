"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarClock,
  Check,
  CheckCheck,
  Gift,
  Link2,
  Loader2,
  Monitor,
  PackageOpen,
  ScanLine,
  Search,
  TriangleAlert,
  X,
} from "lucide-react";
import { brl, cn } from "@/lib/utils";
import { Badge, Card } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { Scanner } from "@/components/mobile/scanner";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import {
  TecladoNumerico,
  VisorQuantidade,
  paraNumero,
} from "@/components/mobile/teclado-numerico";
import {
  avisoDeValidade,
  esperadoDaLinha,
  faltaDaConferencia,
  validadeMaisCurta,
} from "@/lib/compras/recebimento-regras";
import { siglaDeExibicao } from "@/lib/fiscal/unidades";
import {
  conferirItemAction,
  conferirTudoAction,
  finalizarRecebimentoAction,
  somarContagemAction,
} from "@/app/(app)/recebimento/conferencia-actions";
import type { LinhaRecebimento, RecebimentoView } from "@/app/(app)/recebimento/_data";

// ============================================================
// Conferência de um recebimento no celular.
//
// As mesmas regras do computador (`recebimento-regras`): o esperado da nota,
// o que entra quando ninguém conta, a falta que se abate do título. O que
// muda é o gesto: cartão grande, teclado de 56px e o leitor somando no
// servidor — dois celulares bipando a mesma carga não apagam a caixa um do
// outro.
// ============================================================

const UN = "UN";
const inteiro = (n: number) => Math.abs(n - Math.round(n)) < 1e-6;
const fmt = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
const nomeDe = (l: LinhaRecebimento) => l.produtoNome ?? l.descricao;
/** O que entra se a entrada for confirmada agora: o contado, ou o esperado. */
const entrando = (l: LinhaRecebimento) => l.qtdRecebida ?? esperadoDaLinha(l);

/**
 * A embalagem em que a nota faturou, quando dá para contar nela — a mesma
 * régua do computador: quem tem a caixa fechada na frente conta caixa.
 */
function embalagemDaNota(l: LinhaRecebimento): { fator: number; sigla: string } | null {
  const f = l.xml?.fatorConversao ?? 1;
  if (!l.xml || f <= 1 || !inteiro(f) || !inteiro(esperadoDaLinha(l) / f)) return null;
  return { fator: f, sigla: siglaDeExibicao(l.xml.unidade) };
}

/** "2 CX" quando fecha em caixas; senão, em unidades. */
function medida(qtd: number, l: LinhaRecebimento): { n: string; sigla: string } {
  const emb = embalagemDaNota(l);
  return emb && inteiro(qtd / emb.fator)
    ? { n: fmt(qtd / emb.fator), sigla: emb.sigla }
    : { n: fmt(qtd), sigla: UN };
}
const textoDe = (qtd: number, l: LinhaRecebimento) => {
  const m = medida(qtd, l);
  return `${m.n} ${m.sigla}`;
};

type Filtro = "TODOS" | "FALTA" | "DIFERENCA";

export function ConferenciaMobile({
  dados,
  podeReceber,
  cega,
  validadeAlertaDias,
  hoje,
}: {
  dados: RecebimentoView;
  podeReceber: boolean;
  cega: boolean;
  validadeAlertaDias: number;
  /** "Hoje" no fuso da loja (AAAA-MM-DD), decidido no servidor. */
  hoje: string;
}) {
  const router = useRouter();
  const { recebimento, nota, pedido } = dados;
  const finalizado = recebimento.status === "FINALIZADO";
  const cancelado = recebimento.status === "CANCELADO";
  const encerrada = finalizado || cancelado || !podeReceber;
  /** Avulso puro: sem nota e sem pedido, não há "esperado" contra o que divergir. */
  const temPapel = Boolean(nota || pedido);

  // Cópia local para o número responder na hora; o servidor é a verdade e o
  // refresh reconcilia (ajuste durante o render, como no computador).
  const [linhas, setLinhas] = React.useState(dados.linhas);
  const [ultimoServidor, setUltimoServidor] = React.useState(dados.linhas);
  if (ultimoServidor !== dados.linhas) {
    setUltimoServidor(dados.linhas);
    setLinhas(dados.linhas);
  }
  // O leitor chama a função de fora do ciclo de render: ele precisa do número
  // de AGORA, não do que estava na tela quando a câmera abriu.
  const linhasRef = React.useRef(linhas);
  React.useEffect(() => {
    linhasRef.current = linhas;
  }, [linhas]);

  const [busca, setBusca] = React.useState("");
  const [filtro, setFiltro] = React.useState<Filtro>("TODOS");
  const [camera, setCamera] = React.useState(false);
  const [alvoId, setAlvoId] = React.useState<string | null>(null);
  const [tudo, setTudo] = React.useState(false);
  const [confirmando, setConfirmando] = React.useState(false);
  const [enviando, setEnviando] = React.useState(false);
  const [motivo, setMotivo] = React.useState("");
  /** Abater do título o que a nota cobra e não chegou — ligado, como no computador. */
  const [abaterFalta, setAbaterFalta] = React.useState(true);
  /** Gravações a caminho do servidor: receber espera a última. */
  const [gravando, setGravando] = React.useState(0);
  const bipesRef = React.useRef<Record<string, number>>({});

  const alvo = alvoId ? (linhas.find((l) => l.id === alvoId) ?? null) : null;

  const definirLocal = React.useCallback((id: string, qtd: number | null) => {
    linhasRef.current = linhasRef.current.map((l) => (l.id === id ? { ...l, qtdRecebida: qtd } : l));
    setLinhas((prev) => prev.map((l) => (l.id === id ? { ...l, qtdRecebida: qtd } : l)));
  }, []);

  async function gravar(l: LinhaRecebimento, qtd: number) {
    definirLocal(l.id, qtd);
    setAlvoId(null);
    setGravando((n) => n + 1);
    try {
      await conferirItemAction({ receiptId: recebimento.id, itemId: l.id, qtdRecebida: qtd });
    } catch (e) {
      toast.error("Não deu para salvar", e instanceof Error ? e.message : "Tente de novo.");
      router.refresh();
    } finally {
      setGravando((n) => n - 1);
    }
  }

  /**
   * O bipe SOMA no servidor. A tela soma na hora; quando a última resposta da
   * linha chega, o total do servidor manda — ele inclui o que o outro celular
   * bipou na mesma carga.
   */
  const somar = React.useCallback(
    async (linhaId: string, incremento: number) => {
      bipesRef.current[linhaId] = (bipesRef.current[linhaId] ?? 0) + 1;
      setGravando((n) => n + 1);
      try {
        const total = await somarContagemAction({
          receiptId: recebimento.id,
          itemId: linhaId,
          incremento,
        });
        bipesRef.current[linhaId] -= 1;
        if (bipesRef.current[linhaId] === 0) definirLocal(linhaId, total);
      } catch (e) {
        bipesRef.current[linhaId] = 0;
        toast.error("Não deu para somar o bipe", e instanceof Error ? e.message : "Tente de novo.");
        router.refresh();
      } finally {
        setGravando((n) => n - 1);
      }
    },
    [recebimento.id, definirLocal, router],
  );

  // Código → linha, com o fator de cada embalagem: bipar a caixa soma 12,
  // bipar a unidade soma 1.
  const porCodigo = React.useMemo(() => {
    const mapa = new Map<string, { id: string; incremento: number }>();
    for (const l of dados.linhas) {
      if (l.ean) mapa.set(l.ean, { id: l.id, incremento: 1 });
      if (l.sku) mapa.set(l.sku.toLowerCase(), { id: l.id, incremento: 1 });
      for (const e of l.embalagens) {
        if (e.ean) mapa.set(e.ean, { id: l.id, incremento: e.fator });
      }
    }
    return mapa;
  }, [dados.linhas]);

  const aoLerCodigo = React.useCallback(
    (codigo: string) => {
      if (encerrada) return;
      const achado = porCodigo.get(codigo) ?? porCodigo.get(codigo.toLowerCase());
      const linha = achado ? linhasRef.current.find((l) => l.id === achado.id) : null;
      if (!achado || !linha) {
        toast.error(
          "Fora deste recebimento",
          `${codigo} não está nesta conferência. Item a mais se lança no computador.`,
        );
        return;
      }
      const nova = (linha.qtdRecebida ?? 0) + achado.incremento;
      definirLocal(linha.id, nova);
      void somar(linha.id, achado.incremento);
      toast.success(
        nomeDe(linha),
        cega
          ? `${textoDe(nova, linha)} contado(s)`
          : `${textoDe(nova, linha)} de ${textoDe(esperadoDaLinha(linha), linha)}`,
      );
    },
    [encerrada, porCodigo, definirLocal, somar, cega],
  );

  async function conferirTudo() {
    setEnviando(true);
    try {
      const n = await conferirTudoAction(recebimento.id);
      setLinhas((prev) =>
        prev.map((l) => (l.qtdRecebida == null ? { ...l, qtdRecebida: esperadoDaLinha(l) } : l)),
      );
      toast.success(
        n === 1 ? "1 item marcado como está no papel." : `${n} itens marcados como estão no papel.`,
        "Os já contados ficaram como estavam.",
      );
      setTudo(false);
      router.refresh();
    } catch (e) {
      toast.error("Não deu para confirmar", e instanceof Error ? e.message : "Tente de novo.");
    } finally {
      setEnviando(false);
    }
  }

  // ── O que a entrada faria agora ─────────────────────────────
  const conferidos = linhas.filter((l) => l.qtdRecebida != null).length;
  const naoContadas = linhas.filter((l) => l.qtdRecebida == null);
  const diverge = (l: LinhaRecebimento) =>
    temPapel &&
    !l.avulsa &&
    l.qtdRecebida != null &&
    Math.abs(l.qtdRecebida - esperadoDaLinha(l)) > 0.001;
  const comDiferenca = linhas.filter(diverge).length;
  const itensEntrando = linhas.filter((l) => entrando(l) > 0);
  const unidadesEntrando = itensEntrando.reduce((s, l) => s + entrando(l), 0);
  const semProduto = itensEntrando.filter((l) => !l.productId).length;
  const impedimento =
    semProduto > 0
      ? `${semProduto} ${semProduto === 1 ? "item ainda não tem" : "itens ainda não têm"} produto relacionado — relacione no computador antes de receber.`
      : linhas.length > 0 && itensEntrando.length === 0
        ? "Nenhum item foi recebido — nada a dar entrada."
        : null;
  // A mesma régua do servidor: contado diferente do esperado e sem explicação.
  const naoExplicadas = !temPapel
    ? []
    : linhas.filter(
        (l) =>
          !l.motivoDivergencia &&
          l.resolucao !== "ACEITO" &&
          l.resolucao !== "IGNORADO" &&
          Math.abs(entrando(l) - esperadoDaLinha(l)) > 0.001,
      );
  const falta = faltaDaConferencia(linhas);
  const vaiAbater = Boolean(nota) && falta.valor > 0.005 && abaterFalta;
  const vencidos = itensEntrando.filter(
    (l) =>
      avisoDeValidade(validadeMaisCurta(l.validade, l.lotes), hoje, validadeAlertaDias)?.tipo ===
      "VENCIDO",
  ).length;

  async function receber() {
    setEnviando(true);
    try {
      const r = await finalizarRecebimentoAction({
        receiptId: recebimento.id,
        motivoDivergencia: motivo.trim() || null,
        abaterFalta: vaiAbater,
      });
      toast.success(
        `Recebimento ${r.numero} finalizado.`,
        "Estoque e custo atualizados." +
          (r.faltaAbatida > 0 ? ` ${brl(r.faltaAbatida)} de falta abatidos do título.` : ""),
      );
      router.push("/m/receber");
      router.refresh();
    } catch (e) {
      toast.error("Não foi possível receber", e instanceof Error ? e.message : "Tente de novo.");
      setEnviando(false);
    }
  }

  // Na ordem da nota, como o papel na mão de quem confere.
  const termo = busca.trim().toLowerCase();
  const lista = linhas.filter((l) => {
    if (filtro === "FALTA" && l.qtdRecebida != null) return false;
    if (filtro === "DIFERENCA" && !diverge(l)) return false;
    if (!termo) return true;
    return `${l.descricao} ${l.produtoNome ?? ""} ${l.sku ?? ""} ${l.ean ?? ""} ${l.codigoFornecedor ?? ""}`
      .toLowerCase()
      .includes(termo);
  });

  const linkComputador = `/recebimento/${recebimento.id}`;
  /** "Recebi tudo" antes da primeira contagem; depois, "o resto". */
  const atalhoTudo = `Recebi ${conferidos === 0 ? "tudo" : "o resto"} conforme ${nota ? "a nota" : "o pedido"}`;

  return (
    <div className={cn("space-y-3", !encerrada && "pb-24")}>
      {camera && (
        <Scanner
          onCodigo={aoLerCodigo}
          continuo
          onFechar={() => setCamera(false)}
          dica="Bipe a unidade, a caixa ou o fardo"
        />
      )}

      {encerrada && (
        <Card className="space-y-2 p-4 text-[13px] text-ink-2">
          <p>
            {finalizado
              ? "Recebimento concluído — a mercadoria já está no estoque."
              : cancelado
                ? "Recebimento cancelado — nada entrou no estoque."
                : "Você acompanha esta conferência. Quem recebe nesta loja é quem conta e dá a entrada."}
          </p>
          <Link
            href={linkComputador}
            className="inline-flex items-center gap-1.5 font-medium text-brand-strong underline-offset-2 hover:underline"
          >
            <Monitor className="h-4 w-4" aria-hidden />
            Abrir no computador
          </Link>
        </Card>
      )}

      {linhas.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-8 text-center">
          <PackageOpen className="h-8 w-8 text-muted" aria-hidden />
          <p className="font-display text-base font-semibold text-ink">Nada para contar ainda</p>
          <p className="text-sm text-ink-2">
            {nota
              ? "A conferência desta nota ainda não foi montada. Escolha como receber no computador."
              : "Este recebimento não tem itens. Adicione o que chegou pelo computador."}
          </p>
          <Link href={linkComputador} className="mt-1 text-sm font-medium text-brand-strong underline">
            Abrir no computador
          </Link>
        </Card>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-faint"
                aria-hidden
              />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Achar por nome ou código"
                aria-label="Buscar item do recebimento"
                className="min-h-11 w-full rounded-full border border-line-button bg-surface pr-4 pl-9 text-sm text-ink placeholder:text-faint focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              />
            </div>
            {!encerrada && (
              <button
                type="button"
                onClick={() => setCamera((v) => !v)}
                aria-pressed={camera}
                aria-label={camera ? "Fechar o leitor" : "Ler código de barras"}
                className={cn(
                  "tap grid h-11 w-11 shrink-0 place-items-center rounded-full border transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none",
                  camera ? "border-brand bg-brand text-on-brand" : "border-line-button bg-surface text-ink",
                )}
              >
                <ScanLine className="h-5 w-5" aria-hidden />
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar itens">
            {(
              [
                ["TODOS", "Todos", linhas.length],
                ["FALTA", "A conferir", naoContadas.length],
                ...(temPapel ? ([["DIFERENCA", "Com diferença", comDiferenca]] as const) : []),
              ] as const
            ).map(([chave, rotulo, total]) => (
              <button
                key={chave}
                type="button"
                aria-pressed={filtro === chave}
                onClick={() => setFiltro(chave)}
                className={cn(
                  "tap inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none",
                  filtro === chave
                    ? "border-brand bg-brand-soft text-ink"
                    : "border-line-button bg-surface text-ink-2",
                )}
              >
                {rotulo}
                <span className="font-mono text-[12px] text-muted">{total}</span>
              </button>
            ))}
          </div>

          {!encerrada && !cega && naoContadas.length > 0 && (
            <Button variant="secondary" onClick={() => setTudo(true)} className="w-full">
              <CheckCheck className="h-4 w-4" aria-hidden />
              {atalhoTudo}
            </Button>
          )}

          <ul className="space-y-1.5">
            {lista.map((l) => (
              <li key={l.id}>
                <CartaoLinha
                  linha={l}
                  cega={cega}
                  semEsperado={l.avulsa && !temPapel}
                  diverge={diverge(l)}
                  bloqueado={encerrada}
                  onAbrir={() => setAlvoId(l.id)}
                />
              </li>
            ))}
          </ul>

          {lista.length === 0 && (
            <Card className="p-6 text-center text-sm text-ink-2">
              {busca.trim() ? `Nenhum item com “${busca.trim()}”.` : "Nenhum item neste filtro."}{" "}
              <button
                type="button"
                onClick={() => {
                  setBusca("");
                  setFiltro("TODOS");
                }}
                className="cursor-pointer font-medium text-brand-strong underline"
              >
                Ver todos
              </button>
            </Card>
          )}
        </>
      )}

      {/* Barra de fecho, flutuante acima da de abas — mesma posição da
          conferência de pedido. */}
      {!encerrada && linhas.length > 0 && (
        <div className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-30">
          <div className="flex items-center gap-2 rounded-[var(--radius-m)] border border-line bg-surface/95 px-4 py-2.5 shadow-[var(--shadow-2)] backdrop-blur">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-ink">
                {conferidos} de {linhas.length} conferidos
              </p>
              <p className="truncate text-[11px] text-muted">
                {impedimento
                  ? "falta relacionar produto no computador"
                  : comDiferenca > 0
                    ? `${comDiferenca} com diferença`
                    : naoContadas.length > 0
                      ? `o resto entra como está ${nota ? "na nota" : "no pedido"}`
                      : "tudo contado"}
              </p>
            </div>
            <Button onClick={() => setConfirmando(true)} disabled={enviando || gravando > 0}>
              {gravando > 0 && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Receber
            </Button>
          </div>
        </div>
      )}

      {alvo && !encerrada && (
        <SheetContagem
          key={alvo.id}
          linha={alvo}
          cega={cega}
          temNota={Boolean(nota)}
          semEsperado={alvo.avulsa && !temPapel}
          onFechar={() => setAlvoId(null)}
          onConfirmar={(qtd) => void gravar(alvo, qtd)}
        />
      )}

      {tudo && (
        <BottomSheet
          open
          onClose={() => setTudo(false)}
          titulo={`${atalhoTudo}?`}
          descricao="Só o que ninguém contou muda. O que já foi contado fica como está."
          rodape={
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setTudo(false)} className="flex-1" size="lg">
                Voltar
              </Button>
              <Button onClick={() => void conferirTudo()} disabled={enviando} className="flex-1" size="lg">
                {enviando ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <CheckCheck className="h-4 w-4" aria-hidden />
                )}
                Confirmar
              </Button>
            </div>
          }
        >
          <p className="pb-2 text-[13px] text-ink-2">
            {naoContadas.length} {naoContadas.length === 1 ? "item fica" : "itens ficam"} com a
            quantidade {nota ? "da nota" : "do pedido"}. Nada entra no estoque ainda — a entrada
            continua sendo no botão “Receber”.
          </p>
        </BottomSheet>
      )}

      {confirmando && (
        <BottomSheet
          open
          onClose={() => setConfirmando(false)}
          titulo="Receber no estoque"
          descricao="A mercadoria vira saldo e o custo médio é recalculado. O preço de venda não muda."
          rodape={
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setConfirmando(false)} className="flex-1" size="lg">
                Voltar
              </Button>
              <Button
                onClick={() => void receber()}
                disabled={
                  enviando ||
                  gravando > 0 ||
                  impedimento !== null ||
                  (naoExplicadas.length > 0 && motivo.trim().length < 3)
                }
                className="flex-1"
                size="lg"
              >
                {enviando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                {enviando ? "Recebendo…" : "Confirmar entrada"}
              </Button>
            </div>
          }
        >
          <div className="space-y-3 pb-2">
            <p className="rounded-lg border border-line px-3 py-2 text-[13px]">
              <span className="text-muted">Estoque · {recebimento.siteNome}</span>
              <span className="mt-0.5 block font-mono text-ink">
                +{fmt(unidadesEntrando)} {UN} em {itensEntrando.length}{" "}
                {itensEntrando.length === 1 ? "item" : "itens"}
              </span>
            </p>

            {impedimento && (
              <p className="flex items-start gap-2 rounded-lg bg-danger-soft p-3 text-[13px] text-danger">
                <Link2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                {impedimento}
              </p>
            )}

            {naoContadas.length > 0 && (
              <p className="rounded-lg bg-accent-soft p-3 text-[13px] text-accent">
                {naoContadas.length}{" "}
                {naoContadas.length === 1 ? "item não foi contado — entra" : "itens não foram contados — entram"}{" "}
                com a quantidade {nota ? "da nota" : "do pedido"}.
              </p>
            )}

            {vencidos > 0 && (
              <p className="flex items-start gap-2 rounded-lg bg-danger-soft p-3 text-[13px] text-danger">
                <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                {vencidos === 1
                  ? "1 item entra com a validade já vencida."
                  : `${vencidos} itens entram com a validade já vencida.`}{" "}
                Confira antes de receber.
              </p>
            )}

            {nota && falta.valor > 0.005 && (
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line p-3 text-[13px]">
                <input
                  type="checkbox"
                  checked={abaterFalta}
                  onChange={(e) => setAbaterFalta(e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-brand)]"
                />
                <span>
                  <span className="font-medium text-ink">Abater a falta do título a pagar</span>
                  <span className="block text-[12px] text-muted">
                    A nota cobra {brl(falta.valor)} em{" "}
                    {falta.itens === 1 ? "1 item que não entrou" : `${falta.itens} itens que não entraram`}.
                  </span>
                </span>
              </label>
            )}

            {naoExplicadas.length > 0 && (
              <label className="block">
                <span className="mb-1 flex items-start gap-1.5 text-sm font-medium text-ink">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
                  O que aconteceu com{" "}
                  {naoExplicadas.length === 1
                    ? "o item que não bateu"
                    : `os ${naoExplicadas.length} itens que não bateram`}
                  ?
                </span>
                <textarea
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  rows={2}
                  maxLength={240}
                  placeholder="Ex.: veio só metade da carga, o resto chega amanhã."
                  className="w-full rounded-xl border border-line-button bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                />
                <span className="mt-1 block text-[12px] text-muted">Fica na história do recebimento.</span>
              </label>
            )}
          </div>
        </BottomSheet>
      )}
    </div>
  );
}

/** Um item da carga: foto, nome, código e o placar contado × esperado. */
function CartaoLinha({
  linha,
  cega,
  semEsperado,
  diverge,
  bloqueado,
  onAbrir,
}: {
  linha: LinhaRecebimento;
  cega: boolean;
  semEsperado: boolean;
  diverge: boolean;
  bloqueado: boolean;
  onAbrir: () => void;
}) {
  const contado = linha.qtdRecebida != null;
  const esperado = esperadoDaLinha(linha);
  const atual = contado ? medida(linha.qtdRecebida ?? 0, linha) : null;
  // Na cega, o número do papel só aparece depois da contagem.
  const mostraEsperado = !semEsperado && !(cega && !contado);

  const corpo = (
    <Card
      className={cn(
        "flex items-center gap-3 p-3",
        contado && (diverge ? "border-warn/40 bg-warn-soft/30" : "border-ok/40 bg-ok-soft/30"),
      )}
    >
      <span className="relative shrink-0">
        {linha.imagemUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={linha.imagemUrl}
            alt=""
            className="h-12 w-12 rounded-lg border border-line bg-surface object-contain"
          />
        ) : (
          <span className="grid h-12 w-12 place-items-center rounded-lg border border-line bg-surface-2 text-muted">
            <PackageOpen className="h-5 w-5" aria-hidden />
          </span>
        )}
        <span
          className={cn(
            "absolute -right-1 -bottom-1 grid h-5 w-5 place-items-center rounded-full ring-2 ring-surface",
            contado ? (diverge ? "bg-warn text-white" : "bg-ok text-white") : "bg-surface-2 text-muted",
          )}
          aria-hidden
        >
          {contado ? <Check className="h-3 w-3" /> : <ScanLine className="h-3 w-3" />}
        </span>
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{nomeDe(linha)}</span>
        <span className="block truncate font-mono text-[11px] text-muted">
          {linha.ean ?? linha.codigoFornecedor ?? (linha.avulsa ? "adicionado na conferência" : "sem código")}
        </span>
        {!linha.productId && (
          <span className="mt-1 block text-[11px] font-medium text-accent">
            Sem produto — relacione no computador
          </span>
        )}
        {linha.bonificacao && (
          <Badge tone="accent" className="mt-1">
            <Gift className="h-3 w-3" aria-hidden /> Bonificação
          </Badge>
        )}
      </span>

      <span className="shrink-0 text-right">
        <span className="block font-display text-lg leading-none font-semibold text-ink tabular-nums">
          {atual ? atual.n : "—"}
          {atual && <span className="ml-0.5 text-[11px] font-normal text-muted">{atual.sigla}</span>}
        </span>
        {mostraEsperado && (
          <span className="text-[11px] text-muted">de {textoDe(esperado, linha)}</span>
        )}
      </span>
    </Card>
  );

  if (bloqueado) return corpo;
  return (
    <button
      type="button"
      onClick={onAbrir}
      aria-label={`Contar ${nomeDe(linha)}`}
      className="block w-full cursor-pointer rounded-[var(--radius-m)] text-left focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
    >
      {corpo}
    </button>
  );
}

/**
 * O teclado da contagem. Conta na embalagem da nota por padrão (1 CX no papel,
 * 1 CX na doca); a unidade é a exceção da caixa aberta. O servidor grava
 * sempre em unidade.
 */
function SheetContagem({
  linha,
  cega,
  temNota,
  semEsperado,
  onFechar,
  onConfirmar,
}: {
  linha: LinhaRecebimento;
  cega: boolean;
  temNota: boolean;
  semEsperado: boolean;
  onFechar: () => void;
  /** Em unidades de estoque. */
  onConfirmar: (qtd: number) => void;
}) {
  const emb = embalagemDaNota(linha);
  const atual = linha.qtdRecebida;
  const esperado = esperadoDaLinha(linha);
  const [modo, setModo] = React.useState<"EMB" | "UN">(
    emb && (atual == null || inteiro(atual / emb.fator)) ? "EMB" : "UN",
  );
  const fator = modo === "EMB" && emb ? emb.fator : 1;
  const sigla = modo === "EMB" && emb ? emb.sigla : UN;
  const [valor, setValor] = React.useState(atual != null ? String(atual / fator) : "");

  function trocar(novo: "EMB" | "UN") {
    if (!emb || novo === modo) return;
    if (valor !== "") {
      const n = paraNumero(valor);
      if (novo === "UN") setValor(String(n * emb.fator));
      // Doze garrafas soltas não viram "1 caixa" sozinhas se não fecham.
      else setValor(inteiro(n / emb.fator) ? String(n / emb.fator) : "");
    }
    setModo(novo);
  }

  const descricao =
    cega && atual == null
      ? "Conte e digite o que chegou."
      : semEsperado
        ? "Item adicionado na conferência."
        : `${temNota ? "Nota" : "Esperado"}: ${textoDe(esperado, linha)}${
            emb ? ` (= ${fmt(esperado)} ${UN})` : ""
          }`;

  return (
    <BottomSheet
      open
      onClose={onFechar}
      titulo={nomeDe(linha)}
      descricao={descricao}
      rodape={
        <div className="flex gap-2">
          {!cega && !semEsperado && !linha.avulsa && esperado > 0 && (
            <Button variant="secondary" onClick={() => onConfirmar(esperado)} className="flex-1" size="lg">
              Igual {temNota ? "à nota" : "ao pedido"}
            </Button>
          )}
          <Button
            onClick={() => onConfirmar(paraNumero(valor) * fator)}
            disabled={valor === ""}
            className="flex-1"
            size="lg"
          >
            <Check className="h-4 w-4" aria-hidden />
            Confirmar
          </Button>
        </div>
      }
    >
      <div className="space-y-3 pb-2">
        {emb && (
          <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Contar em">
            {(
              [
                ["EMB", `${emb.sigla} (${fmt(emb.fator)} ${UN})`],
                ["UN", "Unidade"],
              ] as const
            ).map(([m, rotulo]) => (
              <button
                key={m}
                type="button"
                aria-pressed={modo === m}
                onClick={() => trocar(m)}
                className={cn(
                  "tap min-h-10 cursor-pointer rounded-full border text-[13px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none",
                  modo === m ? "border-brand bg-brand-soft text-ink" : "border-line-button bg-surface text-ink-2",
                )}
              >
                {rotulo}
              </button>
            ))}
          </div>
        )}
        <VisorQuantidade valor={valor} unidade={sigla} />
        <TecladoNumerico valor={valor} onChange={setValor} decimais={0} />
        <button
          type="button"
          onClick={() => onConfirmar(0)}
          className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-1.5 rounded-full text-[13px] font-medium text-danger hover:bg-danger-soft"
        >
          <X className="h-4 w-4" aria-hidden />
          Não recebi este item
        </button>
      </div>
    </BottomSheet>
  );
}
