import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { basePrisma } from "@/lib/prisma";
import { provisionTenantForUser } from "@/lib/provisioning";
import { authConfig } from "./auth.config";

/**
 * Config completa (Node runtime): adapter Prisma + providers.
 * Google OAuth + Credentials (email/senha, bcrypt). User é global; o vínculo
 * com tenant é o Membership (PRD §5).
 */

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(basePrisma),
  events: {
    // Dispara só para usuários criados pelo adapter (OAuth). Usuários de
    // Credentials são criados em signupWithTenant, que já provisiona tudo.
    async createUser({ user }) {
      if (!user.id) return;
      await provisionTenantForUser({
        userId: user.id,
        name: user.name,
        email: user.email,
      });
    },
  },
  providers: [
    Google({ allowDangerousEmailAccountLinking: true }),
    Credentials({
      credentials: {
        email: { label: "E-mail", type: "email" },
        password: { label: "Senha", type: "password" },
      },
      authorize: async (raw) => {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const email = parsed.data.email.toLowerCase().trim();
        const user = await basePrisma.user.findUnique({ where: { email } });
        if (!user?.passwordHash) return null;
        const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!ok) return null;
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
  ],
});
