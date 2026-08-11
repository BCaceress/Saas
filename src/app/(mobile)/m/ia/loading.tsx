import { SkCabecalho, SkLista, SkTela } from "@/components/mobile/esqueleto";

export default function IaLoading() {
  return (
    <SkTela rotulo="Abrindo o NoHub IA">
      <SkCabecalho />
      <SkLista itens={4} />
    </SkTela>
  );
}
