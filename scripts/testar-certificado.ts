/**
 * Testa um certificado A1 (.pfx/.p12) com o MESMO código que o upload usa,
 * mais o OpenSSL do Node como segunda opinião. Nada sai da máquina.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/testar-certificado.ts "C:\caminho\cert.pfx"
 *
 * A senha é pedida no terminal (ou vem de CERT_SENHA).
 */
import fs from "node:fs";
import tls from "node:tls";
import readline from "node:readline/promises";
import { lerCertificadoA1 } from "@/lib/fiscal/certificado-a1";

async function main() {
  const arquivo = process.argv[2];
  if (!arquivo || !fs.existsSync(arquivo)) {
    console.error("Informe o caminho do .pfx: scripts/testar-certificado.ts \"C:\\caminho\\cert.pfx\"");
    process.exit(1);
  }

  let senha = process.env.CERT_SENHA ?? "";
  if (!senha) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    senha = await rl.question("Senha do certificado: ");
    rl.close();
  }

  const bytes = fs.readFileSync(arquivo);
  console.log(`\nArquivo: ${bytes.length} bytes · senha com ${senha.length} caractere(s)`);
  console.log(
    `Caracteres fora de A-Z/0-9 na senha: ${
      [...senha].filter((c) => !/[A-Za-z0-9]/.test(c)).map((c) => JSON.stringify(c)).join(" ") || "nenhum"
    }`,
  );

  try {
    tls.createSecureContext({ pfx: bytes, passphrase: senha });
    console.log("OpenSSL do Node: abriu com esta senha ✔");
  } catch (e) {
    console.log(`OpenSSL do Node: ${(e as Error).message}`);
  }

  try {
    const info = lerCertificadoA1(bytes.toString("base64"), senha);
    console.log("NoHub: abriu ✔");
    console.log(`  titular: ${info.titular}`);
    console.log(`  CNPJ:    ${info.cnpj}`);
    console.log(`  validade: ${info.validade.toLocaleDateString("pt-BR")}`);
  } catch (e) {
    console.log(`NoHub: ${(e as Error).message}`);
  }
}

void main();
