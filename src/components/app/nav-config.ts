import {
  LayoutDashboard,
  Boxes,
  Warehouse,
  Users,
  ShoppingCart,
  Handshake,
  ShoppingBag,
  ClipboardList,
  ClipboardCheck,
  BarChart3,
  Recycle,
  Truck,
  Factory,
  MonitorSmartphone,
  ReceiptText,
  FileUp,
  History,
  Inbox,
  Settings,
  Building2,
  UserCog,
  Blocks,
  CreditCard,
  Store,
  Bell,
  Gift,
  Wallet,
  Tags,
  PackagePlus,
  PackageCheck,
  CalendarClock,
  SlidersHorizontal,
  ArrowRightLeft,
  Layers,
  Percent,
  ChartColumnBig,
  TriangleAlert,
  LineChart,
  Sparkles,
  Undo2,
  HandCoins,
  type LucideIcon,
} from "lucide-react";
import { podeEmAlguma, type Acesso, type Permissao } from "@/lib/permissoes";

/**
 * Mapa único de navegação do app — fonte de verdade para sidebar, drawer do
 * celular, abas de módulo, badges e paleta de comandos. A barra de polegar da
 * superfície `/m` NÃO sai daqui: ela tem config própria em
 * `components/mobile/nav.ts`.
 *
 * O mapa é COMPLETO: descreve também as telas que não cabem na sidebar
 * (`ocultoNoMenu`). Cada consumidor filtra o que precisa — assim menu, abas e
 * busca nunca divergem, que era o que acontecia quando cada tela reescrevia a
 * própria lista de abas à mão.
 *
 * Fora do mapa de propósito: rotas que são só `redirect()` (ex.
 * /estoque/producao, /compras/revisar, /relatorios/ia). Elas não são destino —
 * listá-las criaria dois caminhos para a mesma tela.
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
  /** Frase curta: subtítulo da aba do módulo, do flyout e da linha na paleta. */
  descricao?: string;
  /**
   * Existe para as abas do módulo e para a paleta, mas não entra na sidebar.
   * É como o mapa fica completo sem o menu virar uma lista de 40 linhas.
   */
  ocultoNoMenu?: boolean;
  /**
   * Tela com cabeçalho próprio: fica fora da barra de abas do módulo, e a
   * barra some enquanto ela está aberta.
   */
  semAbas?: boolean;
  /**
   * Pai que também é tela: o próprio href renderiza uma página (a Central de
   * Relatórios, por exemplo), então ele vale como destino — inclusive de
   * `rotaInicial`, que fora isso só considera folhas.
   */
  indice?: boolean;
  /**
   * Subitens. O pai vira uma gaveta: abre ao clicar e já nasce aberta quando
   * a tela atual é uma das filhas. Um pai só aparece se sobrar ao menos uma
   * filha visível — a permissão mora na filha, não no pai.
   */
  children?: NavItem[];
};

export type NavGroup = {
  title: string | null;
  items: NavItem[];
  /** Grupo ancorado no rodapé da sidebar (Configurações). */
  rodape?: boolean;
};

