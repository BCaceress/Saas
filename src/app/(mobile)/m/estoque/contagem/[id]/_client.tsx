"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Box,
  Check,
  CloudOff,
  Loader2,
  PackageOpen,
  Refrigerator,
  ScanLine,
  Search,
  Snowflake,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { StorageType } from "@/generated/prisma";
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
  salvarContagemInventarioAction,
  fecharInventarioAction,
} from "@/app/(app)/estoque/actions";
import type { InventarioView, InventarioItemView } from "@/app/(app)/estoque/_data";

/** Salva depois de tantos itens contados… */
const ITENS_ATE_SALVAR = 5;
/** …ou depois de tanto tempo parado, o que vier primeiro. */
const MS_ATE_SALVAR = 20_000;

/**
 * Contagem de inventário com leitor.
 *
 * O ciclo é: bipa → o item sobe para o topo → teclado numérico → confirma →
 * próximo bipe. A câmera fica ligada o tempo todo (`continuo`), então não há
 * um toque de "abrir câmera" por produto.
 *
 * O salvamento é EM LOTE, nunca por bipe: cada `salvarContagemInventarioAction`
 * é uma ida ao servidor, e quem conta uma gôndola bipa dezenas de itens por
 * minuto. Salva a cada 5 itens ou 20 segundos parado — o que vier primeiro.
 *
 * Offline não é escopo: se a rede cair, o aviso aparece e o botão de salvar
 * fica disponível para tentar de novo. O que foi digitado continua na tela.
 */
