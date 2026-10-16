import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import tls from "node:tls";
import forge from "node-forge";
import {
  abrirCertificadoA1,
  credenciaisTls,
  lerCertificadoA1,
} from "@/lib/fiscal/certificado-a1";

const FIXTURES = path.resolve(__dirname, "../fixtures");

function certificado(cn: string, validoAte: Date, chave = forge.pki.rsa.generateKeyPair(1024)) {
  const cert = forge.pki.createCertificate();
  cert.publicKey = chave.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(validoAte.getTime() - 365 * 86_400_000);
  cert.validity.notAfter = validoAte;
  const attrs = [
    { shortName: "C", value: "BR" },
    { shortName: "O", value: "ICP-Brasil" },
    // AR que emitiu: CNPJ que NÃO é o do titular.
    { shortName: "OU", value: "11222333000181" },
    { shortName: "CN", value: cn },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(chave.privateKey, forge.md.sha256.create());
  return { cert, chave };
}

/** PFX no formato e-CNPJ ICP-Brasil (CN = "RAZÃO:CNPJ"), opcionalmente com a AC antes. */
function gerarPfx(opts: {
  cn: string;
  validoAte: Date;
  senha: string;
  comCadeia?: boolean;
}): string {
  const titular = certificado(opts.cn, opts.validoAte);
  const certs = opts.comCadeia
    ? [certificado("AC TESTE RFB v5", opts.validoAte).cert, titular.cert]
    : [titular.cert];
  const p12 = forge.pkcs12.toPkcs12Asn1(titular.chave.privateKey, certs, opts.senha, {
    algorithm: "3des",
  });
  return forge.util.encode64(forge.asn1.toDer(p12).getBytes());
}

const umAno = new Date(Date.now() + 365 * 86_400_000);
const CN = "MERCADO TESTE LTDA:12345678000199";

describe("lerCertificadoA1", () => {
  it("tira CNPJ e titular do CN, não do primeiro atributo nem do OU", () => {
    const info = lerCertificadoA1(gerarPfx({ cn: CN, validoAte: umAno, senha: "s3nha" }), "s3nha");
    expect(info.cnpj).toBe("12345678000199");
    expect(info.titular).toBe("MERCADO TESTE LTDA");
  });

  it("escolhe o certificado que casa com a chave quando o PFX traz a cadeia", () => {
    const pfx = gerarPfx({ cn: CN, validoAte: umAno, senha: "s3nha", comCadeia: true });
    expect(lerCertificadoA1(pfx, "s3nha").cnpj).toBe("12345678000199");
    expect(abrirCertificadoA1(pfx, "s3nha").chain.match(/BEGIN CERTIFICATE/g)).toHaveLength(2);
  });

  it("aceita a senha colada com espaço no fim", () => {
    const pfx = gerarPfx({ cn: CN, validoAte: umAno, senha: "s3nha" });
    expect(lerCertificadoA1(pfx, "s3nha \n").cnpj).toBe("12345678000199");
  });

  it("diz que a senha está errada", () => {
    const pfx = gerarPfx({ cn: CN, validoAte: umAno, senha: "certa" });
    expect(() => lerCertificadoA1(pfx, "errada")).toThrow(/Senha do certificado incorreta/);
  });

  it("diz que o arquivo não é um .pfx", () => {
    const naoPfx = Buffer.from("-----BEGIN CERTIFICATE-----\nxxx").toString("base64");
    expect(() => lerCertificadoA1(naoPfx, "s3nha")).toThrow(/não é um certificado A1 válido/);
  });

  it("recusa e-CPF (sem CNPJ no CN)", () => {
    const pfx = gerarPfx({ cn: "FULANO DE TAL:12345678901", validoAte: umAno, senha: "s3nha" });
    expect(() => lerCertificadoA1(pfx, "s3nha")).toThrow(/e-CPF/);
  });

  // Fixtures reais (autoassinados, CNPJ fictício): o formato que o Windows
  // exporta hoje (PBES2/AES-256) e o legado de certificadora (RC2-40).
  it("abre PFX do Windows (AES) com senha acentuada", () => {
    const pfx = fs.readFileSync(path.join(FIXTURES, "a1-windows-aes-senha-acentuada.pfx"));
    const b64 = pfx.toString("base64");
    expect(lerCertificadoA1(b64, "Açaí@2025").cnpj).toBe("12345678000199");
    expect(() => tls.createSecureContext(credenciaisTls(b64, "Açaí@2025"))).not.toThrow();
    expect(() => lerCertificadoA1(b64, "Acai@2025")).toThrow(/Senha do certificado incorreta/);
  });

  it("abre PFX legado (RC2-40) que o OpenSSL 3 recusa, e o TLS aceita o PEM", () => {
    const b64 = fs
      .readFileSync(path.join(FIXTURES, "a1-openssl-legado-rc2.pfx"))
      .toString("base64");
    expect(lerCertificadoA1(b64, "Senh@123").cnpj).toBe("12345678000199");
    expect(() => tls.createSecureContext(credenciaisTls(b64, "Senh@123"))).not.toThrow();
  });

  it("abre com a senha certa mesmo quando o MAC do arquivo não confere", () => {
    const titular = certificado(CN, umAno);
    const p12 = forge.pkcs12.toPkcs12Asn1(titular.chave.privateKey, [titular.cert], "NV486TTNP9VMAA", {
      algorithm: "3des",
    });
    // macData → DigestInfo → digest: adultera um byte.
    const digest = ((p12.value[2] as forge.asn1.Asn1).value[0] as forge.asn1.Asn1)
      .value[1] as forge.asn1.Asn1;
    const bytes = digest.value as string;
    digest.value = String.fromCharCode(bytes.charCodeAt(0) ^ 0xff) + bytes.slice(1);
    const b64 = forge.util.encode64(forge.asn1.toDer(p12).getBytes());

    expect(lerCertificadoA1(b64, "NV486TTNP9VMAA").cnpj).toBe("12345678000199");
    expect(() => lerCertificadoA1(b64, "NV486TTNP9VMAB")).toThrow(/Senha do certificado incorreta/);
  });

  it("mensagem de senha errada traz o diagnóstico sem a senha", () => {
    const pfx = gerarPfx({ cn: CN, validoAte: umAno, senha: "NV486TTNP9VMAA" });
    try {
      lerCertificadoA1(pfx, "ERRADA");
      expect.unreachable();
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toMatch(/senha com 6 caractere/);
      expect(msg).not.toContain("ERRADA");
    }
  });

  it("recusa certificado vencido", () => {
    const pfx = gerarPfx({ cn: CN, validoAte: new Date(Date.now() - 86_400_000), senha: "s3nha" });
    expect(() => lerCertificadoA1(pfx, "s3nha")).toThrow(/venceu/);
  });
});
