import { describe, it, expect } from "vitest";
import { gtinValido } from "@/lib/codigo-lido";

/**
 * Código com dígito verificador errado é um produto que NUNCA bipa no caixa.
 * O scanner não erra; o dedo digitando erra — e o erro só aparece semanas
 * depois, com fila na frente. Esta função é a única defesa.
 */
describe("gtinValido", () => {
  it("aceita GTIN real de cada comprimento", () => {
    expect(gtinValido("7891000315507")).toBe(true); // EAN-13, Nestlé
    expect(gtinValido("7894900011517")).toBe(true); // EAN-13, Coca-Cola
    expect(gtinValido("96385074")).toBe(true); // EAN-8
    expect(gtinValido("036000291452")).toBe(true); // UPC-12
    expect(gtinValido("17891000315504")).toBe(true); // DUN-14 (caixa)
  });

  it("pega o dígito trocado — o erro de digitação típico", () => {
    expect(gtinValido("7891000315508")).toBe(false);
    expect(gtinValido("7894900011518")).toBe(false);
    expect(gtinValido("96385075")).toBe(false);
  });

  it("pega dígitos vizinhos trocados de lugar", () => {
    expect(gtinValido("8791000315507")).toBe(false); // 78 → 87
    expect(gtinValido("7891000135507")).toBe(false); // 31 → 13
    expect(gtinValido("7891000315570")).toBe(false); // 07 → 70
  });

  it("deixa passar a transposição de vizinhos que diferem em 5 — limite do módulo 10", () => {
    // Buraco conhecido do algoritmo, não bug nosso: trocar dois dígitos
    // vizinhos cuja diferença é 5 mantém a soma. Vale registrar para ninguém
    // "consertar" a função tentando pegar este caso.
    expect(gtinValido("7891000315057")).toBe(true); // 50 → 05
  });

  it("não opina sobre o que não é GTIN", () => {
    // Código interno de balança, SKU do fornecedor, campo em branco.
    expect(gtinValido("2001234")).toBeNull();
    expect(gtinValido("")).toBeNull();
    expect(gtinValido("789")).toBeNull();
    expect(gtinValido("789100031550712345")).toBeNull();
  });

  it("ignora separadores que o leitor às vezes mistura", () => {
    expect(gtinValido("789 1000 315507")).toBe(true);
    expect(gtinValido("7891000-315507")).toBe(true);
  });
});
