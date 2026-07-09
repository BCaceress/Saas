/**
 * Catálogo do totem — helpers client-safe (sem banco).
 * Ícones de categoria, regras de venda sugestiva e formatação de volume.
 * Tudo baseado no NOME da categoria (normalizado), já que o schema não tem
 * um enum de categoria fixo.
 */

import {
  Beer,
  Wine,
  Martini,
  CupSoda,
  GlassWater,
  Zap,
  Snowflake,
  Cookie,
  Candy,
  ShoppingBasket,
  Sandwich,
  Popcorn,
  Coffee,
  Milk,
  Cigarette,
  Croissant,
  Beef,
  Apple,
  SprayCan,
  Droplets,
  PawPrint,
  Package,
  type LucideIcon,
} from "lucide-react";

/** Remove acentos e baixa a caixa — para casar nomes de categoria digitados livres. */
export function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

type CatDef = { icon: LucideIcon; match: string[] };

/** Ordem importa: a primeira definição cujo termo aparecer no nome vence. */
const CATEGORIA_DEFS: CatDef[] = [
  { icon: Beer, match: ["cerveja", "chopp", "chope", "breja", "lager", "ipa", "pilsen"] },
  { icon: Wine, match: ["vinho", "espumante", "champanhe", "prosecco"] },
  { icon: Martini, match: ["destilado", "vodka", "whisky", "uisque", "gin", "cachaca", "tequila", "rum", "licor", "aperitivo", "drink", "coquetel"] },
  { icon: Zap, match: ["energetico", "energ", "red bull", "monster"] },
  { icon: GlassWater, match: ["agua", "isotonico", "tonica"] },
  { icon: CupSoda, match: ["refrigerante", "refri", "suco", "cha ", "bebida"] },
  { icon: Snowflake, match: ["gelo", "congelado", "sorvete", "acai"] },
  { icon: Popcorn, match: ["salgadinho", "snack", "amendoim", "batata", "chips", "pipoca", "petisco"] },
  { icon: Sandwich, match: ["salgado", "lanche", "sanduiche", "hot dog", "pastel"] },
  { icon: Candy, match: ["doce", "chocolate", "bala", "chiclete", "sobremesa", "guloseima"] },
  { icon: Cookie, match: ["biscoito", "bolacha", "cookie", "wafer"] },
  { icon: Coffee, match: ["cafe", "cappuccino", "achocolatado"] },
  { icon: Milk, match: ["leite", "laticinio", "iogurte", "queijo"] },
  { icon: Cigarette, match: ["cigarro", "tabac", "fumo", "isqueiro", "seda"] },
  { icon: Croissant, match: ["padaria", "pao", "bolo", "confeitaria"] },
  { icon: Beef, match: ["carne", "churrasco", "espetinho", "frios", "embutido", "linguica"] },
  { icon: Apple, match: ["hortifruti", "fruta", "verdura", "legume"] },
  { icon: SprayCan, match: ["limpeza", "detergente", "desinfetante"] },
  { icon: Droplets, match: ["higiene", "shampoo", "sabonete", "farmacia"] },
  { icon: PawPrint, match: ["pet", "racao", "animal"] },
  { icon: Package, match: ["descartav", "copo", "utilidade", "bazar", "carvao"] },
  { icon: ShoppingBasket, match: ["conveniencia", "mercearia", "outros"] },
];

/** Ícone Lucide para uma categoria. Fallback: cesta de compras. */
export function iconeCategoria(nome: string | null | undefined): LucideIcon {
  if (!nome) return ShoppingBasket;
  const n = norm(nome);
  for (const def of CATEGORIA_DEFS) {
    if (def.match.some((m) => n.includes(m))) return def.icon;
  }
  return ShoppingBasket;
}

// ── Venda sugestiva ─────────────────────────────────────────
// Ao adicionar um item de categoria X, oferecer itens das categorias-alvo.
// Casamento por termo no nome da categoria do produto candidato.
const REGRAS_SUGESTAO: { quando: string[]; sugerir: string[] }[] = [
  { quando: ["cerveja", "chopp", "chope"], sugerir: ["gelo", "amendoim", "salgad", "carvao", "copo", "petisco"] },
  { quando: ["energetico", "energ"], sugerir: ["vodka", "destilado", "gelo"] },
  { quando: ["refrigerante", "refri", "suco"], sugerir: ["salgad", "snack", "doce", "gelo"] },
  { quando: ["destilado", "vodka", "whisky", "gin", "cachaca"], sugerir: ["energetico", "gelo", "refrigerante", "copo"] },
  { quando: ["gelo"], sugerir: ["cerveja", "refrigerante", "destilado"] },
  { quando: ["salgad", "snack", "amendoim"], sugerir: ["cerveja", "refrigerante"] },
];

/** Termos de categoria a sugerir a partir da categoria de um produto adicionado. */
export function termosSugeridos(categoria: string | null | undefined): string[] {
  if (!categoria) return [];
  const n = norm(categoria);
  for (const r of REGRAS_SUGESTAO) {
    if (r.quando.some((q) => n.includes(q))) return r.sugerir;
  }
  return [];
}

/** "350 ml", "2 L", "473 ml" — a partir do volume em ml. "" se nulo. */
export function fmtVolume(ml: number | null | undefined): string {
  if (ml == null || ml <= 0) return "";
  if (ml >= 1000) {
    const l = ml / 1000;
    return `${Number.isInteger(l) ? l : l.toFixed(1).replace(".", ",")} L`;
  }
  return `${ml} ml`;
}
