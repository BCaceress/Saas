import { MobilePageHeader } from "@/components/mobile/page-header";
import { ConteudoEmpresa } from "@/app/(app)/configuracoes/empresa/_conteudo";

export const metadata = { title: "Empresa — NoHub Market" };

/**
 * Mesma tela do desktop, cabeçalho do `/m`.
 *
 * O miolo vem de `(app)/configuracoes/empresa/_conteudo` — o formulário já é
 * responsivo (grade que colapsa em uma coluna), então duplicá-lo aqui só criaria
 * duas verdades sobre o cadastro da empresa.
 */
export default function EmpresaMobilePage() {
  return (
    <div className="space-y-4">
      <MobilePageHeader
        titulo="Empresa"
        descricao="Identificação, contato e endereço."
        voltar="/m/configuracoes"
      />
      <ConteudoEmpresa />
    </div>
  );
}
