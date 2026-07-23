"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { basePrisma } from "@/lib/prisma";
import { requireActiveTenant } from "@/lib/current-tenant";
import { PRESETS, tierFromPontos, featuresDosToggles } from "@/lib/presets";
import { assinaturaParaFeatures } from "@/lib/planos";
import { isAdmin } from "@/lib/permissoes";

const schema = z.object({
  tipoOperacao: z.enum(["AUTONOMO", "MERCADINHO", "CONVENIENCIA_BEBIDAS"]),
  pontos: z.enum(["1", "2-5", "6+"]),
  topologia: z.enum(["LOCAL", "CD_ABASTECE", "MISTO"]),
  // resposta da pergunta específica (liga o toggle "perguntado")
  perguntaSim: z.boolean().default(false),
  nomeMercado: z.string().trim().min(2).max(80).optional(),
});

export type OnboardingInput = z.infer<typeof schema>;

export async function saveOnboarding(input: OnboardingInput) {
  const ctx = await requireActiveTenant();
  if (!isAdmin(ctx.acessos)) {
    throw new Error("Sem permissão para concluir o setup.");
  }

  const parsed = schema.parse(input);
  const preset = PRESETS[parsed.tipoOperacao];

  // Toggles = preset + override da pergunta específica.
  const toggles = { ...preset.toggles };
  if (preset.pergunta === "comodato") toggles.moduloComodato = parsed.perguntaSim;
  if (preset.pergunta === "fiscal") toggles.moduloFiscal = parsed.perguntaSim;

  const numPontos = parsed.pontos === "1" ? 1 : parsed.pontos === "2-5" ? 3 : 6;

  // O plano sai do que a operação precisa: piso pelo nº de pontos, subindo até
  // cobrir os módulos do preset. Sem isso o onboarding ligaria módulo fora do
  // plano e o tenant cairia num app meio bloqueado no primeiro acesso.
  const { plano, addons } = assinaturaParaFeatures(
    featuresDosToggles(toggles),
    tierFromPontos(parsed.pontos),
  );

  await basePrisma.tenant.update({
    where: { id: ctx.tenant.id },
    data: {
      tipoOperacao: parsed.tipoOperacao,
      atendimento: preset.atendimento,
      topologia: parsed.topologia,
      numPontos,
      plano,
      addons,
      ...toggles,
      onboardingDone: true,
      ...(parsed.nomeMercado ? { nome: parsed.nomeMercado } : {}),
    },
  });

  redirect("/produtos");
}
