import type { CopilotoEvento } from "./tipos";

/** Um evento SSE por linha `data:` — o client (usar-copiloto-chat.ts) faz o parse manual. */
export function encodeSse(evento: CopilotoEvento): string {
  return `data: ${JSON.stringify(evento)}\n\n`;
}
