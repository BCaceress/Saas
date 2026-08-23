"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  ClipboardList,
  Image as ImageIcon,
  ScanLine,
  ShoppingCart,
  Tag,
  Truck,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import { useContextoAcoes } from "@/components/mobile/contexto-acoes";
import {
  registrarOperacao,
  useOperacoesRecentes,
} from "@/components/mobile/recentes-operacoes";
import { useAlerts } from "@/components/app/alerts-provider";
import { podeEmAlguma, type Acesso, type Permissao } from "@/lib/permissoes";
import type { NavToggles } from "@/components/app/nav-config";

// ============================================================
// Nova operação — o menu do botão do meio.
//
// A lista responde "o que eu vim fazer aqui", e não "para qual módulo eu vou".
// Por isso os rótulos são verbos e a ordem é a frequência de quem está de pé na
// loja, não a ordem dos módulos no menu do desktop.
//
// A divisão com o "Menu" é essa e não tem exceção: aqui só entra operação de
// CHÃO — algo que se faz com o produto na mão, quase sempre começando por um
// bipe. Lugar (lista, cadastro, relatório) mora no "Menu". Enquanto os dois
// menus repetiam os mesmos cinco destinos, ninguém aprendia qual abrir.
//
// Escanear é o primeiro e o maior: quase toda operação começa por um produto, e
// a maioria das telas abaixo abre a câmera de qualquer jeito. Quem só quer
// consultar não deveria pagar dois toques — daí o alvo grande no topo, separado
// da grade.
// ============================================================

type Operacao = {
  /** Id estável — chave da memória de uso recente. Não muda com o rótulo. */
  chave: string;
  href: string;
  label: string;
  descricao: string;
  icone: LucideIcon;
  /** TODAS exigidas. Ação que passa pelo scanner também precisa de `produto.ver`. */
  permissoes?: Permissao[];
  mostrar?: (t: NavToggles) => boolean;
  /** Só faz sentido com mais de um local: transferir para onde, senão? */
  exigeMultiSite?: boolean;
  /**
   * A linha mostra o número de alertas do destino.
   *
   * Só onde o href É o assunto. "Registrar perda" aponta para o scanner, e as
   * duas que apontavam para `/m/estoque` exibiam o total de alertas de estoque
   * — o mesmo número nas duas, sem relação nenhuma com perda ou transferência.
   */
  badge?: boolean;
};

const OPERACOES: Operacao[] = [
  {
    chave: "receber",
    href: "/m/receber",
    label: "Receber mercadoria",
    descricao: "Conferir pedido item a item",
    icone: Truck,
    permissoes: ["compras.receber"],
    badge: true,
  },
  {
    chave: "inventario",
    href: "/m/estoque/contagem",
    label: "Inventário",
    descricao: "Contar a prateleira",
    icone: ClipboardList,
    permissoes: ["estoque.inventario"],
    badge: true,
  },
  // Perda, transferência e ajuste precisam de um PRODUTO, e o produto vem da
  // câmera. Antes apontavam para `/m/estoque`, onde a pessoa caía numa lista
  // sem nenhuma pista de como executar o que o menu prometeu — a folha de ação
  // só abre a partir de uma linha da lista. Agora o bipe carrega a intenção
  // (`?acao=`) e a folha certa sobe junto com a ficha.
  {
    chave: "transferencia",
    href: "/m/scan?acao=transferencia",
    label: "Transferência",
    descricao: "Bipe o produto que vai para outra loja",
    icone: ArrowLeftRight,
    permissoes: ["estoque.transferir", "produto.ver"],
    exigeMultiSite: true,
  },
  {
    chave: "perda",
    href: "/m/scan?acao=perda",
    label: "Registrar perda",
    descricao: "Quebra, vencimento, avaria",
    icone: TriangleAlert,
    permissoes: ["estoque.ajustar", "produto.ver"],
  },
  {
    chave: "preco",
    href: "/m/encarte",
    label: "Alterar preço",
    descricao: "Um produto ou um encarte inteiro",
    icone: ImageIcon,
    permissoes: ["produto.preco"],
  },
  {
    chave: "etiquetas",
    href: "/m/etiquetas",
    label: "Etiquetas",
    descricao: "Fila de impressão",
    icone: Tag,
    permissoes: ["produto.preco"],
  },
  {
    chave: "pedido",
    href: "/m/pedido",
    label: "Pedido de compra",
    descricao: "Bipar o que falta",
    icone: ShoppingCart,
    permissoes: ["compras.pedir"],
  },
  // Cotação NÃO entra: é trabalho de mesa, com tela própria e botão de criar
  // dentro dela — nada aqui começa com o produto na mão. Ela vive no "Menu",
  // como lugar.
];

