// ============================================================
// CFOP: a mesma operação, vista dos dois lados.
//
// Puro e sem `server-only` de propósito — o servidor usa para montar o perfil
// fiscal e a tela de revisão usa para mostrar ao operador que 5102 do
// fornecedor é 1102 nosso. Duas cópias da regra viram dois CFOP diferentes
// para a mesma nota.
// ============================================================

/**
 * CFOP de entrada equivalente ao CFOP declarado na nota.
 *
 * O CFOP do XML é da SAÍDA DO FORNECEDOR — 5102 é "venda dele", não "compra
 * nossa". Só o primeiro dígito muda: 5→1 (dentro do estado), 6→2 (outro
 * estado), 7→3 (exterior). `null` quando não é um CFOP de saída reconhecível.
 */
export function cfopDeEntrada(cfopDaNota: string | null | undefined): string | null {
  const c = (cfopDaNota ?? "").replace(/\D/g, "");
  if (c.length !== 4) return null;
  const entrada: Record<string, string> = { "5": "1", "6": "2", "7": "3" };
  const primeiro = entrada[c[0]];
  return primeiro ? primeiro + c.slice(1) : null;
}
