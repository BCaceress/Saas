"use client";

import * as React from "react";
import { Camera, CameraOff, Flashlight, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Leitor de código de barras pela câmera.
 *
 * Uma API só no componente: o `BarcodeDetector` nativo quando existe
 * (Chrome/Edge no Android), e o ponyfill `barcode-detector` quando não —
 * mesma classe, apoiada em WebAssembly. O ponyfill entra por `await import()`,
 * então o ~1 MB de wasm só desce em quem precisa dele (iOS, Firefox).
 *
 * O wasm é servido de `/wasm/` (ver scripts/copiar-wasm.mjs). O padrão da
 * biblioteca é baixar de um CDN — inaceitável aqui: quebraria num mercado com
 * internet ruim e mandaria tráfego para terceiro.
 *
 * EXIGE contexto seguro (HTTPS ou localhost): `getUserMedia` não existe fora
 * dele. Em rede local use as receitas do plano (port forwarding do Chrome ou
 * mkcert). Por isso a digitação manual nunca sai da tela — é a saída para
 * câmera negada, aparelho sem câmera e código rasgado.
 */

type Estado =
  | "iniciando"
  | "pedindo-permissao"
  | "lendo"
  | "negada"
  | "sem-camera"
  | "sem-suporte";

const FORMATOS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "itf"] as const;

/** Ignora releituras do mesmo código por este tempo. */
const DEBOUNCE_MS = 1500;

type DetectorLike = {
  detect: (fonte: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
};

async function criarDetector(): Promise<DetectorLike | null> {
  const nativo = (globalThis as { BarcodeDetector?: new (o: unknown) => DetectorLike })
    .BarcodeDetector;
  if (nativo) return new nativo({ formats: FORMATOS });

  try {
    const { BarcodeDetector, setZXingModuleOverrides } = await import(
      "barcode-detector/ponyfill"
    );
    // Precisa vir ANTES de construir o detector: é quem decide de onde o wasm
    // é baixado, e o padrão da biblioteca é um CDN externo.
    setZXingModuleOverrides({ locateFile: () => "/wasm/zxing_reader.wasm" });
    return new BarcodeDetector({ formats: [...FORMATOS] }) as DetectorLike;
  } catch {
    return null;
  }
}

export function Scanner({
  onCodigo,
  onFechar,
  continuo = false,
  ocupado = false,
}: {
  onCodigo: (codigo: string) => void;
  onFechar?: () => void;
  /** Contagem de inventário lê sem parar; consulta para no primeiro acerto. */
  continuo?: boolean;
  /** Trava a leitura enquanto o pai processa o código anterior. */
  ocupado?: boolean;
}) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const ultimoRef = React.useRef<{ codigo: string; em: number }>({ codigo: "", em: 0 });
  const pararRef = React.useRef(false);
  const ocupadoRef = React.useRef(ocupado);

  const [estado, setEstado] = React.useState<Estado>("iniciando");
  const [temLanterna, setTemLanterna] = React.useState(false);
  const [lanterna, setLanterna] = React.useState(false);

  const onCodigoRef = React.useRef(onCodigo);

  // O laço de leitura roda fora do React (requestAnimationFrame). Espelhar
  // `ocupado` e o callback em refs mantém o laço vendo o valor atual sem ter
  // de ser recriado — recriar significaria reabrir a câmera. A escrita mora
  // num efeito sem lista de dependências: gravar ref durante o render deixa o
  // valor inconsistente entre render e commit.
  React.useEffect(() => {
    ocupadoRef.current = ocupado;
    onCodigoRef.current = onCodigo;
  });

  React.useEffect(() => {
    pararRef.current = false;
    let raf = 0;

    async function iniciar() {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setEstado("sem-suporte");
        return;
      }

      const detector = await criarDetector();
      if (!detector) {
        setEstado("sem-suporte");
        return;
      }
      if (pararRef.current) return;

      setEstado("pedindo-permissao");

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // `ideal` e não `exact`: num aparelho só com câmera frontal, `exact`
          // falharia em vez de usar a que existe.
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
          audio: false,
        });
      } catch (e) {
        const nome = e instanceof DOMException ? e.name : "";
        setEstado(nome === "NotFoundError" || nome === "OverconstrainedError" ? "sem-camera" : "negada");
        return;
      }

      if (pararRef.current) {
        for (const t of stream.getTracks()) t.stop();
        return;
      }

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      // `playsInline` também está no JSX; sem ele o iOS abre em tela cheia.
      await video.play().catch(() => {});

      const track = stream.getVideoTracks()[0];
      const caps = track?.getCapabilities?.() as { torch?: boolean } | undefined;
      setTemLanterna(Boolean(caps?.torch));

      setEstado("lendo");

      const laco = async () => {
        if (pararRef.current) return;
        const v = videoRef.current;
        if (v && v.readyState >= 2 && !ocupadoRef.current) {
          try {
            const achados = await detector.detect(v);
            const bruto = achados[0]?.rawValue?.trim();
            if (bruto) {
              const agora = Date.now();
              const ultimo = ultimoRef.current;
              const repetido = ultimo.codigo === bruto && agora - ultimo.em < DEBOUNCE_MS;
              if (!repetido) {
                ultimoRef.current = { codigo: bruto, em: agora };
                navigator.vibrate?.(30);
                onCodigoRef.current(bruto);
                if (!continuo) {
                  pararRef.current = true;
                  return;
                }
              }
            }
          } catch {
            // Quadro ruim (foco, movimento): tenta o próximo.
          }
        }
        raf = requestAnimationFrame(() => void laco());
      };

      void laco();
    }

    void iniciar();

    // Câmera ligada em segundo plano come bateria e, no iOS, trava o stream ao
    // voltar. Solta ao sair da aba.
    const aoTrocarVisibilidade = () => {
      if (document.visibilityState === "hidden") {
        for (const t of streamRef.current?.getTracks() ?? []) t.stop();
      }
    };
    document.addEventListener("visibilitychange", aoTrocarVisibilidade);

    return () => {
      pararRef.current = true;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", aoTrocarVisibilidade);
      for (const t of streamRef.current?.getTracks() ?? []) t.stop();
      streamRef.current = null;
    };
  }, [continuo]);

  async function alternarLanterna() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const proximo = !lanterna;
    try {
      await track.applyConstraints({
        advanced: [{ torch: proximo } as MediaTrackConstraintSet],
      });
      setLanterna(proximo);
    } catch {
      setTemLanterna(false);
    }
  }

  return (
    <div className="relative overflow-hidden rounded-[var(--radius-lg)] border border-line bg-ink">
      <video
        ref={videoRef}
        playsInline
        muted
        // `aspect-[3/4]` deixa a mira alta o bastante para o código caber sem a
        // pessoa afastar o braço.
        className={cn(
          "aspect-[3/4] w-full object-cover",
          estado !== "lendo" && "invisible",
        )}
      />

      {estado === "lendo" && (
        <>
          {/* Mira: a faixa clara diz onde encostar o código. */}
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="h-28 w-4/5 rounded-xl border-2 border-white/80 shadow-[0_0_0_100vmax_rgba(0,0,0,0.35)]" />
          </div>

          <p className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs font-medium text-white/90">
            {ocupado ? "Consultando…" : "Aponte para o código de barras"}
          </p>
        </>
      )}

      {estado !== "lendo" && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center">
          <Aviso estado={estado} />
        </div>
      )}

      <div className="absolute top-2 right-2 flex gap-2">
        {temLanterna && estado === "lendo" && (
          <button
            type="button"
            onClick={alternarLanterna}
            aria-pressed={lanterna}
            aria-label="Lanterna"
            className={cn(
              "grid h-10 w-10 place-items-center rounded-full backdrop-blur",
              lanterna ? "bg-white text-ink" : "bg-black/40 text-white",
            )}
          >
            <Flashlight className="h-5 w-5" />
          </button>
        )}

        {onFechar && (
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar câmera"
            className="grid h-10 w-10 place-items-center rounded-full bg-black/40 text-white backdrop-blur"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>
  );
}

