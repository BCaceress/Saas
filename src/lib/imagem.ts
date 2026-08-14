/**
 * Miniaturas de produto — o que sai do servidor e o que entra no banco.
 *
 * Duas pontas do mesmo problema: a listagem desenha a foto a 36px mas baixava o
 * arquivo inteiro, e o upload do operador ia para `Product.imagemUrl` como
 * `data:` de até 2 MB. Numa página de 50 produtos isso é dezenas de megabytes
 * para pintar alguns milhares de pixels.
 *
 * - `thumbSrc` manda a foto REMOTA pelo otimizador do Next (WebP/AVIF, cache,
 *   allowlist de host, bloqueio de IP local — tudo dele, sem proxy nosso).
 * - `arquivoParaThumb` encolhe o upload ANTES de virar `data:`, porque foto
 *   embutida na coluna viaja no payload da lista toda vez.
 */

/** Hosts cujas fotos podem passar pelo otimizador. Espelhado em `next.config.ts`. */
export const HOSTS_IMAGEM = [{ protocol: "https", hostname: "**.bluesoft.com.br" }] as const;

/**
 * Larguras que o otimizador aceita: `imageSizes` ∪ `deviceSizes` do Next 16.
 * Pedir um valor fora da lista devolve 400 — por isso a largura é arredondada
 * para cima, nunca passada crua.
 */
const LARGURAS = [
  32, 48, 64, 96, 128, 256, 384, 640, 750, 828, 1080, 1200, 1920, 2048, 3840,
] as const;

const larguraValida = (w: number) => LARGURAS.find((l) => l >= w) ?? LARGURAS[LARGURAS.length - 1];

function hostPermitido(hostname: string): boolean {
  return HOSTS_IMAGEM.some(({ hostname: padrao }) =>
    padrao.startsWith("**.")
      ? hostname === padrao.slice(3) || hostname.endsWith(padrao.slice(2))
      : hostname === padrao,
  );
}

/**
 * URL da miniatura na largura pedida (em pixels de DISPOSITIVO — numa `<img>`
 * de 36px em tela retina, peça 96).
 *
 * Host fora da allowlist e `data:` voltam intactos: o otimizador recusaria o
 * primeiro e não tem o que fazer com o segundo. Pior caso = o comportamento de
 * antes, nunca uma imagem quebrada.
 */
export function thumbSrc(url: string, larguraPx: number): string {
  if (url.startsWith("data:") || url.startsWith("blob:")) return url;

  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return url;
    host = u.hostname;
  } catch {
    return url; // caminho relativo ou URL torta — deixa o browser resolver
  }
  if (!hostPermitido(host)) return url;

  // q=75 é o único valor liberado por padrão no Next 16; outro é coagido.
  return `/_next/image?url=${encodeURIComponent(url)}&w=${larguraValida(larguraPx)}&q=75`;
}

// ── Upload ───────────────────────────────────────────────────────────────────

/** Lado maior da foto guardada. 512 cobre o zoom da ficha sem inchar a coluna. */
const LADO_MAX = 512;
const QUALIDADE = 0.72;

/**
 * Encolhe a imagem escolhida e devolve `data:image/webp`.
 *
 * Roda no browser (canvas): o arquivo de 2 MB nunca sai da máquina do operador,
 * só os ~20 KB que sobram. Imagem menor que o limite também passa pelo canvas —
 * um JPEG de 400px ainda encolhe bastante virando WebP.
 *
 * Rejeita com mensagem em pt-BR pronta para o toast.
 */
export async function arquivoParaThumb(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("Não foi possível abrir o arquivo.");
  });

  const escala = Math.min(1, LADO_MAX / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * escala));
  const h = Math.max(1, Math.round(bitmap.height * escala));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Não foi possível processar a imagem.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const dataUrl = canvas.toDataURL("image/webp", QUALIDADE);
  // Browser sem encoder WebP devolve PNG silenciosamente — aí o JPEG comprime
  // melhor que o PNG que ele acabou de gerar.
  return dataUrl.startsWith("data:image/webp")
    ? dataUrl
    : canvas.toDataURL("image/jpeg", QUALIDADE);
}
