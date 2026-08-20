"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  ClipboardList,
  Handshake,
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
// Escanear é o primeiro e o maior: quase toda operação começa por um produto, e
// a maioria das telas abaixo abre a câmera de qualquer jeito. Quem só quer
// consultar não deveria pagar dois toques — daí o alvo grande no topo, separado
// da grade.
// ============================================================

type Operacao = {
  href: string;
  label: string;
  descricao: string;
  icone: LucideIcon;
  permissao?: Permissao;
  mostrar?: (t: NavToggles) => boolean;
  /** Só faz sentido com mais de um local: transferir para onde, senão? */
  exigeMultiSite?: boolean;
};

const OPERACOES: Operacao[] = [
  {
    href: "/m/receber",
    label: "Receber mercadoria",
    descricao: "Conferir pedido item a item",
    icone: Truck,
    permissao: "compras.receber",
  },
  {
    href: "/m/estoque/contagem",
    label: "Inventário",
    descricao: "Contar a prateleira",
    icone: ClipboardList,
    permissao: "estoque.inventario",
  },
  {
    href: "/m/estoque?filtro=transferir",
    label: "Transferência",
    descricao: "Mandar para outra loja",
    icone: ArrowLeftRight,
    permissao: "estoque.transferir",
    exigeMultiSite: true,
  },
  {
    href: "/m/estoque",
    label: "Registrar perda",
    descricao: "Quebra, vencimento, avaria",
    icone: TriangleAlert,
    permissao: "estoque.ajustar",
  },
  {
    href: "/m/encarte",
    label: "Alterar preço",
    descricao: "Um produto ou um encarte inteiro",
    icone: ImageIcon,
    permissao: "produto.preco",
  },
  {
    href: "/m/etiquetas",
    label: "Etiquetas",
    descricao: "Fila de impressão",
    icone: Tag,
    permissao: "produto.preco",
  },
  {
    href: "/m/pedido",
    label: "Pedido de compra",
    descricao: "Bipar o que falta",
    icone: ShoppingCart,
    permissao: "compras.pedir",
  },
  {
    href: "/m/cotacoes",
    label: "Cotação",
    descricao: "Pedir preço a vários fornecedores",
    icone: Handshake,
    permissao: "compras.pedir",
  },
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

  const visiveis = React.useMemo(
    () =>
      OPERACOES.filter(
        (o) =>
          (!o.mostrar || o.mostrar(toggles)) &&
          (!o.exigeMultiSite || multiSite) &&
          (!o.permissao || podeEmAlguma(acessos, o.permissao)),
      ),
    [acessos, toggles, multiSite],
  );

  function ir(href: string) {
    onClose();
    router.push(href);
  }

  return (
    <BottomSheet open={open} onClose={onClose} titulo="Nova operação">
      <div className="space-y-3 pb-2">
        {podeEmAlguma(acessos, "produto.ver") && (
          <button
            type="button"
            onClick={() => ir("/m/scan")}
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
              const alertas = contar(o.href.split("?")[0]);
              return (
                <li key={o.label}>
                  <button
                    type="button"
                    onClick={() => ir(o.href)}
                    className="flex min-h-14 w-full cursor-pointer items-center gap-3 bg-surface px-4 py-2 text-left transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                  >
                    <o.icone className="h-5 w-5 shrink-0 text-ink-2" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink">{o.label}</span>
                      <span className="block text-xs text-muted">{o.descricao}</span>
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