export const NAV_GROUPS: NavGroup[] = [
  {
    title: null,
    items: [
      {
        href: "/inicio",
        label: "Início",
        icon: LayoutDashboard,
        enabled: true,
        permissao: "relatorio.ver",
        descricao: "O dia da loja num relance.",
      },
    ],
  },
  {
    title: "Vender",
    items: [
      {
        href: "/vendas",
        label: "PDV",
        icon: ShoppingCart,
        enabled: true,
        show: (t) => t.moduloPdv,
        permissao: "venda.registrar",
        descricao: "Registrar vendas e fechar o caixa.",
      },
      {
        href: "/totem",
        label: "Autoatendimento",
        icon: MonitorSmartphone,
        enabled: true,
        show: (t) => t.moduloAutoatendimento,
        permissao: "venda.registrar",
        descricao: "Fila e configuração dos quiosques.",
      },
      {
        href: "/clientes",
        label: "Clientes",
        icon: Users,
        enabled: true,
        permissao: "cliente.ver",
        descricao: "Cadastro, fidelização e clientes em risco.",
      },
    ],
  },
  {
    title: "Estoque",
    items: [
      {
        href: "/estoque",
        label: "Estoque",
        icon: Warehouse,
        enabled: true,
        // O guard mora em estoque/layout.tsx (`estoque.ver`) — toda filha herda.
        children: [
          {
            href: "/estoque",
            label: "Saldos",
            icon: Layers,
            enabled: true,
            permissao: "estoque.ver",
            descricao: "O que tem em casa, o que falta e o que precisa repor.",
          },
          {
            href: "/estoque/movimentacoes",
            label: "Movimentações",
            icon: History,
            enabled: true,
            permissao: "estoque.ver",
            descricao: "Histórico auditável de tudo que entrou e saiu.",
          },
          {
            href: "/estoque/entradas",
            label: "Entradas",
            icon: PackagePlus,
            enabled: true,
            ocultoNoMenu: true,
            permissao: "estoque.ver",
            descricao: "Lançamentos que aumentaram o saldo.",
          },
          {
            href: "/estoque/recebimentos",
            label: "Recebimentos",
            icon: PackageCheck,
            enabled: true,
            ocultoNoMenu: true,
            permissao: "compras.receber",
            descricao: "Conferir o que o fornecedor entregou.",
          },
          {
            href: "/estoque/validade",
            label: "Validade",
            icon: CalendarClock,
            enabled: true,
            permissao: "estoque.ver",
            descricao: "Lotes vencendo e vencidos, por prioridade.",
          },
          {
            href: "/estoque/inventarios",
            label: "Inventários",
            icon: ClipboardList,
            enabled: true,
            permissao: "estoque.inventario",
            descricao: "Contagens e divergências apuradas.",
          },
          {
            href: "/estoque/ajustes",
            label: "Ajustes",
            icon: SlidersHorizontal,
            enabled: true,
            ocultoNoMenu: true,
            permissao: "estoque.ajustar",
            descricao: "Corrigir saldo com motivo registrado.",
          },
          {
            href: "/estoque/transferencias",
            label: "Transferências",
            icon: ArrowRightLeft,
            enabled: true,
            ocultoNoMenu: true,
            permissao: "estoque.transferir",
            descricao: "Movimentar produtos entre locais.",
          },
          {
            href: "/estoque/requisicoes",
            label: "Requisições",
            icon: ClipboardCheck,
            enabled: true,
            ocultoNoMenu: true,
            permissao: "estoque.transferir",
            descricao: "Pedidos de um local para outro.",
          },
          {
            // Fica em Estoque porque é onde a mercadoria some do saldo, mas o
            // documento é de Compras: aponta para o pedido, a nota e o título.
            href: "/estoque/devolucoes",
            label: "Devoluções",
            icon: Undo2,
            enabled: true,
            ocultoNoMenu: true,
            permissao: "compras.devolver",
            descricao: "Mercadoria que volta ao fornecedor — e o crédito que vem junto.",
          },
        ],
      },
      {
        href: "/produtos",
        label: "Produtos",
        icon: Boxes,
        enabled: true,
        // Tela de gestão do catálogo. `produto.ver` é consulta (PDV, estoque) e
        // não basta para abrir o cadastro.
        permissao: "produto.editar",
        descricao: "Catálogo, preço e ficha de cada item.",
      },
    ],
  },
  {
    title: "Comprar",
    items: [
      {
        href: "/cotacoes",
        label: "Cotações",
        icon: Handshake,
        enabled: true,
        // Cotações é o planejamento: o que comprar, de quem e por quanto. A
        // configuração de cada fornecedor (integração, catálogo, condições)
        // mora em /fornecedores/[id]. Pedidos e Recebimentos já foram um
        // submenu daqui — agora são módulos irmãos, cada um destino final por
        // si, sem pai em comum.
        children: [
          {
            href: "/cotacoes",
            label: "Planejamento",
            icon: LayoutDashboard,
            enabled: true,
            // Mesmo href do pai (a gaveta também é tela). `ocultoNoMenu`: com
            // toda filha oculta, `NavGrupo` renderiza o pai como item comum
            // (sem seta/gaveta) — só "Cotações", sem submenu — e o próprio
            // href do pai vira o candidato de rota ativa (`acharAtivo`).
            semAbas: true,
            ocultoNoMenu: true,
            permissao: "compras.ver",
            descricao:
              "Planeje reposições antes de enviar pedidos aos fornecedores.",
          },
          {
            href: "/cotacoes/respostas",
            label: "Respostas",
            icon: Inbox,
            enabled: true,
            ocultoNoMenu: true,
            permissao: "compras.ver",
            descricao:
              "Tudo que os fornecedores mandaram — cotação, arquivo ou integração — na ordem em que chegou.",
          },
          {
            href: "/cotacoes/importacoes",
            label: "Importações",
            icon: FileUp,
            enabled: true,
            ocultoNoMenu: true,
            permissao: "compras.ver",
            descricao: "Todo arquivo e sincronização que já alimentou uma tabela de preço.",
          },
          {
            href: "/cotacoes/historico",
            label: "Histórico",
            icon: History,
            enabled: true,
            ocultoNoMenu: true,
            permissao: "compras.ver",
            descricao:
              "Como o preço de cada item se moveu e quanto isso já economizou.",
          },
          {
            href: "/cotacoes/reposicao-inteligente",
            label: "Reposição inteligente",
            icon: Recycle,
            enabled: true,
            ocultoNoMenu: true,
            semAbas: true,
            permissao: "compras.pedir",
            descricao: "Sugestões de compra a partir do giro e da previsão de ruptura.",
          },
        ],
      },
      {
        href: "/pedidos",
        label: "Pedidos",
        icon: ClipboardList,
        enabled: true,
        permissao: "compras.ver",
        descricao: "Acompanhe seus pedidos de compra do envio à conclusão.",
      },
      {
        // Item de menu de novo (a pedido do usuário): /recebimento passou a
        // ser a listagem do que efetivamente chegou — vinculado a pedido ou
        // avulso — não só a tela de conferência de uma nota (/recebimento/[id]).
        href: "/recebimento",
        label: "Recebimentos",
        icon: PackageCheck,
        enabled: true,
        semAbas: true,
        permissao: "compras.receber",
        descricao:
          "O que efetivamente chegou na loja — vinculado a um pedido ou avulso.",
      },
      {
        href: "/fornecedores",
        label: "Fornecedores",
        icon: Truck,
        enabled: true,
        permissao: "fornecedor.ver",
        descricao:
          "O centro de gestão de cada parceiro: cadastro, integração, catálogo, preços e financeiro.",
      },
      {
        // Financeiro nasceu dentro de Comprar (contas a pagar é consequência
        // direta da mercadoria que entrou) e cresceu para as duas pontas do
        // caixa. Fica aqui, e não em Gestão, porque quem compra é quem sabe se
        // o boleto bate com a nota.
        href: "/financeiro/fluxo-de-caixa",
        label: "Financeiro",
        icon: Wallet,
        enabled: true,
        indice: true,
        permissao: "financeiro.ver",
        descricao: "Contas a pagar, a receber e o caixa projetado.",
        children: [
          {
            href: "/financeiro/fluxo-de-caixa",
            label: "Fluxo de caixa",
            icon: LineChart,
            enabled: true,
            permissao: "financeiro.ver",
            descricao: "O que entra e o que sai, dia a dia, com saldo acumulado.",
          },
          {
            href: "/financeiro/contas-a-pagar",
            label: "Contas a pagar",
            icon: Wallet,
            enabled: true,
            permissao: "financeiro.ver",
            descricao: "O que a loja deve aos fornecedores, por vencimento.",
          },
          {
            href: "/financeiro/contas-a-receber",
            label: "Contas a receber",
            icon: HandCoins,
            enabled: true,
            permissao: "financeiro.ver",
            descricao: "Venda a prazo, comodato faturado e aluguel de espaço.",
          },
        ],
      },
    ],
  },
  {
    title: "Gestão",
    items: [
      {
        // Item direto, não gaveta: a Central JÁ é o índice de todos os
        // relatórios, com busca, favoritos e categorias. Repetir treze links
        // aqui seria o menu gigante que a Central existe para acabar — então as
        // telas de relatório ficam no mapa (paleta, ícone, rota ativa) com
        // `ocultoNoMenu`, e o menu tem uma linha só.
        href: "/relatorios",
        label: "Relatórios",
        icon: BarChart3,
        enabled: true,
        permissao: "relatorio.ver",
        descricao: "Central de relatórios: busca, favoritos, exportação e histórico.",
        indice: true,
        children: [
          {
            href: "/relatorios/lista",
            label: "Assistente e documentos",
            icon: Sparkles,
            enabled: true,
            ocultoNoMenu: true,
            permissao: "relatorio.ver",
            descricao: "Pergunte à IA e recupere os PDFs gerados neste navegador.",
          },
          {
            href: "/relatorios/consulta",
            label: "Consulta",
            icon: Sparkles,
            enabled: true,
            ocultoNoMenu: true,
            semAbas: true,
            permissao: "relatorio.ver",
            descricao: "Monte o relatório que você precisa e leve em CSV ou PDF.",
          },
          {
            href: "/relatorios/dashboard",
            label: "Painel",
            icon: LineChart,
            enabled: true,
            ocultoNoMenu: true,
            permissao: "relatorio.ver",
            descricao: "Faturamento, categorias e tendência do período.",
          },
          {
            href: "/relatorios/vendas",
            label: "Vendas",
            icon: ShoppingCart,
            enabled: true,
            ocultoNoMenu: true,
            permissao: "relatorio.ver",
            descricao: "Curva do dia, mix de pagamento e ranking de produtos.",
          },
          {
            href: "/relatorios/estoque",
            label: "Estoque",
            icon: Warehouse,
            enabled: true,
            ocultoNoMenu: true,
            permissao: "relatorio.ver",
            descricao: "Posição, valor parado e ruptura.",
          },
          {
            href: "/relatorios/margem",
            label: "Margem",
            icon: Percent,
            enabled: true,
            ocultoNoMenu: true,
            permissao: "relatorio.financeiro",
            descricao: "Receita, CMV e margem de cada produto.",
          },
          {
            href: "/relatorios/abc",
            label: "Curva ABC",
            icon: ChartColumnBig,
            enabled: true,
            ocultoNoMenu: true,
            permissao: "relatorio.ver",
            descricao: "Quais produtos concentram o faturamento.",
          },
          {
            href: "/relatorios/compras",
            label: "Compras",
            icon: ShoppingBag,
            enabled: true,
            ocultoNoMenu: true,
            permissao: "relatorio.ver",
            descricao: "Entradas por produto e por fornecedor.",
          },
          {
            href: "/relatorios/perdas",
            label: "Perdas",
            icon: TriangleAlert,
            enabled: true,
            ocultoNoMenu: true,
            permissao: "relatorio.ver",
            descricao: "O que foi baixado como perda e quanto custou.",
          },
          {
            href: "/relatorios/pagamentos",
            label: "Pagamentos",
            icon: Wallet,
            enabled: true,
            ocultoNoMenu: true,
            permissao: "relatorio.financeiro",
            descricao: "Mix de recebimento e fechamentos de caixa.",
          },
          {
            href: "/relatorios/producao",
            label: "Produção",
            icon: Factory,
            enabled: true,
            ocultoNoMenu: true,
            permissao: "relatorio.ver",
            descricao: "Consumo de insumos e rendimento das fichas.",
          },
          {
            href: "/relatorios/fiscal",
            label: "Fiscal",
            icon: ReceiptText,
            enabled: true,
            ocultoNoMenu: true,
            show: (t) => t.moduloFiscal,
            permissao: "fiscal.ver",
            descricao: "Documentos emitidos e situação junto à SEFAZ.",
          },
        ],
      },
      {
        href: "/fiscal",
        label: "Fiscal",
        icon: ReceiptText,
        enabled: true,
        show: (t) => t.moduloFiscal,
        permissao: "fiscal.ver",
        descricao: "Emissão, manifestação e documentos recebidos.",
      },
      {
        href: "/comodato",
        label: "Comodato",
        icon: Recycle,
        enabled: true,
        show: (t) => t.moduloComodato,
        permissao: "estoque.ver",
        descricao: "Equipamentos emprestados e onde cada um está.",
      },
    ],
  },
  {
    title: null,
    rodape: true,
    items: [
      {
        href: "/configuracoes",
        label: "Configurações",
        icon: Settings,
        enabled: true,
        children: [
          {
            href: "/configuracoes/empresa",
            label: "Empresa",
            icon: Building2,
            enabled: true,
            permissao: "config.gerenciar",
            descricao: "Dados cadastrais, endereço e identidade da loja.",
          },
          {
            href: "/configuracoes/usuarios",
            label: "Usuários",
            icon: UserCog,
            enabled: true,
            permissao: "config.gerenciar",
            descricao: "Quem acessa o quê — perfis, convites e lojas.",
          },
          {
            href: "/configuracoes/modulos",
            label: "Módulos",
            icon: Blocks,
            enabled: true,
            permissao: "config.gerenciar",
            descricao: "Ligue e desligue o que a operação usa.",
          },
          {
            href: "/configuracoes/plano",
            label: "Plano",
            icon: CreditCard,
            enabled: true,
            permissao: "config.gerenciar",
            descricao: "Assinatura, add-ons e faturas.",
          },
          {
            href: "/configuracoes/sites",
            label: "Lojas e depósitos",
            icon: Store,
            enabled: true,
            ocultoNoMenu: true,
            permissao: "config.gerenciar",
            descricao: "Os locais onde há estoque e venda.",
          },
          {
            href: "/configuracoes/caixa",
            label: "Caixa",
            icon: Wallet,
            enabled: true,
            ocultoNoMenu: true,
            permissao: "config.gerenciar",
            descricao: "Abertura, sangria e limite de gaveta.",
          },
          {
            href: "/configuracoes/metodos-pagamento",
            label: "Métodos de pagamento",
            icon: CreditCard,
            enabled: true,
            ocultoNoMenu: true,
            permissao: "config.gerenciar",
            descricao: "Formas aceitas e taxas de cada uma.",
          },
          {
            href: "/configuracoes/estoque",
            label: "Regras de estoque",
            icon: Warehouse,
            enabled: true,
            ocultoNoMenu: true,
            permissao: "config.gerenciar",
            descricao: "Estratégia de reposição e alerta de validade.",
          },
          {
            href: "/configuracoes/fidelizacao",
            label: "Fidelização",
            icon: Gift,
            enabled: true,
            ocultoNoMenu: true,
            permissao: "config.gerenciar",
            descricao: "Pontos, cupons e régua de relacionamento.",
          },
          {
            href: "/configuracoes/notificacoes",
            label: "Notificações",
            icon: Bell,
            enabled: true,
            ocultoNoMenu: true,
            permissao: "config.gerenciar",
            descricao: "O que a loja recebe e por onde.",
          },
          {
            href: "/configuracoes/autoatendimento",
            label: "Autoatendimento",
            icon: MonitorSmartphone,
            enabled: true,
            ocultoNoMenu: true,
            show: (t) => t.moduloAutoatendimento,
            permissao: "config.gerenciar",
            descricao: "Quiosques, PIN e modo de operação.",
          },
          {
            href: "/configuracoes/fiscal",
            label: "Fiscal",
            icon: ReceiptText,
            enabled: true,
            ocultoNoMenu: true,
            show: (t) => t.moduloFiscal,
            // Guard próprio em configuracoes/fiscal/page.tsx.
            permissao: "fiscal.configurar",
            descricao: "Certificado, série e ambiente de emissão.",
          },
          {
            href: "/configuracoes/classificacao-fiscal",
            label: "Classificação fiscal",
            icon: Tags,
            enabled: true,
            ocultoNoMenu: true,
            show: (t) => t.moduloFiscal,
            permissao: "config.gerenciar",
            descricao: "NCM, CFOP e perfis pendentes de revisão do contador.",
          },
        ],
      },
    ],
  },
];

