import { MobileShell } from "@/components/mobile/mobile-shell";
import { FaixaAssinatura } from "@/components/app/faixa-assinatura";
import { Toaster } from "@/components/ui/toast";
import { carregarShell } from "@/lib/shell-context";
import { withTenant } from "@/lib/current-tenant";
import { db } from "@/lib/prisma";

/**
 * Casca da superfície mobile.
 *
 * Grupo de rota IRMÃO de `(app)`, não filho: o `AppShell` de lá é client e
 * arrasta sidebar, navbar, paleta de comandos e copiloto para dentro de
 * qualquer filha — e ainda trava o scroll do documento. Um layout filho não
 * consegue desligar o pai.
 *
 * O que os dois precisam ter igual — tenant, onboarding, cobrança, toggles —
 * mora em `lib/shell-context`, então nada aqui é cópia dos guards do desktop.
 *
 * Sem `comCaixa`: `relatorioCaixa` é leitura cara e só a tela `/m/caixa` usa.
 */
export default async function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { ctx, toggles, acesso, admin } = await carregarShell();

  // Contagem real de locais, não `numPontos` do cadastro: o que decide se
  // "Transferência" existe é haver para onde transferir. Um `count` indexado
  // por tenant é barato o bastante para o layout.
  const totalSites = await withTenant(ctx, () => db.site.count({ where: { ativo: true } }));

  return (
    <MobileShell
      acessos={ctx.acessos}
      toggles={toggles}
      tenantNome={ctx.tenant.nome}
      multiSite={totalSites > 1}
    >
      {/* Cobrança pendente precisa aparecer nas duas superfícies: quem só usa o
          celular não pode ser o último a saber que a conta vai travar. */}
      {acesso.aviso && (
        <FaixaAssinatura
          tom={acesso.aviso.tom}
          texto={acesso.aviso.texto}
          podeAssinar={admin}
        />
      )}
      {children}
      <Toaster />
    </MobileShell>
  );
}
