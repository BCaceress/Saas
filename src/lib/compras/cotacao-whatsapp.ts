// ============================================================
// A cotação no formato que a Cloud API aceita.
//
// Sem `server-only` de propósito: aqui só há texto e cálculo puro, e a TELA de
// configuração precisa mostrar o mesmo corpo de template que o disparo usa —
// duas cópias do texto seriam duas chances de o template aprovado na Meta não
// bater com o que o servidor manda.
//
// Mensagem que a empresa inicia sai por TEMPLATE aprovado pela Meta, e
// template não é texto livre: é uma frase fixa com buracos numerados. Toda a
// lista de produtos, que a mensagem manual carrega, não cabe aqui — e nem
// precisa: o link de resposta É a lista, melhor do que qualquer parágrafo.
//
// O corpo aprovado tem que casar EXATAMENTE com esta ordem. É por isso que o
// texto sugerido mora no código e a tela de configuração o mostra para copiar:
// template aprovado com outra ordem manda o prazo no lugar do nome da loja.
// ============================================================

/** Ordem dos parâmetros do corpo. Mudar aqui = reprovar o template lá. */
export const TEMPLATE_PARAMETROS = [
  "{{1}} nome da sua empresa",
  "{{2}} número da cotação",
  "{{3}} prazo de resposta",
  "{{4}} link para responder",
] as const;

/** Corpo que o operador deve submeter à Meta, palavra por palavra. */
export const TEMPLATE_CORPO_SUGERIDO =
  "Olá! Aqui é da {{1}}. Enviamos a cotação de compra {{2}} e gostaríamos do seu preço. " +
  "Responda até {{3}} neste link, sem precisar de cadastro: {{4}}";

/** Categoria e idioma que a mensagem exige — a tela repete para o operador. */
export const TEMPLATE_CATEGORIA = "Utilidade (utility)";

export type ParametrosCotacao = {
  empresa: string;
  numero: string;
  prazo: Date | null;
  link: string;
};

/**
 * Sem prazo, o buraco não pode ficar vazio: a Meta recusa parâmetro em branco.
 * "assim que puder" é a verdade do caso — a cotação realmente não tem data.
 */
export function parametrosDoTemplate(p: ParametrosCotacao): string[] {
  return [
    p.empresa,
    p.numero,
    p.prazo ? p.prazo.toLocaleDateString("pt-BR") : "assim que puder",
    p.link,
  ];
}

/**
 * Telefone como a Meta quer: só dígitos, com DDI. Número brasileiro sem DDI
 * (10 ou 11 dígitos) ganha o 55 — é o que o cadastro guarda no dia a dia.
 */
export function numeroInternacional(telefone: string | null | undefined): string | null {
  const tel = telefone?.replace(/\D/g, "") ?? "";
  if (tel.length < 10) return null;
  return tel.length <= 11 ? `55${tel}` : tel;
}

/**
 * O mesmo celular brasileiro nas duas formas que a Meta pode conhecer.
 *
 * O WhatsApp identifica o contato pelo número com que ele se cadastrou. Para
 * celular do Brasil isso é uma bagunça histórica: contas antigas vivem no
 * cadastro da Meta com OITO dígitos (55 + DDD + 8) e as novas com o nono
 * dígito (55 + DDD + 9…). Mandar na forma errada volta como "mensagem não
 * entregue" (131026) — que a tela lia como "esse número não tem WhatsApp",
 * mesmo o número existindo e a pessoa estando lá.
 *
 * Daí a lista: o primeiro é o que o cadastro diz, o segundo é a outra forma do
 * MESMO número. Quem dispara tenta na ordem e para no primeiro aceite.
 */
export function numerosPossiveis(telefone: string | null | undefined): string[] {
  const principal = numeroInternacional(telefone);
  if (!principal) return [];
  const br = /^55(\d{2})(\d{8,9})$/.exec(principal);
  if (!br) return [principal];
  const [, ddd, local] = br;
  // Nono dígito presente: a alternativa é o número sem ele.
  if (local.length === 9 && local.startsWith("9")) return [principal, `55${ddd}${local.slice(1)}`];
  // Oito dígitos começando em 6–9 é celular antigo: a alternativa põe o 9.
  if (local.length === 8 && /^[6-9]/.test(local)) return [principal, `55${ddd}9${local}`];
  return [principal];
}
