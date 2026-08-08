import { Sk } from "@/components/app/skeletons";
import { SkCabecalho, SkTela } from "@/components/mobile/esqueleto";

/**
 * O visor da câmera ocupa quase a tela inteira e tem proporção fixa (3/4).
 * Reservar esse retângulo desde o primeiro quadro evita o pulo mais feio da
 * superfície: o campo de digitação nascer no meio da tela e escorregar para
 * baixo quando o vídeo aparece.
 */
export default function ScanLoading() {
  return (
    <SkTela rotulo="Preparando o leitor">
      <SkCabecalho />
      <Sk className="aspect-[3/4] w-full rounded-[var(--radius-lg)]" />
      <div className="flex gap-2">
        <Sk className="h-12 flex-1 rounded-full" />
        <Sk className="h-12 w-12 rounded-full" />
        <Sk className="h-12 w-28 rounded-full" />
      </div>
      <Sk className="h-12 w-full rounded-full" />
    </SkTela>
  );
}
