"use client";

import * as React from "react";
import Link from "next/link";
import { Loader2, PackageSearch, Search, ScanLine, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";
import { Scanner } from "@/components/mobile/scanner";
import { FichaProdutoView, AcoesFicha } from "@/components/mobile/ficha-produto";
import {
  buscarPorCodigoAction,
  buscarPorNomeAction,
  consultarEanExternoAction,
  type ConsultaCosmos,
} from "./actions";
import type { FichaProduto, ProdutoResumo } from "../_produto-data";

/**
 * Consulta de produto por código de barras.
 *
 * A câmera é o caminho principal, mas o campo de digitação NUNCA some: leitor
 * quebra, código rasga, e em navegador sem contexto seguro a câmera nem abre.
 */
export function ScanClient() {
  const [ficha, setFicha] = React.useState<FichaProduto | null>(null);
  const [naoAchou, setNaoAchou] = React.useState<string | null>(null);
  const [buscando, setBuscando] = React.useState(false);
  const [manual, setManual] = React.useState("");

  const consultar = React.useCallback(async (codigo: string) => {
    setBuscando(true);
    setNaoAchou(null);
    try {
      const r = await buscarPorCodigoAction(codigo);
      if (r.tipo === "achou") {
        setFicha(r.ficha);
      } else {
        setFicha(null);
        setNaoAchou(r.codigo);
      }
    } catch {
      setFicha(null);
      setNaoAchou(codigo);
    } finally {
      setBuscando(false);
    }
  }, []);

  function limpar() {
    setFicha(null);
    setNaoAchou(null);
    setManual("");
  }

  if (ficha) {
    return (
      <div className="space-y-3">
        <FichaProdutoView ficha={ficha} />
        <AcoesFicha ficha={ficha} />
        <Button variant="secondary" onClick={limpar} className="w-full">
          <ScanLine className="h-4 w-4" aria-hidden />
          Escanear outro
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Scanner onCodigo={consultar} ocupado={buscando} />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const v = manual.trim();
          if (v) void consultar(v);
        }}
        className="flex gap-2"
      >
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          // `inputMode="numeric"` abre o teclado numérico sem impedir SKU com
          // letras — quem precisa, troca o teclado.
          inputMode="numeric"
          autoComplete="off"
          placeholder="Digitar código ou SKU"
          aria-label="Código de barras ou SKU"
          className="min-h-12 flex-1 rounded-full border border-line-button bg-surface px-4 text-sm text-ink placeholder:text-faint focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        />
        <Button type="submit" size="lg" disabled={buscando || !manual.trim()}>
          {buscando ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Search className="h-4 w-4" aria-hidden />
          )}
          Buscar
        </Button>
      </form>

      {naoAchou !== null && <NaoEncontrado codigo={naoAchou} />}
    </div>
  );
}

/**
 * Código lido, produto inexistente. Duas saídas: procurar por nome (pode ser
 * cadastro sem EAN) ou consultar a base pública para saber o que é aquilo.
 *
 * Cadastrar não é opção aqui de propósito — formulário de produto não vai para
 * o celular.
 */
function NaoEncontrado({ codigo }: { codigo: string }) {
  const [termo, setTermo] = React.useState("");
  const [resultados, setResultados] = React.useState<ProdutoResumo[] | null>(null);
  const [procurando, setProcurando] = React.useState(false);
  const [cosmos, setCosmos] = React.useState<ConsultaCosmos | null>(null);
  const [consultandoCosmos, setConsultandoCosmos] = React.useState(false);

  async function procurar(e: React.FormEvent) {
    e.preventDefault();
    if (termo.trim().length < 2) return;
    setProcurando(true);
    try {
      setResultados(await buscarPorNomeAction(termo));
    } finally {
      setProcurando(false);
    }
  }

  async function consultarExterno() {
    setConsultandoCosmos(true);
    try {
      setCosmos(await consultarEanExternoAction(codigo));
    } finally {
      setConsultandoCosmos(false);
    }
  }

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-start gap-2">
        <PackageSearch className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-hidden />
        <div className="min-w-0">
          <p className="font-display text-base font-semibold text-ink">
            Nenhum produto com esse código
          </p>
          <p className="font-mono text-xs text-muted">{codigo}</p>
        </div>
      </div>

      <form onSubmit={procurar} className="flex gap-2">
        <input
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          placeholder="Procurar pelo nome"
          aria-label="Nome do produto"
          className="min-h-11 flex-1 rounded-full border border-line-button bg-surface px-4 text-sm text-ink placeholder:text-faint focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        />
        <Button type="submit" variant="secondary" disabled={procurando}>
          {procurando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Buscar"}
        </Button>
      </form>

      {resultados !== null &&
        (resultados.length === 0 ? (
          <p className="text-[13px] text-muted">Nada com esse nome.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {resultados.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/m/produto/${p.id}`}
                  className="flex min-h-12 items-center gap-2 px-3 py-2 text-[13px] hover:bg-surface-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{p.nome}</span>
                    <span className="block font-mono text-xs text-muted">{p.sku}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ))}

      <div className="border-t border-line pt-3">
        {cosmos === null ? (
          <Button
            variant="secondary"
            onClick={consultarExterno}
            disabled={consultandoCosmos}
            className="w-full"
          >
            {consultandoCosmos ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="h-4 w-4" aria-hidden />
            )}
            Descobrir o que é este código
          </Button>
        ) : cosmos.ok ? (
          <div className="space-y-1">
            <p className="text-xs text-ink-2">Base pública de produtos</p>
            <p className="font-medium text-ink">{cosmos.nome ?? "Sem descrição"}</p>
            {cosmos.marca && <p className="text-[13px] text-muted">{cosmos.marca}</p>}
            <p className="pt-1 text-xs text-muted">
              Para cadastrar, abra o sistema no computador — o formulário de produto
              não cabe no celular.
            </p>
          </div>
        ) : (
          <p className="text-[13px] text-muted">{cosmos.erro}</p>
        )}
      </div>
    </Card>
  );
}