/**
 * Pais e filhos numa lista só — quem procura por rota não liga para a gaveta.
 * O pai vem antes das filhas, o que importa no desempate de `navIcon`.
 */
export const NAV_ITEMS_FLAT: NavItem[] = NAV_GROUPS.flatMap((g) =>
  g.items.flatMap((i) => (i.children ? [i, ...i.children] : [i])),
);

/** A rota atual está dentro deste item? (igual ou abaixo dele) */
export const navMatches = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(href + "/");

/**
 * Ícone do menu para uma rota — casa o prefixo mais específico
 * (ex.: /configuracoes/usuarios vence /configuracoes).
 */
export function navIcon(href: string): LucideIcon | undefined {
  // `sort` é estável: em empate de comprimento (ex.: /estoque pai × filha
  // "Saldos") o pai vence, porque vem primeiro em NAV_ITEMS_FLAT.
  const match = NAV_ITEMS_FLAT.filter((i) => navMatches(href, i.href)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];
  return match?.icon;
}

/**
 * Frase de apoio de um item do mapa — pai, filha ou item sem gaveta (ex.:
 * Pedidos, Recebimentos). Existe para telas que não têm barra de abas: elas
 * pegam a descrição direto do item, em vez de repeti-la à mão.
 */
export function navDescricao(href: string): string | undefined {
  return NAV_ITEMS_FLAT.find((i) => i.href === href)?.descricao;
}

