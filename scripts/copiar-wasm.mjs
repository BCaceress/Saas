// Copia o wasm do leitor de código de barras para public/wasm/.
//
// Roda no postinstall: o binário PRECISA ser da mesma versão do JS que o
// carrega — o zxing valida o hash. Copiar à mão e commitar sairia do ar em
// silêncio no dia em que a dependência subir de versão.
//
// Por que auto-hospedar: o `locateFile` padrão do zxing-wasm baixa de
// `fastly.jsdelivr.net`. Isso quebraria o scanner num mercado com internet
// ruim, vazaria uso para terceiro, e não passaria pelo cache do service
// worker. Ver `setZXingModuleOverrides` em components/mobile/scanner.tsx.

import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGEM = join(raiz, "node_modules", "zxing-wasm", "dist", "reader", "zxing_reader.wasm");
const DESTINO_DIR = join(raiz, "public", "wasm");
const DESTINO = join(DESTINO_DIR, "zxing_reader.wasm");

if (!existsSync(ORIGEM)) {
  // Não derruba o install: sem o wasm, o scanner ainda funciona no Android
  // (BarcodeDetector nativo) e sempre resta a digitação manual.
  console.warn("[copiar-wasm] zxing-wasm não encontrado — o scanner do iOS ficará indisponível.");
  process.exit(0);
}

await mkdir(DESTINO_DIR, { recursive: true });
await copyFile(ORIGEM, DESTINO);
console.log("[copiar-wasm] public/wasm/zxing_reader.wasm atualizado.");
