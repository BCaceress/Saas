import { CatalogoDocumentos } from "./_catalogo";

/**
 * Catálogo de relatórios em PDF (Fase 7 §11). Galeria de modelos agrupados por
 * tema; cada card abre um modal de parâmetros e gera o documento em nova aba
 * (rota /documento/[modelo]). Vive dentro do shell, como aba dos relatórios.
 */
export default function DocumentosPage() {
  return (
    <div className="space-y-1">
      <p className="text-sm text-muted">
        Relatórios prontos para imprimir ou salvar em PDF. Escolha um modelo, ajuste o período e gere — abre em nova aba.
      </p>
      <div className="pt-5">
        <CatalogoDocumentos />
      </div>
    </div>
  );
}
