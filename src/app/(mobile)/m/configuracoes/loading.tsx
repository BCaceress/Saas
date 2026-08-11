import { SkCabecalho, SkLista, SkTela } from "@/components/mobile/esqueleto";

export default function ConfiguracoesMobileLoading() {
  return (
    <SkTela rotulo="Carregando as configurações">
      <SkCabecalho />
      <SkLista itens={8} />
    </SkTela>
  );
}
