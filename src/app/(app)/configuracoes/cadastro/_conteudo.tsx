import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";
import { camposDoTenant } from "@/lib/cadastro-campos";
import { CamposCadastroClient } from "./_client";

/** Miolo de "Campos do cadastro" — compartilhado pelo desktop e pelo `/m`. */
export async function ConteudoCadastro() {
  const ctx = await requireActiveTenant();
  const campos = camposDoTenant(ctx.tenant);

  // Desligar o +18 muda o que o caixa faz — a tela avisa quantas lojas param
  // de pedir a confirmação de idade ANTES de o operador salvar.
  //
  // `async` + `await` DENTRO do callback: a promessa do Prisma é preguiçosa e
  // só dispara a consulta no `.then`. Devolvida crua, ela rodaria já fora do
  // `runWithTenant`, sem tenant no contexto.
  const lojasComControle = await runWithTenant(ctx.tenant.id, async () =>
    await db.site.count({ where: { ativo: true, controleIdade: true } }),
  );

  return (
    <CamposCadastroClient
      initial={{
        usaMarcas: campos.marca,
        usaArmazenagem: campos.armazenagem,
        usaRestricaoIdade: campos.restricaoIdade,
        usaSku: campos.sku,
      }}
      lojasComControle={lojasComControle}
    />
  );
}
