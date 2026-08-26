import { cn } from "@/lib/utils";

// ============================================================
// O que a nota diz × o que o NoHub guarda.
//
// Uma tabela só, usada nos dois momentos em que a pergunta aparece: ao
// cadastrar um produto que a nota trouxe e ao revisar uma linha que destoa do
// cadastro. O lado "NoHub" muda de significado entre os dois (lá é o que VAI
// ser salvo, aqui é o que JÁ está), então quem chama monta as linhas — o que
// não muda, e por isso mora aqui, é a leitura em colunas vizinhas.
// ============================================================

export type LinhaComparacao = {
  rotulo: string;
  /** Sem valor no XML a linha não é desenhada — coluna vazia não informa. */
  xml: string | null;
  nohub: React.ReactNode;
  /** Destaca o par: é aqui que os dois lados não fecham. */
  diverge?: boolean;
};

export function TabelaComparacao({ linhas }: { linhas: LinhaComparacao[] }) {
  const visiveis = linhas.filter((l) => l.xml);
  if (visiveis.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded-[var(--radius)] border border-line bg-surface">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-line text-[10px] font-medium tracking-wide text-faint uppercase">
            <th className="px-3 py-2 text-left font-medium">Informação</th>
            <th className="px-3 py-2 text-left font-medium">XML</th>
            <th className="px-3 py-2 text-left font-medium">NoHub</th>
          </tr>
        </thead>
        <tbody>
          {visiveis.map((l) => (
            <tr
              key={l.rotulo}
              className={cn(
                "border-b border-line/60 last:border-0",
                l.diverge && "bg-warn-soft/60",
              )}
            >
              <td className="px-3 py-1.5 whitespace-nowrap text-muted">{l.rotulo}</td>
              <td className="px-3 py-1.5 font-mono text-ink-2">{l.xml}</td>
              <td className={cn("px-3 py-1.5", l.diverge ? "font-medium text-ink" : "text-ink-2")}>
                {l.nohub}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
