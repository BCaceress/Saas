import "server-only";
import { basePrisma, db } from "./prisma";
import {
  cabeMais,
  limitesDe,
  mensagemLimite,
  PlanoInsuficienteError,
  type Assinatura,
  type Limites,
} from "./planos";

// ============================================================
// Limites de plano no ponto de criação. Ficam aqui, e não em `guard.ts`, porque
// os wrappers `tx`/`txp` dos módulos só repassam o tenantId — não o contexto.
// A leitura da assinatura é por chave primária e só acontece ao criar.
//
// A contagem roda DENTRO do runWithTenant do chamador: `db` já filtra por
// tenant. Não é à prova de corrida (dois creates simultâneos no limite passam);
// para limite comercial isso é aceitável — travar a venda por lock não é.
// ============================================================

async function assinatura(tenantId: string): Promise<Assinatura> {
  const t = await basePrisma.tenant.findUnique({
    where: { id: tenantId },
    select: { plano: true, addons: true, lojasExtras: true },
  });
  if (!t) throw new Error("Tenant não encontrado.");
  return t;
}

/**
 * Cabe mais `quantos`? Lança `PlanoInsuficienteError` com o texto de upgrade.
 * `usados` é a contagem atual — o novo registro cabe quando usados < limite.
 */
async function assertCabe(
  tenantId: string,
  chave: keyof Limites,
  usados: number,
  quantos = 1,
): Promise<void> {
  const a = await assinatura(tenantId);
  if (cabeMais(a, chave, usados + quantos - 1)) return;
  throw new PlanoInsuficienteError(null, mensagemLimite(chave, limitesDe(a)[chave] ?? 0));
}

/** Antes de criar loja/ponto/CD. Chame dentro do contexto de tenant. */
export async function assertCabeSite(tenantId: string): Promise<void> {
  await assertCabe(tenantId, "sites", await db.site.count());
}

/** Antes de criar produto. `quantos` > 1 para importação em lote. */
export async function assertCabeProduto(tenantId: string, quantos = 1): Promise<void> {
  await assertCabe(tenantId, "produtos", await db.product.count({ where: { ativo: true } }), quantos);
}

/**
 * Antes de convidar. Conta membros ativos + convites ainda válidos: aceitar um
 * convite vira membro, então a vaga já fica reservada — senão o limite estoura
 * na aceitação, quando ninguém mais tem o que fazer a respeito.
 */
export async function assertCabeUsuario(tenantId: string): Promise<void> {
  const [membros, convites] = await Promise.all([
    basePrisma.membership.count({ where: { tenantId, ativo: true } }),
    basePrisma.invite.count({ where: { tenantId, expiresAt: { gt: new Date() } } }),
  ]);
  await assertCabe(tenantId, "usuarios", membros + convites);
}
