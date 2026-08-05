"use client";

import * as React from "react";
import { Download, LoaderCircle, Lock, SlidersHorizontal } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import type { Exportacao } from "@/lib/relatorios/catalogo";
import {
  Aviso,
  MenuExportar,
  Visualizacao,
  hrefSaida,
  useLarguraTabela,
  type Previa,
  type Saida,
} from "./previa";
import { previaPadraoAction, registrarSaidaAction } from "./actions";

/**
 * "Visualizar" — o caminho de um clique.
 *
 * Não pergunta nada: abre e mostra o relatório com o padrão (o pessoal, se a
 * pessoa salvou um; senão o da definição). Uma única ida ao servidor traz a
 * execução pronta — o painel nunca desenha formulário, só resultado.
 *
 * Quem quiser mexer em coluna ou ordem sai daqui por "Personalizar". A maioria
 * não quer: quer o número.
 */
export function VisualizadorRelatorio({
  relatorioId,
  nome,
  descricao,
  categoria,
  exportacoes,
  onPersonalizar,
  onClose,
}: {
  relatorioId: string;
  nome: string;
  descricao: string;
  categoria: string;
  exportacoes: readonly Exportacao[];
  onPersonalizar: () => void;
  onClose: () => void;
}) {
  const [previa, setPrevia] = React.useState<Previa | null>(null);
  const [podeExportar, setPodeExportar] = React.useState(false);
  const [meuPadrao, setMeuPadrao] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const [ocupado, setOcupado] = React.useState<Saida | null>(null);
  const { largura, medirTabela } = useLarguraTabela("3xl");

  React.useEffect(() => {
    let vivo = true;
    previaPadraoAction(relatorioId).then((r) => {
      if (!vivo) return;
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      setPrevia(r.dados.previa);
      setPodeExportar(r.dados.podeExportar);
      setMeuPadrao(r.dados.origem === "meu-padrao");
    });
    return () => {
      vivo = false;
    };
  }, [relatorioId]);

  async function exportar(formato: Saida) {
    if (!previa) return;
    setOcupado(formato);
    // Abrir a janela ANTES do await: navegador só confia em `window.open` que
    // nasce do clique — depois de um `await` ele trata como popup e bloqueia.
    window.open(hrefSaida(relatorioId, formato, previa.config), "_blank", "noopener");
    await registrarSaidaAction({ relatorioId, config: previa.config, formato }).catch(() => {});
    setOcupado(null);
  }

  return (
    <Sheet
      open
      onClose={onClose}
      width={largura}
      title={previa?.nome ?? nome}
      description={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span>{categoria}</span>
          <span className="text-faint" aria-hidden>
            ·
          </span>
          <span className="text-muted">{descricao}</span>
          {meuPadrao && (
            <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand-strong">
              seu padrão
            </span>
          )}
        </span>
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={onPersonalizar}>
            <SlidersHorizontal size={15} aria-hidden />
            Personalizar
          </Button>

          {podeExportar && exportacoes.length > 0 && previa ? (
            <MenuExportar
              exportacoes={exportacoes}
              ocupado={ocupado}
              onExportar={exportar}
              trigger={<BotaoExportar ocupado={ocupado !== null} />}
            />
          ) : null}
        </div>
      }
    >
      {erro && (
        <Aviso tom="erro" icone={Lock}>
          {erro}
        </Aviso>
      )}

      {!previa && !erro && (
        <div className="flex items-center gap-2 py-16 text-sm text-muted">
          <LoaderCircle size={16} className="animate-spin" aria-hidden />
          Gerando o relatório…
        </div>
      )}

      <Visualizacao previa={previa} tabelaRef={medirTabela} />
    </Sheet>
  );
}

/**
 * Gatilho do menu de saídas — botão sólido, porque é a ação principal daqui.
 * O `onClick` chega por `cloneElement` do Menu; ele só repassa.
 */
function BotaoExportar({ ocupado, onClick }: { ocupado: boolean; onClick?: () => void }) {
  return (
    <Button size="sm" onClick={onClick} disabled={ocupado}>
      {ocupado ? (
        <LoaderCircle size={15} className="animate-spin" aria-hidden />
      ) : (
        <Download size={15} aria-hidden />
      )}
      Exportar
    </Button>
  );
}
