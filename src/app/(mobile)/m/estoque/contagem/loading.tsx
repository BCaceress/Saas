import { SkCabecalho, SkLista, SkTela } from "@/components/mobile/esqueleto";

export default function ContagemLoading() {
  return (
    <SkTela rotulo="Carregando as contagens">
      <SkCabecalho />
      <SkLista itens={4} />
    </SkTela>
  );
}
