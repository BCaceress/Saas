import type { MetadataRoute } from "next";

/**
 * Manifest PRÓPRIO do quiosque — o caminho para o autoatendimento abrir em tela
 * cheia de verdade no celular e no tablet.
 *
 * Por que um segundo manifest, e não um campo a mais no de `/manifest.ts`:
 *
 *  · `display: "fullscreen"` só vale para o app instalado, e vale para o app
 *    INTEIRO. Aplicado ao manifest principal, o ERP do operador perderia a
 *    barra de status (relógio, bateria, sinal) em todas as telas — péssimo para
 *    quem passa o dia dentro dele, e ótimo para um quiosque, que é justamente
 *    onde o cliente não deve conseguir sair da tela.
 *  · `start_url` + `id` diferentes fazem o browser tratar isto como um segundo
 *    app instalável: no mesmo aparelho convivem o ícone "NoHub" (o app do
 *    operador) e o "Autoatendimento" (o tablet da loja, dedicado).
 *
 * `orientation: "portrait"` porque o totem fica em pé no balcão; e
 * `prefer_related_applications: false` para não oferecer loja de aplicativos.
 *
 * ATENÇÃO: a rota PRECISA estar fora do matcher do middleware (src/middleware.ts).
 * O browser busca o manifest sem credenciais — passando pelo gate de sessão ele
 * viraria redirect para o /login e o quiosque deixaria de ser instalável.
 *
 * É route handler, e não `app/totem/manifest.ts`, porque a convenção de arquivo
 * do Next só existe na RAIZ de `app/` (ver docs, metadata/manifest).
 */
const manifest: MetadataRoute.Manifest = {
  id: "/totem",
  name: "Autoatendimento — NoHub Market",
  short_name: "Autoatendimento",
  description: "Quiosque de autoatendimento do mercado: o cliente escolhe e paga sozinho.",
  lang: "pt-BR",
  dir: "ltr",
  categories: ["business", "shopping"],

  start_url: "/totem",
  // Escopo restrito ao quiosque: um toque que escapasse para o resto do app
  // abriria o ERP dentro da janela do totem.
  scope: "/totem",
  display: "fullscreen",
  // Degrada na ordem certa quando a plataforma não suporta fullscreen (iOS):
  // standalone ainda tira a barra do navegador.
  display_override: ["fullscreen", "standalone", "minimal-ui"],
  orientation: "portrait",

  // Literais: o manifest não enxerga `var()` do globals.css. Espelham
  // --canvas / --surface do tema claro, padrão do app sem cookie de tema.
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
  ],
};

export function GET() {
  return new Response(JSON.stringify(manifest), {
    headers: {
      "content-type": "application/manifest+json",
      "cache-control": "public, max-age=0, must-revalidate",
    },
  });
}
