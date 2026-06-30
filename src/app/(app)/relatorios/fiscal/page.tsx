import { FileText } from "lucide-react";
import { ChartCard } from "@/components/charts/chart-card";

/**
 * Relatório fiscal (PRD §5) — reaproveita os dados da Fase 5 (emissão NFC-e via
 * gateway). A Fase 5 ainda não foi implementada (sem FiscalDocument no schema),
 * então a tela é um placeholder honesto, sem desenhar números fantasma.
 */
export default function RelatorioFiscal() {
  return (
    <ChartCard title="Documentos fiscais" subtitle="Emitidos · rejeitados · cancelados">
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <FileText size={36} className="text-faint" />
        <p className="max-w-md text-sm font-medium text-muted">
          O relatório fiscal entra junto com a emissão de NFC-e (Fase 5). Assim que
          a emissão estiver ativa, a saúde dos documentos aparece aqui.
        </p>
        <p className="text-xs text-faint">Vendas e pagamentos já estão disponíveis nas outras abas.</p>
      </div>
    </ChartCard>
  );
}
