"use server";

import { z } from "zod";
import { db } from "@/lib/prisma";
import { guardAction } from "@/lib/guard";
import { runWithTenant } from "@/lib/tenant-context";
import { invalidarOpcoesFormulario } from "../../produtos/_data";

async function tx<T>(fn: (tid: string) => Promise<T>): Promise<T> {
  const ctx = await guardAction("config.gerenciar");
  return runWithTenant(ctx.tenant.id, () => fn(ctx.tenant.id));
}

const fiscalProfileSchema = z.object({
  nome: z.string().min(2, "Informe o nome do perfil fiscal."),
  ncm: z.string().min(1, "Informe o NCM."),
  cest: z.string().optional(),
  origem: z.string().optional(),
  csosn: z.string().optional(),
  cst: z.string().optional(),
  cstPis: z.string().optional(),
  cstCofins: z.string().optional(),
  aliquotaIcms: z.number().nonnegative().optional().nullable(),
  temSt: z.boolean().default(false),
  precisaRevisao: z.boolean().default(false),
});

export type FiscalProfileInput = z.input<typeof fiscalProfileSchema>;

function fiscalProfileData(d: z.infer<typeof fiscalProfileSchema>) {
  return {
    nome: d.nome.trim(),
    ncm: d.ncm.trim(),
    cest: d.cest?.trim() || null,
    origem: d.origem?.trim() || "0",
    csosn: d.csosn?.trim() || null,
    cst: d.cst?.trim() || null,
    cstPis: d.cstPis?.trim() || null,
    cstCofins: d.cstCofins?.trim() || null,
    aliquotaIcms: d.aliquotaIcms ?? null,
    temSt: d.temSt,
    precisaRevisao: d.precisaRevisao,
  };
}

export async function createFiscalProfile(input: FiscalProfileInput) {
  return tx(async (tid) => {
    const d = fiscalProfileSchema.parse(input);
    const profile = await db.fiscalProfile.create({
      data: { tenantId: tid, ...fiscalProfileData(d) },
    });
    // O select de perfil fiscal do cadastro de produto vem de cache.
    invalidarOpcoesFormulario(tid);
    return profile.id;
  });
}

export async function updateFiscalProfile(id: string, input: FiscalProfileInput) {
  return tx(async (tid) => {
    const d = fiscalProfileSchema.parse(input);
    await db.fiscalProfile.update({ where: { id }, data: fiscalProfileData(d) });
    invalidarOpcoesFormulario(tid);
  });
}

export async function deleteFiscalProfile(id: string) {
  return tx(async (tid) => {
    const usadoPorProduto = await db.product.findFirst({
      where: { fiscalProfileId: id },
      select: { id: true },
    });
    if (usadoPorProduto)
      throw new Error("Não é possível excluir: há produtos usando este perfil fiscal.");
    const usadoPorSubcategoria = await db.subcategory.findFirst({
      where: { defaultFiscalProfileId: id },
      select: { id: true },
    });
    if (usadoPorSubcategoria)
      throw new Error("Não é possível excluir: há subcategorias vinculadas a este perfil fiscal.");
    await db.fiscalProfile.delete({ where: { id } });
    invalidarOpcoesFormulario(tid);
  });
}

export async function setSubcategoryFiscalProfile(
  subcategoryId: string,
  fiscalProfileId: string | null,
) {
  return tx(async (tid) => {
    await db.subcategory.update({
      where: { id: subcategoryId },
      data: { defaultFiscalProfileId: fiscalProfileId },
    });
    // `defaultFiscalProfileId` viaja em `subOpts` — é ele que pré-seleciona o
    // perfil quando o operador escolhe a subcategoria no cadastro.
    invalidarOpcoesFormulario(tid);
  });
}
