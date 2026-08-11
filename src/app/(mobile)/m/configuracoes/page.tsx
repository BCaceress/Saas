import {
  Bell,
  Blocks,
  Building2,
  CreditCard,
  Gift,
  MapPin,
  MonitorSmartphone,
  ReceiptText,
  Scale,
  Sparkles,
  UserCog,
  Wallet,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import { carregarShell } from "@/lib/shell-context";
import { podeEmAlguma } from "@/lib/permissoes";
import { MobilePageHeader } from "@/components/mobile/page-header";
import { LinhaLink } from "@/components/mobile/linha-link";
import { Bolha, MCard, SecaoTitulo, type Tom } from "@/components/mobile/ui";

export const metadata = { title: "Configurações — NoHub Market" };

type Linha = {
  href: string;
  icone: LucideIcon;
  tom?: Tom;
  titulo: string;
  descricao: string;
  /** Estado atual em uma palavra — o que a linha vale sem precisar abrir. */
  valor?: string | null;
  mostrar?: boolean;
};

/**
 * Configurações no `/m`.
 *
 * Lista agrupada em vez da grade de cartões do desktop: no celular o cartão de
 * ícone+título+descrição vira uma coluna de blocos altos, e treze deles são
 * quatro telas de rolagem. A linha carrega o mesmo conteúdo em um terço da
 * altura e é o padrão que o resto do `/m` já usa.
 *
 * Cada linha mostra o estado atual à direita (fundo de troco, PIN definido,
 * plano) — é o que responde "preciso entrar aqui?" sem abrir a tela.
 *
 * As telas de destino são as MESMAS do desktop: o miolo de cada uma mora em
 * `_conteudo.tsx`, e cada superfície só põe o próprio cabeçalho.
 */
export default async function ConfiguracoesMobilePage() {
  const { ctx, toggles, planoLabel } = await carregarShell();
  const { tenant } = ctx;

  const brl = (n: number) =>
    n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const modulosLigados = [
    toggles.moduloPdv,
    toggles.moduloFiscal,
    toggles.moduloComodato,
    toggles.moduloRota,
    toggles.moduloAutoatendimento,
  ].filter(Boolean).length;

  const grupos: { titulo: string; linhas: Linha[] }[] = [
    {
      titulo: "Sua empresa",
      linhas: [
        {
          href: "/m/configuracoes/empresa",
          icone: Building2,
          titulo: "Empresa",
          descricao: "Nome, CNPJ, contato e endereço.",
          valor: tenant.cnpj ? "CNPJ ok" : "Sem CNPJ",
        },
        {
          href: "/m/configuracoes/sites",
          icone: MapPin,
          titulo: "Lojas e pontos",
          descricao: "Lojas, pontos autônomos e centros de distribuição.",
        },
        {
          href: "/m/configuracoes/usuarios",
          icone: UserCog,
          titulo: "Usuários",
          descricao: "Convide a equipe e defina o acesso de cada pessoa.",
        },
      ],
    },
    {
      titulo: "Operação",
      linhas: [
        {
          href: "/m/configuracoes/estoque",
          icone: Warehouse,
          titulo: "Estoque e alertas",
          descricao: "Mínimo padrão, produto parado, validade e contagem.",
          valor: `${tenant.estoqueMinimoPadrao} un. mín.`,
        },
        {
          href: "/m/configuracoes/caixa",
          icone: Wallet,
          titulo: "Caixa",
          descricao: "Fundo de troco padrão e limite de gaveta.",
          valor:
            tenant.caixaFundoTroco != null
              ? brl(Number(tenant.caixaFundoTroco))
              : "Sem fundo",
        },
        {
          href: "/m/configuracoes/metodos-pagamento",
          icone: CreditCard,
          titulo: "Métodos de pagamento",
          descricao: "Formas aceitas por loja, maquininha e Pix.",
        },
        {
          href: "/m/configuracoes/autoatendimento",
          icone: MonitorSmartphone,
          titulo: "Autoatendimento",
          descricao: "PIN de saída do modo quiosque.",
          valor: tenant.totemPinHash ? "PIN definido" : "Sem PIN",
          mostrar: toggles.moduloAutoatendimento,
        },
        {
          href: "/m/configuracoes/notificacoes",
          icone: Bell,
          titulo: "Notificações",
          descricao: "Quais grupos de alerta aparecem no sino.",
          valor:
            tenant.alertasDesativados.length > 0
              ? `${tenant.alertasDesativados.length} desligados`
              : "Todos ligados",
        },
      ],
    },
    {
      titulo: "Clientes",
      linhas: [
        {
          href: "/m/configuracoes/fidelizacao",
          icone: Gift,
          tom: "accent",
          titulo: "Fidelização",
          descricao: "Cupons de retorno e aniversário, faixas de pontos.",
          valor: tenant.cupomAutomatico ? "Automático" : "Manual",
        },
      ],
    },
    {
      titulo: "Fiscal",
      linhas: [
        {
          href: "/m/configuracoes/fiscal",
          icone: ReceiptText,
          titulo: "Fiscal",
          descricao: "Provedor de emissão, certificado A1, CSC e numeração.",
          mostrar: podeEmAlguma(ctx.acessos, "fiscal.configurar"),
        },
        {
          href: "/m/configuracoes/classificacao-fiscal",
          icone: Scale,
          titulo: "Classificação fiscal",
          descricao: "Perfis (NCM/CEST) e vínculo por subcategoria.",
        },
      ],
    },
    {
      titulo: "Assinatura",
      linhas: [
        {
          href: "/m/configuracoes/modulos",
          icone: Blocks,
          titulo: "Módulos",
          descricao: "Ligue PDV, fiscal, comodato, rota e autoatendimento.",
          valor: `${modulosLigados} ligados`,
        },
        {
          href: "/m/configuracoes/plano",
          icone: Sparkles,
          tom: "accent",
          titulo: "Plano e add-ons",
          descricao: "O que a assinatura cobre, uso e o que muda ao subir.",
          valor: planoLabel,
        },
      ],
    },
  ];

  return (
    <div className="space-y-5">
      <MobilePageHeader
        titulo="Configurações"
        descricao={tenant.nome}
        voltar="/m/mais"
      />

      {grupos.map((grupo) => {
        const linhas = grupo.linhas.filter((l) => l.mostrar !== false);
        if (linhas.length === 0) return null;
        return (
          <section key={grupo.titulo} className="space-y-2">
            <SecaoTitulo>{grupo.titulo}</SecaoTitulo>
            <MCard className="divide-y divide-line overflow-hidden">
              {linhas.map((l) => (
                <LinhaLink key={l.href} href={l.href} className="items-center">
                  <Bolha icone={l.icone} tom={l.tom ?? "neutro"} tamanho="md" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink">
                      {l.titulo}
                    </span>
                    <span className="mt-0.5 block text-xs leading-snug text-muted">
                      {l.descricao}
                    </span>
                  </span>
                  {l.valor && (
                    <span className="hidden shrink-0 rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[11px] text-ink-2 min-[380px]:block">
                      {l.valor}
                    </span>
                  )}
                </LinhaLink>
              ))}
            </MCard>
          </section>
        );
      })}
    </div>
  );
}
