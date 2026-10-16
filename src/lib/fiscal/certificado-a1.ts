import "server-only";
import tls from "node:tls";
import forge from "node-forge";
import { FiscalProviderError, type CertificadoInfo } from "./types";

// PBES2 (AES — padrão do Windows atual e do OpenSSL 3) deriva a chave da
// senha em UTF-8 (RFC 9579). O forge passa a string JS crua ao PBKDF2, então
// senha com acento/ç/º abre o MAC mas não a chave privada: "senha incorreta"
// com a senha certa. Para ASCII o UTF-8 é idêntico — a correção é neutra.
type PbeComPbes2 = {
  getCipherForPBES2: (oid: string, params: unknown, password: string) => unknown;
  __utf8?: boolean;
};
const pbe = (forge.pki as unknown as { pbe: PbeComPbes2 }).pbe;
if (!pbe.__utf8) {
  const original = pbe.getCipherForPBES2;
  pbe.getCipherForPBES2 = (oid, params, password) =>
    original(oid, params, forge.util.encodeUtf8(password));
  pbe.__utf8 = true;
}

// ============================================================
// Certificado A1 (.pfx/.p12) — aberto UMA vez aqui e convertido em PEM.
//
// Por que forge e não o OpenSSL do Node: A1 emitido por certificadora costuma
// vir com o formato legado (RC2-40 + 3DES), que o OpenSSL 3 recusa sem o
// provider "legacy" ("Unsupported PKCS12 PFX data"). O forge abre os dois
// formatos; a conexão mTLS com a SEFAZ recebe chave + certificado em PEM.
// ============================================================

export type CertificadoAberto = {
  /** Chave privada em PEM. */
  privateKey: string;
  /** Certificado do titular (o que casa com a chave) em PEM. */
  certificate: string;
  /** Titular + cadeia, para o handshake TLS. */
  chain: string;
  cert: forge.pki.Certificate;
};

function erro(mensagem: string, causa?: unknown): never {
  throw new FiscalProviderError(mensagem, causa);
}

function lerAsn1(der: string): forge.asn1.Asn1 {
  try {
    return forge.asn1.fromDer(der);
  } catch (e) {
    erro(
      "O arquivo não é um certificado A1 válido. Envie o .pfx ou .p12 (não o .cer, .crt ou .zip).",
      e,
    );
  }
}

/**
 * A mesma estrutura sem o `macData` (a verificação de integridade). Arquivo de
 * certificadora às vezes tem MAC que o forge calcula diferente — a senha certa
 * é recusada ali. Sem o MAC, a senha ainda é provada: com a errada a chave
 * privada não decifra, e a chave tem de casar com o certificado logo abaixo.
 */
function semMac(asn1: forge.asn1.Asn1): forge.asn1.Asn1 {
  const filhos = asn1.value as forge.asn1.Asn1[];
  return forge.asn1.create(asn1.tagClass, asn1.type, asn1.constructed, filhos.slice(0, 2));
}

const senhaErrada = (e: unknown) =>
  e instanceof Error &&
  /Invalid password|wrong password|MAC could not be verified|Failed to decrypt/i.test(e.message);