export function ContagemClient({ inventario }: { inventario: InventarioView }) {
  const router = useRouter();

  const [contagens, setContagens] = React.useState<Record<string, number>>(() =>
    Object.fromEntries(
      inventario.items
        .filter((i) => i.qtdContada != null)
        .map((i) => [i.productId, i.qtdContada as number]),
    ),
  );
  const [ordem, setOrdem] = React.useState<string[]>([]);
  const [alvo, setAlvo] = React.useState<InventarioItemView | null>(null);
  const [busca, setBusca] = React.useState("");
  // A câmera nasce desligada: quem abre a contagem muitas vezes vem conferir a
  // lista, e vídeo ligado no fundo come bateria e assusta quem não pediu.
  const [camera, setCamera] = React.useState(false);
  const [naoSalvos, setNaoSalvos] = React.useState(0);
  const [salvando, setSalvando] = React.useState(false);
  const [falhouSalvar, setFalhouSalvar] = React.useState(false);
  const [fechando, setFechando] = React.useState(false);

  const porEan = React.useMemo(() => {
    const m = new Map<string, InventarioItemView>();
    for (const i of inventario.items) {
      if (i.ean) m.set(i.ean, i);
      m.set(i.sku.toLowerCase(), i);
    }
    return m;
  }, [inventario.items]);

  const contagensRef = React.useRef(contagens);
  React.useEffect(() => {
    contagensRef.current = contagens;
  });

  /**
   * Envia o que já foi contado. Idempotente: manda o estado inteiro, não um
   * delta — reenviar não duplica nada.
   *
   * `mapa` é explícito porque o gatilho por volume dispara no mesmo tique em
   * que o item foi contado, antes de o ref ter sido atualizado pelo efeito.
   * Sem isso, o lote sairia sempre um item atrasado.
   */
  const salvar = React.useCallback(
    async (mapa?: Record<string, number>, silencioso = true) => {
      const fonte = mapa ?? contagensRef.current;
      const items = Object.entries(fonte).map(([productId, qtdContada]) => ({
        productId,
        qtdContada,
      }));
      if (items.length === 0) return;

      setSalvando(true);
      try {
        await salvarContagemInventarioAction({ inventoryId: inventario.id, items });
        setNaoSalvos(0);
        setFalhouSalvar(false);
        if (!silencioso) toast.success("Contagem salva.");
      } catch (e) {
        setFalhouSalvar(true);
        if (!silencioso) {
          toast.error(
            "Não foi possível salvar",
            e instanceof Error ? e.message : "Verifique a conexão.",
          );
        }
      } finally {
        setSalvando(false);
      }
    },
    [inventario.id],
  );

  // Gatilho por tempo: reinicia a cada item contado, então só dispara quando a
  // pessoa para. O gatilho por volume mora em `confirmar`.
  React.useEffect(() => {
    if (naoSalvos === 0) return;
    const t = setTimeout(() => void salvar(), MS_ATE_SALVAR);
    return () => clearTimeout(t);
  }, [naoSalvos, salvar]);

  const aoLerCodigo = React.useCallback(
    (codigo: string) => {
      const item =
        porEan.get(codigo) ?? porEan.get(codigo.toLowerCase()) ?? null;
      if (!item) {
        toast.error("Fora deste inventário", `Código ${codigo} não está no escopo.`);
        return;
      }
      setAlvo(item);
    },
    [porEan],
  );

  function confirmar(productId: string, quantidade: number) {
    // O próximo estado é calculado aqui, fora dos updaters: o gativo por volume
    // precisa do mapa JÁ com este item, e disparar efeito de dentro de um
    // updater rodaria duas vezes em modo estrito.
    const proximoMapa = { ...contagens, [productId]: quantidade };
    const proximoNaoSalvos = naoSalvos + 1;

    setContagens(proximoMapa);
    // Empurra para o FIM da fila de contados: quem conta uma gôndola quer o que
    // ainda falta no alto da tela, não o que acabou de sair da mão.
    setOrdem((prev) => [...prev.filter((p) => p !== productId), productId]);
    setAlvo(null);
    setNaoSalvos(proximoNaoSalvos);

    if (proximoNaoSalvos >= ITENS_ATE_SALVAR) void salvar(proximoMapa);
  }

  async function fechar() {
    const items = Object.entries(contagens).map(([productId, qtdContada]) => ({
      productId,
      qtdContada,
    }));
    if (items.length === 0) {
      toast.error("Nada contado", "Conte ao menos um item antes de encerrar.");
      return;
    }
    setFechando(true);
    try {
      await fecharInventarioAction({ inventoryId: inventario.id, items });
      toast.success("Inventário encerrado.", "Os saldos foram ajustados.");
      router.push("/m/estoque/contagem");
      router.refresh();
    } catch (e) {
      toast.error(
        "Não foi possível encerrar",
        e instanceof Error ? e.message : "Tente de novo.",
      );
      setFechando(false);
    }
  }

  const total = inventario.items.length;
  const contados = Object.keys(contagens).length;
  const divergentes = inventario.items.filter((i) => {
    const c = contagens[i.productId];
    return c != null && c !== i.qtdSistema;
  }).length;

  // O que falta contar primeiro; o que já foi contado desce para o fim, na
  // ordem em que foi contado (o último bipado é o último da lista).
  const lista = React.useMemo(() => {
    const pos = new Map(ordem.map((id, i) => [id, i]));
    const termo = busca.trim().toLowerCase();
    return [...inventario.items]
      .filter(
        (i) => !termo || `${i.nome} ${i.sku} ${i.ean ?? ""}`.toLowerCase().includes(termo),
      )
      .sort((a, b) => {
        const ca = contagens[a.productId] != null;
        const cb = contagens[b.productId] != null;
        if (ca !== cb) return ca ? 1 : -1;
        if (ca && cb) {
          // Contado em sessão anterior não está em `ordem`: vai antes dos desta
          // sessão, que é a ordem cronológica real.
          return (pos.get(a.productId) ?? -1) - (pos.get(b.productId) ?? -1);
        }
        return a.nome.localeCompare(b.nome, "pt-BR");
      });
  }, [inventario.items, ordem, contagens, busca]);

  return (
    <div className="space-y-3 pb-24">
      {camera && (
        <Scanner onCodigo={aoLerCodigo} continuo ocupado={alvo !== null} onFechar={() => setCamera(false)} />
      )}

      {/* Buscar pelo nome e bipar são a mesma pergunta ("qual produto agora?"),
          então moram na mesma linha — o leitor é o botão à direita. */}
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-faint"
            aria-hidden
          />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Achar produto pelo nome"
            aria-label="Buscar produto no inventário"
            className="min-h-11 w-full rounded-full border border-line-button bg-surface pr-4 pl-9 text-sm text-ink placeholder:text-faint focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
          />
        </div>

        <button
          type="button"
          onClick={() => setCamera((v) => !v)}
          aria-pressed={camera}
          aria-label={camera ? "Fechar o leitor" : "Ler código de barras"}
          className={cn(
            "tap grid h-11 w-11 shrink-0 place-items-center rounded-full border transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none",
            camera
              ? "border-brand bg-brand text-on-brand"
              : "border-line-button bg-surface text-ink",
          )}
        >
          <ScanLine className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <ul className="space-y-1.5">
        {lista.map((i) => {
          const c = contagens[i.productId];
          const diverge = c != null && c !== i.qtdSistema;
          return (
            <li key={i.productId}>
              <button
                type="button"
                onClick={() => setAlvo(i)}
                className="w-full text-left"
              >
                <Card
                  className={cn(
                    "flex items-center gap-3 p-3",
                    c != null && "border-ok/40 bg-ok-soft/30",
                  )}
                >
                  {/* Foto no lugar do ícone de estado: na gôndola quem identifica
                      o produto é a embalagem, não o nome. O visto de "já contei"
                      vira selo no canto da miniatura. */}
                  <span className="relative shrink-0">
                    {i.imagemUrl ? (
                      /* <img> cru como no resto do app: a URL é arbitrária
                         (Cosmos ou upload do tenant) e next/image exigiria
                         allowlist por host. */
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={i.imagemUrl}
                        alt=""
                        className="h-12 w-12 rounded-lg border border-line bg-surface object-contain"
                      />
                    ) : (
                      <span className="grid h-12 w-12 place-items-center rounded-lg border border-line bg-surface-2 text-muted">
                        <PackageOpen className="h-5 w-5" aria-hidden />
                      </span>
                    )}
                    {c != null && (
                      <span
                        className="absolute -right-1 -bottom-1 grid h-5 w-5 place-items-center rounded-full bg-ok text-white ring-2 ring-surface"
                        aria-hidden
                      >
                        <Check className="h-3 w-3" />
                      </span>
                    )}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{i.nome}</span>
                    {/* SKU e código de barras na MESMA linha: o SKU é o que
                        está na etiqueta da prateleira, o EAN é o que a pessoa
                        bipa — conferir os dois é o gesto da contagem. */}
                    <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted">
                      <span className="truncate">{i.sku}</span>
                      {i.ean && (
                        <>
                          <span className="shrink-0 text-faint" aria-hidden>
                            ·
                          </span>
                          <span className="truncate">{i.ean}</span>
                        </>
                      )}
                    </span>
                    {i.locationNome && (
                      <span className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-2">
                        <IconeLocal tipo={i.locationTipo} />
                        <span className="truncate">{i.locationNome}</span>
                      </span>
                    )}
                  </span>

                  <span className="shrink-0 text-right">
                    {c != null ? (
                      <>
                        <span className="block font-display text-lg leading-none font-semibold text-ink tabular-nums">
                          {c.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}
                        </span>
                        {/* Em contagem cega a divergência não aparece: mostrar
                            já denunciaria o saldo do sistema. */}
                        {diverge && !inventario.modoCego && (
                          <span className="text-[11px] font-medium text-warn">
                            sistema {i.qtdSistema.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}
                          </span>
                        )}
                      </>
                    ) : inventario.modoCego ? (
                      <span className="text-[11px] text-faint">a contar</span>
                    ) : (
                      /* Contagem aberta: o saldo do sistema já aparece antes de
                         contar — é o número que a pessoa vai conferir. */
                      <>
                        <span className="block font-display text-lg leading-none font-semibold text-ink-2 tabular-nums">
                          {i.qtdSistema.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}
                        </span>
                        <span className="text-[11px] text-faint">no sistema</span>
                      </>
                    )}
                  </span>
                </Card>
              </button>
            </li>
          );
        })}
      </ul>

      {/* Barra flutuante acima da barra de abas do shell: a de abas ocupa
          ~4rem + respiro + área segura, então 5.5rem é o piso desta. Solta das
          laterais e com as quatro bordas arredondadas — é um cartão sobre a
          lista, não um rodapé colado na tela. */}
      <div className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-30 rounded-[var(--radius-lg)] border border-line bg-surface px-4 py-2 shadow-[var(--shadow-2)]">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-ink">
              {contados} de {total} contados
              {!inventario.modoCego && divergentes > 0 && (
                <span className="text-warn"> · {divergentes} divergência{divergentes > 1 ? "s" : ""}</span>
              )}
            </p>
            <p className="flex items-center gap-1 text-[11px] text-muted">
              {salvando ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> salvando…
                </>
              ) : falhouSalvar ? (
                <>
                  <CloudOff className="h-3 w-3 text-danger" aria-hidden />
                  <span className="text-danger">não salvo — toque em Salvar</span>
                </>
              ) : naoSalvos > 0 ? (
                `${naoSalvos} para salvar`
              ) : (
                "tudo salvo"
              )}
            </p>
          </div>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => void salvar(undefined, false)}
            disabled={salvando || naoSalvos === 0}
          >
            Salvar
          </Button>
          <Button size="sm" onClick={fechar} disabled={fechando || contados === 0}>
            {fechando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Encerrar
          </Button>
        </div>
      </div>

      {alvo && (
        <SheetContagem
          item={alvo}
          cego={inventario.modoCego}
          atual={contagens[alvo.productId] ?? null}
          onFechar={() => setAlvo(null)}
          onConfirmar={(q) => confirmar(alvo.productId, q)}
        />
      )}
    </div>
  );
}

