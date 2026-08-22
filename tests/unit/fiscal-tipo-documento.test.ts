import { describe, it, expect } from "vitest";
import { classificarDocumento, ehConhecimentoDeTransporte } from "@/lib/fiscal/tipo-documento";

// O importador aceitava qualquer XML e tentava virar entrada de mercadoria.
// CT-e e nota de serviço não têm produto para relacionar — ficavam PENDENTE
// para sempre. Estes testes travam a regra que separa mercadoria de despesa.

describe("ehConhecimentoDeTransporte", () => {
  it("reconhece CT-e autorizado (cteProc)", () => {
    expect(ehConhecimentoDeTransporte('<?xml version="1.0"?><cteProc versao="4.00"><CTe/></cteProc>')).toBe(true);
  });

  it("reconhece CT-e solto (CTe)", () => {
    expect(ehConhecimentoDeTransporte("<CTe><infCte Id='CTe123'/></CTe>")).toBe(true);
  });

  it("reconhece CT-e com prefixo de namespace", () => {
    expect(ehConhecimentoDeTransporte("<ns:cteProc><ns:CTe/></ns:cteProc>")).toBe(true);
  });

  it("não confunde NF-e com CT-e", () => {
    expect(ehConhecimentoDeTransporte('<nfeProc><NFe><infNFe Id="NFe1"/></NFe></nfeProc>')).toBe(false);
  });
});

describe("classificarDocumento", () => {
  const mercadoria = { cfop: "5102", descricao: "Cerveja long neck 355ml" };
  const servico = { cfop: "1353", descricao: "Serviço de transporte" };

  it("NF-e de mercadoria movimenta estoque", () => {
    const r = classificarDocumento({ modelo: "55", itens: [mercadoria, mercadoria] });
    expect(r.movimentaEstoque).toBe(true);
    expect(r.motivo).toBeNull();
  });

  it("modelo 57 (CT-e) nunca movimenta estoque", () => {
    const r = classificarDocumento({ modelo: "57", itens: [mercadoria] });
    expect(r.movimentaEstoque).toBe(false);
    expect(r.motivo).toContain("CT-e");
  });

  it("modelo 67 (CT-e OS) também é serviço", () => {
    expect(classificarDocumento({ modelo: "67", itens: [] }).movimentaEstoque).toBe(false);
  });

  it("nota com TODOS os itens de CFOP de serviço é despesa", () => {
    const r = classificarDocumento({ modelo: "55", itens: [servico, { cfop: "2933", descricao: "ISS" }] });
    expect(r.movimentaEstoque).toBe(false);
    expect(r.motivo).toContain("serviço");
  });

  // Distribuidor que destaca frete como item da mesma nota: continua sendo
  // entrada de mercadoria — recusar isso deixaria a bebida fora do estoque.
  it("nota mista (mercadoria + serviço) continua sendo entrada", () => {
    expect(
      classificarDocumento({ modelo: "55", itens: [mercadoria, servico] }).movimentaEstoque,
    ).toBe(true);
  });

  it("nota sem itens não é tratada como despesa", () => {
    expect(classificarDocumento({ modelo: "55", itens: [] }).movimentaEstoque).toBe(true);
  });

  it("item sem CFOP não conta como serviço", () => {
    expect(
      classificarDocumento({ modelo: "55", itens: [{ cfop: null, descricao: "?" }] })
        .movimentaEstoque,
    ).toBe(true);
  });
});
