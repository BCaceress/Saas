import {
  ArrowLeftRight,
  ClipboardList,
  Image as ImageIcon,
  ShoppingCart,
  Tag,
  Truck,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { podeEmAlguma, type Acesso, type Permissao } from "@/lib/permissoes";
import type { NavToggles } from "@/components/app/nav-config";

// ============================================================
// As operações do botão do meio — a LISTA, sem a folha que a desenha.
//
// Módulo neutro (sem "use client") de propósito: a folha é client, mas o
// `/m/mais` é server e precisa saber, antes de pintar, se este perfil tem
// alguma operação — senão renderiza um bloco vazio. Tudo que é exportado de um
// módulo "use client" vira referência de cliente e não pode ser chamado no
// servidor; por isso os dados moram aqui e só a UI mora lá.
//
// A lista responde "o que eu vim fazer aqui", e não "para qual módulo eu vou".
// Por isso os rótulos são verbos e a ordem é a frequência de quem está de pé na
// loja, não a ordem dos módulos no menu do desktop.
//
// A divisão com o "Mais" é essa e não tem exceção: aqui só entra operação de
// CHÃO — algo que se faz com o produto na mão, quase sempre começando por um
// bipe. Lugar (lista, cadastro, relatório) mora no "Mais". Enquanto os dois
// menus repetiam os mesmos cinco destinos, ninguém aprendia qual abrir.
// ============================================================

export type Operacao = {
  href: string;
  label: string;
  descricao: string;
  icone: LucideIcon;
  permissao?: Permissao;
  mostrar?: (t: NavToggles) => boolean;
  /** Só faz sentido com mais de um local: transferir para onde, senão? */
  exigeMultiSite?: boolean;
};

export const OPERACOES: Operacao[] = [
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
  // Cotação NÃO entra: é trabalho de mesa, com tela própria e botão de criar
  // dentro dela — nada aqui começa com o produto na mão. Ela vive no "Mais",
  // como lugar. Era a última duplicata entre os dois menus.
];

/** Operações que este perfil enxerga — o filtro da folha, isolado para reuso. */
export function operacoesVisiveis(
  acessos: Acesso[],
  toggles: NavToggles,
  multiSite: boolean,
): Operacao[] {
  return OPERACOES.filter(
    (o) =>
      (!o.mostrar || o.mostrar(toggles)) &&
      (!o.exigeMultiSite || multiSite) &&
      (!o.permissao || podeEmAlguma(acessos, o.permissao)),
  );
}

/**
 * Há alguma operação para oferecer? Quem abre a folha por um atalho (a linha do
 * "Mais") precisa saber disso ANTES de mostrar o atalho — senão o toque termina
 * numa folha vazia, e a seção inteira do menu nasce sem conteúdo.
 *
 * `produto.ver` conta sozinho: quem tem só isso ainda ganha o alvo grande de
 * escanear no topo da folha.
 */
export function temOperacoes(
  acessos: Acesso[],
  toggles: NavToggles,
  multiSite: boolean,
): boolean {
  return (
    podeEmAlguma(acessos, "produto.ver") ||
    operacoesVisiveis(acessos, toggles, multiSite).length > 0
  );
}
