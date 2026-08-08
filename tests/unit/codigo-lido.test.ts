import { describe, it, expect } from "vitest";
import {
  classificarCodigo,
  codigoDoPedido,
  resumoDaChave,
  PREFIXO_PEDIDO,
} from "@/lib/codigo-lido";
import { eanParaSvg, ehEanDesenhavel } from "@/lib/barcode-svg";

/**
 * O classificador é a única regra de decisão do scanner universal: é ele que
 * separa "abrir o produto" de "importar a nota" de "abrir o pedido". Um engano
 * aqui manda uma chave de 44 dígitos para a busca de produto e a pessoa acha
 * que o app não leu a nota.
 */
describe("classificarCodigo", () => {
  it("reconhece EAN-13, EAN-8, UPC-A e DUN-14", () => {
    expect(classificarCodigo("7891000100103")).toEqual({
      tipo: "ean",
      valor: "7891000100103",
    });
    expect(classificarCodigo("96385074").tipo).toBe("ean");
    expect(classificarCodigo("012345678905").tipo).toBe("ean");
    expect(classificarCodigo("17891000100100").tipo).toBe("ean");
  });

  it("limpa sujeira do leitor antes de decidir", () => {
    expect(classificarCodigo("  789 1000 100103 ")).toEqual({
      tipo: "ean",
      valor: "7891000100103",
    });
  });

  it("reconhece a chave de acesso de 44 dígitos da DANFE", () => {
    const chave = "3".repeat(44);
    expect(classificarCodigo(chave)).toEqual({ tipo: "chave", valor: chave });
  });

  it("tira a chave da URL do QR da NFC-e", () => {
    const chave = "4".repeat(44);
    expect(
      classificarCodigo(
        `https://www.sefaz.rs.gov.br/nfce/qrcode?p=${chave}|2|1|1|abc`,
      ),
    ).toEqual({ tipo: "chave", valor: chave });

    expect(
      classificarCodigo(`https://exemplo.gov.br/consulta?chNFe=${chave}&tpAmb=1`),
    ).toEqual({ tipo: "chave", valor: chave });
  });

  it("chave vence EAN: 44 dígitos nunca é código de produto", () => {
    // Sem a ordem certa, a chave cairia na regra numérica genérica.
    expect(classificarCodigo("5".repeat(44)).tipo).toBe("chave");
  });

  it("reconhece o QR do pedido, no esquema próprio e na rota do app", () => {
    expect(classificarCodigo(`${PREFIXO_PEDIDO}clx123abc`)).toEqual({
      tipo: "pedido",
      valor: "clx123abc",
    });
    expect(classificarCodigo("https://loja.nohub.app/m/receber/clx123abc")).toEqual({
      tipo: "pedido",
      valor: "clx123abc",
    });
  });

  it("o que não casa vira busca livre, não erro", () => {
    expect(classificarCodigo("REF-COCA-2L")).toEqual({
      tipo: "texto",
      valor: "REF-COCA-2L",
    });
    // 9 dígitos não é EAN de nenhum tamanho válido.
    expect(classificarCodigo("123456789").tipo).toBe("texto");
    expect(classificarCodigo("   ")).toEqual({ tipo: "texto", valor: "" });
  });

  it("ida e volta do código do pedido", () => {
    const id = "cm4xyz";
    expect(classificarCodigo(codigoDoPedido(id))).toEqual({ tipo: "pedido", valor: id });
  });
});

describe("resumoDaChave", () => {
  it("lê série e número direto da chave, sem consultar a SEFAZ", () => {
    // cUF(35) AAMM(2401) CNPJ(14) mod(55) serie(001) nNF(000000123) resto
    const chave = `352401${"1".repeat(14)}55001000000123` + "1".repeat(9);
    const r = resumoDaChave(chave);
    expect(r.modelo).toBe("55");
    expect(r.serie).toBe(1);
    expect(r.numero).toBe(123);
    expect(r.cnpjEmitente).toBe("1".repeat(14));
  });
});

describe("eanParaSvg", () => {
  it("desenha EAN-13 e EAN-8", () => {
    expect(ehEanDesenhavel("7891000100103")).toBe(true);
    expect(ehEanDesenhavel("96385074")).toBe(true);
    expect(eanParaSvg("7891000100103")).toContain("<svg");
    expect(eanParaSvg("96385074")).toContain("<svg");
  });

  it("recusa o que não sabe desenhar em vez de imprimir barra errada", () => {
    expect(ehEanDesenhavel("123456789")).toBe(false);
    expect(eanParaSvg("SKU-123")).toBeNull();
    expect(eanParaSvg("1".repeat(14))).toBeNull();
  });

  it("respeita a largura do padrão: 95 módulos + zona de silêncio", () => {
    const svg = eanParaSvg("7891000100103") as string;
    // 95 módulos + 9 de margem de cada lado.
    expect(svg).toContain('viewBox="0 0 113');
  });
});
