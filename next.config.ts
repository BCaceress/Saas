import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Multi-tenant usa subdomínios em dev (x.lvh.me:3000). O Next 15+ bloqueia
  // requests de dev de origens != localhost; sem isto a hidratação não roda
  // nos subdomínios. Inclui o domínio raiz e o curinga de tenants.
  allowedDevOrigins: ["lvh.me", "*.lvh.me", "10.0.0.186"],

  experimental: {
    // Importação de XML: o contador manda o mês inteiro num ZIP. O padrão de
    // 1 MB derruba isso com um erro que não explica nada ao operador.
    serverActions: { bodySizeLimit: "12mb" },
  },

  images: {
    // miniaturas do Cosmos Bluesoft (enriquecimento por EAN)
    remotePatterns: [{ protocol: "https", hostname: "**.bluesoft.com.br" }],
  },
};

export default nextConfig;
