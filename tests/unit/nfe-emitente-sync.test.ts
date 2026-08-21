import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseNotaXml } from "@/lib/fiscal/nfe-xml";

/**
 * O que a sincronização de fornecedor consome do XML: regime tributário,
 * telefone e e-mail do emitente.
 *
 * O e-mail é o campo perigoso — é texto livre na NF-e e chega de todo jeito.
 * Deixar "nao possui" virar contato encheria o cadastro de lixo, e cada linha
 * dessas vira uma pergunta na tela do operador.
 */
const fixture = readFileSync(resolve(__dirname, "../fixtures/nfe-183095-crbs.xml"), "utf8");
const nota = parseNotaXml(fixture);

/** Monta uma NF-e mínima só com os campos do emitente que se quer testar. */
function notaCom(emitExtra: string, foneExtra = "") {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc><NFe><infNFe Id="NFe43260856228356007900550390001830951157156333" versao="4.00">
  <ide><mod>55</mod><nNF>1</nNF><serie>1</serie><dhEmi>2026-08-20T10:00:00-03:00</dhEmi></ide>
  <emit>
    <CNPJ>56228356007900</CNPJ><xNome>DISTRIBUIDORA TESTE LTDA</xNome>
    ${emitExtra}
    <enderEmit><xLgr>Rua A</xLgr><nro>100</nro><xBairro>Centro</xBairro>
      <xMun>Porto Alegre</xMun><cMun>4314902</cMun><UF>RS</UF><CEP>90000000</CEP>
      ${foneExtra}
    </enderEmit>
  </emit>
  <det nItem="1"><prod><cProd>1</cProd><xProd>Item</xProd><uCom>UN</uCom>
    <qCom>1</qCom><vUnCom>1.00</vUnCom><vProd>1.00</vProd></prod></det>
  <total><ICMSTot><vNF>1.00</vNF></ICMSTot></total>
</infNFe></NFe></nfeProc>`;
  return parseNotaXml(xml);
}

describe("emitente do XML — dados que alimentam o cadastro do fornecedor", () => {
  it("lê CRT e telefone da nota real", () => {
    expect(nota.emitente.crt).toBe(3);
    expect(nota.emitente.telefone).toBe("08008871111");
    expect(nota.emitente.cnpj).toBe("56228356007900");
  });

  it("nota sem e-mail nem CRT não inventa valor", () => {
    const n = notaCom("");
    expect(n.emitente.email).toBeNull();
    expect(n.emitente.crt).toBeNull();
  });

  it("aceita e-mail normal, em minúsculas", () => {
    const n = notaCom("<email>Faturamento@Empresa.com.BR</email>");
    expect(n.emitente.email).toBe("faturamento@empresa.com.br");
  });

  it("descarta texto que não é e-mail", () => {
    expect(notaCom("<email>nao possui</email>").emitente.email).toBeNull();
    expect(notaCom("<email>-</email>").emitente.email).toBeNull();
  });

  it("de uma lista de e-mails, fica com o primeiro válido", () => {
    const n = notaCom("<email>fiscal@empresa.com.br; vendas@empresa.com.br</email>");
    expect(n.emitente.email).toBe("fiscal@empresa.com.br");
  });

  it("telefone chega só com dígitos, para comparar com o cadastro", () => {
    const n = notaCom("", "<fone>(51) 3333-4444</fone>");
    expect(n.emitente.telefone).toBe("5133334444");
  });
});
