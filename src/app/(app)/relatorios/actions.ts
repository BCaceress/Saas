"use server";

import { cookies } from "next/headers";

/** Troca o site ativo (cookie compartilhado com Estoque/Vendas). */
export async function setReportSiteAction(siteId: string) {
  const store = await cookies();
  store.set("nohub-site", siteId, { path: "/", maxAge: 60 * 60 * 24 * 365 });
}
