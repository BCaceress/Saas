import "server-only";
import { basePrisma } from "./prisma";
import { logAviso } from "./log";

// ============================================================
// Limite de tentativas por chave, com janela deslizante simples.
//
// Guardado no banco porque em serverless não existe "memória do processo": a
// próxima tentativa pode cair em outra instância, e um contador em RAM daria
// ao atacante tantas tentativas quanto instâncias houver.
//
// Uma linha, um UPSERT atômico — o CASE resolve expiração e incremento na
// mesma ida ao banco, sem transação e sem corrida entre requisições.
// ============================================================

export type Resultado = {
  ok: boolean;
  /** Tentativas restantes na janela (0 quando bloqueado). */
  restante: number;
  /** Segundos até liberar. 0 quando ok. */
  esperaSeg: number;
};

/**
 * Conta uma tentativa. Devolve `ok: false` quando o limite estourou.
 *
 * Falha do banco NÃO bloqueia o usuário: preferimos deixar passar a derrubar
 * o login inteiro porque a tabela de contador está indisponível. Fica no log.
 */
export async function consumir(
  chave: string,
  limite: number,
  janelaSeg: number,
): Promise<Resultado> {
  try {
    const rows = await basePrisma.$queryRaw<{ contador: number; janelaFim: Date }[]>`
      INSERT INTO "RateLimit" ("chave", "contador", "janelaFim", "updatedAt")
      VALUES (${chave}, 1, now() + make_interval(secs => ${janelaSeg}), now())
      ON CONFLICT ("chave") DO UPDATE SET
        "contador" = CASE
          WHEN "RateLimit"."janelaFim" < now() THEN 1
          ELSE "RateLimit"."contador" + 1
        END,
        "janelaFim" = CASE
          WHEN "RateLimit"."janelaFim" < now() THEN now() + make_interval(secs => ${janelaSeg})
          ELSE "RateLimit"."janelaFim"
        END,
        "updatedAt" = now()
      RETURNING "contador", "janelaFim"
    `;

    const r = rows[0];
    if (!r) return { ok: true, restante: limite - 1, esperaSeg: 0 };

    const esperaSeg = Math.max(0, Math.ceil((r.janelaFim.getTime() - Date.now()) / 1000));
    if (r.contador > limite) {
      logAviso("rate-limit.bloqueado", `chave ${chave} excedeu ${limite} em ${janelaSeg}s`, {
        contador: r.contador,
      });
      return { ok: false, restante: 0, esperaSeg };
    }
    return { ok: true, restante: Math.max(0, limite - r.contador), esperaSeg: 0 };
  } catch {
    return { ok: true, restante: limite, esperaSeg: 0 };
  }
}

/** Zera o contador — chamado quando a tentativa dá certo (login válido). */
export async function liberar(chave: string): Promise<void> {
  try {
    await basePrisma.rateLimit.deleteMany({ where: { chave } });
  } catch {
    // contador órfão expira sozinho; não vale derrubar um login por isso
  }
}

/** Mensagem pronta para a tela — sem revelar qual chave bateu no limite. */
export function mensagemBloqueio(esperaSeg: number): string {
  const min = Math.ceil(esperaSeg / 60);
  return min <= 1
    ? "Muitas tentativas. Aguarde um minuto e tente de novo."
    : `Muitas tentativas. Aguarde ${min} minutos e tente de novo.`;
}

/** Limpeza das janelas vencidas — roda no job diário. */
export async function limparExpirados(): Promise<number> {
  const r = await basePrisma.rateLimit.deleteMany({ where: { janelaFim: { lt: new Date() } } });
  return r.count;
}