/** Só é montado quando NÃO está lendo — o tipo diz isso para o TS. */
function Aviso({ estado }: { estado: Exclude<Estado, "lendo"> }) {
  if (estado === "iniciando" || estado === "pedindo-permissao") {
    return (
      <div className="flex flex-col items-center gap-2 text-white/80">
        <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
        <p className="text-sm">
          {estado === "pedindo-permissao" ? "Liberando a câmera…" : "Preparando o leitor…"}
        </p>
      </div>
    );
  }

  const TEXTO: Record<
    Exclude<Estado, "iniciando" | "pedindo-permissao" | "lendo">,
    { icone: typeof Camera; titulo: string; corpo: string }
  > = {
    negada: {
      icone: CameraOff,
      titulo: "Câmera bloqueada",
      corpo:
        "Libere a câmera para este site nas configurações do navegador e recarregue a página. Enquanto isso, digite o código abaixo.",
    },
    "sem-camera": {
      icone: CameraOff,
      titulo: "Nenhuma câmera encontrada",
      corpo: "Este aparelho não tem câmera disponível. Digite o código abaixo.",
    },
    "sem-suporte": {
      icone: Camera,
      titulo: "Leitor indisponível",
      corpo:
        "Este navegador não consegue ler a câmera aqui. Isso costuma acontecer fora de HTTPS. Digite o código abaixo.",
    },
  };

  const { icone: Icone, titulo, corpo } = TEXTO[estado];

  return (
    <div className="flex flex-col items-center gap-2 text-white/90">
      <Icone className="h-8 w-8" aria-hidden />
      <p className="font-display text-base font-semibold">{titulo}</p>
      <p className="max-w-xs text-sm text-white/70">{corpo}</p>
    </div>
  );
}
