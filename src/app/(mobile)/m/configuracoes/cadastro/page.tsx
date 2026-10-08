import { MobilePageHeader } from "@/components/mobile/page-header";
import { ConteudoCadastro } from "@/app/(app)/configuracoes/cadastro/_conteudo";

export const metadata = { title: "Campos do cadastro — NoHub Market" };

export default function CadastroConfigMobilePage() {
  return (
    <div className="space-y-4">
      <MobilePageHeader
        titulo="Campos do cadastro"
        descricao="Esconda o que sua operação não preenche. Nada é apagado."
        voltar="/m/configuracoes"
      />
      <ConteudoCadastro />
    </div>
  );
}
