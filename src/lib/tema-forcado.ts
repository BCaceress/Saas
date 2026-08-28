/**
 * Cabeçalho que o proxy escreve nas rotas de público externo (hoje só o link de
 * cotação do fornecedor) para o layout raiz fixar o tema claro no <html>,
 * ignorando o cookie `theme` do operador. Constante compartilhada porque as
 * duas pontas — proxy e layout — precisam falar a mesma string.
 */
export const TEMA_FORCADO_HEADER = "x-tema-forcado";
