import type { MetadataRoute } from "next";

/**
 * Manifest do PWA. O app instalado abre em `/m` — a superfície mobile enxuta —
 * porque quem instala no celular quer o operacional de pé (escanear, contar,
 * receber), não o ERP inteiro. O `scope` continua "/" para que sair do /m para
 * uma tela desktop não jogue a pessoa de volta pro navegador.
 *
 * Cores são literais: o manifest não enxerga `var()` do globals.css. Valores
 * espelham os tokens do tema CLARO (--surface / --canvas), que é o padrão do
 * app quando não há cookie de tema. A troca por tema acontece no
 * <meta name="theme-color"> do root layout, esse sim renderizado por request.
 *
 * ATENÇÃO: `/manifest.webmanifest` precisa estar FORA do matcher do middleware
 * (src/middleware.ts). O browser busca o manifest sem credenciais; passando pelo
 * gate de sessão ele viraria redirect e o app deixaria de ser instalável.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "NoHub Market",
    short_name: "NoHub",
    description:
      "Estoque, compras, vendas e alertas do seu mercado — no bolso, de pé, na gôndola.",
    lang: "pt-BR",
    dir: "ltr",
    categories: ["business", "productivity", "shopping"],

    start_url: "/m",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "portrait",

    background_color: "#f5f6f8",
    theme_color: "#ffffff",

    prefer_related_applications: false,

    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-monochrome.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "monochrome",
      },
    ],

    // Atalhos do toque longo no ícone: as quatro coisas que se faz em pé, e que
    // no app custariam abrir + escolher. Escanear vem primeiro porque é o
    // começo de quase toda operação — e aqui ele pula até a folha "Nova
    // operação", indo direto à câmera.
    shortcuts: [
      {
        name: "Escanear produto",
        short_name: "Escanear",
        description: "Ler código de barras, nota fiscal ou QR de pedido",
        url: "/m/scan",
      },
      {
        name: "Receber mercadoria",
        short_name: "Receber",
        description: "Conferir o pedido que chegou na porta",
        url: "/m/receber",
      },
      {
        name: "Alertas",
        short_name: "Alertas",
        description: "O que precisa de você agora",
        url: "/m/alertas",
      },
      {
        name: "Estoque",
        short_name: "Estoque",
        description: "Saldos, ruptura e contagem",
        url: "/m/estoque",
      },
    ],
  };
}
