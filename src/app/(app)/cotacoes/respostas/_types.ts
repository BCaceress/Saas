// DTOs da Central de Respostas. Tudo serializável (Date/Decimal já viram
// string/number no loader), porque atravessa a fronteira RSC → client.

/** Por onde a informação chegou. É o que o operador reconhece de imediato. */
export type CanalResposta =
  | "LINK" // fornecedor preencheu o link público
  | "OPERADOR" // alguém da loja transcreveu (áudio, foto, telefone)
  | "ARQUIVO" // planilha, CSV, PDF, imagem, XML, JSON
  | "API"; // integração do fornecedor

/**
 * Estado da linha na caixa de entrada. Ordem de urgência: ERRO e REVISAR pedem
 * ação, CHEGOU é bom saber, AGUARDANDO/LIDO é só espera.
 */
export type EstadoResposta =
  | "AGUARDANDO" // pergunta feita, ninguém respondeu
  | "LIDO" // o fornecedor abriu o link e não respondeu (ainda)
  | "PROCESSANDO" // arquivo em leitura
  | "CHEGOU" // resposta completa, nada pendente
  | "REVISAR" // chegou, mas tem item sem vínculo esperando gente
  | "RECUSADO" // "não vou cotar"
  | "ERRO"; // leitura falhou

export type RespostaRow = {
  id: string;
  origem: "cotacao" | "importacao";
  supplierId: string;
  supplierNome: string;
  /** Contato que recebeu a cotação — null em importação e no contato geral. */
  contatoNome: string | null;
  canal: CanalResposta;
  estado: EstadoResposta;
  /** O que chegou: "Cotação COT-00042" ou o nome do arquivo. */
  titulo: string;
  /** Uma linha de contexto — o que se lê para decidir se vale abrir. */
  detalhe: string;
  /** Quando entrou na caixa (ISO). */
  quando: string;
  href: string;
  /** Itens que precisam de gente (sem vínculo / não cotados). 0 = nada a fazer. */
  pendencias: number;
  /** Total da proposta, quando o número existe. */
  valor: number | null;
};

export type ResumoRespostas = {
  aguardando: number; // perguntas sem resposta
  chegaramHoje: number;
  precisamRevisao: number; // linhas em REVISAR ou ERRO
  /** ISO da resposta mais recente — null quando a caixa está vazia. */
  ultimaEm: string | null;
};
