"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ImageOff,
  ImagePlus,
  AlertTriangle,
  Loader2,
  RefreshCw,
  ScanBarcode,
  Info,
} from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { SkuTag } from "@/components/sku-tag";
import {
  aplicarImagens,
  buscarImagens,
  type ImagemStatus,
  type ImagemSugestao,
} from "../imagens-actions";

/** Precisa bater com o teto por chamada da server action. */
const LOTE = 12;

const MOTIVO: Record<ImagemStatus, string> = {
  encontrada: "",
  sem_imagem: "Código conhecido, mas sem foto na base.",
  nao_encontrado: "Código não encontrado na base.",
  sem_ean: "Produto sem código de barras.",
  rate_limit: "Limite de consultas atingido.",
  sem_token: "Busca por código indisponível (sem token).",
  erro: "Não foi possível consultar agora.",
};

/** Falha que não adianta insistir no resto da fila — a busca para aqui. */
const INTERROMPE: ImagemStatus[] = ["rate_limit", "sem_token"];
/** Falha pontual: vale um "tentar de novo". */
const RETENTAVEL: ImagemStatus[] = ["erro", "rate_limit"];

/** Código de barras utilizável para consulta (a base cobre de EAN-8 a GTIN-14). */
const temEan = (p: ProdutoImagem) => (p.ean ?? "").replace(/\D/g, "").length >= 8;

export type ProdutoImagem = {
  id: string;
  nome: string;
  sku: string;
  ean: string | null;
  imagemUrl: string | null;
};

/**
 * Busca a foto do produto pelo código de barras — o mesmo caminho do cadastro
 * manual (Cosmos), só que em lote e depois do fato: quem importou por CSV entra
 * com o catálogo inteiro sem imagem.
 *
 * Nada é gravado sem revisão: cada resultado vira um cartão que o operador
 * confirma ou descarta (um por vez, ou todos de uma vez).
 */
