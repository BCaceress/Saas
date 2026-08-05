import { ImageResponse } from "next/og";
import { TRIAL_DIAS } from "@/lib/planos";

// Imagem que aparece quando o link é colado no WhatsApp, LinkedIn ou Slack —
// hoje o caminho mais comum de chegada num ERP de bairro é alguém mandar o link
// para o compadre. Sem ela, o link vai cru.
export const alt = "NoHub Market — o ERP do mercado de bairro";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "#101318",
          backgroundImage:
            "radial-gradient(ellipse 60% 80% at 85% 0%, rgba(249,115,22,0.30), transparent 62%)",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 12,
              background: "#f97316",
              display: "flex",
            }}
          />
          <div style={{ display: "flex", fontSize: 30, fontWeight: 700 }}>
            NoHub<span style={{ color: "#f97316" }}>.</span>
            <span style={{ color: "rgba(255,255,255,0.55)", fontWeight: 500 }}>Market</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              display: "flex",
              fontSize: 76,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: -2,
            }}
          >
            O mercado inteiro numa tela só.
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 30,
              color: "rgba(255,255,255,0.62)",
              maxWidth: 900,
              lineHeight: 1.35,
            }}
          >
            Produtos, estoque, compras, PDV, fiscal e clientes para mercadinho, conveniência e
            adega.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              display: "flex",
              padding: "12px 24px",
              borderRadius: 999,
              background: "#f97316",
              color: "#2a1204",
              fontSize: 26,
              fontWeight: 600,
            }}
          >
            {TRIAL_DIAS} dias grátis
          </div>
          <div style={{ display: "flex", fontSize: 26, color: "rgba(255,255,255,0.5)" }}>
            sem cartão · cancele quando quiser
          </div>
        </div>
      </div>
    ),
    size,
  );
}
