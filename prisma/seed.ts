// Seed manual para DEV: cria um login demo já com onboarding pronto.
// O seed REAL de cada tenant roda no signup (src/lib/seed-tenant.ts).
// Uso: npm run db:seed  →  demo@nohub.market / nohub1234  (demo.lvh.me:3000)
import { PrismaClient } from "../src/generated/prisma";
import bcrypt from "bcryptjs";
import { seedTenant } from "../src/lib/seed-tenant";

const prisma = new PrismaClient();

async function main() {
  const email = "demo@nohub.market";
  if (await prisma.user.findUnique({ where: { email } })) {
    console.log("Usuário demo já existe — nada a fazer.");
    return;
  }
  const passwordHash = await bcrypt.hash("nohub1234", 12);

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { name: "Operador Demo", email, passwordHash } });
    const tenant = await tx.tenant.create({
      data: {
        subdomain: "demo",
        nome: "Adega Demo",
        status: "TRIAL",
        trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        onboardingDone: true,
        tipoOperacao: "CONVENIENCIA_BEBIDAS",
        atendimento: "OPERADOR_PDV",
        topologia: "LOCAL",
        numPontos: 1,
        moduloPdv: true,
        moduloFiscal: true,
      },
    });
    await tx.membership.create({ data: { userId: user.id, tenantId: tenant.id, role: "OWNER" } });
    await seedTenant(tx, tenant.id);
  });

  console.log("✓ Seed demo criado: demo@nohub.market / nohub1234 → http://demo.lvh.me:3000");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
