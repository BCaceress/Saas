"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  assinaturaDoTenant,
  cancelarAssinatura,
  iniciarAssinatura,
  precoMensal,
  sincronizarAssinatura,
} from "@/lib/assinatura";
import { requireAdmin } from "@/lib/current-tenant";
import { logErro } from "@/lib/log";
import {
  ADDONS,
  ADDONS_SLUGS,
  PLANOS,
  ehAddonSlug,
  limitesDe,
  planoAtendeOuSuperior,
  type AddonSlug,
} from "@/lib/planos";
import { basePrisma, db } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

// ============================================================
// Contratação — plano, add-ons e assinatura.
//
// Usa `requireAdmin` (e não `guardAction`) de propósito: estas ações precisam
// funcionar com a conta SUSPENSA, que é exatamente quando o lojista vem aqui
// pagar. Bloquear a tela de pagamento por falta de pagamento é armadilha.
// ============================================================

const ROTA = "/configuracoes/plano";

const planoSchema = z.object({ plano: z.enum(["PRATA", "OURO", "DIAMANTE"]) });

/**
 * Troca o plano contratado. Downgrade que não cabe é barrado ANTES: reduzir o
 * teto com a loja acima dele deixaria o operador com dado que ele não consegue
 * mais editar, e a culpa apareceria semanas depois.
 */
export async function trocarPlanoAction(input: z.input<typeof planoSchema>) {
  const ctx = await requireAdmin();
  const d = planoSchema.parse(input);
  if (d.plano === ctx.tenant.plano) return { ok: true as const };

  const alvo = { ...ctx.tenant, plano: d.plano };
  const limites = limitesDe(alvo);

  const [sites, produtos, usuarios] = await Promise.all([
    // `await` dentro do runWithTenant: PrismaPromise é lazy e sem ele a query
    // executaria fora do contexto async (ver lib/prisma.ts).
    runWithTenant(ctx.tenant.id, async () => await db.site.count()),
    runWithTenant(ctx.tenant.id, async () => await db.product.count({ where: { ativo: true } })),
    basePrisma.membership.count({ where: { tenantId: ctx.tenant.id, ativo: true } }),
  ]);

  const estouros: string[] = [];
  if (limites.sites !== null && sites > limites.sites) {
    estouros.push(`${sites} lojas (o plano ${PLANOS[d.plano].nome} permite ${limites.sites})`);
  }
  if (limites.usuarios !== null && usuarios > limites.usuarios) {
    estouros.push(`${usuarios} usuários (o plano permite ${limites.usuarios})`);
  }
  if (limites.produtos !== null && produtos > limites.produtos) {
    estouros.push(`${produtos} produtos ativos (o plano permite ${limites.produtos})`);
  }
  if (estouros.length > 0) {
    throw new Error(
      `Não dá para mudar para ${PLANOS[d.plano].nome} agora: você tem ${estouros.join(
        ", ",
      )}. Reduza antes de trocar de plano.`,
    );
  }

  // Add-on que exige plano maior cai junto — cobrar por algo que o plano não
  // sustenta mais é cobrar por nada.
  const addonsValidos = ctx.tenant.addons.filter(
    (s) => ehAddonSlug(s) && planoAtendeOuSuperior(d.plano, ADDONS[s].requerPlano),
  );

  await basePrisma.tenant.update({
    where: { id: ctx.tenant.id },
    data: { plano: d.plano, addons: addonsValidos },
  });

  revalidatePath(ROTA, "layout");
  return { ok: true as const };
}

const addonSchema = z.object({
  // Da fonte única: add-on novo em `lib/planos` já entra aqui, sem lista paralela.
  slug: z.enum(ADDONS_SLUGS as [AddonSlug, ...AddonSlug[]]),
  contratar: z.boolean(),
  /** Só para "loja-extra": quantas lojas além das do plano. */
  quantidade: z.coerce.number().int().min(0).max(50).optional(),
});

export async function alternarAddonAction(input: z.input<typeof addonSchema>) {
  const ctx = await requireAdmin();
  const d = addonSchema.parse(input);
  const addon = ADDONS[d.slug];

  if (d.contratar && !planoAtendeOuSuperior(ctx.tenant.plano, addon.requerPlano)) {
    throw new Error(`${addon.nome} exige o plano ${PLANOS[addon.requerPlano].nome} ou superior.`);
  }

  const atuais = new Set(ctx.tenant.addons.filter(ehAddonSlug));
  if (d.contratar) atuais.add(d.slug);
  else atuais.delete(d.slug);

  const lojasExtras =
    d.slug === "loja-extra"
      ? d.contratar
        ? Math.max(1, d.quantidade ?? 1)
        : 0
      : ctx.tenant.lojasExtras;

  // Tirar loja extra com loja usando aquele espaço quebraria o cadastro.
  if (d.slug === "loja-extra" && lojasExtras < ctx.tenant.lojasExtras) {
    const sites = await runWithTenant(ctx.tenant.id, async () => await db.site.count());
    const limite = limitesDe({ ...ctx.tenant, lojasExtras }).sites;
    if (limite !== null && sites > limite) {
      throw new Error(
        `Você tem ${sites} lojas cadastradas — desative uma antes de reduzir as lojas extras.`,
      );
    }
  }

  await basePrisma.tenant.update({
    where: { id: ctx.tenant.id },
    data: { addons: [...atuais], lojasExtras },
  });

  revalidatePath(ROTA, "layout");
  return { ok: true as const };
}

/**
 * Gera o checkout do gateway e devolve a URL. A tela abre em nova aba: o
 * lojista paga no Mercado Pago e o webhook libera o acesso.
 */
export async function assinarAction(): Promise<string> {
  const ctx = await requireAdmin();
  const totens = await runWithTenant(ctx.tenant.id, async () => await db.totemDevice.count());

  try {
    const { checkoutUrl } = await iniciarAssinatura(ctx.tenant.id, { totens });
    revalidatePath(ROTA, "layout");
    return checkoutUrl;
  } catch (e) {
    logErro("assinatura.iniciar", e, { tenantId: ctx.tenant.id });
    throw new Error(
      e instanceof Error
        ? e.message
        : "Não foi possível abrir o checkout agora. Tente de novo em instantes.",
    );
  }
}

/** Reconsulta o gateway — para quem pagou e a tela ainda não virou. */
export async function conferirPagamentoAction() {
  const ctx = await requireAdmin();
  try {
    const status = await sincronizarAssinatura(ctx.tenant.id);
    revalidatePath(ROTA, "layout");
    return { status };
  } catch (e) {
    logErro("assinatura.conferir", e, { tenantId: ctx.tenant.id });
    throw new Error("Não conseguimos falar com o Mercado Pago agora. Tente de novo em instantes.");
  }
}

export async function cancelarAssinaturaAction() {
  const ctx = await requireAdmin();
  await cancelarAssinatura(ctx.tenant.id);
  revalidatePath(ROTA, "layout");
  return { ok: true as const };
}

/** Preço fechado do que está marcado hoje — o mesmo número que vai ao gateway. */
export async function precoAtualAction(): Promise<number> {
  const ctx = await requireAdmin();
  const totens = await runWithTenant(ctx.tenant.id, async () => await db.totemDevice.count());
  return precoMensal({
    plano: ctx.tenant.plano,
    addons: ctx.tenant.addons,
    lojasExtras: ctx.tenant.lojasExtras,
    totens,
  });
}

export async function assinaturaAtualAction() {
  const ctx = await requireAdmin();
  return assinaturaDoTenant(ctx.tenant.id);
}
