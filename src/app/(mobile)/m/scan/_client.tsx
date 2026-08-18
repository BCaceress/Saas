"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FileText,
  Image as ImageIcon,
  Loader2,
  PackageSearch,
  Receipt,
  Search,
  ScanLine,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { Scanner } from "@/components/mobile/scanner";
import { BotaoDitado } from "@/components/mobile/ditado";
import { FichaProdutoView, AcoesFicha } from "@/components/mobile/ficha-produto";
import type { AcaoInicial } from "@/components/mobile/acoes-produto";
import { classificarCodigo } from "@/lib/codigo-lido";
import { interpretarComandoAction, type ComandoVoz } from "../acoes/actions";
import { importarNotaPorChaveAction, type ResultadoNota } from "../nota/actions";
import {
  buscarPorCodigoAction,
  buscarPorNomeAction,
  consultarEanExternoAction,
  type ConsultaCosmos,
} from "./actions";
import type { FichaProduto, ProdutoResumo } from "../_produto-data";

/**
 * O scanner universal.
 *
 * Uma câmera só, e a pessoa NUNCA escolhe modo: quem decide o destino é o que
 * foi lido (`lib/codigo-lido`). Código de barras abre o produto; a chave de 44
 * dígitos impressa na DANFE busca a nota na SEFAZ; o QR que colamos no pedido
 * abre a conferência daquele pedido. Menu de modo seria pedir para a pessoa
 * classificar o papel antes de apontar — trabalho que o payload já faz.
 *
 * A digitação NUNCA some: leitor quebra, código rasga, e em navegador sem
 * contexto seguro a câmera nem abre.
 */

type Estado =
  | { tela: "lendo" }
  | { tela: "produto"; ficha: FichaProduto; inicial: AcaoInicial | null }
  | { tela: "nota"; resultado: ResultadoNota }
  | { tela: "sem-produto"; codigo: string }
  | { tela: "escolher"; termo: string; resultados: ProdutoResumo[] };

export function ScanClient() {
  const router = useRouter();
  const [estado, setEstado] = React.useState<Estado>({ tela: "lendo" });
  const [ocupado, setOcupado] = React.useState(false);
  const [manual, setManual] = React.useState("");

  /** Abre a ficha de um produto pelo id/EAN/SKU já conhecido. */
  const abrirProduto = React.useCallback(
    async (codigo: string, inicial: AcaoInicial | null = null) => {
      const r = await buscarPorCodigoAction(codigo);
      if (r.tipo === "achou") {
        setEstado({ tela: "produto", ficha: r.ficha, inicial });
        return true;
      }
      return false;
    },
    [],
  );

  const consultar = React.useCallback(
    async (bruto: string) => {
      setOcupado(true);
      try {
        const lido = classificarCodigo(bruto);

        if (lido.tipo === "pedido") {
          // Não confirma nada aqui: a própria tela do pedido é quem valida o id
          // e aplica o guard de `compras.receber`.
          router.push(`/m/receber/${lido.valor}`);
          return;
        }

        if (lido.tipo === "chave") {
          setEstado({
            tela: "nota",
            resultado: await importarNotaPorChaveAction(lido.valor),
          });
          return;
        }

        if (await abrirProduto(lido.valor)) return;

        // EAN que não casou é um código órfão; texto que não casou é busca.
        if (lido.tipo === "ean") {
          setEstado({ tela: "sem-produto", codigo: lido.valor });
        } else {
          setEstado({
            tela: "escolher",
            termo: lido.valor,
            resultados: await buscarPorNomeAction(lido.valor),
          });
        }
      } catch {
        setEstado({ tela: "sem-produto", codigo: bruto });
      } finally {
        setOcupado(false);
      }
    },
    [abrirProduto, router],
  );

  /** Fala → intenção → a MESMA sheet que o dedo abriria. */
  const aoFalar = React.useCallback(
    async (texto: string) => {
      setOcupado(true);
      try {
        const cmd = await interpretarComandoAction(texto);
        if (cmd.acao === "nenhuma" || !cmd.produto) {
          toast.info("Não entendi", `Ouvi "${texto}". Tente dizer o produto e o que fazer.`);
          return;
        }

        const achados = await buscarPorNomeAction(cmd.produto);
        if (achados.length === 0) {
          toast.error("Produto não encontrado", `Nada com "${cmd.produto}" no catálogo.`);
          return;
        }
        // Mais de um candidato = a pessoa escolhe. Adivinhar aqui seria
        // registrar perda no produto errado.
        if (achados.length > 1) {
          setEstado({ tela: "escolher", termo: cmd.produto, resultados: achados });
          return;
        }

        await abrirProduto(achados[0].id, acaoDoComando(cmd));
      } finally {
        setOcupado(false);
      }
    },
    [abrirProduto],
  );

  function limpar() {
    setEstado({ tela: "lendo" });
    setManual("");
  }

  if (estado.tela === "produto") {
    return (
      <div className="space-y-3">
        <FichaProdutoView ficha={estado.ficha} />
        <AcoesFicha
          ficha={estado.ficha}
          inicial={estado.inicial}
          onAtualizar={() => void abrirProduto(estado.ficha.id, null)}
        />
        <Button variant="secondary" onClick={limpar} className="w-full">
          <ScanLine className="h-4 w-4" aria-hidden />
          Escanear outro
        </Button>
      </div>
    );
  }

  if (estado.tela === "nota") {
    return <ResultadoDaNota resultado={estado.resultado} onVoltar={limpar} />;
  }

  return (
    <div className="space-y-4">
      <Scanner
        onCodigo={consultar}
        ocupado={ocupado}
        perfil="universal"
        dica="Código de barras, nota fiscal ou QR do pedido"
      />

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
          placeholder="Digitar código, SKU ou nome"
          aria-label="Código de barras, SKU ou nome"
          className="min-h-12 flex-1 rounded-full border border-line-button bg-surface px-4 text-sm text-ink placeholder:text-faint focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        />
        <BotaoDitado onTexto={aoFalar} />
        <Button type="submit" size="lg" disabled={ocupado || !manual.trim()}>
          {ocupado ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Search className="h-4 w-4" aria-hidden />
          )}
          Buscar
        </Button>
      </form>

      <Link
        href="/m/encarte"
        className="flex min-h-12 items-center justify-center gap-2 rounded-full border border-line-button bg-surface text-sm font-medium text-ink"
      >
        <ImageIcon className="h-4 w-4 text-ink-2" aria-hidden />
        Ler encarte ou tabela de preço
      </Link>

      {estado.tela === "sem-produto" && <NaoEncontrado codigo={estado.codigo} />}

      {estado.tela === "escolher" && (
        <Card className="space-y-3 p-4">
          <p className="font-display text-base font-semibold text-ink">
            {estado.resultados.length === 0
              ? "Nada com esse nome"
              : "Qual deles?"}
          </p>
          <p className="text-[13px] text-muted">procurando por “{estado.termo}”</p>
          {estado.resultados.length > 0 && <Lista produtos={estado.resultados} />}
        </Card>
      )}
    </div>
  );
}

