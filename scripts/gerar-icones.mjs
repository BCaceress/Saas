// Gera os ícones do PWA a partir de public/images/logo.png.
//
// Uso: node scripts/gerar-icones.mjs
//
// Roda à mão e os PNGs vão pro git — não é passo de build. Só rode de novo se a
// marca mudar.
//
// Duas decisões que não são óbvias:
//
// 1. FUNDO ESCURO. A marca tem uma haste cinza-clara; num ícone de fundo branco
//    metade do símbolo desaparece. O fundo é o --canvas escuro do globals.css.
//    Fundo opaco também é requisito do apple-touch-icon (o iOS não trata alpha).
//
// 2. DUAS ESCALAS. O ícone comum usa 68% do quadro. O maskable usa 52%, porque
//    o Android recorta o ícone na forma do launcher e só o círculo central de
//    80% é garantido — logo colado na borda vira logo cortado.

import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGEM = join(raiz, "public", "images", "logo.png");
const DESTINO = join(raiz, "public", "icons");

/** --canvas do tema escuro (src/app/globals.css). */
const FUNDO = { r: 13, g: 15, b: 18, alpha: 1 };

/** Fração do quadro ocupada pela marca. */
const ESCALA_PADRAO = 0.68;
const ESCALA_MASKABLE = 0.52;

/** Recorta o halo/transparência e devolve só a marca. */
async function marca() {
  return sharp(ORIGEM).trim({ threshold: 10 }).toBuffer();
}

async function icone(fonte, lado, escala, saida) {
  const interno = Math.round(lado * escala);
  const simbolo = await sharp(fonte)
    .resize(interno, interno, { fit: "inside", withoutEnlargement: false })
    .toBuffer();

  await sharp({
    create: { width: lado, height: lado, channels: 4, background: FUNDO },
  })
    .composite([{ input: simbolo, gravity: "center" }])
    .png()
    .toFile(join(DESTINO, saida));

  console.log(`  ${saida}  ${lado}×${lado}`);
}

/**
 * Silhueta para `purpose: "monochrome"`: o sistema recolore os pixels opacos
 * (badge de notificação, por exemplo). Só o alfa importa, então achatamos o
 * degradê do halo com um threshold e pintamos tudo de branco.
 */
async function monocromatico(fonte, lado, saida) {
  const interno = Math.round(lado * ESCALA_PADRAO);

  const alfa = await sharp(fonte)
    .resize(interno, interno, { fit: "inside" })
    .extractChannel("alpha")
    .threshold(128)
    .toBuffer();

  const { width, height } = await sharp(alfa).metadata();

  const silhueta = await sharp({
    create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .joinChannel(alfa)
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: lado,
      height: lado,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: silhueta, gravity: "center" }])
    .png()
    .toFile(join(DESTINO, saida));

  console.log(`  ${saida}  ${lado}×${lado}  (silhueta)`);
}

async function main() {
  await mkdir(DESTINO, { recursive: true });
  const fonte = await marca();

  console.log("Gerando ícones do PWA:");
  await icone(fonte, 192, ESCALA_PADRAO, "icon-192.png");
  await icone(fonte, 512, ESCALA_PADRAO, "icon-512.png");
  await icone(fonte, 512, ESCALA_MASKABLE, "icon-maskable-512.png");
  await monocromatico(fonte, 512, "icon-monochrome.png");

  // O apple-touch-icon fica na raiz de public/: o iOS procura nesse caminho
  // quando o manifest não é lido (Safari só lê o manifest depois de instalado).
  const apple = await sharp(fonte)
    .resize(Math.round(180 * ESCALA_PADRAO), Math.round(180 * ESCALA_PADRAO), {
      fit: "inside",
    })
    .toBuffer();

  await sharp({ create: { width: 180, height: 180, channels: 4, background: FUNDO } })
    .composite([{ input: apple, gravity: "center" }])
    .png()
    .toFile(join(raiz, "public", "apple-touch-icon.png"));

  console.log("  apple-touch-icon.png  180×180");
  console.log("Pronto.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
