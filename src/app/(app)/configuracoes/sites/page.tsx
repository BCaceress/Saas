import { MapPin } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { ConteudoSites } from "./_conteudo";

export default function SitesPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Lojas e pontos"
        icon={MapPin}
        description="Lojas, pontos autônomos e centros de distribuição do tenant."
        backHref="/configuracoes"
        innerClassName="max-w-none"
      />
      <ConteudoSites />
    </div>
  );
}
