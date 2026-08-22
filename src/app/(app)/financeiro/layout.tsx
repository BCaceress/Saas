import { requirePermissao } from "@/lib/guard";

// O módulo inteiro exige ver o financeiro. Nenhuma tela aqui é consulta
// inofensiva: saber quanto a loja deve é informação de dono.

export default async function FinanceiroLayout({ children }: { children: React.ReactNode }) {
  await requirePermissao("financeiro.ver");
  return <div className="flex flex-col gap-5">{children}</div>;
}
