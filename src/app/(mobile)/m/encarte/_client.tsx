"use client";

import * as React from "react";
import { Camera, Check, ChevronDown, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { brl, cn } from "@/lib/utils";
import { lerEncarteAction, aplicarPrecosAction, type ItemEncarte } from "../acoes/actions";

/**
 * Foto de encarte → preços conferidos → preços gravados.
 *
 * O passo do meio é o produto inteiro. A leitura por imagem confunde "3 por
 * 10,00" com "R$ 3,10" e às vezes casa o refrigerante de 2L com o de 600ml;
 * aplicar direto trocaria erro de leitura por preço de prateleira. Então nada é
 * marcado por padrão: a pessoa liga item por item o que confere com o papel.
 *
 * A foto é reduzida AQUI, antes de subir. Uma foto de celular moderno tem 4-8 MB
 * e o que a leitura precisa é enxergar texto — 1600px de lado longo chega, e a
 * diferença é uma espera de segundos contra uma de minutos no 3G do depósito.
 */

const LADO_MAX = 1600;
const QUALIDADE = 0.82;

type Linha = ItemEncarte & {
  /** Vai ser gravado? Nasce desligado de propósito. */
  marcado: boolean;
  /** Produto escolhido — a sugestão ou uma das alternativas. */
  productId: string | null;
};

export function EncarteClient() {
  const [lendo, setLendo] = React.useState(false);
  const [salvando, setSalvando] = React.useState(false);
  const [linhas, setLinhas] = React.useState<Linha[] | null>(null);
  const refArquivo = React.useRef<HTMLInputElement>(null);

  async function aoEscolher(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    // Reset imediato: sem isso, escolher a MESMA foto de novo não dispara
    // `change` e a tela parece travada.
    e.target.value = "";
    if (!arquivo) return;

    setLendo(true);
    try {
      const media = await reduzirParaBase64(arquivo);
      const r = await lerEncarteAction(media);
      if (!r.ok) {
        toast.error("Não deu para ler", r.erro);
        return;
      }
      setLinhas(
        r.itens.map((i) => ({
          ...i,
          marcado: false,
          productId: i.sugestao?.productId ?? null,
        })),
      );
    } catch {
      toast.error("Não deu para ler", "Tente de novo com a foto mais de frente.");
    } finally {
      setLendo(false);
    }
  }

  async function aplicar() {
    if (!linhas) return;
    const alvo = linhas.filter((l) => l.marcado && l.productId);
    if (alvo.length === 0) return;

    setSalvando(true);
    try {
      const r = await aplicarPrecosAction({
        itens: alvo.map((l) => ({ productId: l.productId as string, preco: l.preco })),
      });
      toast.success(
        "Preços atualizados",
        `${r.alterados} ${r.alterados === 1 ? "produto" : "produtos"} com preço novo.`,
      );
      setLinhas(null);
    } catch (e) {
      toast.error(
        "Não foi possível gravar",
        e instanceof Error ? e.message : "Tente de novo em instantes.",
      );
    } finally {
      setSalvando(false);
    }
  }

  const marcados = linhas?.filter((l) => l.marcado && l.productId).length ?? 0;

  if (!linhas) {
    return (
      <div className="space-y-3">
        <Card className="space-y-3 p-4">
          <p className="text-sm text-ink-2">
            Fotografe o encarte, a tabela do fornecedor ou a etiqueta da gôndola. O
            texto é lido e casado com o seu catálogo — nada é gravado sem a sua
            conferência.
          </p>
          <Button
            onClick={() => refArquivo.current?.click()}
            disabled={lendo}
            className="w-full"
            size="lg"
          >
            {lendo ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Camera className="h-4 w-4" aria-hidden />
            )}
            {lendo ? "Lendo a foto…" : "Tirar foto"}
          </Button>
          <input
            ref={refArquivo}
            type="file"
            accept="image/*"
            // `capture` pede a câmera traseira direto; quem quiser a galeria
            // ainda consegue pelo seletor do sistema.
            capture="environment"
            onChange={aoEscolher}
            className="sr-only"
            aria-label="Foto do encarte"
          />
        </Card>

        <p className="px-1 text-xs text-muted">
          Funciona melhor de frente, com a folha inteira no quadro e sem sombra em
          cima do preço.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-ink-2">
          {linhas.length} {linhas.length === 1 ? "item lido" : "itens lidos"} · {marcados}{" "}
          marcado{marcados === 1 ? "" : "s"}
        </p>
        <button
          type="button"
          onClick={() => setLinhas(null)}
          className="flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border border-line-button px-3 text-[13px] font-medium text-ink-2"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          Outra foto
        </button>
      </div>

      <ul className="space-y-2">
        {linhas.map((linha, i) => (
          <LinhaEncarte
            key={`${linha.descricao}-${i}`}
            linha={linha}
            onMudar={(nova) =>
              setLinhas((atual) => atual!.map((l, j) => (j === i ? nova : l)))
            }
          />
        ))}
      </ul>

      {/* Rodapé fixo: a lista é longa e o botão de gravar não pode depender de
          rolar até o fim. */}
      <div className="sticky bottom-24 z-10">
        <Button
          onClick={aplicar}
          disabled={marcados === 0 || salvando}
          className="w-full shadow-[var(--shadow-2)]"
          size="lg"
        >
          {salvando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {marcados === 0
            ? "Marque o que confere"
            : `Aplicar ${marcados} ${marcados === 1 ? "preço" : "preços"}`}
        </Button>
      </div>
    </div>
  );
}

function LinhaEncarte({
  linha,
  onMudar,
}: {
  linha: Linha;
  onMudar: (nova: Linha) => void;
}) {
  const [abrindo, setAbrindo] = React.useState(false);

  const escolhido =
    linha.productId === linha.sugestao?.productId
      ? linha.sugestao
      : (linha.alternativas.find((a) => a.productId === linha.productId) ?? null);

  const semCasar = escolhido == null;
  const precoAtual = linha.sugestao?.precoAtual ?? null;
  const variacao =
    precoAtual != null && precoAtual > 0
      ? ((linha.preco - precoAtual) / precoAtual) * 100
      : null;

  return (
    <li>
      <Card className={cn("p-3", linha.marcado && "ring-2 ring-brand/40")}>
        <div className="flex items-start gap-3">
          <button
            type="button"
            role="checkbox"
            aria-checked={linha.marcado}
            aria-label={`Aplicar preço de ${linha.descricao}`}
            disabled={semCasar}
            onClick={() => onMudar({ ...linha, marcado: !linha.marcado })}
            className={cn(
              "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md border transition-colors",
              semCasar
                ? "cursor-not-allowed border-line bg-surface-2"
                : linha.marcado
                  ? "cursor-pointer border-transparent bg-brand text-on-brand"
                  : "cursor-pointer border-line-strong bg-surface",
            )}
          >
            {linha.marcado && <Check className="h-4 w-4" aria-hidden />}
          </button>

          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-muted">
              lido: {linha.descricao}
              {linha.unidade && ` · ${linha.unidade}`}
            </p>

            {escolhido ? (
              <p className="truncate font-medium text-ink">{escolhido.nome}</p>
            ) : (
              <p className="font-medium text-warn">Sem produto correspondente</p>
            )}

            <p className="mt-0.5 text-sm">
              <span className="font-display font-semibold text-ink">{brl(linha.preco)}</span>
              {precoAtual != null && (
                <span className="text-muted">
                  {" "}
                  · hoje {brl(precoAtual)}
                  {variacao != null && Math.abs(variacao) >= 0.5 && (
                    <span className={variacao > 0 ? "text-danger" : "text-ok"}>
                      {" "}
                      ({variacao > 0 ? "+" : ""}
                      {variacao.toFixed(0)}%)
                    </span>
                  )}
                </span>
              )}
            </p>

            {linha.alternativas.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setAbrindo((v) => !v)}
                  aria-expanded={abrindo}
                  className="mt-1 flex min-h-9 cursor-pointer items-center gap-1 text-[13px] font-medium text-brand"
                >
                  {semCasar ? "Escolher produto" : "Não é esse"}
                  <ChevronDown
                    className={cn("h-3.5 w-3.5 transition-transform", abrindo && "rotate-180")}
                    aria-hidden
                  />
                </button>

                {abrindo && (
                  <ul className="mt-1 divide-y divide-line rounded-lg border border-line">
                    {linha.alternativas.map((a) => (
                      <li key={a.productId}>
                        <button
                          type="button"
                          onClick={() => {
                            onMudar({ ...linha, productId: a.productId, marcado: true });
                            setAbrindo(false);
                          }}
                          className="flex min-h-11 w-full cursor-pointer items-center px-3 text-left text-[13px] hover:bg-surface-2"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-ink">{a.nome}</span>
                            <span className="block font-mono text-xs text-muted">{a.sku}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </div>
      </Card>
    </li>
  );
}

/**
 * Redimensiona no browser e devolve base64 sem o prefixo `data:`.
 *
 * `createImageBitmap` respeita a orientação EXIF — sem isso, foto tirada em pé
 * chega deitada no leitor e o texto vira ilegível.
 */
async function reduzirParaBase64(
  arquivo: File,
): Promise<{ mimeType: string; base64: string }> {
  const bitmap = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
  const escala = Math.min(1, LADO_MAX / Math.max(bitmap.width, bitmap.height));
  const largura = Math.round(bitmap.width * escala);
  const altura = Math.round(bitmap.height * escala);

  const canvas = document.createElement("canvas");
  canvas.width = largura;
  canvas.height = altura;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("sem canvas");
  ctx.drawImage(bitmap, 0, 0, largura, altura);
  bitmap.close();

  const dataUrl = canvas.toDataURL("image/jpeg", QUALIDADE);
  return { mimeType: "image/jpeg", base64: dataUrl.slice(dataUrl.indexOf(",") + 1) };
}
