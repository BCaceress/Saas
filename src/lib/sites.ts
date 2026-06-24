import "server-only";
import { cookies } from "next/headers";
import { db } from "./prisma";
import type { Prisma } from "@/generated/prisma";

export type SiteRow = { id: string; nome: string; tipo: string; ativo: boolean };

/** Retorna o site ativo (do cookie) ou o primeiro site do tenant. */
export async function getActiveSiteId(): Promise<string | null> {
  const store = await cookies();
  const cookie = store.get("nohub-site");
  if (cookie?.value) return cookie.value;
  const site = await db.site.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  return site?.id ?? null;
}

/** Retorna todos os sites ativos do tenant (dentro de runWithTenant). */
export async function listSites(): Promise<SiteRow[]> {
  return db.site.findMany({
    where: { ativo: true },
    orderBy: { nome: "asc" },
    select: { id: true, nome: true, tipo: true, ativo: true },
  });
}

/**
 * Garante que o tenant tem pelo menos um Site (LOJA "Principal").
 * Usado no createProduct e em paths de setup.
 * Roda dentro de runWithTenant — usa `db`.
 */
export async function getOrCreateDefaultSite(tenantId: string): Promise<{ id: string }> {
  const existing = await db.site.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (existing) return existing;
  return db.site.create({
    data: { tenantId, nome: "Principal", tipo: "LOJA" },
    select: { id: true },
  });
}

/** Versão para uso dentro de transação basePrisma (provisioning / seed). */
export async function getOrCreateDefaultSiteTx(
  tx: Prisma.TransactionClient,
  tenantId: string
): Promise<{ id: string }> {
  const existing = await tx.site.findFirst({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (existing) return existing;
  return tx.site.create({
    data: { tenantId, nome: "Principal", tipo: "LOJA" },
    select: { id: true },
  });
}