/**
 * Abas de um módulo — TODAS as filhas, inclusive as que a sidebar esconde.
 * É daqui que os cabeçalhos de módulo tiram a barra de abas, em vez de
 * reescreverem a lista à mão (e divergirem do menu).
 */
export function navTabs(moduloHref: string): NavItem[] {
  const modulo = NAV_ITEMS_FLAT.find((i) => i.href === moduloHref && i.children);
  return modulo?.children ?? [];
}

// `navMobile()` saiu junto com a barra inferior desta casca: a superfície de
// mão é o `/m`, que tem config própria (`components/mobile/nav.ts`). Duas
// barras mobile diferentes ensinavam caminhos que a outra tela não tinha.

/**
 * Trilha da rota atual: [pai, filha] quando a tela mora numa gaveta, [item]
 * quando é raiz. Alimenta o rótulo da paleta ("Estoque › Validade").
 */
export function navTrilha(pathname: string): NavItem[] {
  let melhor: NavItem[] = [];
  const considerar = (trilha: NavItem[]) => {
    const alvo = trilha[trilha.length - 1];
    if (!navMatches(pathname, alvo.href)) return;
    const atual = melhor[melhor.length - 1];
    if (!atual || alvo.href.length > atual.href.length) melhor = trilha;
  };

  for (const grupo of NAV_GROUPS) {
    for (const item of grupo.items) {
      if (item.children) {
        // O pai só entra na trilha por meio de uma filha — sozinho ele é
        // rótulo, não destino. Exceção: pai que também é tela (`indice`).
        if (item.indice) considerar([item]);
        for (const filha of item.children) considerar([item, filha]);
      } else {
        considerar([item]);
      }
    }
  }
  return melhor;
}

