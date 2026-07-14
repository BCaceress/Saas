"use client";

import { useEffect, useRef } from "react";
import QRCode from "qrcode";

// QR Code do PIX. Usa a imagem do provedor quando existe (Mercado Pago
// devolve png base64); senão gera no cliente a partir do copia-e-cola —
// cobre o provedor Simulado e PSPs que só retornam o payload EMV.
export function PixQr({
  payload,
  imagemBase64,
  size = 208,
  className,
}: {
  /** PIX copia-e-cola (payload EMV). */
  payload: string | null | undefined;
  /** Imagem pronta do provedor (png base64, sem prefixo data:). */
  imagemBase64?: string | null;
  size?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (imagemBase64 || !payload || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, payload, {
      width: size,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#ffffff" },
    }).catch(() => {});
  }, [payload, imagemBase64, size]);

  if (imagemBase64) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- data-URI do provedor, next/image não otimiza base64
      <img
        src={`data:image/png;base64,${imagemBase64}`}
        alt="QR Code PIX — aponte a câmera do celular"
        width={size}
        height={size}
        className={className}
      />
    );
  }
  if (!payload) return null;
  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="QR Code PIX — aponte a câmera do celular"
      className={className}
    />
  );
}
