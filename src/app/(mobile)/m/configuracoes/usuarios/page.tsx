import { MobilePageHeader } from "@/components/mobile/page-header";
import { ConteudoUsuarios } from "@/app/(app)/configuracoes/usuarios/_conteudo";

export const metadata = { title: "Usuários — NoHub Market" };

export default function UsuariosMobilePage() {
  return (
    <div className="space-y-4">
      <MobilePageHeader
        titulo="Usuários"
        descricao="Equipe, convites e acesso por loja."
        voltar="/m/configuracoes"
      />
      <ConteudoUsuarios />
    </div>
  );
}
