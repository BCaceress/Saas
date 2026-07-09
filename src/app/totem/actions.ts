"use server";

import bcrypt from "bcryptjs";
import { requireActiveTenant } from "@/lib/current-tenant";

/** Verifica o PIN de saída do quiosque. Sem PIN configurado, a saída é livre. */
export async function verifyTotemPinAction(pin: string): Promise<boolean> {
  const ctx = await requireActiveTenant();
  if (!ctx.tenant.totemPinHash) return true;
  return bcrypt.compare(pin, ctx.tenant.totemPinHash);
}
