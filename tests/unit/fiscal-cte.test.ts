import { describe, it, expect } from "vitest";
import { ratearFrete, ehCteXml, parseCteXml } from "@/lib/fiscal/cte-xml";

// O frete que vem em CT-e separado é custo da mercadoria. Estes testes travam
// a régua do rateio — errar aqui distorce margem em silêncio, produto a produto.

describe("ehCteXml", () => {
  it("reconhece cteProc e CTe, com e sem namespace", () => {
    expect(ehCteXml("<cteProc><CTe/></cteProc>")).toBe(true);
    expect(ehCteXml("<CTe><infCte/></CTe>")).toBe(true);
    expect(ehCteXml("<ns:cteProc/>")).toBe(true);
  });

  it("não confunde NF-e com CT-e", () => {
    expect(ehCteXml("<nfeProc><NFe/></nfeProc>")).toBe(false);
  });
});

describe("ratearFrete", () => {
  const notas = [
    { chave: "A", valorTotal: 3000 },
    { chave: "B", valorTotal: 1000 },
  ];

  it("divide proporcional ao valor de cada nota", () => {
    const r = ratearFrete(200, notas);
    expect(r.get("A")).toBe(150);
    expect(r.get("B")).toBe(50);
  });

  it("a soma das partes é exatamente o frete", () => {
    // 1/3 não fecha em centavos: a última linha leva a sobra do arredondamento.
    const r = ratearFrete(100, [
      { chave: "A", valorTotal: 1 },
      { chave: "B", valorTotal: 1 },
      { chave: "C", valorTotal: 1 },
    ]);
    const soma = [...r.values()].reduce((a, b) => a + b, 0);
    expect(soma).toBeCloseTo(100, 2);
  });

  it("divide igual quando nenhuma nota tem valor", () => {
    const r = ratearFrete(90, [
      { chave: "A", valorTotal: 0 },
      { chave: "B", valorTotal: 0 },
      { chave: "C", valorTotal: 0 },
    ]);
    expect(r.get("A")).toBe(30);
    expect(r.get("C")).toBe(30);
  });

  it("frete zero ou sem notas não distribui nada", () => {
    expect(ratearFrete(0, notas).size).toBe(0);
    expect(ratearFrete(200, []).size).toBe(0);
  });

  it("carga de uma nota só leva o frete inteiro", () => {
    const r = ratearFrete(180, [{ chave: "A", valorTotal: 3000 }]);
    expect(r.get("A")).toBe(180);
  });
});

describe("parseCteXml", () => {
  const cte = `<?xml version="1.0" encoding="UTF-8"?>
<cteProc versao="4.00">
  <CTe>
    <infCte Id="CTe43250612345678000190570010000012341000012348" versao="4.00">
      <ide>
        <mod>57</mod>
        <serie>1</serie>
        <nCT>1234</nCT>
        <dhEmi>2026-08-20T10:00:00-03:00</dhEmi>
        <tpServ>0</tpServ>
      </ide>
      <emit>
        <CNPJ>12345678000190</CNPJ>
        <xNome>Transportes Rapido LTDA</xNome>
        <enderEmit><UF>RS</UF></enderEmit>
      </emit>
      <dest><CNPJ>98765432000110</CNPJ></dest>
      <vPrest>
        <vTPrest>200.00</vTPrest>
        <vRec>180.50</vRec>
      </vPrest>
      <infCTeNorm>
        <infDoc>
          <infNFe><chave>43250612345678000190550010000011111000011118</chave></infNFe>
          <infNFe><chave>43250612345678000190550010000022222000022226</chave></infNFe>
        </infDoc>
      </infCTeNorm>
    </infCte>
  </CTe>
</cteProc>`;

  it("lê chave, emitente e valor a receber", () => {
    const r = parseCteXml(cte);
    expect(r.chave).toHaveLength(44);
    expect(r.modelo).toBe("57");
    expect(r.numero).toBe(1234);
    expect(r.emitente.cnpj).toBe("12345678000190");
    expect(r.emitente.uf).toBe("RS");
    // vRec (o que vai ser pago) manda sobre vTPrest.
    expect(r.valorTotal).toBe(180.5);
  });

  it("colhe as chaves das notas transportadas, sem a própria", () => {
    const r = parseCteXml(cte);
    expect(r.notasTransportadas).toHaveLength(2);
    expect(r.notasTransportadas).toContain("43250612345678000190550010000011111000011118");
    expect(r.notasTransportadas).not.toContain(r.chave);
  });

  it("lê o tomador para conferir se o frete é nosso", () => {
    expect(parseCteXml(cte).tomadorCnpj).toBe("98765432000110");
  });

  it("recusa XML que não é CT-e", () => {
    expect(() => parseCteXml("<nfeProc><NFe/></nfeProc>")).toThrow();
  });
});
