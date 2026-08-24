import {
  ArrowLeftRight,
  BarChart3,
  LogOut,
  MonitorSmartphone,
  Handshake,
  Receipt,
  Settings,
  Sparkles,
  Store,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { carregarShell } from "@/lib/shell-context";
import { featureAtiva } from "@/lib/planos";
import { VERSAO_APP } from "@/lib/versao";
import { podeEmAlguma, type Permissao } from "@/lib/permissoes";
import type { NavToggles } from "@/components/app/nav-config";
import { MobilePageHeader } from "@/components/mobile/page-header";
import { InstalarApp } from "@/components/mobile/instalar-app";
import { LinhaLink } from "@/components/mobile/linha-link";
import { AtivarNotificacoes } from "@/components/mobile/ativar-notificacoes";
import { Card } from "@/components/ui/misc";
import { signOutAction } from "@/app/(app)/actions";

/**
 * O resto do app: tudo que não coube nas cinco abas da barra.
 *
 * Só LUGARES. Verbo — contar, etiquetar, receber, mudar preço, pedir — mora na
 * folha "Nova operação", no botão do meio, e não é repetido aqui: a lista já
 * teve os dois misturados, e quem via "Contagem" nos dois menus não aprendia
 * nenhum.
 *
 * Os grupos são a segunda metade da arrumação: uma lista chapada de doze linhas
 * se lê como despejo, e no celular a pessoa rola procurando em vez de mirar.
 */
export default async function MaisPage() {
  const { ctx, toggles, planoLabel, vocabularioPonto, admin } = await carregarShell();

  type Linha = {
    href: string;
    label: string;
    icone: LucideIcon;
    permissao?: Permissao;
    mostrar?: (t: NavToggles) => boolean;
    /** Portão que não cabe em permissão nem em toggle (add-on de plano, admin). */
    liberado?: boolean;
  };

  const secoes: Array<{ titulo: string; itens: Linha[] }> = [
    {
      titulo: "Operação",
      // Vendas, movimento e cotação são telas de CONSULTA — olha-se o que
      // aconteceu. Por isso ficam aqui e não na folha.
      itens: [
        { href: "/m/vendas", label: "Vendas", icone: Receipt, permissao: "relatorio.ver" },
        {
          href: "/m/movimentacoes",
          label: "Movimentações",
          icone: ArrowLeftRight,
          permissao: "estoque.ver",
        },
        // Cotação é trabalho de mesa: a lista é o destino, e criar uma é um
        // botão dentro dela. Nada disso começa com o produto na mão.
        { href: "/m/cotacoes", label: "Cotações", icone: Handshake, permissao: "compras.ver" },
      ],
    },
    {
      // "Consultar", e não "Cadastros": produto não se cadastra aqui (dezenas
      // de campos fiscais, de embalagem e de canal — trabalho de mesa) e
      // fornecedor também não. O rótulo antigo prometia uma ação que a tela não
      // entrega. Cliente é a exceção que escreve, e por isso vem por último no
      // raciocínio: quem procura ficha procura as três no mesmo lugar.
      titulo: "Consultar",
      itens: [
        { href: "/m/produtos", label: "Produtos", icone: Store, permissao: "produto.ver" },
        // Clientes vem logo abaixo de Produtos: quem procura uma ficha procura
        // as duas no mesmo lugar. É a única daqui que também ESCREVE (cadastra
        // no balcão, manda cupom, chama no WhatsApp).
        { href: "/m/clientes", label: "Clientes", icone: Users, permissao: "cliente.ver" },
        {
          href: "/m/fornecedores",
          label: "Fornecedores",
          icone: Truck,
          permissao: "fornecedor.ver",
        },
      ],
    },
    {
      titulo: "Análise",
      itens: [
        {
          href: "/m/relatorios",
          label: "Relatórios",
          icone: BarChart3,
          permissao: "relatorio.ver",
        },
        // A IA perdeu o botão flutuante (cobria o canto das ações das telas de
        // operação), então o menu é o caminho dela. O portão é o mesmo do
        // desktop: add-on no plano + administrador.
        {
          href: "/m/ia",
          label: "NoHub IA",
          icone: Sparkles,
          liberado: featureAtiva(ctx.tenant, "ia.copiloto") && admin,
        },
      ],
    },
    {
      titulo: "Este aparelho",
      itens: [
        {
          href: "/totem",
          label: "Modo autoatendimento",
          icone: MonitorSmartphone,
          permissao: "venda.registrar",
          mostrar: (t) => t.moduloAutoatendimento,
          // Sem selo de "versão de computador": o quiosque é responsivo e roda
          // no próprio tablet, que é justamente onde ele costuma ficar.
        },
      ],
    },
  ];

  const visiveis = secoes
    .map((s) => ({
      ...s,
      itens: s.itens.filter(
        (i) =>
          i.liberado !== false &&
          (!i.mostrar || i.mostrar(toggles)) &&
          (!i.permissao || podeEmAlguma(ctx.acessos, i.permissao)),
      ),
    }))
    .filter((s) => s.itens.length > 0);

  return (
    <div className="space-y-5">
      <MobilePageHeader titulo="Mais" />

      <Card className="p-4">
        <p className="font-display text-base font-semibold text-ink">
          {ctx.user.name ?? ctx.user.email}
        </p>
        {/* Sem o cargo: quem abre o app sabe o que faz na loja — o rótulo do
            perfil só ocupava a linha logo abaixo do nome. */}
        <p className="mt-1 text-xs text-muted">
          {ctx.tenant.nome} · {planoLabel} · {vocabularioPonto.toLowerCase()}
        </p>
      </Card>

      <InstalarApp />

      {/* A chave VAPID desce como prop, não como NEXT_PUBLIC_: ela é pública
          por definição, mas manter tudo que é segredo-adjacente fora do bundle
          evita que a próxima chave siga o mesmo caminho por hábito. */}
      {process.env.VAPID_PUBLIC_KEY && (
        <AtivarNotificacoes chavePublica={process.env.VAPID_PUBLIC_KEY} />
      )}

      {visiveis.map((secao) => (
        <section key={secao.titulo} className="space-y-2">
          <h2 className="font-display text-base font-semibold text-ink">{secao.titulo}</h2>
          <Card className="divide-y divide-line overflow-hidden">
            {secao.itens.map((i) => (
              <LinhaLink key={i.href} href={i.href}>
                <i.icone className="h-5 w-5 shrink-0 text-ink-2" aria-hidden />
                <span className="flex-1 text-sm font-medium text-ink">{i.label}</span>
              </LinhaLink>
            ))}
          </Card>
        </section>
      ))}

      <section className="space-y-2">
        <h2 className="font-display text-base font-semibold text-ink">Conta</h2>
        <Card className="divide-y divide-line overflow-hidden">
          {admin && (
            <LinhaLink href="/m/configuracoes">
              <Settings className="h-5 w-5 shrink-0 text-ink-2" aria-hidden />
              <span className="flex-1 text-sm font-medium text-ink">Configurações</span>
            </LinhaLink>
          )}

          {/* Sem "usar a versão completa": no aparelho de mão o app é este.
              Quem precisa da tela de mesa abre o app pelo computador. */}
          <form action={signOutAction}>
            <button
              type="submit"
              className="flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 py-3 text-left text-danger transition-colors hover:bg-danger-soft focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)] focus-visible:outline-none"
            >
              <LogOut className="h-5 w-5 shrink-0" aria-hidden />
              <span className="flex-1 text-sm font-medium">Sair</span>
            </button>
          </form>
        </Card>
        {/* Versão discreta: só serve quando alguém relata um problema — daí o
            tamanho de nota de rodapé, e não de linha da lista. */}
        <p className="px-1 text-center font-mono text-[11px] text-faint">
          {VERSAO_APP}
        </p>
      </section>
    </div>
  );
}