/**
 * Cor do local de estoque. A cor É a informação: numa contagem de gôndola, o
 * que muda o percurso é "isso está no refrigerado?", não o nome da prateleira.
 * Mesmo par ícone/cor do cadastro de armazenagem no desktop.
 */
const LOCAL_ICONE: Record<StorageType, React.ElementType> = {
  AMBIENTE: Box,
  REFRIGERADO: Refrigerator,
  CONGELADO: Snowflake,
};
const LOCAL_COR: Record<StorageType, string> = {
  AMBIENTE: "text-brand",
  REFRIGERADO: "text-ok",
  CONGELADO: "text-blue-500",
};

function IconeLocal({ tipo }: { tipo: StorageType | null }) {
  const Icone = tipo ? LOCAL_ICONE[tipo] : Box;
  return (
    <Icone
      className={cn("h-3.5 w-3.5 shrink-0", tipo ? LOCAL_COR[tipo] : "text-faint")}
      aria-hidden
    />
  );
}

function SheetContagem({
  item,
  cego,
  atual,
  onFechar,
  onConfirmar,
}: {
  item: InventarioItemView;
  cego: boolean;
  atual: number | null;
  onFechar: () => void;
  onConfirmar: (q: number) => void;
}) {
  const [valor, setValor] = React.useState(atual != null ? String(atual).replace(".", ",") : "");
  const q = paraNumero(valor);

  return (
    <BottomSheet
      open
      onClose={onFechar}
      titulo={item.nome}
      descricao={<span className="font-mono text-xs">{item.sku}</span>}
      rodape={
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onFechar} className="flex-1" size="lg">
            <X className="h-4 w-4" aria-hidden />
            Cancelar
          </Button>
          <Button
            onClick={() => onConfirmar(q)}
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
        {!cego && (
          <div className="flex justify-center">
            <Badge tone="neutral">
              sistema: {item.qtdSistema.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}
            </Badge>
          </div>
        )}
        <VisorQuantidade valor={valor} />
        <TecladoNumerico valor={valor} onChange={setValor} decimais={3} />
      </div>
    </BottomSheet>
  );
}
