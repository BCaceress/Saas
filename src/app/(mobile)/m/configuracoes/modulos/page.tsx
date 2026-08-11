import { MobilePageHeader } from "@/components/mobile/page-header";
import { ConteudoModulos } from "@/app/(app)/configuracoes/modulos/_conteudo";

export const metadata = { title: "Módulos — NoHub Market" };

export default function ModulosMobilePage() {
  return (
    <div className="space-y-4">
      <MobilePageHeader
        titulo="Módulos"
        descricao="O menu se adapta na hora ao que você liga aqui."
        voltar="/m/configuracoes"
      />
      <ConteudoModulos />
    </div>
  );
}
