import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";
import { camposDoTenant } from "@/lib/cadastro-campos";
import { CamposCadastroClient } from "./_client";

/** Miolo de "Campos do cadastro" — compartilhado pelo desktop e pelo `/m`. */
export async function ConteudoCadastro() {
  const ctx = await requireActiveTenant();
  const campos = camposDoTenant(ctx.tenant);

  // O que já está preenchido decide o tom do aviso: desligar um campo vazio é
  // limpeza de tela; desligar um campo com 300 produtos preenchidos esconde
  // trabalho que alguém fez, e o operador precisa saber disso ANTES de salvar.
  const [produtosComMarca, produtosComLocal, locais] = await runWithTenant(
    ctx.tenant.id,
    async () =>
      Promise.all([
        db.product.count({ where: { brandId: { not: null } } }),
        db.stock.count({ where: { locationId: { not: null } } }),
        db.storageLocation.count({ where: { ativo: true } }),
      ]),
  );

  return (
    <CamposCadastroClient
      initial={{ usaMarcas: campos.marca, usaArmazenagem: campos.armazenagem }}
      uso={{ produtosComMarca, produtosComLocal, locais }}
    />
  );
}
