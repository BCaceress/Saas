import { HubAnalises } from "./_hub";

/**
 * Hub inteligente de análises (tela única). Busca, chips, catálogo de
 * relatórios com ações (abrir / IA / PDF), documentos recentes e o assistente
 * IA em drawer — sem navegação por abas. Relatórios detalhados continuam em
 * /relatorios/{tipo}; PDFs em /documento/{modelo}.
 */
export default function ListaRelatoriosPage() {
  return <HubAnalises />;
}