/** Traduz a intenção falada na sheet correspondente. */
function acaoDoComando(cmd: ComandoVoz): AcaoInicial | null {
  const qtd = cmd.quantidade != null ? String(cmd.quantidade).replace(".", ",") : undefined;
  switch (cmd.acao) {
    case "perda":
      return { chave: "perda", quantidade: qtd, motivo: cmd.motivo ?? undefined };
    case "ajuste":
      return { chave: "ajuste", quantidade: qtd, motivo: cmd.motivo ?? undefined };
    case "preco":
      return {
        chave: "preco",
        preco: cmd.preco != null ? String(cmd.preco).replace(".", ",") : undefined,
      };
    case "pedir":
      return { chave: "pedir", quantidade: qtd };
    // "consultar" e "contar" abrem a ficha sem sheet: a primeira já responde, e
    // contagem é uma tela própria, com sessão de inventário.
    default:
      return null;
  }
}

function Lista({ produtos }: { produtos: ProdutoResumo[] }) {
  return (
    <ul className="divide-y divide-line rounded-lg border border-line">
      {produtos.map((p) => (
        <li key={p.id}>
          <Link
            href={`/m/produto/${p.id}?de=/m/scan`}
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
  );
}

// ── Nota fiscal lida pela câmera ────────────────────────────

/**
 * O que aconteceu com a chave lida. Quatro desfechos, e cada um leva a um lugar
 * diferente — inclusive "não deu", que precisa dizer o motivo em vez de só
 * falhar.
 */
function ResultadoDaNota({
  resultado,
  onVoltar,
}: {
  resultado: ResultadoNota;
  onVoltar: () => void;
}) {
  const sucesso = resultado.tipo === "importada" || resultado.tipo === "ja-importada";

  return (
    <div className="space-y-3">
      <Card className="space-y-3 p-4">
        <div className="flex items-start gap-2">
          <Receipt
            className={sucesso ? "mt-0.5 h-5 w-5 shrink-0 text-ok" : "mt-0.5 h-5 w-5 shrink-0 text-muted"}
            aria-hidden
          />
          <div className="min-w-0">
            <p className="font-display text-base font-semibold text-ink">
              {resultado.tipo === "importada" && "Nota importada"}
              {resultado.tipo === "ja-importada" && "Esta nota já estava aqui"}
              {resultado.tipo === "aguardando" && "Ciência registrada"}
              {resultado.tipo === "erro" && "Não deu para trazer a nota"}
            </p>
            {resultado.tipo !== "erro" && resultado.tipo !== "aguardando" && (
              <p className="text-sm text-ink-2">
                {resultado.emitente} · NF-e{" "}
                <span className="font-mono text-xs">{resultado.numero}</span>
              </p>
            )}
            {resultado.tipo === "aguardando" && (
              <p className="text-sm text-ink-2">{resultado.mensagem}</p>
            )}
            {resultado.tipo === "erro" && (
              <p className="text-sm text-ink-2">{resultado.mensagem}</p>
            )}
          </div>
        </div>

        {sucesso && (
          <Link
            href={
              (resultado.tipo === "importada" || resultado.tipo === "ja-importada") && resultado.inboundId
                ? `/compras/recebimento/${resultado.inboundId}`
                : "/fiscal/notas-recebidas"
            }
            className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-brand text-sm font-semibold text-on-brand"
          >
            <FileText className="h-4 w-4" aria-hidden />
            Conferir itens e dar entrada
          </Link>
        )}
      </Card>

      <Button variant="secondary" onClick={onVoltar} className="w-full">
        <ScanLine className="h-4 w-4" aria-hidden />
        Escanear outro
      </Button>
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
          <Lista produtos={resultados} />
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
