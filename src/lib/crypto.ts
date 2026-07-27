import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// ============================================================
// Criptografia de segredos de terceiros guardados no banco.
//
// O que passa por aqui: credencial do PSP (PaymentProviderConfig.accessToken),
// credencial do provedor fiscal (FiscalConfig.apiToken), segredo de webhook e
// o CSC da SEFAZ (FiscalEmitente.csc). São credenciais DO CLIENTE — um dump de
// banco vazado sem isto entrega a conta do lojista no gateway e a emissão de
// nota no CNPJ dele.
//
// AES-256-GCM: cifra + autentica. Se o texto for adulterado, o decifrar falha
// em vez de devolver lixo.
//
// Compatível com o que já está gravado em texto puro: `decifrar` devolve o
// valor como veio quando ele não tem o prefixo. Cada gravação re-cifra, então
// a base migra sozinha conforme o operador salva a configuração.
// ============================================================

const PREFIX = "enc.v1.";

let cachedKey: Buffer | null = null;

/**
 * Chave de 32 bytes derivada de `SECRETS_KEY`. Em produção ela é obrigatória e
 * separada do `AUTH_SECRET` de propósito: rotacionar segredo de sessão é
 * rotina, e não pode tornar ilegível a credencial fiscal do cliente.
 */
function key(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.SECRETS_KEY?.trim();
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "SECRETS_KEY ausente. Defina uma chave de 32 bytes (openssl rand -base64 32) " +
          "antes de gravar ou ler credenciais de terceiros.",
      );
    }
    // Dev: deriva do AUTH_SECRET para não travar quem só quer rodar local.
    const fallback = process.env.AUTH_SECRET ?? "dev-inseguro";
    cachedKey = createHash("sha256").update(`nohub.dev.${fallback}`).digest();
    return cachedKey;
  }

  // Aceita base64, hex ou frase — normaliza tudo para 32 bytes via SHA-256.
  cachedKey = createHash("sha256").update(raw).digest();
  return cachedKey;
}

/** True se o valor já está no formato cifrado desta lib. */
export function estaCifrado(valor: string): boolean {
  return valor.startsWith(PREFIX);
}

/**
 * Cifra para gravar. `null`/vazio passam direto — coluna opcional continua
 * opcional, e cifrar string vazia só gastaria bytes.
 */
export function cifrar(valor: string | null | undefined): string | null {
  if (valor == null) return null;
  if (valor === "") return "";
  if (estaCifrado(valor)) return valor; // já cifrado: não empilha camadas

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(valor, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return (
    PREFIX +
    [iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".")
  );
}

/**
 * Decifra ao ler. Valor sem o prefixo é legado em texto puro e volta como está
 * — a alternativa (quebrar) derrubaria a operação de quem configurou antes
 * desta mudança.
 */
export function decifrar(valor: string | null | undefined): string | null {
  if (valor == null) return null;
  if (!estaCifrado(valor)) return valor;

  const [ivB64, tagB64, ctB64] = valor.slice(PREFIX.length).split(".");
  if (!ivB64 || !tagB64 || !ctB64) {
    throw new Error("Segredo cifrado com formato inválido.");
  }

  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Chave trocada ou registro adulterado. Mensagem sem vazar o conteúdo.
    throw new Error(
      "Não foi possível decifrar a credencial guardada. " +
        "Se a SECRETS_KEY mudou, salve a configuração novamente com a credencial atual.",
    );
  }
}
