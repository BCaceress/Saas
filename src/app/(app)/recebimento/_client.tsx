"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronRight,
  FileUp,
  Inbox,
  Link2Off,
  Loader2,
  ScanLine,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { EstadoVazio, Metrica, MetricaGrid, fmtMoney, fmtQuando } from "../cotacoes/_catalogo/ui";
import { importarXmlRecebimentoAction } from "./actions";
import type { NotaPendente } from "./_data";

// ── Fila do recebimento ─────────────────────────────────────
// A tela existe para uma pergunta só: "chegou mercadoria, e agora?". A
// resposta é subir o XML — o pedido o sistema acha sozinho. A fila abaixo é o
// que ainda não virou estoque.

export function FilaRecebimento({ notas }: { notas: NotaPendente[] }) {
  const semPedido = notas.filter((n) => !n.pedidoNumero).length;
  const comDivergencia = notas.filter((n) => n.divergencias > 0).length;

  return (
    <div className="flex flex-col gap-5">
      <MetricaGrid className="lg:grid-cols-3">
        <Metrica
          label="Notas a receber"
          valor={String(notas.length)}
          sub="importadas e ainda sem entrada"
          icon={<Inbox size={13} />}
          tom="brand"
        />
        <Metrica
          label="Sem pedido"
          valor={String(semPedido)}
          sub="precisam de vínculo manual"
          icon={<Link2Off size={13} />}
          tom={semPedido > 0 ? "accent" : "ink"}
        />
        <Metrica
          label="Com divergência"
          valor={String(comDivergencia)}
          sub="nota diferente do pedido"
          icon={<TriangleAlert size={13} />}
          tom={comDivergencia > 0 ? "accent" : "ink"}
        />
      </MetricaGrid>

      <Upload />

      {notas.length === 0 ? (
        <EstadoVazio
          icon={<ScanLine size={20} />}
          titulo="Nenhuma nota esperando conferência"
          descricao="Assim que o fornecedor mandar o XML, suba o arquivo aqui: o pedido correspondente é localizado sozinho e sobra só conferir a mercadoria."
        />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
          {notas.map((n) => (
            <li key={n.id}>
              <Link
                href={`/recebimento/${n.id}`}
                className="flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{n.fornecedor}</p>
                  <p className="truncate text-[12px] text-muted">
                    <span className="font-mono">
                      NF {n.numero}/{n.serie}
                    </span>
                    {" · "}
                    {n.itens} {n.itens === 1 ? "item" : "itens"}
                    {" · "}
                    {fmtQuando(n.dataEmissao)}
                  </p>
                </div>

                <div className="hidden shrink-0 text-right sm:block">
                  <p className="font-display text-[15px] font-semibold text-ink tabular-nums">
                    {fmtMoney(n.valorTotal)}
                  </p>
                </div>

                <div className="shrink-0">
                  {n.pedidoNumero ? (
                    n.divergencias > 0 ? (
                      <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-medium text-accent">
                        {n.divergencias}{" "}
                        {n.divergencias === 1 ? "divergência" : "divergências"}
                      </span>
                    ) : (
                      <span className="rounded-full bg-ok-soft px-2.5 py-1 text-[11px] font-medium text-ok">
                        Conciliada · {n.pedidoNumero}
                      </span>
                    )
                  ) : (
                    <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-muted">
                      Sem pedido
                    </span>
                  )}
                </div>

                <ChevronRight className="h-4 w-4 shrink-0 text-faint" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Upload do XML ───────────────────────────────────────────

function Upload() {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = React.useState(false);
  const [sobre, setSobre] = React.useState(false);

  async function enviar(arquivos: FileList | File[]) {
    const lista = Array.from(arquivos);
    if (lista.length === 0) return;

    setEnviando(true);
    try {
      const form = new FormData();
      for (const f of lista) form.append("arquivos", f);
      const resultados = await importarXmlRecebimentoAction(form);

      const importadas = resultados.filter((r) => r.status === "IMPORTADA");
      const erros = resultados.filter((r) => r.status === "ERRO");
      const duplicadas = resultados.filter((r) => r.status === "DUPLICADA");

      for (const e of erros) toast.error(e.arquivo, e.motivo);
      if (duplicadas.length > 0) {
        toast.info(
          `${duplicadas.length} ${duplicadas.length === 1 ? "nota já importada" : "notas já importadas"}`,
          "A chave de acesso já existe aqui — mercadoria não entra duas vezes.",
        );
      }

      // Uma nota só: leva direto para a conferência. É o caso de 9 em cada 10
      // uploads, e voltar para a fila para clicar de novo seria um passo à toa.
      const unica = importadas[0];
      if (importadas.length === 1 && unica?.inboundId) {
        toast.success(
          unica.pedidoNumero
            ? `Pedido ${unica.pedidoNumero} encontrado automaticamente.`
            : "Nota importada.",
          unica.pedidoNumero
            ? "A nota já foi conciliada com o pedido."
            : "Escolha o pedido correspondente na próxima tela.",
        );
        router.push(`/recebimento/${unica.inboundId}`);
        return;
      }

      if (importadas.length > 1) {
        toast.success(`${importadas.length} notas importadas.`, "Confira uma a uma na fila.");
      }
      router.refresh();
    } catch (e) {
      toast.error(
        "Não foi possível ler o arquivo",
        e instanceof Error ? e.message : "Tente de novo.",
      );
    } finally {
      setEnviando(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setSobre(true);
      }}
      onDragLeave={() => setSobre(false)}
      onDrop={(e) => {
        e.preventDefault();
        setSobre(false);
        void enviar(e.dataTransfer.files);
      }}
      className={cn(
        "flex flex-col items-center gap-3 rounded-[var(--radius-lg)] border border-dashed px-6 py-10 text-center transition-colors",
        sobre ? "border-brand bg-brand-soft" : "border-line bg-surface",
      )}
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-[var(--radius)] bg-brand-soft text-brand">
        {enviando ? (
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        ) : (
          <FileUp className="h-5 w-5" aria-hidden />
        )}
      </div>
      <div>
        <p className="font-display text-[15px] font-semibold text-ink">
          Arraste o XML da nota aqui
        </p>
        <p className="mx-auto mt-1 max-w-md text-[13px] text-muted">
          O NoHub lê a nota, procura o pedido em aberto que corresponde a ela e mostra
          item a item o que foi pedido, o que foi faturado e o que falta conferir. Aceita
          .xml e .zip.
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".xml,.zip,text/xml,application/xml,application/zip"
        multiple
        className="hidden"
        onChange={(e) => e.target.files && void enviar(e.target.files)}
      />
      <Button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={enviando}
        variant="secondary"
      >
        {enviando ? "Lendo a nota…" : "Escolher arquivo"}
      </Button>

      <p className="text-[12px] text-muted">
        Cansou de arrastar arquivo?{" "}
        <Link
          href="/configuracoes/notas-fiscais"
          className="font-medium text-brand underline underline-offset-2"
        >
          Receba as notas por e-mail ou direto da SEFAZ
        </Link>
        .
      </p>
    </div>
  );
}
