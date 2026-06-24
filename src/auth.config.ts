import type { NextAuthConfig } from "next-auth";

/**
 * Config compartilhada e edge-safe (sem adapter/Prisma/bcrypt) — usada tanto
 * pelo middleware (verificação de JWT na edge) quanto pelo auth.ts completo.
 */

const rootDomain = (process.env.NEXT_PUBLIC_APP_DOMAIN ?? "lvh.me:3000").split(
  ":"
)[0];

// Cookie no domínio raiz (".lvh.me") => sessão compartilhada entre subdomínios
// (cada tenant em x.app.com). Só aplica se o root tiver ponto (não em "localhost").
const cookieDomain = rootDomain.includes(".") ? `.${rootDomain}` : undefined;

export const authConfig = {
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  cookies: cookieDomain
    ? {
        sessionToken: {
          name: "authjs.session-token",
          options: {
            httpOnly: true,
            sameSite: "lax",
            path: "/",
            domain: cookieDomain,
            secure: process.env.NODE_ENV === "production",
          },
        },
      }
    : undefined,
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.id = user.id as string;
      return token;
    },
    session({ session, token }) {
      if (token?.id && session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
