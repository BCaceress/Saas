import type { NextConfig } from "next";
import { HOSTS_IMAGEM } from "./src/lib/imagem";

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

  // IMAP fala TLS cru e carrega tabelas de charset por require dinâmico — o
  // bundler quebra os dois. Fica fora do bundle, resolvido em runtime no Node.
  serverExternalPackages: ["imapflow"],

  // PALIATIVO, não cura. O client do Prisma é gerado DENTRO de src/
  // (`output = ../src/generated/prisma`) e o runtime dele procura o query engine
  // varrendo diretórios que só existem em runtime — `existsSync(path.join(o, s))`
  // com `o` saindo de `process.cwd()`. O tracer do Turbopack não consegue provar
  // o que aquilo lê, desiste, e passa a tratar o PROJETO INTEIRO como dependência
  // do servidor. O sintoma é o aviso "Encountered unexpected file in NFT list",
  // que aponta justamente este arquivo — daí ele estar na lista abaixo.
  //
  // O que sai daqui não é usado pelo servidor em nenhuma hipótese: teste, script
  // de build, migration, documentação. O caminho REAL do engine continua no
  // trace, porque o Prisma o declara em literais (`path.join(__dirname,
  // "../query_engine-*.node")`) que o tracer entende.
  //
  // A cura de verdade é tirar o client gerado de dentro de src/ — enquanto ele
  // estiver aqui, arquivos de src/ que ninguém importa continuam entrando no
  // trace, só sem disparar o aviso. Marcar o código gerado com
  // `/*turbopackIgnore: true*/` foi tentado e não fecha: são muitas chamadas de
  // fs dinâmicas espalhadas pelo bundle minificado do runtime.
  outputFileTracingExcludes: {
    "/**": [
      "next.config.ts",
      "docs/**",
      "tests/**",
      "scripts/**",
      "electron/**",
      "prisma/migrations/**",
      "tmp/**",
      "**/*.csv",
      "**/*.tsbuildinfo",
    ],
  },

  images: {
    // Allowlist do otimizador (hoje: miniaturas do Cosmos Bluesoft, do
    // enriquecimento por EAN). Vem de `src/lib/imagem.ts` porque o cliente usa a
    // MESMA lista para decidir se manda a foto pelo otimizador ou direto: as
    // duas pontas desalinhadas viram 400 na miniatura.
    remotePatterns: HOSTS_IMAGEM.map((p) => ({ ...p })),
  },

  // O service worker não pode ser cacheado: alguns browsers seguram a versão
  // antiga por até 24h, e aí uma correção no SW só chega no dia seguinte.
  // Service-Worker-Allowed: / permite que ele controle a origem inteira.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },

  // Compras virou um módulo só: o que era /compras-fornecedores/* mudou de
  // casa. Links salvos e favoritos antigos continuam abrindo a tela certa.
  async redirects() {
    return [
      { source: "/compras-fornecedores/pedidos", destination: "/compras/carrinho", permanent: true },
      { source: "/compras-fornecedores", destination: "/compras", permanent: true },
      { source: "/compras-fornecedores/:path*", destination: "/compras/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
