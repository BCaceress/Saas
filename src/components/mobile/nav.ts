import {
  Bell,
  Home,
  Menu,
  Plus,
  ShoppingBag,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import { podeEmAlguma, type Acesso, type Permissao } from "@/lib/permissoes";
import type { NavToggles } from "@/components/app/nav-config";

/**
 * Navegação da superfície mobile (`/m`).
 *
 * Config PRÓPRIA, separada do `nav-config.ts` de propósito. Lá vive o mapa da
 * tela de mesa — sidebar, abas de módulo, paleta de comandos —, e pendurar
 * hrefs `/m/*` naquela lista poluiria os três e ainda estragaria `rotaInicial`.
 * Aqui a lista é curta e existe para uma coisa só: cinco alvos de polegar.
 * (A casca `(app)` já teve uma barra inferior própria abaixo de 768px; ela
 * morreu porque duas navegações mobile divergentes é pior que uma.)
 *
 * Os tipos e o `podeEmAlguma` vêm de lá — a fonte de verdade de permissão
 * continua sendo uma só.
 */

export type MobileTab = {
  href: string;
  label: string;
  icon: LucideIcon;
  /**
   * A tela já existe? A superfície `/m` está sendo construída por fases, e uma
   * aba que aponta para rota inexistente é um 404 no rodapé. Vira `true` quando
   * a fase correspondente entrega a tela.
   */
  pronto: boolean;
  /** Permissão mínima para o item aparecer. O guard da rota exige a MESMA. */
  permissao?: Permissao;
  /** Visibilidade condicionada aos toggles do tenant (default: sempre). */
  show?: (t: NavToggles) => boolean;
  /** Alvo central, em cápsula elevada. Um só — é a ação do dia a dia. */
  destaque?: boolean;
  /**
   * Abre a folha "Nova operação" em vez de navegar. O `href` continua valendo
   * como destino de fallback (atalho do PWA, navegação por teclado, JS fora do
   * ar) — por isso ele aponta para a operação mais comum, e não para "#".
   */
  abreOperacoes?: boolean;
};

/**
 * Cinco no máximo: abaixo disso sobra espaço, acima os alvos ficam menores que
 * o polegar. "Escanear" no centro porque é o gesto mais repetido de quem está
 * de pé na gôndola.
 *
 * A ordem separa as duas metades da barra: à esquerda o que é MEU (o dia da
 * loja, o estoque), à direita o que me COBRA (alertas) e o resto do app. Início
 * e Alertas já ficaram grudados na esquerda — duas telas de olhar no mesmo
 * canto, com o par da direita desperdiçado num único "Menu".
 */
const TABS: MobileTab[] = [
  // A home mostra faturamento e margem — sem `relatorio.ver` ela seria uma
  // tela vazia, então some da barra em vez de virar beco sem saída.
  { href: "/m", label: "Início", icon: Home, permissao: "relatorio.ver", pronto: true },
  {
    href: "/m/estoque",
    label: "Estoque",
    icon: Warehouse,
    permissao: "estoque.ver",
    pronto: true,
  },
  // O centro deixou de ser um destino e virou o começo de qualquer operação:
  // escanear, receber, contar, transferir, dar baixa, mudar preço, pedir. O
  // scanner continua sendo o primeiro item da folha, em alvo grande — é o que
  // mais se faz e não pode custar dois toques.
  {
    href: "/m/scan",
    label: "Nova",
    icon: Plus,
    permissao: "produto.ver",
    destaque: true,
    abreOperacoes: true,
    pronto: true,
  },
  { href: "/m/alertas", label: "Alertas", icon: Bell, pronto: true },
  // "Menu", não "Mais": a tela é o mapa do app, não uma sobra. "Mais" só
  // dizia que existia algo além da barra, sem dizer o quê.
  { href: "/m/menu", label: "Menu", icon: Menu, pronto: true },
];

/**
 * Entra no lugar de Estoque para quem só opera venda (caixa sem acesso a
 * estoque): a barra nunca fica com um buraco no meio.
 */
const TAB_VENDA: MobileTab = {
  href: "/m/vendas",
  label: "Vendas",
  icon: ShoppingBag,
  permissao: "venda.registrar",
  show: (t) => t.moduloPdv,
  pronto: true,
};

function visivel(tab: MobileTab, acessos: Acesso[], toggles: NavToggles): boolean {
  if (!tab.pronto) return false;
  if (tab.show && !tab.show(toggles)) return false;
  // `podeEmAlguma` é filtro de MENU: mostra o item a quem tem a permissão em ao
  // menos uma loja. Quem autoriza de fato é o guard da rota, por loja.
  if (tab.permissao && !podeEmAlguma(acessos, tab.permissao)) return false;
  return true;
}

/** Abas visíveis para este usuário, na ordem da barra. */
export function abasMobile(acessos: Acesso[], toggles: NavToggles): MobileTab[] {
  const base = TABS.filter((t) => visivel(t, acessos, toggles));

  const temEstoque = base.some((t) => t.href === "/m/estoque");
  if (!temEstoque && visivel(TAB_VENDA, acessos, toggles)) {
    // No slot que era do Estoque — antes do alvo de destaque, não no fim. O "+"
    // precisa continuar no centro da barra, senão o polegar perde a referência.
    const i = base.findIndex((t) => t.destaque);
    base.splice(i === -1 ? base.length : i, 0, TAB_VENDA);
  }

  return base;
}

/**
 * Primeira tela do mobile para este usuário. A home mostra faturamento e
 * margem; quem não tem `relatorio.ver` cairia num painel vazio, então vai
 * direto para o primeiro destino que consegue usar.
 */
export function rotaInicialMobile(acessos: Acesso[], toggles: NavToggles): string {
  if (podeEmAlguma(acessos, "relatorio.ver")) return "/m";
  const abas = abasMobile(acessos, toggles).filter((t) => t.href !== "/m");
  return abas[0]?.href ?? "/m/alertas";
}

/**
 * Alertas trazem `href` da superfície de desktop (`_alerts.ts` é compartilhado).
 * Quando existe equivalente no mobile, o toque fica dentro do /m; sem
 * equivalente, abre a tela de desktop mesmo — melhor um layout apertado do que
 * um botão que não leva a lugar nenhum.
 */
/**
 * Terceiro elemento: quando o mobile tem a MESMA rota profunda, o resto do
 * caminho (o id) sobrevive à tradução. O regex existe para não mandar
 * `/cotacoes/respostas` — que só existe no desktop — para uma rota mobile
 * inexistente: só passa o que tem cara de id.
 */
const ID = /^\/[a-z0-9]{16,}$/i;

const EQUIVALENTE: Array<[prefixo: string, destino: string, resto?: RegExp]> = [
  // Validade fica de fora: o `/m/estoque` lista saldo, não lote — mandar para
  // lá um alerta de vencimento trocaria a informação certa por outra.
  ["/estoque/inventarios", "/m/estoque/contagem"],
  ["/estoque/movimentacoes", "/m/movimentacoes"],
  // Pedido de compra cai em `/m/receber`: sem a tela de aprovações, é lá que o
  // mobile move status e cancela.
  ["/pedidos", "/m/receber"],
  // Cotação tem a mesma tela profunda no mobile, então o alerta abre a cotação
  // certa — não a lista.
  ["/cotacoes", "/m/cotacoes", ID],
  ["/estoque", "/m/estoque"],
  ["/produtos", "/m/produtos"],
  // Caixa não tem equivalente mobile de propósito: abrir/fechar caixa é
  // trabalho de PDV, na máquina com gaveta. O alerta abre a tela de mesa.
  ["/clientes", "/m/clientes"],
  // Fornecedores fica de fora mesmo existindo `/m/fornecedores`: a tradução é
  // por PREFIXO, então todo alerta de um fornecedor específico
  // (`/fornecedores/[id]`, o centro de gestão de sete abas) cairia na lista e
  // perderia o alvo. Melhor abrir a tela de mesa, que tem a resposta.
];

/** Converte um href de alerta para o destino mobile, quando houver. */
export function hrefMobile(href: string): string {
  const [caminho, query = ""] = href.split(/(?=[?#])/, 2);
  for (const [prefixo, destino, resto] of EQUIVALENTE) {
    if (caminho !== prefixo && !caminho.startsWith(`${prefixo}/`)) continue;
    const sufixo = caminho.slice(prefixo.length);
    // Rota profunda equivalente: mantém o id em vez de cair na lista.
    if (resto && sufixo && resto.test(sufixo)) return `${destino}${sufixo}${query}`;
    // O destino já pode trazer query própria; nesse caso a do alerta se perde
    // de propósito (os filtros não são os mesmos nas duas superfícies).
    return destino.includes("?") ? destino : `${destino}${query}`;
  }
  return href;
}
