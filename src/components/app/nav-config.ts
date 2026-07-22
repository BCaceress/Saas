import {
  LayoutDashboard,
  Boxes,
  Warehouse,
  Users,
  ShoppingCart,
  ShoppingBag,
  ClipboardList,
  BarChart3,
  Wallet,
  Recycle,
  Truck,
  Factory,
  MonitorSmartphone,
  ReceiptText,
  type LucideIcon,
} from "lucide-react";
import { podeEmAlguma, type Acesso, type Permissao } from "@/lib/permissoes";

/**
 * Mapa único de navegação do app — fonte de verdade para Sidebar e PageHeader.
 * Ícone, rótulo e rota vivem aqui; sidebar e cabeçalhos consomem o mesmo item,
 * então menu e página nunca divergem.
 */

export type NavToggles = {
  moduloPdv: boolean;
  moduloComodato: boolean;
  moduloRota: boolean;
  moduloAutoatendimento: boolean;
  moduloFiscal: boolean;
};

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Módulo implementado? false = "Em breve" (não navegável). */
  enabled: boolean;
  /** Visibilidade condicionada aos toggles do tenant (default: sempre). */
  show?: (t: NavToggles) => boolean;
  /** Permissão mínima para ver o item. O guard da rota exige a MESMA. */
  permissao?: Permissao;
};

export type NavGroup = { title: string | null; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    title: null,
    items: [
      {
        href: "/inicio",
        label: "Dashboard",
        icon: LayoutDashboard,
        enabled: true,
        permissao: "relatorio.ver",
      },
    ],
  },
  {
    title: "Gestão",
    items: [
      {
        href: "/produtos",
        label: "Produtos",
        icon: Boxes,
        enabled: true,
        // Tela de gestão do catálogo. `produto.ver` é consulta (PDV, estoque) e
        // não basta para abrir o cadastro.
        permissao: "produto.editar",
      },
      {
        href: "/clientes",
        label: "Clientes",
        icon: Users,
        enabled: true,
        permissao: "cliente.ver",
      },
      {
        href: "/fornecedores",
        label: "Fornecedores",
        icon: Factory,
        enabled: true,
        permissao: "fornecedor.ver",
      },
      {
        href: "/estoque",
        label: "Estoque",
        icon: Warehouse,
        enabled: true,
        permissao: "estoque.ver",
      },
      {
        href: "/compras",
        label: "Pedidos de Compra",
        icon: ShoppingBag,
        enabled: true,
        permissao: "compras.ver",
      },
    ],
  },
  {
    title: "Operação",
    items: [
      {
        href: "/vendas",
        label: "PDV",
        icon: ShoppingCart,
        enabled: true,
        show: (t) => t.moduloPdv,
        permissao: "venda.registrar",
      },
      {
        href: "/totem",
        label: "Autoatendimento",
        icon: MonitorSmartphone,
        enabled: true,
        show: (t) => t.moduloAutoatendimento,
        permissao: "venda.registrar",
      },
      { href: "/pedidos", label: "Pedidos", icon: ClipboardList, enabled: false },
      {
        href: "/rota",
        label: "Reposição",
        icon: Truck,
        enabled: false,
        show: (t) => t.moduloRota,
      },
      {
        href: "/comodato",
        label: "Comodato",
        icon: Recycle,
        enabled: true,
        show: (t) => t.moduloComodato,
        permissao: "estoque.ver",
      },
      {
        href: "/fiscal",
        label: "Fiscal",
        icon: ReceiptText,
        enabled: true,
        show: (t) => t.moduloFiscal,
        permissao: "fiscal.ver",
      },
      { href: "/financeiro", label: "Financeiro", icon: Wallet, enabled: false },
      {
        href: "/relatorios",
        label: "Análises",
        icon: BarChart3,
        enabled: true,
        permissao: "relatorio.ver",
      },
    ],
  },
];

const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

/**
 * Ícone do menu para uma rota — casa o prefixo mais específico
 * (ex.: /configuracoes/usuarios vence /configuracoes).
 */
export function navIcon(href: string): LucideIcon | undefined {
  const match = ALL_ITEMS.filter(
    (i) => href === i.href || href.startsWith(i.href + "/"),
  ).sort((a, b) => b.href.length - a.href.length)[0];
  return match?.icon;
}

/** O item aparece para quem tem esses acessos? */
export function podeVerItem(item: NavItem, acessos: Acesso[]): boolean {
  return !item.permissao || podeEmAlguma(acessos, item.permissao);
}

/**
 * Ordem de "casa" — não é a ordem do menu. Quem opera caixa aterrissa no PDV,
 * quem cuida de estoque no estoque; só quem enxerga números começa no painel.
 */
const PRIORIDADE_INICIAL = [
  "/inicio",
  "/vendas",
  "/estoque",
  "/compras",
  "/produtos",
  "/clientes",
  "/fornecedores",
  "/relatorios",
];

/**
 * Primeira rota que a pessoa pode abrir — destino de quem cai numa tela sem
 * permissão. null = não pode nada (cai em /sem-acesso).
 */
export function rotaInicial(acessos: Acesso[], toggles: NavToggles): string | null {
  const disponivel = (i: NavItem) =>
    i.enabled && (i.show ? i.show(toggles) : true) && podeVerItem(i, acessos);

  for (const href of PRIORIDADE_INICIAL) {
    const item = ALL_ITEMS.find((i) => i.href === href);
    if (item && disponivel(item)) return href;
  }
  return ALL_ITEMS.find(disponivel)?.href ?? null;
}
