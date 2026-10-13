import { describe, it, expect } from "vitest";
import { lerDataImagem, thumbSrc, urlImagemProduto } from "@/lib/imagem";

/**
 * A listagem troca a foto embutida por um caminho curto. Se a troca errar o
 * alvo, ou a foto volta a inchar o payload, ou uma URL remota válida vira 404.
 */

const QUANDO = new Date("2026-10-13T12:00:00Z");

describe("urlImagemProduto", () => {
  it("troca a foto embutida pelo caminho da rota, versionado", () => {
    const url = urlImagemProduto("p1", "data:image/webp;base64,AAAA", QUANDO);
    expect(url).toBe(`/api/produtos/p1/imagem?v=${QUANDO.getTime().toString(36)}`);
  });

  it("muda a versão quando o produto muda", () => {
    const antes = urlImagemProduto("p1", "data:image/webp;base64,AAAA", QUANDO);
    const depois = urlImagemProduto("p1", "data:image/webp;base64,AAAA", new Date(QUANDO.getTime() + 1000));
    expect(depois).not.toBe(antes);
  });

  it("deixa URL remota intacta e produto sem foto como null", () => {
    expect(urlImagemProduto("p1", "https://cdn.exemplo.com/a.jpg", QUANDO)).toBe("https://cdn.exemplo.com/a.jpg");
    expect(urlImagemProduto("p1", null, QUANDO)).toBeNull();
  });

  it("o caminho da rota passa pelo thumbSrc sem virar pedido ao otimizador", () => {
    const url = urlImagemProduto("p1", "data:image/webp;base64,AAAA", QUANDO)!;
    expect(thumbSrc(url, 96)).toBe(url);
  });
});

describe("lerDataImagem", () => {
  it("separa tipo e conteúdo", () => {
    expect(lerDataImagem("data:image/webp;base64,AAAA")).toEqual({
      contentType: "image/webp",
      base64: "AAAA",
    });
  });

  it("recusa SVG, texto e URL comum", () => {
    expect(lerDataImagem("data:image/svg+xml;base64,AAAA")).toBeNull();
    expect(lerDataImagem("data:text/html;base64,AAAA")).toBeNull();
    expect(lerDataImagem("https://cdn.exemplo.com/a.jpg")).toBeNull();
  });
});