/** Mensagem do OpenSSL do Node com esta senha, ou null se ele abriu o arquivo. */
function respostaOpenssl(der: string, senha: string): string | null {
  try {
    tls.createSecureContext({ pfx: Buffer.from(der, "binary"), passphrase: senha });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Algoritmos visíveis sem senha — nada secreto, só para o suporte. */
function algoritmos(asn1: forge.asn1.Asn1): string {
  const nomes = new Set<string>();
  const visitar = (n: forge.asn1.Asn1) => {
    if (n.type === forge.asn1.Type.OID && typeof n.value === "string") {
      const nome = (forge.pki.oids as Record<string, string>)[forge.asn1.derToOid(n.value)];
      if (nome) nomes.add(nome);
    } else if (Array.isArray(n.value)) {
      n.value.forEach(visitar);
    }
  };
  visitar(asn1);
  return [...nomes].join(", ");
}

function falhaAoAbrir(der: string, asn1: forge.asn1.Asn1, senha: string, e: unknown): never {
  const detalhe = e instanceof Error ? e.message : String(e);
  const openssl = respostaOpenssl(der, senha);
  const diagnostico = `senha com ${senha.length} caractere(s); ${algoritmos(asn1)}; OpenSSL: ${openssl ?? "abriu"}`;
  if (senhaErrada(e) && openssl !== null) {
    erro(
      `Senha do certificado incorreta. Confira maiúsculas e minúsculas e se o navegador não preencheu a senha sozinho. (${diagnostico})`,
      e,
    );
  }
  erro(`Não foi possível abrir o certificado A1: ${detalhe}. (${diagnostico})`, e);
}

export function abrirCertificadoA1(pfxBase64: string, senha: string): CertificadoAberto {
  const der = forge.util.decode64(pfxBase64);
  const asn1 = lerAsn1(der);

  // Senha colada costuma vir com espaço ou quebra de linha no fim.
  const senhas = [...new Set([senha, senha.trim()])];
  let p12: forge.pkcs12.Pkcs12Pfx | null = null;
  let primeiroErro: unknown = null;
  let semIntegridade = false;
  for (const s of senhas) {
    for (const estrutura of [asn1, semMac(asn1)]) {
      try {
        p12 = forge.pkcs12.pkcs12FromAsn1(estrutura, false, s);
        semIntegridade = estrutura !== asn1;
        break;
      } catch (e) {
        primeiroErro ??= e;
      }
    }
    if (p12) break;
  }
  if (!p12) falhaAoAbrir(der, asn1, senha, primeiroErro);

  const shrouded = forge.pki.oids.pkcs8ShroudedKeyBag;
  const plain = forge.pki.oids.keyBag;
  const certOid = forge.pki.oids.certBag;
  const keyBags = [
    ...(p12.getBags({ bagType: shrouded })[shrouded] ?? []),
    ...(p12.getBags({ bagType: plain })[plain] ?? []),
  ];
  const certs = (p12.getBags({ bagType: certOid })[certOid] ?? [])
    .map((b) => b.cert)
    .filter((c): c is forge.pki.Certificate => Boolean(c));

  if (keyBags.length === 0) {
    erro(
      "O arquivo não traz a chave privada. Exporte o certificado de novo marcando \"exportar a chave privada\".",
    );
  }
  const key = keyBags.find((b) => b.key)?.key as forge.pki.rsa.PrivateKey | undefined;
  // PFX de certificadora vem com a cadeia (AC intermediária, raiz). O titular
  // é o que tem a mesma chave pública da chave privada — nunca "o primeiro".
  const titular = key
    ? (certs.find((c) => (c.publicKey as forge.pki.rsa.PublicKey).n?.equals(key.n)) ?? null)
    : null;
  // Aberto sem o MAC: chave e certificado casando é a prova de que a senha
  // está certa. Não casou = a senha decifrou lixo.
  if (semIntegridade && (!key || !titular)) {
    falhaAoAbrir(der, asn1, senha, new Error("PKCS#12 MAC could not be verified. Invalid password?"));
  }
  if (!key) {
    erro("A chave privada deste certificado não é RSA — o certificado A1 de NF-e precisa ser RSA.");
  }
  if (certs.length === 0) erro("O arquivo não traz o certificado, só a chave.");
  if (!titular) erro("Nenhum certificado do arquivo corresponde à chave privada.");

  const certificate = forge.pki.certificateToPem(titular);
  return {
    privateKey: forge.pki.privateKeyToPem(key),
    certificate,
    chain: [certificate, ...certs.filter((c) => c !== titular).map((c) => forge.pki.certificateToPem(c))].join(""),
    cert: titular,
  };
}

export function lerCertificadoA1(pfxBase64: string, senha: string): CertificadoInfo {
  const { cert } = abrirCertificadoA1(pfxBase64, senha);
  // e-CNPJ ICP-Brasil: CN = "RAZÃO SOCIAL:12345678000199". Só o CN vale: o
  // OU costuma trazer o CNPJ da AR que emitiu, que não é o do titular.
  const cn = String(cert.subject.getField("CN")?.value ?? "").trim();
  const documento = cn.match(/:(\d{14})$/)?.[1] ?? cn.match(/\d{14}/)?.[0] ?? "";
  const titular = cn.replace(/:\d{11,14}$/, "").trim() || "Titular não informado";
  if (!documento) {
    erro(
      "Este certificado não tem CNPJ — parece um e-CPF. Para receber NF-e da empresa, use o e-CNPJ A1.",
    );
  }
  if (cert.validity.notAfter.getTime() < Date.now()) {
    erro(
      `Este certificado venceu em ${cert.validity.notAfter.toLocaleDateString("pt-BR")}. Renove-o com a certificadora e envie o novo .pfx.`,
    );
  }
  return {
    id: `local-${documento}`,
    titular,
    cnpj: documento,
    validade: cert.validity.notAfter,
  };
}

/** Credenciais para `https.request` — PEM, não PFX (ver topo do arquivo). */
export function credenciaisTls(pfxBase64: string, senha: string): { key: string; cert: string } {
  const aberto = abrirCertificadoA1(pfxBase64, senha);
  return { key: aberto.privateKey, cert: aberto.chain };
}
