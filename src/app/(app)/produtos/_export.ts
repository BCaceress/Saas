import { gerarXlsx, XLSX_CONTENT_TYPE, type CelulaXlsx } from "@/lib/relatorios/xlsx";

/**
 * Download da planilha no navegador. O xlsx é montado no cliente (o `fflate` já
 * está no bundle por causa do fiscal) porque as colunas são as que o operador
 * ligou na tela — quem sabe disso é a tela, não o servidor.
 */
export function baixarXlsx(args: {
  nomeArquivo: string;
  aba: string;
  cabecalho: string[];
  linhas: CelulaXlsx[][];
}) {
  const bytes = gerarXlsx({ aba: args.aba, cabecalho: args.cabecalho, linhas: args.linhas });
  // `slice()` desencosta do buffer do fflate: um ArrayBuffer compartilhado faz
  // o Blob levar lixo junto.
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: XLSX_CONTENT_TYPE });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = args.nomeArquivo;
  a.click();
  URL.revokeObjectURL(url);
}
