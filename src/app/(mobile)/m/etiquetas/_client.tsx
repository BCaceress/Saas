"use client";

import * as React from "react";
import Link from "next/link";
import { Minus, Plus, Printer, ScanLine, Tag, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";
import { Scanner } from "@/components/mobile/scanner";
import { useFilaEtiquetas, urlDaFolha } from "@/components/mobile/fila-etiquetas";
import { buscarPorCodigoAction } from "../scan/actions";

/**
 * Montar a fila é o mesmo gesto de sempre: passar pela gôndola e bipar.
 *
 * O scanner fica em modo contínuo aqui — parar a câmera a cada item transformaria
 * uma volta de 30 produtos em 30 esperas. O produto repetido soma quantidade em
 * vez de duplicar a linha, que é o que a pessoa quer dizer ao bipar duas vezes.
 */
export function EtiquetasClient() {
  const { itens, total, adicionar, definirQuantidade, remover, limpar, max } =
    useFilaEtiquetas();
  const [lendo, setLendo] = React.useState(false);
  const [ocupado, setOcupado] = React.useState(false);
  const [ultimo, setUltimo] = React.useState<string | null>(null);

  const cheia = itens.length >= max;

  async function aoLer(codigo: string) {
    if (cheia) return;
    setOcupado(true);
    try {
      const r = await buscarPorCodigoAction(codigo);
      if (r.tipo === "achou") {
        adicionar({
          productId: r.ficha.id,
          nome: r.ficha.nome,
          sku: r.ficha.sku,
        });
        setUltimo(r.ficha.nome);
      } else {
        setUltimo(`Sem cadastro: ${codigo}`);
      }
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-3">
      {lendo ? (
        <div className="space-y-2">
          <Scanner
            onCodigo={aoLer}
            onFechar={() => setLendo(false)}
            continuo
            ocupado={ocupado}
            dica="Bipe um produto atrás do outro"
          />
          {ultimo && (
            <p className="text-center text-[13px] text-ink-2" aria-live="polite">
              {ultimo}
            </p>
          )}
        </div>
      ) : (
        <Button
          onClick={() => setLendo(true)}
          disabled={cheia}
          className="w-full"
          size="lg"
          variant="secondary"
        >
          <ScanLine className="h-4 w-4" aria-hidden />
          {cheia ? `Fila cheia (${max})` : "Escanear para a fila"}
        </Button>
      )}

      {itens.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-8 text-center">
          <Tag className="h-8 w-8 text-muted" aria-hidden />
          <p className="font-display text-base font-semibold text-ink">Fila vazia</p>
          <p className="text-sm text-ink-2">
            Bipe os produtos cuja etiqueta precisa trocar, ou toque em “Etiqueta” na
            ficha de um produto.
          </p>
        </Card>
      ) : (
        <>
          <ul className="space-y-2">
            {itens.map((i) => (
              <li key={i.productId}>
                <Card className="flex items-center gap-2 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{i.nome}</p>
                    <p className="font-mono text-xs text-muted">{i.sku}</p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <BotaoQtd
                      rotulo={`Menos uma etiqueta de ${i.nome}`}
                      onClick={() => definirQuantidade(i.productId, i.quantidade - 1)}
                    >
                      <Minus className="h-4 w-4" aria-hidden />
                    </BotaoQtd>
                    <span className="w-7 text-center font-display text-base font-semibold text-ink tabular-nums">
                      {i.quantidade}
                    </span>
                    <BotaoQtd
                      rotulo={`Mais uma etiqueta de ${i.nome}`}
                      onClick={() => definirQuantidade(i.productId, i.quantidade + 1)}
                    >
                      <Plus className="h-4 w-4" aria-hidden />
                    </BotaoQtd>
                  </div>

                  <button
                    type="button"
                    onClick={() => remover(i.productId)}
                    aria-label={`Tirar ${i.nome} da fila`}
                    className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-full text-muted hover:bg-danger-soft hover:text-danger"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </Card>
              </li>
            ))}
          </ul>

          <div className="sticky bottom-24 z-10 space-y-2">
            {/* Link e não botão: abre a folha numa aba nova, e a impressão é do
                navegador — o app não tem (nem quer) driver de impressora. */}
            <Link
              href={urlDaFolha(itens)}
              target="_blank"
              rel="noopener"
              className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-brand text-sm font-semibold text-on-brand shadow-[var(--shadow-2)]"
            >
              <Printer className="h-4 w-4" aria-hidden />
              Imprimir {total} {total === 1 ? "etiqueta" : "etiquetas"}
            </Link>
            <Button variant="ghost" onClick={limpar} className="w-full">
              Limpar fila
            </Button>
          </div>

          <p className="px-1 text-xs text-muted">
            O preço impresso é o que estiver no sistema na hora de abrir a folha — não o
            de quando você bipou.
          </p>
        </>
      )}
    </div>
  );
}

function BotaoQtd({
  rotulo,
  onClick,
  children,
}: {
  rotulo: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={rotulo}
      className="grid h-10 w-10 cursor-pointer place-items-center rounded-full border border-line-button bg-surface text-ink-2 active:bg-surface-2"
    >
      {children}
    </button>
  );
}