/**
 * O item aparece para quem tem esses acessos? Pai com gaveta herda a resposta
 * das filhas: gaveta vazia não vira item morto no menu.
 */
export function podeVerItem(item: NavItem, acessos: Acesso[]): boolean {
  if (item.children) return item.children.some((c) => podeVerItem(c, acessos));
  return !item.permissao || podeEmAlguma(acessos, item.permissao);
}

/** Item visível para este operador, neste tenant — permissão + toggle. */
export function itemVisivel(
  item: NavItem,
  acessos: Acesso[],
  toggles: NavToggles,
): boolean {
  return (item.show ? item.show(toggles) : true) && podeVerItem(item, acessos);
}

/**
 * Ordem de "casa" — não é a ordem do menu. Quem opera caixa aterrissa no PDV,
 * quem cuida de estoque no estoque; só quem enxerga números começa no painel.
 */
const PRIORIDADE_INICIAL = [
  "/inicio",
  "/vendas",
  "/estoque",
  "/cotacoes",
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
  const disponivel = (i: NavItem) => i.enabled && itemVisivel(i, acessos, toggles);

  // Só folhas (e pais que são tela): um pai de gaveta não é destino, é rótulo.
  const folhas = NAV_ITEMS_FLAT.filter((i) => !i.children || i.indice);

  for (const href of PRIORIDADE_INICIAL) {
    const item = folhas.find((i) => i.href === href);
    if (item && disponivel(item)) return href;
  }
  return folhas.find(disponivel)?.href ?? null;
}
