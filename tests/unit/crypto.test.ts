import { describe, it, expect, beforeAll } from "vitest";
import { cifrar, decifrar, estaCifrado } from "@/lib/crypto";

// Credencial de PSP, token do provedor fiscal e CSC da SEFAZ passam por aqui.
// Duas garantias importam: o valor volta idêntico, e texto adulterado NÃO volta
// como lixo silencioso — ele estoura.

beforeAll(() => {
  process.env.SECRETS_KEY = "chave-de-teste-para-a-suite-nao-usar-em-producao";
});

describe("cifrar/decifrar", () => {
  it("devolve o mesmo valor no ciclo completo", () => {
    const segredo = "APP_USR-1234567890-abcdef";
    const guardado = cifrar(segredo)!;
    expect(guardado).not.toContain(segredo);
    expect(decifrar(guardado)).toBe(segredo);
  });

  it("preserva acento e caractere especial", () => {
    const v = "çãõ-áé#@!$%¨&*()_+";
    expect(decifrar(cifrar(v))).toBe(v);
  });

  it("cada cifragem gera texto diferente (IV aleatório)", () => {
    const a = cifrar("mesmo-segredo");
    const b = cifrar("mesmo-segredo");
    expect(a).not.toBe(b);
    expect(decifrar(a)).toBe(decifrar(b));
  });

  it("não empilha camadas ao recifrar o que já está cifrado", () => {
    const uma = cifrar("token")!;
    const duas = cifrar(uma)!;
    expect(duas).toBe(uma);
    expect(decifrar(duas)).toBe("token");
  });

  it("passa null e vazio adiante — coluna opcional segue opcional", () => {
    expect(cifrar(null)).toBeNull();
    expect(cifrar(undefined)).toBeNull();
    expect(cifrar("")).toBe("");
    expect(decifrar(null)).toBeNull();
  });

  it("lê o legado em texto puro sem quebrar a operação", () => {
    // Registros anteriores à cifragem continuam válidos até a próxima gravação.
    expect(estaCifrado("token-antigo-em-claro")).toBe(false);
    expect(decifrar("token-antigo-em-claro")).toBe("token-antigo-em-claro");
  });

  it("recusa texto adulterado em vez de devolver lixo", () => {
    const guardado = cifrar("segredo-importante")!;
    const partes = guardado.split(".");
    // Troca um caractere do ciphertext: a tag GCM não fecha mais.
    const ultimo = partes[partes.length - 1];
    partes[partes.length - 1] = (ultimo[0] === "A" ? "B" : "A") + ultimo.slice(1);
    expect(() => decifrar(partes.join("."))).toThrow();
  });

  it("recusa formato inválido", () => {
    expect(() => decifrar("enc.v1.so-uma-parte")).toThrow();
  });
});
