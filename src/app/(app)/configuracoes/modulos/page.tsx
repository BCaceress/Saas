import { Blocks } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { ConteudoModulos } from "./_conteudo";

export const metadata = { title: "Módulos — NoHub Market" };

export default function ModulosPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Módulos"
        icon={Blocks}
        description="Ligue e desligue os módulos da sua operação — o menu se adapta na hora."
        backHref="/configuracoes"
        innerClassName="max-w-none"
      />
      <ConteudoModulos />
    </div>
  );
}
