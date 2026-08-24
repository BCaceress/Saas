import "server-only";
import { cookies, headers } from "next/headers";
import { SUPERFICIE_COOKIE, homeDaSuperficie } from "@/lib/superficie";

/**
 * Home de quem acabou de entrar: `/m` no celular, `/inicio` no computador.
 *
 * Vive fora de `lib/superficie` porque aquele módulo é importado pelo
 * proxy, e `next/headers` não existe no runtime dele.
 */
export async function homeDoLogin(): Promise<string> {
  const [jar, h] = await Promise.all([cookies(), headers()]);
  return homeDaSuperficie({
    cookie: jar.get(SUPERFICIE_COOKIE)?.value,
    userAgent: h.get("user-agent"),
    chUaMobile: h.get("sec-ch-ua-mobile"),
  });
}
