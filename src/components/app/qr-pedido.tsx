"use client";

import * as React from "react";
import QRCode from "qrcode";
import { Printer } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { codigoDoPedido } from "@/lib/codigo-lido";

/**
 * QR do pedido de compra — a etiqueta que fecha o "Modo recebimento".
 *
 * Sem ele, quem recebe abre o app, entra em Receber, procura o fornecedor na
 * lista e confere se é aquele pedido mesmo. Com ele, aponta a câmera para o
 * papel que veio com a carga e a conferência já abre no pedido certo.
 *
 * O conteúdo é `nohub://pc/<id>`, não uma URL: um QR com link levaria quem não
 * é da empresa a uma tela de login, e o esquema próprio deixa explícito que
 * aquilo só significa algo dentro do app (ver lib/codigo-lido).
 *
 * Gerado no cliente, em canvas: são 30 bytes de payload e nenhuma ida ao
 * servidor — o id do pedido já está na tela.
 */
export function QrPedidoSheet({
  open,
  onClose,
  pedidoId,
  numero,
  fornecedor,
  empresa,
}: {
  open: boolean;
  onClose: () => void;
  pedidoId: string;
  numero: string;
  fornecedor: string;
  empresa: string;
}) {
  const ref = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    if (!open || !ref.current) return;
    QRCode.toCanvas(ref.current, codigoDoPedido(pedidoId), {
      width: 320,
      margin: 2,
      // "M" aguenta um QR amassado na caixa sem virar código ilegível, e ainda
      // mantém o desenho grosso o bastante para leitura de longe.
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#ffffff" },
    }).catch(() => {});
  }, [open, pedidoId]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="QR de recebimento"
      description={`${numero} · ${fornecedor}`}
      footer={
        <Button onClick={() => window.print()} className="w-full">
          <Printer size={16} />
          Imprimir
        </Button>
      }
    >
      {/* `qr-folha` é o que sobra na impressão — ver a regra @media abaixo. */}
      <div className="qr-folha flex flex-col items-center gap-4 py-4 text-center">
        <div className="rounded-xl border border-line bg-white p-4">
          <canvas
            ref={ref}
            role="img"
            aria-label={`QR do pedido ${numero} — aponte a câmera do aplicativo`}
          />
        </div>

        <div>
          <p className="font-display text-lg font-semibold text-ink">{numero}</p>
          <p className="text-sm text-ink-2">{fornecedor}</p>
          <p className="mt-1 text-xs text-muted">{empresa}</p>
        </div>

        <p className="max-w-xs text-[13px] text-muted print:hidden">
          Imprima e mande junto do pedido. Na entrega, quem recebe aponta a câmera do
          aplicativo e a conferência abre neste pedido.
        </p>
      </div>

      <style>{`@media print{
        body *{visibility:hidden}
        .qr-folha,.qr-folha *{visibility:visible}
        .qr-folha{position:fixed;inset:0;display:flex;align-items:center;justify-content:center}
        @page{size:A4;margin:20mm}
      }`}</style>
    </Sheet>
  );
}