export function NovaOperacaoSheet({
  open,
  onClose,
  acessos,
  toggles,
  multiSite,
}: {
  open: boolean;
  onClose: () => void;
  acessos: Acesso[];
  toggles: NavToggles;
  /** A empresa tem mais de um local ativo. */
  multiSite: boolean;
}) {
  const router = useRouter();
  const { contar } = useAlerts();
  const recentes = useOperacoesRecentes();
  // Só para saber se há contagem parada. Memorizado por aba (`contexto-acoes`),
  // e a ficha do produto já paga essa viagem — aqui costuma vir do cache.
  const ctx = useContextoAcoes();

  const visiveis = React.useMemo(() => {
    const permitidas = OPERACOES.filter(
      (o) =>
        (!o.mostrar || o.mostrar(toggles)) &&
        (!o.exigeMultiSite || multiSite) &&
        (o.permissoes ?? []).every((p) => podeEmAlguma(acessos, p)),
    );

    // Recentes primeiro, na ordem de uso; o resto mantém a ordem canônica —
    // que é a memória de posição de quem já decorou a folha.
    const posicao = (o: Operacao) => {
      const i = recentes.indexOf(o.chave);
      return i === -1 ? recentes.length : i;
    };
    return permitidas
      .map((o, i) => ({ o, i }))
      .sort((a, b) => posicao(a.o) - posicao(b.o) || a.i - b.i)
      .map(({ o }) => o);
  }, [acessos, toggles, multiSite, recentes]);

  function ir(o: Operacao) {
    registrarOperacao(o.chave);
    onClose();
    router.push(o.href);
  }

  const contagensAbertas = ctx?.inventariosAbertos ?? 0;

  return (
    <BottomSheet open={open} onClose={onClose} titulo="Nova operação">
      <div className="space-y-3 pb-2">
        {podeEmAlguma(acessos, "produto.ver") && (
          <button
            type="button"
            onClick={() => {
              onClose();
              router.push("/m/scan");
            }}
            className={cn(
              "flex min-h-16 w-full cursor-pointer items-center gap-3 rounded-xl bg-brand px-4 text-left text-on-brand",
              "focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none",
            )}
          >
            <ScanLine className="h-6 w-6 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block font-display text-base font-semibold">
                Escanear produto
              </span>
              <span className="block text-[13px] opacity-80">
                Código de barras, nota fiscal ou QR do pedido
              </span>
            </span>
          </button>
        )}

        {visiveis.length > 0 && (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
            {visiveis.map((o) => {
              // Contagem parada troca o rótulo: "Inventário" e "retomar" levam
              // ao mesmo lugar, mas só um avisa que há trabalho pela metade.
              const retomar = o.chave === "inventario" && contagensAbertas > 0;
              const alertas = o.badge ? contar(o.href.split("?")[0]) : 0;

              return (
                <li key={o.chave}>
                  <button
                    type="button"
                    onClick={() => ir(o)}
                    className="flex min-h-14 w-full cursor-pointer items-center gap-3 bg-surface px-4 py-2 text-left transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                  >
                    <o.icone className="h-5 w-5 shrink-0 text-ink-2" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink">
                        {retomar ? "Retomar contagem" : o.label}
                      </span>
                      <span className="block text-xs text-muted">
                        {retomar
                          ? contagensAbertas === 1
                            ? "Uma contagem parada no meio"
                            : `${contagensAbertas} contagens paradas no meio`
                          : o.descricao}
                      </span>
                    </span>
                    {/* O que já está esperando por você entra como número, não
                        como bolinha: "2 pedidos" muda a decisão, "tem algo" não. */}
                    {alertas > 0 && (
                      <span className="shrink-0 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-semibold text-danger">
                        {alertas}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {visiveis.length === 0 && !podeEmAlguma(acessos, "produto.ver") && (
          <p className="py-6 text-center text-sm text-muted">
            Seu perfil não tem operações disponíveis aqui.
          </p>
        )}
      </div>
    </BottomSheet>
  );
}
