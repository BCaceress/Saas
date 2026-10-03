import type { Prisma } from "@/generated/prisma";
import { onlyDigits } from "./normalize";

// ============================================================
// Achar o produto por QUALQUER código que bipe nele.
//
// Um código de barras pode viver em três lugares, e o leitor não sabe a
// diferença entre eles:
//
//   1. `Product.ean`            — espelho do código principal (legado vivo);
//   2. `ProductBarcode.codigo`  — apelidos: mesma unidade, marcas diferentes;
//   3. `ProductPackaging.ean`   — fardo/caixa, onde o FATOR muda o saldo.
//
// Este módulo é a única definição de "onde procurar". Antes cada tela montava
// o seu OR à mão, e foi assim que o apelido de código precisou ser acrescentado
// em oito lugares: quem esquecesse um deixava um bipe sem resposta, com fila
// no caixa.
//
// Puro de propósito — sem I/O, sem `db`. Monta o `where` e devolve; quem
// consulta é o chamador, dentro do contexto de tenant dele.
// ============================================================

/**
 * Alternativas de busca do produto pela unidade de VENDA (fator 1).
 *
 * Não inclui embalagem: quem bipa um fardo precisa saber que é fardo para
 * multiplicar o fator. Use `alternativasComEmbalagem` nessas telas.
 *
 * Devolve `[]` para código vazio — um OR vazio no Prisma casaria tudo.
 */
export function alternativasPorCodigo(bruto: string): Prisma.ProductWhereInput[] {
  const digitos = onlyDigits(bruto);
  const cru = bruto.trim();
  const codigos = [...new Set([digitos, cru].filter(Boolean))];
  if (!codigos.length) return [];
  return [
    { ean: { in: codigos } },
    { barcodes: { some: { codigo: { in: codigos } } } },
  ];
}

/** Idem, somando o DUN do fardo/caixa. */
export function alternativasComEmbalagem(bruto: string): Prisma.ProductWhereInput[] {
  const digitos = onlyDigits(bruto);
  const cru = bruto.trim();
  const codigos = [...new Set([digitos, cru].filter(Boolean))];
  if (!codigos.length) return [];
  return [
    ...alternativasPorCodigo(bruto),
    { packagings: { some: { ean: { in: codigos } } } },
  ];
}

/**
 * Trecho de código digitado na busca livre ("748" acha "7891000...").
 *
 * `contains` e não `in`: aqui a pessoa está procurando, não bipando.
 */
export function alternativasPorTrechoDeCodigo(
  termo: string,
): Prisma.ProductWhereInput[] {
  const digitos = onlyDigits(termo);
  if (!digitos) return [];
  return [
    { ean: { contains: digitos } },
    { barcodes: { some: { codigo: { contains: digitos } } } },
    { packagings: { some: { ean: { contains: digitos } } } },
  ];
}

/**
 * `where` de "este código já tem dono", para checar antes de gravar.
 *
 * `exceptProductId` deixa o produto em edição de fora — senão todo salvar
 * acusaria conflito com ele mesmo.
 */
export function ondeCodigoTemDono(
  codigos: string[],
  exceptProductId?: string,
): Prisma.ProductBarcodeWhereInput {
  return {
    codigo: { in: codigos },
    ...(exceptProductId ? { productId: { not: exceptProductId } } : {}),
  };
}

/**
 * Lista de códigos de um produto para exibição, principal primeiro.
 *
 * Inclui o espelho `Product.ean` quando a tabela ainda não o tem — produto
 * criado por caminho que só grava o espelho (ou legado com EAN duplicado que
 * o backfill recusou) continua mostrando o código que tem.
 */
export function codigosParaExibir(p: {
  ean: string | null;
  barcodes?: { codigo: string; rotulo: string | null; principal: boolean }[];
}): { codigo: string; rotulo: string | null; principal: boolean }[] {
  const lista = [...(p.barcodes ?? [])];
  if (p.ean && !lista.some((b) => b.codigo === p.ean)) {
    lista.push({ codigo: p.ean, rotulo: null, principal: lista.length === 0 });
  }
  return lista.sort((a, b) => Number(b.principal) - Number(a.principal));
}
