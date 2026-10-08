/**
 * Campos do cadastro que a operação pode desligar — fonte única de verdade.
 *
 * Nem todo mercado preenche tudo: quem produz o que vende (padaria, marmita,
 * granel) não tem marca para informar, e quem opera uma loja só costuma guardar
 * tudo no mesmo lugar. Campo que nunca é preenchido não é neutro — ele ocupa a
 * linha do cadastro, aparece vazio na listagem e na edição em lote, e ensina o
 * operador a passar batido pelos campos.
 *
 * Desligar ESCONDE, nunca apaga: `Brand` e `StorageLocation` continuam no
 * banco, o que já foi preenchido continua gravado e volta a aparecer se a
 * empresa religar o campo.
 *
 * Sem client/server: importável de RSC, Server Action e client.
 */

export type CamposCadastro = {
  /** Marca do produto (campo do cadastro, filtro e coluna da listagem). */
  marca: boolean;
  /** Local de armazenagem (geladeira, depósito, prateleira) dentro da loja. */
  armazenagem: boolean;
};

export function camposDoTenant(t: {
  usaMarcas?: boolean | null;
  usaArmazenagem?: boolean | null;
}): CamposCadastro {
  // `null`/`undefined` = ligado: é o padrão do banco, e esconder campo por
  // dado faltando seria esconder o que a empresa já usa.
  return {
    marca: t.usaMarcas !== false,
    armazenagem: t.usaArmazenagem !== false,
  };
}

/** Fallback para telas que ainda não receberam os campos do servidor. */
export const CAMPOS_PADRAO: CamposCadastro = camposDoTenant({});