export function ImagensSheet({
  open,
  onClose,
  produtos,
  onAplicado,
}: {
  open: boolean;
  onClose: () => void;
  produtos: ProdutoImagem[];
  onAplicado?: () => void;
}) {
  // Sem nenhum código de barras na fila não há o que consultar: já abre na revisão.
  const [fase, setFase] = useState<"buscando" | "revisao" | "gravando">(() =>
    produtos.some((p) => temEan(p)) ? "buscando" : "revisao",
  );
  const [sugestoes, setSugestoes] = useState<ImagemSugestao[]>([]);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [interrompido, setInterrompido] = useState<ImagemStatus | null>(null);
  /** Número da busca em curso — ver `rodar`. */
  const execucao = useRef(0);

  const semEan = produtos.filter((p) => !temEan(p));
  const comEan = produtos.filter(temEan);

  const rodar = useCallback(
    async (lista: ProdutoImagem[], anteriores: ImagemSugestao[] = []) => {
      // Cada execução leva um número. Uma busca nova torna a anterior obsoleta em
      // vez de ser barrada por ela: trava booleana que não é liberada (recarga do
      // dev, painel reaberto) deixaria a tela presa em "buscando" para sempre —
      // e é no fim da busca que o rodapé com o botão de salvar aparece.
      const meuId = ++execucao.current;
      const atual = () => execucao.current === meuId;

      setFase("buscando");
      setInterrompido(null);

      const acumulado = [...anteriores];
      try {
        for (let i = 0; i < lista.length; i += LOTE) {
          if (!atual()) return;
          const chunk = lista.slice(i, i + LOTE);
          const res = await buscarImagens(chunk.map((p) => p.id));
          if (!atual()) return;

          // Substitui a sugestão antiga do mesmo produto (caso de "tentar de novo").
          for (const r of res) {
            const j = acumulado.findIndex((x) => x.id === r.id);
            if (j >= 0) acumulado[j] = r;
            else acumulado.push(r);
          }
          setSugestoes([...acumulado]);
          setMarcados((prev) => {
            const next = new Set(prev);
            for (const r of res) {
              // Sugestão boa entra marcada; quem já tinha foto fica de fora para
              // não trocar por acidente o que o operador escolheu à mão.
              if (r.status === "encontrada" && !r.jaTinha) next.add(r.id);
              else next.delete(r.id);
            }
            return next;
          });

          const parada = res.find((r) => INTERROMPE.includes(r.status));
          if (parada) {
            setInterrompido(parada.status);
            break;
          }
        }
      } catch (e) {
        toast.error(
          "Falha ao consultar a base de códigos",
          e instanceof Error ? e.message : "Tente de novo.",
        );
      } finally {
        // Só a execução mais recente decide a fase — senão uma antiga que termina
        // depois joga a tela de volta para a revisão de dados que já não valem.
        if (atual()) setFase((f) => (f === "buscando" ? "revisao" : f));
      }
    },
    [],
  );

  useEffect(() => {
    if (!open || !comEan.length) return;
    // Microtask: a busca já começa escrevendo estado (fase/progresso) e escrever
    // estado no corpo do efeito encadeia renders à toa.
    let vivo = true;
    Promise.resolve().then(() => {
      if (vivo) rodar(comEan);
    });
    return () => {
      vivo = false;
    };
    // Roda uma vez por abertura — a lista de produtos vem congelada do chamador.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const buscados = sugestoes.length;
  const encontradas = sugestoes.filter((s) => s.status === "encontrada");
  const falhas = sugestoes.filter((s) => s.status !== "encontrada");
  const retentaveis = sugestoes.filter((s) => RETENTAVEL.includes(s.status));
  const jaTinhamFoto = encontradas.filter((s) => s.jaTinha).length;
  const soJaTinham = encontradas.length > 0 && jaTinhamFoto === encontradas.length;
  /** Foto atual de cada produto — o cartão mostra lado a lado o que vai ser trocado. */
  const atuais = new Map(produtos.map((p) => [p.id, p.imagemUrl]));
  const buscando = fase === "buscando";
  const pct = comEan.length ? Math.round((buscados / comEan.length) * 100) : 100;

  function alternar(id: string) {
    setMarcados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function todos(valor: boolean) {
    setMarcados(valor ? new Set(encontradas.map((s) => s.id)) : new Set());
  }

  async function aplicar() {
    const itens = encontradas
      .filter((s) => marcados.has(s.id) && s.imagemUrl)
      .map((s) => ({ id: s.id, imagemUrl: s.imagemUrl! }));
    if (!itens.length) {
      toast.info("Nenhuma imagem marcada", "Marque as fotos que devem entrar no cadastro.");
      return;
    }

    // Salvar encerra a fila: busca ainda em curso vira execução obsoleta e para
    // de mexer na tela por cima do resultado.
    execucao.current++;
    setFase("gravando");
    try {
      const n = await aplicarImagens(itens);
      // Falha silenciosa é pior que erro: se nada entrou, diga que nada entrou —
      // e o painel fica de pé para o operador tentar de novo.
      if (n === 0) {
        setFase("revisao");
        toast.error("Nenhuma imagem foi salva", "Tente de novo ou avise o suporte.");
        return;
      }
      toast.success(
        `${n} ${n === 1 ? "imagem salva" : "imagens salvas"}`,
        falhas.length > 0
          ? `${falhas.length} produto(s) seguem sem foto.`
          : undefined,
      );
      onAplicado?.();
      // Salvou: o painel some. Tela de "concluir" só somava um clique ao fim —
      // o toast já confirma o que entrou.
      onClose();
    } catch (e) {
      setFase("revisao");
      toast.error(
        "Não deu para salvar as imagens",
        e instanceof Error ? e.message : "Tente de novo.",
      );
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Buscar imagens por código de barras"
      description={`${produtos.length} produto${produtos.length === 1 ? "" : "s"} na fila · consulta a base de códigos e você aprova o que entra.`}
      width="3xl"
      footer={
        // Rodapé presente durante a busca também: quem já viu 20 fotos boas pode
        // salvar sem esperar o resto da fila, e o botão nunca "some" da tela.
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-muted">
            {marcados.size} de {encontradas.length} imagens escolhidas
            {buscando && " · busca em andamento"}
          </span>
          <div className="flex items-center gap-2">
            {retentaveis.length > 0 && (
              <Button
                variant="ghost"
                onClick={() =>
                  rodar(
                    comEan.filter((p) => retentaveis.some((r) => r.id === p.id)),
                    sugestoes,
                  )
                }
                disabled={buscando}
                className="gap-1.5"
              >
                <RefreshCw size={15} /> Tentar de novo ({retentaveis.length})
              </Button>
            )}
            {/* Segue clicável com zero marcadas: botão morto sem explicação foi
                exatamente o que confundiu antes — agora o clique diz o que falta. */}
            <Button onClick={aplicar} disabled={fase === "gravando"}>
              {fase === "gravando"
                ? "Salvando…"
                : marcados.size === 0
                  ? "Aplicar imagens"
                  : `Aplicar ${marcados.size} ${marcados.size === 1 ? "imagem" : "imagens"}`}
            </Button>
          </div>
        </div>
      }
    >
      {/* ── Progresso ── */}
      {buscando && (
        <div className="mb-4 flex items-center gap-3 rounded-[var(--radius)] border border-line bg-surface-2 px-4 py-3">
          <Loader2 size={16} className="shrink-0 animate-spin text-brand-strong" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-ink">
              Consultando código {Math.min(buscados + 1, comEan.length)} de {comEan.length}…
            </p>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full bg-brand transition-[width] duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {interrompido && (
        <div className="mb-4 flex items-start gap-2 rounded-[var(--radius)] border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            {MOTIVO[interrompido]} Parei em {buscados} de {comEan.length}. Aplique o que já veio e
            rode de novo depois — o que já tem foto sai da fila.
          </span>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {/* Nada marcado por padrão porque tudo já tem foto — sem isto o rodapé
            diz "Aplicar imagens" e o operador não sabe por que nada acontece. */}
        {soJaTinham && (
          <div className="flex items-start gap-2 rounded-[var(--radius)] border border-info/30 bg-info-soft px-4 py-3 text-sm text-info">
            <Info size={16} className="mt-0.5 shrink-0" />
            <span>
              Todos estes produtos já têm foto — por isso nada veio marcado. Marque os que devem ser{" "}
              <strong>substituídos</strong> pela imagem da base.
            </span>
          </div>
        )}

        {encontradas.length > 0 && (
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-ink">
              {encontradas.length} imagem(ns) encontrada(s)
              {jaTinhamFoto > 0 && (
                <span className="font-normal text-muted"> · {jaTinhamFoto} já com foto</span>
              )}
            </p>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={() => todos(true)}>
                Marcar todas
              </Button>
              <Button variant="ghost" size="sm" onClick={() => todos(false)}>
                Desmarcar
              </Button>
            </div>
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          {encontradas.map((s) => (
            <CardSugestao
              key={s.id}
              sugestao={s}
              atual={atuais.get(s.id) ?? null}
              marcado={marcados.has(s.id)}
              onToggle={() => alternar(s.id)}
            />
          ))}
        </div>

        {(falhas.length > 0 || semEan.length > 0) && !buscando && (
          <details className="rounded-[var(--radius)] border border-line">
            <summary className="cursor-pointer select-none px-4 py-2.5 text-sm text-ink-2 hover:bg-surface-2">
              {falhas.length + semEan.length} produto(s) sem imagem
            </summary>
            <ul className="max-h-56 divide-y divide-line overflow-y-auto border-t border-line text-xs">
              {semEan.map((p) => (
                <li key={p.id} className="flex items-center gap-2 px-4 py-1.5 text-ink-2">
                  <ScanBarcode size={13} className="shrink-0 text-faint" />
                  <span className="min-w-0 flex-1 truncate">{p.nome}</span>
                  <span className="shrink-0 text-muted">{MOTIVO.sem_ean}</span>
                </li>
              ))}
              {falhas.map((s) => (
                <li key={s.id} className="flex items-center gap-2 px-4 py-1.5 text-ink-2">
                  <ImageOff size={13} className="shrink-0 text-faint" />
                  <span className="min-w-0 flex-1 truncate">{s.nome}</span>
                  <span className="shrink-0 text-muted">{MOTIVO[s.status]}</span>
                </li>
              ))}
            </ul>
          </details>
        )}

        {!buscando && encontradas.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <ImageOff size={26} className="text-faint" />
            <p className="text-sm text-ink">Nenhuma imagem encontrada.</p>
            <p className="max-w-sm text-xs text-muted">
              A base só devolve foto para códigos de barras conhecidos. Produto de fabricação própria
              ou sem EAN precisa de imagem enviada à mão.
            </p>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function CardSugestao({
  sugestao,
  atual,
  marcado,
  onToggle,
}: {
  sugestao: ImagemSugestao;
  /** Foto que o produto já tem — some quando não há o que substituir. */
  atual: string | null;
  marcado: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-[var(--radius)] border p-3 transition-colors",
        marcado ? "border-brand bg-brand-soft/40" : "border-line hover:bg-surface-2",
      )}
    >
      <input
        type="checkbox"
        checked={marcado}
        onChange={onToggle}
        className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-[var(--brand)]"
      />
      {/* Substituição mostra as duas: sem ver a atual, aprovar a troca é aposta. */}
      {atual && (
        <span className="flex shrink-0 flex-col items-center gap-0.5">
          <span className="grid h-14 w-14 place-items-center overflow-hidden rounded-[var(--radius-sm)] border border-line bg-white opacity-70">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={atual} alt="" className="h-full w-full object-contain" />
          </span>
          <span className="text-[10px] text-faint">atual</span>
        </span>
      )}
      <span className="flex shrink-0 flex-col items-center gap-0.5">
        <span className="grid h-14 w-14 place-items-center overflow-hidden rounded-[var(--radius-sm)] border border-line bg-white">
          {sugestao.imagemUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={sugestao.imagemUrl} alt="" className="h-full w-full object-contain" />
          ) : (
            <ImagePlus size={16} className="text-faint" />
          )}
        </span>
        {atual && <span className="text-[10px] text-brand-strong">nova</span>}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium text-ink">{sugestao.nome}</span>
        {sugestao.descricaoCosmos && sugestao.descricaoCosmos !== sugestao.nome && (
          <span className="block truncate text-xs text-muted">
            na base: {sugestao.descricaoCosmos}
          </span>
        )}
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <SkuTag sku={sugestao.sku} />
          {sugestao.jaTinha && (
            <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[10.5px] font-medium text-warn">
              já tem foto
            </span>
          )}
        </span>
      </span>
    </label>
  );
}
