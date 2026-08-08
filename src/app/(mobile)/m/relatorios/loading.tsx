import { SkCabecalho, SkLista, SkTela } from "@/components/mobile/esqueleto";

export default function RelatoriosLoading() {
  return (
    <SkTela rotulo="Carregando os relatórios">
      <SkCabecalho />
      <SkLista itens={6} />
    </SkTela>
  );
}
